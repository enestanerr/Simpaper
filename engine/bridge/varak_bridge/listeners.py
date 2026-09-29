# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""UNO listener implementations. soffice calls them synchronously (none of these methods is
[oneway]), usually from its main thread, so they must return quickly and never block."""

import logging
import threading

import uno
import unohelper
from com.sun.star.awt import XKeyHandler, XTopWindowListener
from com.sun.star.frame import (FeatureStateEvent, XDispatch, XDispatchProviderInterceptor,
                                XInterceptorInfo, XStatusListener)
from com.sun.star.task import XInteractionHandler2
from com.sun.star.ui import XContextChangeEventListener
from com.sun.star.util import XCloseListener, XModifyListener
from com.sun.star.view import XSelectionChangeListener

from .errors import uno_type_name
from .protocol import INTERCEPTED_COMMANDS

log = logging.getLogger('varak.listeners')


def base_command(url_complete):
    """'.uno:Save?Foo:bool=true' -> '.uno:Save'."""
    return url_complete.split('?', 1)[0]


def supports(obj, interface_name):
    """True if the UNO object implements the interface (queryInterface, no exception)."""
    try:
        return obj.queryInterface(uno.getTypeByName(interface_name)) is not None
    except Exception:
        return False


class DispatchInterceptor(unohelper.Base, XDispatchProviderInterceptor, XInterceptorInfo, XDispatch):
    """Answers INTERCEPTED_COMMANDS itself (reported via on_intercept) and passes everything else on.

    XInterceptorInfo makes the frame route only matching URLs to this (remote) object, so ordinary
    commands never pay for a cross-process round trip.
    """

    def __init__(self, on_intercept, commands=INTERCEPTED_COMMANDS):
        self._on_intercept = on_intercept
        self._commands = frozenset(commands)
        self._patterns = tuple(p for c in commands for p in (c, c + '?*'))
        self._master = None
        self._slave = None

    # XInterceptorInfo
    def getInterceptedURLs(self):
        return self._patterns

    # XDispatchProviderInterceptor
    def getSlaveDispatchProvider(self):
        return self._slave

    def setSlaveDispatchProvider(self, provider):
        self._slave = provider

    def getMasterDispatchProvider(self):
        return self._master

    def setMasterDispatchProvider(self, provider):
        self._master = provider

    # XDispatchProvider
    def queryDispatch(self, url, target, flags):
        if base_command(url.Complete) in self._commands:
            return self
        if self._slave is not None:
            return self._slave.queryDispatch(url, target, flags)
        return None

    def queryDispatches(self, requests):
        return tuple(self.queryDispatch(r.FeatureURL, r.FrameName, r.SearchFlags) for r in requests)

    # XDispatch
    def dispatch(self, url, args):
        try:
            self._on_intercept(base_command(url.Complete), args)
        except Exception:
            log.exception('intercept callback failed')

    def addStatusListener(self, listener, url):
        event = FeatureStateEvent()
        event.FeatureURL = url
        event.IsEnabled = True
        event.Requery = False
        event.Source = self
        try:
            listener.statusChanged(event)
        except Exception:
            log.debug('status listener rejected initial state', exc_info=True)

    def removeStatusListener(self, listener, url):
        pass


class StatusListener(unohelper.Base, XStatusListener):
    def __init__(self, command, on_state):
        self.command = command
        self._on_state = on_state

    def statusChanged(self, event):
        try:
            self._on_state(self.command, bool(event.IsEnabled), event.State)
        except Exception:
            log.exception('state callback failed')

    def disposing(self, _event):
        pass


class ModifyListener(unohelper.Base, XModifyListener):
    def __init__(self, on_modified):
        self._on_modified = on_modified

    def modified(self, event):
        try:
            self._on_modified(event)
        except Exception:
            log.exception('modified callback failed')

    def disposing(self, _event):
        pass


class CloseListener(unohelper.Base, XCloseListener):
    def __init__(self, on_closing):
        self._on_closing = on_closing

    def queryClosing(self, _event, _gets_ownership):
        pass  # never veto

    def notifyClosing(self, _event):
        try:
            self._on_closing()
        except Exception:
            log.exception('closing callback failed')

    def disposing(self, _event):
        pass


class ContextListener(unohelper.Base, XContextChangeEventListener):
    def __init__(self, on_context):
        self._on_context = on_context

    def notifyContextChangeEvent(self, event):
        try:
            self._on_context(event.ApplicationName or '', event.ContextName or '')
        except Exception:
            log.exception('context callback failed')

    def disposing(self, _event):
        pass


class SelectionListener(unohelper.Base, XSelectionChangeListener):
    def __init__(self, on_selection):
        self._on_selection = on_selection

    def selectionChanged(self, _event):
        try:
            self._on_selection()
        except Exception:
            log.exception('selection callback failed')

    def disposing(self, _event):
        pass


class TopWindowListener(unohelper.Base, XTopWindowListener):
    """Reports LibreOffice's own dialogs (VCL dialogs) opening and closing."""

    def __init__(self, on_opened, on_closed):
        self._on_opened = on_opened
        self._on_closed = on_closed

    def windowOpened(self, event):
        try:
            self._on_opened(event.Source)
        except Exception:
            log.exception('dialog callback failed')

    def windowClosed(self, event):
        try:
            self._on_closed(event.Source)
        except Exception:
            log.exception('dialog callback failed')

    def windowClosing(self, _event):
        pass

    def windowMinimized(self, _event):
        pass

    def windowNormalized(self, _event):
        pass

    def windowActivated(self, _event):
        pass

    def windowDeactivated(self, _event):
        pass

    def disposing(self, _event):
        pass


