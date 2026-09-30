# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Connection to soffice and execution of UNO work on LibreOffice's main thread."""

import gc
import logging
import threading
import time
import weakref

import uno
import unohelper
from com.sun.star.awt import XCallback
from com.sun.star.lang import XEventListener

from .errors import RpcError, detached_error, is_connection_lost, uno_message
from .protocol import ErrorCode
from .values import StructFields, property_value

log = logging.getLogger('simpaper.office')

SYSTEM_WIN32 = 1  # css::lang::SystemDependent::SYSTEM_WIN32
# doc.close must stay well inside the 5 s main-core allows it; releases take milliseconds once soffice is idle.
RELEASE_BARRIER_TIMEOUT_S = 3.0
# How often a caller waiting for a main-thread job checks whether the connection was lost meanwhile.
LOST_POLL_S = 0.1
CONNECTION_LOST_MESSAGE = 'the connection to soffice was lost'


class _Job(unohelper.Base, XCallback):
    """One unit of work posted to the main thread. States: queued -> running -> done | cancelled."""

    def __init__(self, fn, label):
        self._fn = fn
        self.label = label
        self.done = threading.Event()
        self.result = None
        self.error = None
        self.state = 'queued'
        self.modal = False
        self._lock = threading.Lock()

    def notify(self, _data):
        with self._lock:
            if self.state == 'cancelled':
                self.done.set()
                return
            self.state = 'running'
        try:
            self.result = self._fn()
        except BaseException as exc:  # reported to the caller, never to soffice
            # A plain copy only: the traceback would keep UNO proxies of the failed frames alive.
            try:
                self.error = detached_error(exc)
            except Exception:
                self.error = RpcError(ErrorCode.INTERNAL, '%s failed' % (self.label or 'job'))
        finally:
            self._fn = None  # drop the closure (and the proxies it captured) now, on the main thread
            with self._lock:
                self.state = 'done'
            self.done.set()

    def cancel_if_queued(self):
        with self._lock:
            if self.state == 'queued':
                self.state = 'cancelled'
                return True
            return False


class MainThreadExecutor:
    """Runs callables on LibreOffice's main (VCL) thread through com.sun.star.awt.AsyncCallback.

    soffice calls XCallback.notify() synchronously from its main thread; UNO calls made from inside
    notify() carry that thread's identity over URP, so soffice executes them on its main thread as
    well. This avoids UNO calls racing with painting (tdf#172048, tdf#172304).
    """

    def __init__(self, async_callback, lost=None):
        self._acb = async_callback
        self._lock = threading.Lock()
        self._lingering = None
        # threading.Event set when the URP connection is gone: a job can then never run or report back.
        self._lost = lost

    def _connection_lost(self):
        return self._lost is not None and self._lost.is_set()

    def _check_lingering(self):
        with self._lock:
            job = self._lingering
            if job is None or job.state == 'done':
                self._lingering = None
                return
            if not job.modal:
                raise RpcError(ErrorCode.BUSY, 'engine busy: %s is still running' % job.label)

    def run(self, fn, timeout, label='', release=None):
        """Executes fn() on the main thread and returns its result (or raises its exception).

        release: optional threading.Event. If it is set while the job runs (a modal LibreOffice dialog
        opened), run() returns None early; the job keeps running inside the dialog's event loop and later
        jobs are allowed to run nested in that loop, exactly like UI events.
        """
        self._check_lingering()
        if self._connection_lost():
            raise RpcError(ErrorCode.ENGINE_UNAVAILABLE, CONNECTION_LOST_MESSAGE)
        job = _Job(fn, label)
        self._acb.addCallback(job, None)
        deadline = time.monotonic() + timeout
        step = 0.02 if release is not None else LOST_POLL_S
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            if job.done.wait(min(step, remaining)):
                if job.error is not None:
                    raise job.error
                return job.result
            if release is not None and release.is_set() and job.state == 'running':
                job.modal = True
                with self._lock:
                    self._lingering = job
                return None
            if self._connection_lost():
                # soffice will never run (or finish reporting) this job: answer now instead of after the timeout.
                job.cancel_if_queued()
                raise RpcError(ErrorCode.ENGINE_UNAVAILABLE, '%s: %s' % (CONNECTION_LOST_MESSAGE, label))
        if job.cancel_if_queued():
            raise RpcError(ErrorCode.TIMEOUT, '%s did not start within %.0f s (main thread busy)' % (label, timeout))
        with self._lock:
            self._lingering = job
        raise RpcError(ErrorCode.TIMEOUT, '%s did not finish within %.0f s' % (label, timeout))


