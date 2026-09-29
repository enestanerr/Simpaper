# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""JSON-RPC method implementations (EngineMethods in src/shared/engine-protocol.ts)."""

import logging
import os
import platform
import re
import threading
import time

import uno
from com.sun.star.awt import KeyEvent

from . import __version__, ops
from .documents import Documents, close_model, parse_hwnd, raise_load_error, set_no_parent_notify, store_to_url
from .errors import RpcError, is_connection_lost, uno_message, uno_type_name
from .keys import key_constant_name, parse_key_name
from .listeners import InteractionHandler, TopWindowListener
from .office import Office, connect
from .owned import own_window
from .protocol import EXIT_CONNECTION_LOST, MODULE_IDENTIFIER, NEW_DOCUMENT_URL, PROTOCOL_VERSION, VIEW_MODES, ErrorCode
from .values import from_uno, property_value, to_url

log = logging.getLogger('varak.methods')

DEFAULT_TIMEOUT_S = 120.0
LONG_TIMEOUT_S = 900.0     # load / store / convert of large files
SHUTDOWN_CLOSE_TIMEOUT_S = 20.0
# Hyphens occur in shape commands (.uno:BasicShapes.round-rectangle, .uno:ArrowShapes.left-right-arrow).
_COMMAND = re.compile(r'^\.uno:[A-Za-z][A-Za-z0-9_.-]*(\?.*)?$', re.S)


class Params:
    """Validated access to a request's params object."""

    def __init__(self, params):
        if params is None:
            params = {}
        if not isinstance(params, dict):
            raise RpcError(ErrorCode.INVALID_PARAMS, 'params must be an object')
        self._p = params

    def raw(self, name, default=None):
        return self._p.get(name, default)

    def str(self, name, required=True, allow_empty=False):
        value = self._p.get(name)
        if value is None and not required:
            return None
        if not isinstance(value, str) or (not allow_empty and not value):
            raise RpcError(ErrorCode.INVALID_PARAMS, '%s must be a%s string' % (name, '' if allow_empty else ' non-empty'))
        return value

    def bool(self, name, default=False):
        value = self._p.get(name, default)
        if not isinstance(value, bool):
            raise RpcError(ErrorCode.INVALID_PARAMS, '%s must be a boolean' % name)
        return value

    def int(self, name):
        value = self._p.get(name)
        if isinstance(value, bool) or not isinstance(value, int):
            raise RpcError(ErrorCode.INVALID_PARAMS, '%s must be an integer' % name)
        return value

    def dict(self, name, required=True):
        value = self._p.get(name)
        if value is None and not required:
            return None
        if not isinstance(value, dict):
            raise RpcError(ErrorCode.INVALID_PARAMS, '%s must be an object' % name)
        return value

    def str_list(self, name):
        value = self._p.get(name)
        if not isinstance(value, list) or not all(isinstance(v, str) and v for v in value):
            raise RpcError(ErrorCode.INVALID_PARAMS, '%s must be an array of strings' % name)
        return value


def _command(value):
    if not isinstance(value, str) or not _COMMAND.match(value):
        raise RpcError(ErrorCode.INVALID_PARAMS, 'only .uno: commands can be dispatched')
    return value


def _view(p):
    view = p.dict('view')
    mode = view.get('mode')
    if mode not in VIEW_MODES:
        raise RpcError(ErrorCode.INVALID_PARAMS, 'view.mode must be one of %s' % ', '.join(VIEW_MODES))
    if mode == 'child' and not view.get('parentHwnd'):
        raise RpcError(ErrorCode.INVALID_PARAMS, 'view.parentHwnd is required for child views')
    if 'startHidden' in view and not isinstance(view['startHidden'], bool):
        raise RpcError(ErrorCode.INVALID_PARAMS, 'view.startHidden must be a boolean')
    return view


def read_pid_file(path):
    if not path:
        return None
    try:
        with open(path, 'r', encoding='ascii') as handle:
            text = handle.read().strip()
        return int(text) if text.isdigit() else None
    except OSError:
        return None