class KeyHandler(unohelper.Base, XKeyHandler):
    """Consumes shell keys (F6, F10, Ctrl+F1, Ctrl+Tab …) and reports them; everything else passes."""

    def __init__(self, classify, on_key):
        self._classify = classify
        self._on_key = on_key
        self._consumed = set()

    def keyPressed(self, event):
        name = self._classify(event.KeyCode, event.Modifiers)
        if name is None:
            return False
        self._consumed.add(event.KeyCode)
        try:
            self._on_key(name)
        except Exception:
            log.exception('key callback failed')
        return True

    def keyReleased(self, event):
        if event.KeyCode in self._consumed:
            self._consumed.discard(event.KeyCode)
            return True
        return False

    def disposing(self, _event):
        pass


_PASSWORD_REQUESTS = frozenset((
    'com.sun.star.task.DocumentPasswordRequest',
    'com.sun.star.task.DocumentPasswordRequest2',
    'com.sun.star.task.DocumentMSPasswordRequest',
    'com.sun.star.task.DocumentMSPasswordRequest2',
))

# Requests where "approve" is the safe, non-destructive default (acknowledge a warning / repair a package).
_APPROVE_REQUESTS = frozenset((
    'com.sun.star.task.ErrorCodeRequest',
    'com.sun.star.task.ErrorCodeRequest2',
    'com.sun.star.document.BrokenPackageRequest',
    'com.sun.star.document.ExoticFileLoadException',
))


def _find_continuation(continuations, interface_name):
    for cont in continuations:
        if supports(cont, interface_name):
            return cont
    return None


class InteractionHandler(unohelper.Base, XInteractionHandler2):
    """Headless interaction handler: never shows UI.

    Password requests are answered once with the supplied password; a repeated request (or none
    supplied) aborts and records `outcome` ('password-required' / 'wrong-password'). Known warnings
    are approved; everything else is aborted. Only request type names are logged.
    """

    def __init__(self, password=None):
        self._password = password or None
        self._supplied = False
        self._lock = threading.Lock()
        self.outcome = None
        self.requests = []

    def handle(self, request):
        self.handleInteractionRequest(request)

    def handleInteractionRequest(self, request):
        try:
            payload = request.getRequest()
            continuations = request.getContinuations()
        except Exception:
            log.exception('cannot read interaction request')
            return True
        name = uno_type_name(payload) if payload is not None else 'void'
        with self._lock:
            self.requests.append(name)
            if name in _PASSWORD_REQUESTS:
                return self._answer_password(payload, continuations)
        if name in _APPROVE_REQUESTS:
            chosen = _find_continuation(continuations, 'com.sun.star.task.XInteractionApprove')
            if chosen is not None:
                log.info('interaction %s: approve', name)
                chosen.select()
                return True
        for iface in ('com.sun.star.task.XInteractionAbort', 'com.sun.star.task.XInteractionDisapprove',
                      'com.sun.star.task.XInteractionApprove'):
            chosen = _find_continuation(continuations, iface)
            if chosen is not None:
                log.info('interaction %s: %s', name, iface.rsplit('.', 1)[-1])
                chosen.select()
                return True
        log.warning('interaction %s: no continuation selected', name)
        return True

    def _answer_password(self, payload, continuations):
        mode = getattr(getattr(payload, 'Mode', None), 'value', None)
        if self._password is not None and not self._supplied and mode != 'PASSWORD_REENTER':
            chosen = _find_continuation(continuations, 'com.sun.star.task.XInteractionPassword')
            if chosen is not None:
                chosen.setPassword(self._password)
                chosen.select()
                self._supplied = True
                log.info('interaction password request: answered')
                return True
        self.outcome = 'wrong-password' if self._password is not None else 'password-required'
        log.info('interaction password request: %s', self.outcome)
        chosen = _find_continuation(continuations, 'com.sun.star.task.XInteractionAbort')
        if chosen is not None:
            chosen.select()
        return True