def connect(pipe, timeout):
    """Connects to soffice's UNO acceptor on the named pipe, retrying until `timeout` seconds.

    Returns (remote component context, URP bridge). The steps are those of UnoUrlResolver.resolve()
    (Connector, anonymous 'urp' bridge, getInstance), but the bridge is kept: its disposing() event is how
    the bridge learns that the connection is gone (Office.watch_connection).
    """
    local = uno.getComponentContext()
    connector = local.ServiceManager.createInstanceWithContext('com.sun.star.connection.Connector', local)
    factory = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.BridgeFactory', local)
    deadline = time.monotonic() + timeout
    delay = 0.05
    attempts = 0
    while True:
        attempts += 1
        bridge = None
        try:
            connection = connector.connect('pipe,name=%s' % pipe)
            bridge = factory.createBridge('', 'urp', connection, None)
            ctx = bridge.getInstance('StarOffice.ComponentContext')
            if ctx is None:
                raise RpcError(ErrorCode.ENGINE_UNAVAILABLE, 'soffice offers no component context yet')
            log.info('connected to soffice after %d attempt(s)', attempts)
            return ctx, bridge
        except Exception as exc:  # NoConnectException until the acceptor is up
            last = exc
            if bridge is not None:
                try:
                    bridge.dispose()
                except Exception:
                    pass
            bridge = None
        if time.monotonic() >= deadline:
            raise RpcError(ErrorCode.ENGINE_UNAVAILABLE, 'cannot connect to soffice: %s' % uno_message(last))
        time.sleep(delay)
        delay = min(delay * 1.5, 0.25)


class _ConnectionListener(unohelper.Base, XEventListener):
    """Registered at the URP bridge: binaryurp calls disposing() when the connection ends (soffice exited or
    was killed, or binaryurp itself gave up on the connection, e.g. on a string it cannot marshal)."""

    def __init__(self, on_disposed):
        self._on_disposed = on_disposed

    def disposing(self, _event):
        try:
            self._on_disposed('URP bridge disposed')
        except Exception:
            log.exception('connection loss callback failed')


class ConnectionLoss:
    """Whether the URP connection to soffice is gone (it never comes back), reported once to a callback."""

    def __init__(self):
        self.event = threading.Event()
        self._lock = threading.Lock()
        self._callback = None
        self._reason = None
        self._reported = False

    @property
    def lost(self):
        return self.event.is_set()

    def watch(self, bridge, callback):
        """Calls callback(reason) once when the connection is lost: when binaryurp disposes `bridge`, or when a
        call noticed it first (mark). A bridge that is already disposed reports at once (binaryurp calls
        disposing() from addEventListener)."""
        with self._lock:
            self._callback = callback
            report = self.event.is_set() and not self._reported
            self._reported = self._reported or report
        if report:
            callback(self._reason)
            return
        if bridge is None:
            return
        try:
            bridge.addEventListener(_ConnectionListener(self.mark))
        except Exception as exc:
            if is_connection_lost(exc):
                self.mark(uno_message(exc))
            else:
                log.warning('the connection to soffice cannot be watched', exc_info=True)

    def mark(self, reason):
        """Records the loss (idempotent). Called on binaryurp's reader thread or on the request worker."""
        with self._lock:
            if self.event.is_set():
                return
            self._reason = reason
            self.event.set()
            callback = self._callback
            self._reported = callback is not None
        if callback is not None:
            callback(reason)