class Connection:
    """Connects to soffice in the background; requests wait for it (engine.hello)."""

    def __init__(self, pipe, timeout, on_connected):
        self._pipe = pipe
        self._timeout = timeout
        self._on_connected = on_connected
        self.ready = threading.Event()
        self.office = None
        self.error = None

    def start(self):
        threading.Thread(target=self._run, name='varak-connect', daemon=True).start()

    def _run(self):
        try:
            ctx, bridge = connect(self._pipe, self._timeout)
            office = Office(ctx, bridge)
            self._on_connected(office)
            self.office = office
        except BaseException as exc:
            self.error = exc
        finally:
            self.ready.set()

    def wait(self, timeout):
        if not self.ready.wait(timeout):
            raise RpcError(ErrorCode.ENGINE_UNAVAILABLE, 'still connecting to soffice')
        if self.error is not None:
            if isinstance(self.error, RpcError):
                raise self.error
            raise RpcError(ErrorCode.ENGINE_UNAVAILABLE, 'soffice connection failed: %s' % self.error)
        return self.office


class Methods:
    def __init__(self, pipe, emit, connect_timeout=120.0, pid_file=None, on_connection_lost=None):
        self._emit = emit
        self._pid_file = pid_file
        self._connect_timeout = connect_timeout
        self.documents = None
        self.exit_requested = False
        # Set when the parent closed stdin and soffice is being terminated (terminate_on_eof).
        self._terminating = False
        # Called once (on any thread) when the URP connection is lost while nobody asked soffice to end:
        # the bridge process then exits with EXIT_CONNECTION_LOST (main.py), so the main process sees the
        # instance end and runs its crash handling instead of getting ENGINE_UNAVAILABLE forever.
        self.on_connection_lost = on_connection_lost
        self.connection = Connection(pipe, connect_timeout, self._connected)
        self._table = {
            'engine.hello': self.hello,
            'engine.shutdown': self.shutdown,
            'engine.shortcuts': self.shortcuts,
            'engine.config': self.config,
            'doc.load': self.doc_load,
            'doc.new': self.doc_new,
            'doc.store': self.doc_store,
            'doc.info': self.doc_info,
            'doc.setModified': self.doc_set_modified,
            'doc.close': self.doc_close,
            'view.setBounds': self.view_set_bounds,
            'view.setVisible': self.view_set_visible,
            'view.focus': self.view_focus,
            'cmd.dispatch': self.cmd_dispatch,
            'cmd.subscribe': self.cmd_subscribe,
            'cmd.unsubscribe': self.cmd_unsubscribe,
            'cmd.available': self.cmd_available,
            'writer.getText': self.writer_get_text,
            'writer.insertText': self.writer_insert_text,
            'calc.getCell': self.calc_get_cell,
            'calc.setCell': self.calc_set_cell,
            'calc.activeCell': self.calc_active_cell,
            'calc.gotoCell': self.calc_goto_cell,
            'calc.setActiveCellContent': self.calc_set_active_cell_content,
            'impress.slides': self.impress_slides,
            'impress.gotoSlide': self.impress_goto_slide,
            'impress.setShapeText': self.impress_set_shape_text,
            'convert.file': self.convert_file,
        }
        if os.environ.get('VARAK_BRIDGE_TEST_HOOKS') == '1':
            # Engine tests only (tests/engine/lifecycle.test.ts); the renderer cannot reach engine methods.
            self._table['debug.dropConnection'] = self.debug_drop_connection
            self._table['debug.viewChrome'] = self.debug_view_chrome

    def start(self):
        self.connection.start()

    def debug_drop_connection(self, _p):
        """Test hook: ends the URP connection the way binaryurp does after a marshalling error, while soffice
        keeps running (the lost-connection exit path, EXIT_CONNECTION_LOST)."""
        self._office().urp_bridge.dispose()
        return {'ok': True}

    def debug_view_chrome(self, p):
        """Test hook: layout manager visibility, visible toolbars/bars and the Impress slide pane state."""
        doc_id = p.str('docId')
        return self._main(lambda: self.documents.chrome_state(doc_id), 'debug.viewChrome')

    def _connected(self, office):
        office.watch_connection(self._connection_lost)
        self.documents = Documents(office, self._emit)
        try:
            listener = TopWindowListener(self.documents.on_top_window_opened, self.documents.on_top_window_closed)
            office.toolkit.addTopWindowListener(listener)
            self._top_window_listener = listener
        except Exception:
            log.warning('dialog tracking unavailable', exc_info=True)

    def _connection_lost(self, reason):
        """Office.mark_lost callback (binaryurp's thread or the worker). Must not block."""
        if self.exit_requested or self._terminating:
            log.info('connection to soffice closed (%s)', reason)
            return
        log.error('connection to soffice lost (%s); the bridge ends with exit code %d', reason, EXIT_CONNECTION_LOST)
        callback = self.on_connection_lost
        if callback is not None:
            callback()

    # ------------------------------------------------------------------ dispatching
    def call(self, method, params):
        handler = self._table.get(method)
        if handler is None:
            raise RpcError(ErrorCode.METHOD_NOT_FOUND, 'unknown method %s' % method)
        try:
            return handler(Params(params))
        except RpcError as exc:
            # Errors of main-thread jobs arrive as detached RpcErrors (office._Job).
            if exc.code == ErrorCode.ENGINE_UNAVAILABLE and self.connection.office is not None and self.connection.ready.is_set():
                if exc.data and exc.data.get('type'):
                    self.connection.office.mark_lost('%s: %s' % (exc.data.get('type'), exc.message))
            raise
        except Exception as exc:
            if is_connection_lost(exc) and self.connection.office is not None:
                self.connection.office.mark_lost('%s: %s' % (uno_type_name(exc), uno_message(exc)))
            raise

    def _office(self):
        office = self.connection.wait(self._connect_timeout)
        if office.lost:
            raise RpcError(ErrorCode.ENGINE_UNAVAILABLE, 'the connection to soffice was lost')
        return office

    def _main(self, fn, label, timeout=DEFAULT_TIMEOUT_S, release=None):
        return self._office().executor.run(fn, timeout, label, release)

    def _release_barrier(self, office):
        """See Office.release_barrier(); runs on this (non-main) thread between two main-thread jobs."""
        started = time.monotonic()
        try:
            passed = office.release_barrier()
        except Exception as exc:
            # Closing must go on; a lost connection surfaces in the next main-thread job.
            log.warning('release barrier failed (%s); closing anyway', type(exc).__name__)
            return
        if passed:
            log.debug('release barrier passed in %.0f ms', (time.monotonic() - started) * 1000)
        else:
            log.warning('soffice did not process pending releases in time; closing anyway')

    def _session_call(self, p, label, fn, timeout=DEFAULT_TIMEOUT_S):
        doc_id = p.str('docId')
        self._office()

        def work():
            return fn(self.documents.get(doc_id))
        return self._main(work, label, timeout)

    # ------------------------------------------------------------------ engine.*
    def hello(self, p):
        protocol = p.int('protocol')
        if protocol != PROTOCOL_VERSION:
            raise RpcError(ErrorCode.INVALID_REQUEST, 'protocol mismatch', {'expected': PROTOCOL_VERSION})
        office = self._office()
        result = {
            'protocol': PROTOCOL_VERSION,
            'bridgeVersion': __version__,
            'officeVersion': office.version(),
            'pythonVersion': platform.python_version(),
            'bridgePid': os.getpid(),
        }
        pid = read_pid_file(self._pid_file)
        if pid:
            result['officePid'] = pid
        return result

    def shutdown(self, _p):
        office = self.connection.office if self.connection.ready.is_set() else None
        self.exit_requested = True
        if office is None or office.lost:
            return {'ok': True}
        try:
            if office.executor.run(self.documents.begin_close_all, SHUTDOWN_CLOSE_TIMEOUT_S, 'close all documents'):
                self._release_barrier(office)
                office.executor.run(self.documents.finish_close_all, SHUTDOWN_CLOSE_TIMEOUT_S, 'close all documents')
        except Exception as exc:
            log.warning('closing documents before shutdown failed: %s', exc)
        try:
            terminated = office.desktop.terminate()
            log.info('desktop.terminate() -> %s', terminated)
        except Exception as exc:
            log.info('desktop.terminate() ended the connection (%s)', type(exc).__name__)
        return {'ok': True}

    def terminate_on_eof(self, timeout=5.0):
        """The parent closed stdin without engine.shutdown: bring soffice down instead of orphaning it."""
        self._terminating = True
        office = self.connection.office
        if office is None or office.lost:
            return
        done = threading.Event()

        def run():
            try:
                office.desktop.terminate()
            except Exception:
                pass
            finally:
                done.set()
        threading.Thread(target=run, daemon=True).start()
        done.wait(timeout)

    def shortcuts(self, p):
        kind = p.str('kind')
        if kind not in MODULE_IDENTIFIER:
            raise RpcError(ErrorCode.INVALID_PARAMS, 'kind must be writer, calc or impress')
        keys = p.str_list('keys')
        events = {}
        for name in keys:
            try:
                base, bits = parse_key_name(name)
                event = KeyEvent()
                event.KeyCode = uno.getConstantByName('com.sun.star.awt.Key.' + key_constant_name(base))
                event.Modifiers = bits
            except Exception:
                raise RpcError(ErrorCode.INVALID_PARAMS, 'invalid key name %s' % name)
            events[name] = event
        office = self._office()

        def work():
            configs = (office.module_shortcuts(MODULE_IDENTIFIER[kind]), office.global_shortcuts())
            bindings = {}
            for name, event in events.items():
                command = None
                for config in configs:
                    try:
                        command = config.getCommandByKeyEvent(event)
                        break
                    except Exception:
                        continue
                bindings[name] = command
            return {'bindings': bindings}
        return self._main(work, 'engine.shortcuts')

    def config(self, p):
        nodepath = p.str('nodepath')
        if not re.fullmatch(r"/org\.openoffice\.[A-Za-z0-9_.]+(/[^/]+)*", nodepath):
            raise RpcError(ErrorCode.INVALID_PARAMS, 'nodepath must be a /org.openoffice.* configuration path')
        names = p.str_list('names')
        office = self._office()

        def work():
            try:
                access = office.config(nodepath)
            except Exception:
                raise RpcError(ErrorCode.INVALID_PARAMS, 'no configuration node %s' % nodepath)
            values = {}
            for name in names:
                try:
                    values[name] = from_uno(access.getByName(name), office.fields)
                except Exception:
                    values[name] = None
            return {'values': values}
        return self._main(work, 'engine.config')

    # ------------------------------------------------------------------ doc.*
    def doc_load(self, p):
        doc_id = p.str('docId')
        url = to_url(p.str('url'))
        base_url = p.str('baseUrl', required=False)
        view = _view(p)
        kwargs = {
            'filter_name': p.str('filter', required=False),
            'filter_options': p.str('filterOptions', required=False, allow_empty=True),
            'base_url': to_url(base_url) if base_url else None,
            'password': p.str('password', required=False, allow_empty=True),
            'read_only': p.bool('readOnly', False),
        }
        self._office()
        return self._after_open(view, self._open_document(
            doc_id, view, lambda prepared: self.documents.open(doc_id, url, view, prepared=prepared, **kwargs), 'doc.load',
            LONG_TIMEOUT_S))

    def doc_new(self, p):
        doc_id = p.str('docId')
        kind = p.str('kind')
        if kind not in NEW_DOCUMENT_URL:
            raise RpcError(ErrorCode.INVALID_PARAMS, 'kind must be writer, calc or impress')
        view = _view(p)
        self._office()
        return self._after_open(view, self._open_document(
            doc_id, view, lambda prepared: self.documents.open(doc_id, NEW_DOCUMENT_URL[kind], view, is_new=True, prepared=prepared),
            'doc.new'))

    def _open_document(self, doc_id, view, open_fn, label, timeout=DEFAULT_TIMEOUT_S):
        """Runs open_fn(prepared) in a main-thread job. An owned view first gets its owner (owned.py): its frame
        window is created in one job, owned outside of any job (the Win32 calls wait for soffice's main
        thread) and the document is loaded into it in a second job, so nothing converts a shown window."""
        if view.get('mode') != 'owned' or not view.get('parentHwnd'):
            return self._main(lambda: open_fn(None), label, timeout)
        owner = parse_hwnd(view['parentHwnd'])
        prepared = self._main(lambda: self.documents.prepare_window(doc_id, view), label)
        try:
            own_window(int(prepared.hwnd), owner)
        except Exception:
            try:
                self._main(lambda: self.documents.discard_window(prepared), label)
            except Exception:
                log.warning('could not dispose the prepared window of %s', doc_id, exc_info=True)
            raise
        return self._main(lambda: open_fn(prepared), label, timeout)

    @staticmethod
    def _after_open(view, result):
        """Native touches that must not run inside the load job (see documents.set_no_parent_notify)."""
        if view.get('mode') == 'child' and isinstance(result, dict):
            set_no_parent_notify(result.get('hwnd'))
        return result

    def doc_store(self, p):
        url = to_url(p.str('url'))
        filter_name = p.str('filter')
        options = p.str('filterOptions', required=False, allow_empty=True)
        data = p.dict('filterData', required=False)
        password = p.str('password', required=False)
        mark_saved = p.bool('markSaved', False)
        base_url = p.str('baseUrl', required=False, allow_empty=True)  # '' = store links absolute
        if base_url:
            base_url = to_url(base_url)

        def store(session):
            # One job: nothing can modify the document between the store and clearing the flag.
            self.documents.store(session, url, filter_name, options, data, password,
                                 base_url=base_url, mark_saved=mark_saved)
            return {'ok': True}
        return self._session_call(p, 'doc.store', store, LONG_TIMEOUT_S)

    def doc_info(self, p):
        return self._session_call(p, 'doc.info', ops.doc_info)

    def doc_set_modified(self, p):
        modified = p.bool('modified')

        def run(session):
            session.model.setModified(modified)
            return {'ok': True}
        return self._session_call(p, 'doc.setModified', run)

    def doc_close(self, p):
        doc_id = p.str('docId')
        office = self._office()
        session = self._main(lambda: self.documents.begin_close(doc_id), 'doc.close')
        self._release_barrier(office)
        self._main(lambda: self.documents.finish_close(session), 'doc.close')
        return {'ok': True}

    # ------------------------------------------------------------------ view.*
    def view_set_bounds(self, p):
        bounds = p.dict('bounds')
        try:
            x, y, w, h = (int(bounds[k]) for k in ('x', 'y', 'width', 'height'))
        except (KeyError, TypeError, ValueError):
            raise RpcError(ErrorCode.INVALID_PARAMS, 'bounds needs integer x, y, width, height')

        def run(session):
            session.frame.getContainerWindow().setPosSize(x, y, max(w, 1), max(h, 1), 15)
            return {'ok': True}
        return self._session_call(p, 'view.setBounds', run)

    def view_set_visible(self, p):
        visible = p.bool('visible')

        def run(session):
            if session.mode == 'hidden':
                raise RpcError(ErrorCode.UNSUPPORTED, 'hidden documents have no view to show')
            session.frame.getContainerWindow().setVisible(visible)
            return {'ok': True}
        return self._session_call(p, 'view.setVisible', run)

    def view_focus(self, p):
        def run(session):
            if session.mode == 'hidden':
                raise RpcError(ErrorCode.UNSUPPORTED, 'hidden documents cannot be focused')
            session.frame.activate()
            session.frame.getComponentWindow().setFocus()
            return {'ok': True}
        return self._session_call(p, 'view.focus', run)

    # ------------------------------------------------------------------ cmd.*
    def cmd_dispatch(self, p):
        doc_id = p.str('docId')
        command = _command(p.raw('command'))
        args = p.dict('args', required=False)
        self._office()
        documents = self.documents
        opened = documents.watch_dialog()

        def run():
            documents.get(doc_id).dispatch(command, args)
            return {'ok': True}
        try:
            result = self._main(run, 'cmd.dispatch', DEFAULT_TIMEOUT_S, release=opened)
        finally:
            documents.unwatch_dialog(opened)
        return result if result is not None else {'ok': True}

    def cmd_subscribe(self, p):
        commands = [_command(c) for c in p.str_list('commands')]
        return self._session_call(p, 'cmd.subscribe', lambda s: {'states': s.subscribe(commands)})

    def cmd_unsubscribe(self, p):
        commands = [_command(c) for c in p.str_list('commands')]

        def run(session):
            for command in commands:
                session.unsubscribe(command)
            return {'ok': True}
        return self._session_call(p, 'cmd.unsubscribe', run)

    def cmd_available(self, p):
        commands = [_command(c) for c in p.str_list('commands')]

        def run(session):
            return {'available': {c: session.frame.queryDispatch(session.office.url(c), '', 0) is not None for c in commands}}
        return self._session_call(p, 'cmd.available', run)

    # ------------------------------------------------------------------ module operations
    def writer_get_text(self, p):
        return self._session_call(p, 'writer.getText', ops.writer_get_text)

    def writer_insert_text(self, p):
        text = p.str('text', allow_empty=True)
        return self._session_call(p, 'writer.insertText', lambda s: ops.writer_insert_text(s, text))

    def calc_get_cell(self, p):
        sheet, address = p.raw('sheet'), p.str('address')
        return self._session_call(p, 'calc.getCell', lambda s: ops.calc_get_cell(s, sheet, address))

    def calc_set_cell(self, p):
        sheet, address = p.raw('sheet'), p.str('address')
        formula, value = p.raw('formula'), p.raw('value')
        return self._session_call(p, 'calc.setCell', lambda s: ops.calc_set_cell(s, sheet, address, formula, value))

    def calc_active_cell(self, p):
        return self._session_call(p, 'calc.activeCell', ops.calc_active_cell)

    def calc_goto_cell(self, p):
        reference = p.str('reference')
        return self._session_call(p, 'calc.gotoCell', lambda s: ops.calc_goto_cell(s, reference))

    def calc_set_active_cell_content(self, p):
        content = p.str('content', allow_empty=True)
        return self._session_call(p, 'calc.setActiveCellContent', lambda s: ops.calc_set_active_cell_content(s, content))

    def impress_slides(self, p):
        return self._session_call(p, 'impress.slides', ops.impress_slides)

    def impress_goto_slide(self, p):
        index = p.int('index')
        return self._session_call(p, 'impress.gotoSlide', lambda s: ops.impress_goto_slide(s, index))

    def impress_set_shape_text(self, p):
        slide, shape, text = p.int('slide'), p.int('shape'), p.str('text', allow_empty=True)
        return self._session_call(p, 'impress.setShapeText', lambda s: ops.impress_set_shape_text(s, slide, shape, text))

    # ------------------------------------------------------------------ convert.file
    def convert_file(self, p):
        source = to_url(p.str('input'))
        target = to_url(p.str('output'))
        filter_name = p.str('filter')
        options = p.str('filterOptions', required=False, allow_empty=True)
        import_filter = p.str('importFilter', required=False)
        import_options = p.str('importFilterOptions', required=False, allow_empty=True)
        password = p.str('password', required=False, allow_empty=True)
        data = p.dict('filterData', required=False)
        office = self._office()

        def run():
            handler = InteractionHandler(password)
            args = [
                property_value('Hidden', True),
                property_value('MacroExecutionMode', 0),
                property_value('UpdateDocMode', 0),
                property_value('AsTemplate', False),
                property_value('ReadOnly', True),
                property_value('InteractionHandler', handler),
            ]
            if import_filter:
                args.append(property_value('FilterName', import_filter))
            if import_options:
                args.append(property_value('FilterOptions', import_options))
            started = time.monotonic()
            try:
                model = office.desktop.loadComponentFromURL(source, '_blank', 0, tuple(args))
            except Exception as exc:
                raise_load_error(handler, exc)
            if model is None:
                raise_load_error(handler, None)
            try:
                store_to_url(model, target, filter_name, options, data)
            finally:
                close_model(model)
            log.info('converted with %s in %.0f ms', filter_name, (time.monotonic() - started) * 1000)
            return {'ok': True}
        return self._main(run, 'convert.file', LONG_TIMEOUT_S)