class _ReleaseToken(unohelper.Base, XEventListener):
    """Python object lent to soffice by Office.release_barrier(); it dies when soffice releases it."""

    def disposing(self, _event):
        pass


class Office:
    """Services of one connected soffice process."""

    def __init__(self, ctx, bridge=None):
        self.ctx = ctx
        self.urp_bridge = bridge
        self.connection_loss = ConnectionLoss()
        self.smgr = ctx.ServiceManager
        self.desktop = self.create('com.sun.star.frame.Desktop')
        self.toolkit = self.create('com.sun.star.awt.Toolkit')
        self.transformer = self.create('com.sun.star.util.URLTransformer')
        self.dispatch_helper = self.create('com.sun.star.frame.DispatchHelper')
        self.executor = MainThreadExecutor(self.create('com.sun.star.awt.AsyncCallback'), self.connection_loss.event)
        self.invocation = self.create('com.sun.star.script.Invocation')
        self.fields = StructFields(uno.getComponentContext())

    @property
    def lost(self):
        """True once the URP connection to soffice is gone; it never comes back."""
        return self.connection_loss.lost

    def watch_connection(self, on_lost):
        """on_lost(reason) is called once when the connection is lost (see ConnectionLoss.watch)."""
        self.connection_loss.watch(self.urp_bridge, on_lost)

    def mark_lost(self, reason):
        """A call failed because the connection is gone (binaryurp may not have reported it yet)."""
        self.connection_loss.mark(reason)

    def release_barrier(self, timeout=RELEASE_BARRIER_TIMEOUT_S):
        """Waits until soffice has processed every UNO release this process has sent so far.

        binaryurp sends all releases on one dedicated logical thread ("releasehack",
        binaryurp/source/bridge.cxx), so soffice processes them in order but asynchronously, off its
        main thread. A shape proxy whose release is processed after its document was closed destroys an
        SdrObject whose item pool is gone and crashes soffice.bin (docs/dev/engine.md, "Release after
        close"). Closing therefore drops our proxies first and then waits here: an Invocation adapter in
        soffice that holds a Python object of ours is released last; when soffice has destroyed it, it
        releases our object in turn. Garbage cycles are collected first so that their proxies go too.

        Never call this on LibreOffice's main thread (pending destructors may need the SolarMutex).
        Returns False on timeout.
        """
        gc.collect()
        released = threading.Event()
        token = _ReleaseToken()
        weakref.finalize(token, released.set)
        holder = self.invocation.createInstanceWithArguments((token,))
        del token
        del holder
        return released.wait(timeout)

    def create(self, service):
        return self.smgr.createInstanceWithContext(service, self.ctx)

    def config(self, nodepath):
        provider = self.create('com.sun.star.configuration.ConfigurationProvider')
        return provider.createInstanceWithArguments(
            'com.sun.star.configuration.ConfigurationAccess', (property_value('nodepath', nodepath),))

    def version(self):
        """Product version, e.g. '26.8.0.3' (ooSetupVersion + ooSetupExtension, as in the About box)."""
        product = self.config('/org.openoffice.Setup/Product')
        about = product.getByName('ooSetupVersionAboutBox') or ''
        if about.count('.') >= 3:
            version = about
        else:
            version = (product.getByName('ooSetupVersion') or '') + (product.getByName('ooSetupExtension') or '')
        suffix = product.getByName('ooSetupVersionAboutBoxSuffix') or ''
        return (version + suffix).strip()

    def url(self, command):
        """css::util::URL for a command such as '.uno:Bold'."""
        url = uno.createUnoStruct('com.sun.star.util.URL')
        url.Complete = command
        _ok, url = self.transformer.parseStrict(url)
        return url

    def module_shortcuts(self, module_identifier):
        supplier = self.create('com.sun.star.ui.ModuleUIConfigurationManagerSupplier')
        return supplier.getUIConfigurationManager(module_identifier).getShortCutManager()

    def global_shortcuts(self):
        return self.create('com.sun.star.ui.GlobalAcceleratorConfiguration')
