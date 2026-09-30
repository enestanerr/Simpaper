# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Open documents: loading into hidden/child/owned views, listeners, storing and closing.

Everything in this module that touches UNO objects runs on LibreOffice's main thread (see
office.MainThreadExecutor); listener callbacks are invoked by soffice itself.
"""

import collections
import json
import logging
import re
import sys
import threading

import uno
from com.sun.star.awt import Rectangle, WindowDescriptor

from .errors import RpcError, uno_message, uno_type_name
from .listeners import (CloseListener, ContextListener, DispatchInterceptor, InteractionHandler, KeyHandler,
                        ModifyListener, SelectionListener, StatusListener, supports)
from .office import SYSTEM_WIN32
from .ops import writer_page_count
from .protocol import MODULE_IDENTIFIER, ErrorCode
from .values import from_uno, property_value, to_property_values

log = logging.getLogger('simpaper.documents')

MACRO_NEVER_EXECUTE = 0   # css::document::MacroExecMode::NEVER_EXECUTE
UPDATE_NO = 0             # css::document::UpdateDocMode::NO_UPDATE
POS_SIZE = 15             # css::awt::PosSize::POSSIZE
WINDOW_CLASS_TOP = uno.Enum('com.sun.star.awt.WindowClass', 'TOP')
UI_ELEMENT_TOOLBAR = 3    # css::ui::UIElementType::TOOLBAR
STATUS_BAR_URL = 'private:resource/statusbar/statusbar'
SELECTION_THROTTLE_S = 0.1
_NO_PROCESS_ID = uno.ByteSequence(bytes(16))
_DEFAULT_BOUNDS = {'x': 0, 'y': 0, 'width': 800, 'height': 600}

# A frame window created ahead of the load (owned views, see owned.py); hwnd is an unsigned decimal string.
PreparedView = collections.namedtuple('PreparedView', 'window frame hwnd')


def _kind_of(model):
    if model.supportsService('com.sun.star.sheet.SpreadsheetDocument'):
        return 'calc'
    if model.supportsService('com.sun.star.presentation.PresentationDocument'):
        return 'impress'
    if model.supportsService('com.sun.star.drawing.DrawingDocument'):
        return 'draw'
    if model.supportsService('com.sun.star.text.TextDocument') or model.supportsService('com.sun.star.text.GenericTextDocument'):
        return 'writer'
    return None


def _bounds(view):
    raw = view.get('bounds') or _DEFAULT_BOUNDS
    try:
        x, y, w, h = (int(raw[k]) for k in ('x', 'y', 'width', 'height'))
    except (KeyError, TypeError, ValueError):
        raise RpcError(ErrorCode.INVALID_PARAMS, 'view.bounds needs integer x, y, width, height')
    return x, y, max(w, 1), max(h, 1)


def parse_hwnd(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9]{1,20}', value):
        raise RpcError(ErrorCode.INVALID_PARAMS, 'view.parentHwnd must be a decimal string')
    return int(value)


def window_handle(window):
    """HWND of a VCL window peer as an unsigned decimal string (XSystemDependentWindowPeer).

    VCL reports it as a sal_IntPtr (signed); the protocol exchanges handles as unsigned decimals.
    """
    try:
        handle = window.getWindowHandle(_NO_PROCESS_ID, SYSTEM_WIN32)
    except Exception:
        log.debug('getWindowHandle failed', exc_info=True)
        return None
    handle = getattr(handle, 'value', handle)
    if not isinstance(handle, int) or isinstance(handle, bool) or not handle:
        return None
    return str(handle & 0xFFFFFFFFFFFFFFFF)


GWL_EXSTYLE = -20
WS_EX_NOPARENTNOTIFY = 0x00000004


def set_no_parent_notify(hwnd):
    """Adds WS_EX_NOPARENTNOTIFY to a child view (docs/dev/platform.md): clicks into the document and the
    frame's destruction then send no synchronous WM_PARENTNOTIFY to the host window of another process.

    SetWindowLongPtrW sends WM_STYLECHANGING/-CHANGED to soffice's main thread and waits for it, so this
    must never run inside a main-thread job (the main thread is blocked in the job's notify() call and
    would never answer): it runs on a daemon thread after the load job returned. Returns the thread.
    """
    if sys.platform != 'win32' or not hwnd:
        return None

    def run():
        try:
            import ctypes
            user32 = ctypes.WinDLL('user32', use_last_error=True)
            user32.GetWindowLongPtrW.restype = ctypes.c_ssize_t
            user32.GetWindowLongPtrW.argtypes = [ctypes.c_void_p, ctypes.c_int]
            user32.SetWindowLongPtrW.restype = ctypes.c_ssize_t
            user32.SetWindowLongPtrW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_ssize_t]
            handle = ctypes.c_void_p(int(hwnd))
            ctypes.set_last_error(0)
            ex_style = user32.GetWindowLongPtrW(handle, GWL_EXSTYLE)
            if ex_style == 0 and ctypes.get_last_error():
                raise OSError(ctypes.get_last_error(), 'GetWindowLongPtrW failed')
            if not ex_style & WS_EX_NOPARENTNOTIFY:
                ctypes.set_last_error(0)
                if not user32.SetWindowLongPtrW(handle, GWL_EXSTYLE, ex_style | WS_EX_NOPARENTNOTIFY) and ctypes.get_last_error():
                    raise OSError(ctypes.get_last_error(), 'SetWindowLongPtrW failed')
        except Exception:
            log.debug('WS_EX_NOPARENTNOTIFY not set', exc_info=True)
    thread = threading.Thread(target=run, name='simpaper-noparentnotify', daemon=True)
    thread.start()
    return thread


class Throttle:
    """Trailing-edge throttle: fn runs at most once per interval, after the first trigger."""

    def __init__(self, interval, fn):
        self._interval = interval
        self._fn = fn
        self._timer = None
        self._lock = threading.Lock()

    def __call__(self):
        with self._lock:
            if self._timer is not None:
                return
            self._timer = threading.Timer(self._interval, self._fire)
            self._timer.daemon = True
            self._timer.start()

    def _fire(self):
        with self._lock:
            self._timer = None
        self._fn()

    def cancel(self):
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None


class DocSession:
    """One open document with its frame, optional native window and listeners."""

    def __init__(self, office, emit, doc_id, model, frame, kind, mode, window):
        self.office = office
        self._emit = emit
        self.doc_id = doc_id
        self.model = model
        self.frame = frame
        self.kind = kind
        self.mode = mode
        self.window = window
        self.closing = False
        self.subscriptions = {}
        self._states = {}
        self._emitted = {}
        self._initializing = set()
        self._state_lock = threading.Lock()
        self._modified = None
        self._context = None
        self._detach = []
        self._selection = Throttle(SELECTION_THROTTLE_S, self._emit_selection)

    @property
    def controller(self):
        return self.model.getCurrentController()

    def emit(self, event):
        if not self.closing:
            self._emit(event)

    # ------------------------------------------------------------------ listeners
    def attach(self, visible):
        frame, model = self.frame, self.model
        interceptor = DispatchInterceptor(self._on_intercept)
        frame.registerDispatchProviderInterceptor(interceptor)
        self._detach.append(lambda: frame.releaseDispatchProviderInterceptor(interceptor))

        modify = ModifyListener(self._on_modified)
        model.addModifyListener(modify)
        self._detach.append(lambda: model.removeModifyListener(modify))
        self._modified = bool(model.isModified())

        closer = CloseListener(self._on_closing)
        model.addCloseListener(closer)
        self._detach.append(lambda: model.removeCloseListener(closer))

        controller = self.controller
        try:
            mux = self.office.ctx.getValueByName('/singletons/com.sun.star.ui.ContextChangeEventMultiplexer')
            context = ContextListener(self._on_context)
            mux.addContextChangeEventListener(context, controller)
            self._detach.append(lambda: mux.removeContextChangeEventListener(context, controller))
        except Exception:
            log.warning('context change events unavailable', exc_info=True)

        if self.kind == 'calc':
            selection = SelectionListener(self._selection)
            controller.addSelectionChangeListener(selection)
            self._detach.append(lambda: controller.removeSelectionChangeListener(selection))

        if visible:
            keys = KeyHandler(classify_shell_key, self._on_key)
            controller.addKeyHandler(keys)
            self._detach.append(lambda: controller.removeKeyHandler(keys))

    def release(self):
        """Drops the proxies of a closed document (their releases are harmless after the close)."""
        self.subscriptions.clear()
        with self._state_lock:
            self._states.clear()
            self._emitted.clear()
        self.model = self.frame = self.window = None

    def detach(self):
        self._selection.cancel()
        for command in list(self.subscriptions):
            self.unsubscribe(command)
        while self._detach:
            remove = self._detach.pop()
            try:
                remove()
            except Exception:
                log.debug('listener removal failed', exc_info=True)

    def _on_intercept(self, command, args):
        event = {'type': 'intercept', 'docId': self.doc_id, 'command': command}
        if args:
            event['args'] = {pv.Name: from_uno(pv.Value, self.office.fields) for pv in args}
        log.info('intercepted %s', command)
        self.emit(event)

    def _on_modified(self, _event):
        try:
            modified = bool(self.model.isModified())
        except Exception:
            return
        if modified != self._modified:
            self._modified = modified
            self.emit({'type': 'modified', 'docId': self.doc_id, 'modified': modified})

    def _on_closing(self):
        if not self.closing:
            log.info('document %s closed by the engine', self.doc_id)
            self.emit({'type': 'closed', 'docId': self.doc_id})

    def _on_context(self, application, context):
        if (application, context) != self._context:
            self._context = (application, context)
            self.emit({'type': 'context', 'docId': self.doc_id, 'application': application, 'context': context})

    def _emit_selection(self):
        self.emit({'type': 'selection', 'docId': self.doc_id})

    def _on_key(self, name):
        self.emit({'type': 'key', 'docId': self.doc_id, 'key': name})

    # ------------------------------------------------------------------ command state
    def _on_state(self, command, enabled, raw_value):
        value = from_uno(raw_value, self.office.fields)
        key = (enabled, json.dumps(value, sort_keys=True, ensure_ascii=False, default=str))
        with self._state_lock:
            self._states[command] = (enabled, value)
            if command in self._initializing or command not in self.subscriptions:
                return
            if self._emitted.get(command) == key:
                return
            self._emitted[command] = key
        self.emit({'type': 'state', 'docId': self.doc_id, 'command': command, 'enabled': enabled, 'value': value})

    def subscribe(self, commands):
        states = []
        for command in commands:
            if command not in self.subscriptions:
                self._add_subscription(command)
            enabled, value = self._states.get(command, (False, None))
            with self._state_lock:
                self._emitted[command] = (enabled, json.dumps(value, sort_keys=True, ensure_ascii=False, default=str))
            states.append({'command': command, 'enabled': enabled, 'value': value})
        return states

    def _add_subscription(self, command):
        url = self.office.url(command)
        dispatch = self.frame.queryDispatch(url, '', 0)
        with self._state_lock:
            self._initializing.add(command)
            self.subscriptions[command] = None
        try:
            if dispatch is None:
                self._states[command] = (False, None)
                return
            listener = StatusListener(command, self._on_state)
            dispatch.addStatusListener(listener, url)
            self.subscriptions[command] = (dispatch, listener, url)
        finally:
            with self._state_lock:
                self._initializing.discard(command)

    def unsubscribe(self, command):
        entry = self.subscriptions.pop(command, None)
        with self._state_lock:
            self._emitted.pop(command, None)
            self._states.pop(command, None)
        if entry:
            dispatch, listener, url = entry
            try:
                dispatch.removeStatusListener(listener, url)
            except Exception:
                log.debug('removeStatusListener failed', exc_info=True)

    def current_state(self, command):
        """One-shot state query (temporary status listener)."""
        url = self.office.url(command)
        dispatch = self.frame.queryDispatch(url, '', 0)
        if dispatch is None:
            return None
        seen = []
        listener = StatusListener(command, lambda _c, enabled, value: seen.append((enabled, value)))
        dispatch.addStatusListener(listener, url)
        try:
            dispatch.removeStatusListener(listener, url)
        except Exception:
            pass
        return seen[-1] if seen else None

    # ------------------------------------------------------------------ dispatch
    def dispatch(self, command, args):
        url = self.office.url(command)
        if self.frame.queryDispatch(url, '', 0) is None:
            raise RpcError(ErrorCode.UNSUPPORTED, 'command %s is not available here' % command)
        self.office.dispatch_helper.executeDispatch(self.frame, command, '', 0, to_property_values(args))


SHELL_KEYS = {}


def _init_shell_keys():
    key = lambda n: uno.getConstantByName('com.sun.star.awt.Key.' + n)
    mod = lambda n: uno.getConstantByName('com.sun.star.awt.KeyModifier.' + n)
    shift, ctrl = mod('SHIFT'), mod('MOD1')
    SHELL_KEYS.update({
        (key('F6'), 0): 'F6',
        (key('F6'), shift): 'ShiftF6',
        (key('F10'), 0): 'F10',
        (key('F1'), ctrl): 'CtrlF1',
        (key('TAB'), ctrl): 'CtrlTab',
        (key('TAB'), ctrl | shift): 'CtrlShiftTab',
    })


def classify_shell_key(key_code, modifiers):
    if not SHELL_KEYS:
        _init_shell_keys()
    return SHELL_KEYS.get((key_code, modifiers))


class Documents:
    """Registry of open documents of this soffice instance plus the global dialog listener."""

    def __init__(self, office, emit):
        self.office = office
        self._emit = emit
        self.sessions = {}
        # Open LibreOffice dialogs, as the pyuno wrappers of their windows (see on_top_window_opened).
        self._dialogs = set()
        self._dialog_lock = threading.Lock()
        self._watchers = set()
        self._watch_lock = threading.Lock()
        # Modules whose toolbars are switched off in this soffice's window state configuration.
        self._toolbars_off = set()

    def get(self, doc_id):
        if not isinstance(doc_id, str) or not doc_id:
            raise RpcError(ErrorCode.INVALID_PARAMS, 'docId must be a non-empty string')
        session = self.sessions.get(doc_id)
        if session is None or session.closing:
            raise RpcError(ErrorCode.DOC_NOT_FOUND, 'no open document %s' % doc_id)
        return session

    # ------------------------------------------------------------------ dialogs (global)
    def watch_dialog(self):
        """Event that is set when the next LibreOffice dialog opens (see MainThreadExecutor.run)."""
        event = threading.Event()
        with self._watch_lock:
            self._watchers.add(event)
        return event

    def unwatch_dialog(self, event):
        with self._watch_lock:
            self._watchers.discard(event)

    def on_top_window_opened(self, window):
        if self._is_document_window(window) or not supports(window, 'com.sun.star.awt.XDialog'):
            return
        # The wrapper itself is kept, never its id(): pyuno creates a new wrapper for every conversion of
        # event.Source, so windowClosed gets another object, usually at another address (and a freed
        # address can be reused by an unrelated wrapper). pyuno hashes and compares wrappers by UNO
        # identity, and holding this one keeps its proxy alive until the dialog closes.
        with self._dialog_lock:
            self._dialogs.add(window)
        with self._watch_lock:
            for event in self._watchers:
                event.set()
        title = None
        try:
            title = window.getTitle()
        except Exception:
            pass
        self._emit({'type': 'dialog', 'open': True, 'title': title} if title else {'type': 'dialog', 'open': True})

    def on_top_window_closed(self, window):
        with self._dialog_lock:
            if window not in self._dialogs:
                return
            self._dialogs.discard(window)
        self._emit({'type': 'dialog', 'open': False})

    def forget_dialogs(self):
        """Drops the proxies of dialogs still regarded as open (shutdown)."""
        with self._dialog_lock:
            self._dialogs.clear()

    def _is_document_window(self, window):
        for session in self.sessions.values():
            try:
                if session.frame is not None and window == session.frame.getContainerWindow():
                    return True
            except Exception:
                continue
        return False

    # ------------------------------------------------------------------ open
    def open(self, doc_id, url, view, *, filter_name=None, filter_options=None, base_url=None,
             password=None, read_only=False, is_new=False, prepared=None):
        if not isinstance(doc_id, str) or not doc_id:
            raise RpcError(ErrorCode.INVALID_PARAMS, 'docId must be a non-empty string')
        if doc_id in self.sessions:
            raise RpcError(ErrorCode.INVALID_PARAMS, 'document %s is already open' % doc_id)
        mode = view.get('mode')
        start_hidden = bool(view.get('startHidden'))
        handler = InteractionHandler(password)
        args = [
            property_value('MacroExecutionMode', MACRO_NEVER_EXECUTE),
            property_value('UpdateDocMode', UPDATE_NO),
            property_value('InteractionHandler', handler),
        ]
        if not is_new:
            args.append(property_value('AsTemplate', False))  # templates are edited, not instantiated
        if read_only:
            args.append(property_value('ReadOnly', True))
        if filter_name:
            args.append(property_value('FilterName', filter_name))
        if filter_options:
            args.append(property_value('FilterOptions', filter_options))
        if base_url:
            args.append(property_value('DocumentBaseURL', base_url))
        if mode == 'hidden' or start_hidden:
            args.append(property_value('Hidden', True))

        window = frame = model = None
        try:
            if mode == 'hidden':
                model = self.office.desktop.loadComponentFromURL(url, '_blank', 0, tuple(args))
            else:
                if prepared is not None:
                    window, frame = prepared.window, prepared.frame
                else:
                    window = self._create_window(mode, view)
                    frame = self._create_frame(window, doc_id)
                model = frame.loadComponentFromURL(url, '_self', 0, tuple(args))
        except Exception as exc:
            self._dispose_frame(frame, window)
            raise_load_error(handler, exc)
        if model is None:
            self._dispose_frame(frame, window)
            raise_load_error(handler, None)

        kind = _kind_of(model)
        if kind is None:
            try:
                model.close(True)
            finally:
                self._dispose_frame(frame, window)
            raise RpcError(ErrorCode.UNSUPPORTED, 'unsupported document type')
        if frame is None:
            frame = model.getCurrentController().getFrame()
        session = DocSession(self.office, self._emit, doc_id, model, frame, kind, mode, window)
        self.sessions[doc_id] = session
        try:
            session.attach(visible=mode != 'hidden')
            if mode != 'hidden':
                _restore_if_maximized(window)
                self._prepare_view(session)
        except Exception:
            log.exception('view setup failed for %s', doc_id)
        return self.load_result(session, handler)

    def prepare_window(self, doc_id, view):
        """First step of opening an owned view (Methods._open_document): the hidden frame window and its frame,
        so that the window gets its owner before the load shows it. Returns a PreparedView for open()."""
        if not isinstance(doc_id, str) or not doc_id:
            raise RpcError(ErrorCode.INVALID_PARAMS, 'docId must be a non-empty string')
        if doc_id in self.sessions:
            raise RpcError(ErrorCode.INVALID_PARAMS, 'document %s is already open' % doc_id)
        window = frame = None
        try:
            window = self._create_window(view.get('mode'), view)
            frame = self._create_frame(window, doc_id)
        except Exception:
            self._dispose_frame(frame, window)
            raise
        hwnd = window_handle(window)
        if hwnd is None:
            self._dispose_frame(frame, window)
            raise RpcError(ErrorCode.LOAD_FAILED, 'the document window has no native handle')
        return PreparedView(window, frame, hwnd)

    def discard_window(self, prepared):
        """Disposes a PreparedView that was never loaded into."""
        self._dispose_frame(prepared.frame, prepared.window)

    def _create_window(self, mode, view):
        x, y, w, h = _bounds(view)
        toolkit = self.office.toolkit
        if mode == 'child':
            parent = parse_hwnd(view.get('parentHwnd'))
            window = toolkit.createSystemChild(parent, _NO_PROCESS_ID, SYSTEM_WIN32)
        elif mode == 'owned':
            desc = WindowDescriptor()
            desc.Type = WINDOW_CLASS_TOP
            desc.WindowServiceName = 'workwindow'
            desc.ParentIndex = -1
            desc.Parent = None
            desc.Bounds = Rectangle(x, y, w, h)
            desc.WindowAttributes = 0  # no border/caption: a WS_POPUP + WS_EX_TOOLWINDOW frame
            window = toolkit.createWindow(desc)
        else:
            raise RpcError(ErrorCode.INVALID_PARAMS, 'view.mode must be child, owned or hidden')
        if window is None:
            raise RpcError(ErrorCode.LOAD_FAILED, 'cannot create the %s document window' % mode)
        window.setPosSize(x, y, w, h, POS_SIZE)
        return window

    def _create_frame(self, window, doc_id):
        frame = self.office.create('com.sun.star.frame.Frame')
        frame.initialize(window)
        frame.setName('simpaper_' + re.sub(r'[^A-Za-z0-9_]', '_', doc_id))
        self.office.desktop.getFrames().append(frame)
        frame.setCreator(self.office.desktop)
        try:
            frame.LayoutManager.AutomaticToolbars = False
        except Exception:
            log.debug('AutomaticToolbars not settable before load', exc_info=True)
        return frame

    def _dispose_frame(self, frame, window):
        for obj in (frame, window):
            if obj is None:
                continue
            try:
                obj.dispose()
            except Exception:
                pass

    def _prepare_view(self, session):
        """Hides LibreOffice's own chrome; the Simpaper ribbon replaces menus, toolbars and status bar.

        Writer and Calc: the whole layout manager is made invisible. Impress keeps it visible, because sfx2's
        work window hides all of its child windows while the layout manager is invisible
        (LayoutManagerListener in sfx2/source/appl/workwin.cxx) and the slide pane is one of them. Instead,
        every toolbar of the module and its status bar are switched off in the window state configuration: the
        toolbars Impress requests itself while shapes or text are edited (sd ToolBarManager → requestElement)
        and the status bar sfx2 requests on every context change (SfxWorkWindow::UpdateStatusBar_Impl) are then
        never shown, because requestElement honours the stored Visible state. hideElement alone is not enough:
        it does nothing for a bar that has not been created yet.
        """
        frame = session.frame
        layout = frame.LayoutManager
        keep_layout = session.kind == 'impress'
        if keep_layout:
            self._switch_off_bars(MODULE_IDENTIFIER['impress'])
        if layout is not None:
            try:
                layout.AutomaticToolbars = False
            except Exception:
                pass
            urls = [e.ResourceURL for e in layout.getElements()]
            urls += ['private:resource/menubar/menubar', STATUS_BAR_URL]
            for resource in urls:
                try:
                    layout.hideElement(resource)
                except Exception:
                    pass
            if not keep_layout:
                layout.setVisible(False)
        try:
            sidebar = session.controller.getSidebar()
            if sidebar is not None:
                sidebar.setVisible(False)
        except Exception:
            log.debug('no sidebar provider', exc_info=True)
        if session.kind == 'impress':
            state = session.current_state('.uno:LeftPaneImpress')
            if state is not None and state[1] is False:
                session.dispatch('.uno:LeftPaneImpress', None)

    def _switch_off_bars(self, module):
        """Stores Visible=false for every toolbar and the status bar of `module` (once per engine instance;
        see _prepare_view)."""
        if module in self._toolbars_off:
            return
        try:
            supplier = self.office.create('com.sun.star.ui.ModuleUIConfigurationManagerSupplier')
            infos = supplier.getUIConfigurationManager(module).getUIElementsInfo(UI_ELEMENT_TOOLBAR)
            urls = [next((prop.Value for prop in info if prop.Name == 'ResourceURL'), None) for info in infos]
            urls.append(STATUS_BAR_URL)
            states = self.office.create('com.sun.star.ui.WindowStateConfiguration').getByName(module)
            for url in urls:
                if not url:
                    continue
                if states.hasByName(url):
                    kept = [prop for prop in states.getByName(url) if prop.Name != 'Visible']
                    value = uno.Any('[]com.sun.star.beans.PropertyValue', tuple(kept + [property_value('Visible', False)]))
                    uno.invoke(states, 'replaceByName', (url, value))
                else:
                    value = uno.Any('[]com.sun.star.beans.PropertyValue', (property_value('Visible', False),))
                    uno.invoke(states, 'insertByName', (url, value))
            self._toolbars_off.add(module)
        except Exception:
            log.warning('could not switch off the bars of %s', module, exc_info=True)

    def chrome_state(self, doc_id):
        """Test hook data (Methods.debug_view_chrome): what LibreOffice's own UI shows around a view."""
        session = self.get(doc_id)
        layout = session.frame.LayoutManager
        visible = [e.ResourceURL for e in layout.getElements() if layout.isElementVisible(e.ResourceURL)]
        state = session.current_state('.uno:LeftPaneImpress') if session.kind == 'impress' else None
        return {'layoutVisible': bool(layout.isVisible()), 'visibleElements': visible,
                'leftPane': None if state is None else bool(state[1])}

    # ------------------------------------------------------------------ results
    def load_result(self, session, handler=None):
        model = session.model
        result = {
            'docId': session.doc_id,
            'kind': session.kind,
            'title': _title(model, session.frame),
            'filterName': _filter_name(model),
            'readOnly': bool(model.isReadonly()),
            'hasMacros': _has_macros(model),
        }
        if session.window is not None:
            hwnd = window_handle(session.window)
            if hwnd:
                result['hwnd'] = hwnd
        try:
            if session.kind == 'writer':
                model.WordCount  # updates the document statistics (see ops.writer_page_count)
                pages = writer_page_count(model)
                if pages is not None:
                    result['pageCount'] = pages
            elif session.kind == 'calc':
                result['sheetNames'] = list(model.getSheets().getElementNames())
            elif session.kind in ('impress', 'draw'):
                result['slideCount'] = int(model.getDrawPages().getCount())
        except Exception:
            log.debug('structure info unavailable', exc_info=True)
        if handler is not None and handler.requests:
            log.info('load of %s answered interactions: %s', session.doc_id, ', '.join(handler.requests))
        return result

    # ------------------------------------------------------------------ store / close
    def store(self, session, url, filter_name, filter_options=None, filter_data=None, password=None,
              base_url=None, mark_saved=False):
        """storeToURL (a copy). mark_saved: a real save, so the modified flag is cleared right after the store
        succeeded. The caller runs this as one main-thread job, so no user input is processed in between;
        edits made later set the flag again (and emit a 'modified' event)."""
        store_to_url(session.model, url, filter_name, filter_options, filter_data, password, base_url)
        if mark_saved:
            try:
                session.model.setModified(False)
            except Exception as exc:
                # The file is written; a document that stays "modified" only costs an extra prompt.
                log.warning('the modified flag of %s was not cleared after saving (%s)', session.doc_id, uno_type_name(exc))

    # Closing is split in two main-thread steps with Office.release_barrier() in between (run by the
    # caller on its own thread): stop listening, let soffice process our pending releases, then close.
    def begin_close(self, doc_id):
        """Step 1: detaches our listeners; the document stays open. Returns the session."""
        session = self.get(doc_id)
        session.closing = True
        session.detach()
        return session

    def finish_close(self, session):
        """Step 2: closes the model, disposes the view and drops our proxies."""
        try:
            close_model(session.model)
            if session.mode != 'hidden':
                self._dispose_frame(session.frame, None)
            else:
                try:
                    session.frame.close(True)
                except Exception:
                    pass
        finally:
            if self.sessions.get(session.doc_id) is session:
                del self.sessions[session.doc_id]
            session.release()

    def begin_close_all(self):
        # Before the release barrier, so that soffice has processed these releases before anything closes.
        self.forget_dialogs()
        sessions = []
        for session in list(self.sessions.values()):
            try:
                if not session.closing:
                    session.closing = True
                    session.detach()
                sessions.append(session)
            except Exception:
                log.warning('detaching %s failed', session.doc_id, exc_info=True)
        return sessions

    def finish_close_all(self):
        for session in list(self.sessions.values()):
            try:
                self.finish_close(session)
            except Exception:
                log.warning('closing %s failed', session.doc_id, exc_info=True)


def _restore_if_maximized(window):
    """Views are never maximized: the host positions them (a stored window state could maximize them)."""
    try:
        if window is not None and window.IsMaximized:
            window.IsMaximized = False
    except Exception:
        log.debug('window state not available', exc_info=True)


def raise_load_error(handler, exc):
    """Maps a failed load (exception or empty model) to PASSWORD_REQUIRED / WRONG_PASSWORD / LOAD_FAILED."""
    if handler.outcome == 'password-required':
        raise RpcError(ErrorCode.PASSWORD_REQUIRED, 'the document is password protected')
    if handler.outcome == 'wrong-password':
        raise RpcError(ErrorCode.WRONG_PASSWORD, 'the password is wrong')
    if isinstance(exc, RpcError):
        raise exc
    data = {'interactions': list(handler.requests)}
    if exc is not None:
        data['type'] = uno_type_name(exc)
        raise RpcError(ErrorCode.LOAD_FAILED, uno_message(exc), data)
    raise RpcError(ErrorCode.LOAD_FAILED, 'the engine could not load the document', data)


def store_to_url(model, url, filter_name, filter_options=None, filter_data=None, password=None, base_url=None):
    """XStorable.storeToURL: writes a copy, keeps the location and the modified flag.

    base_url: DocumentBaseURL of the export, i.e. what relative links are written relative to. None keeps
    LibreOffice's default (the target URL, with "save URLs relative to file system" on); '' stores them
    absolute, which is what LibreOffice's own AutoRecovery does for backups in another folder (#i66598).
    """
    handler = InteractionHandler()
    args = [
        property_value('FilterName', filter_name),
        property_value('Overwrite', True),
        property_value('InteractionHandler', handler),
    ]
    if base_url is not None:
        args.append(property_value('DocumentBaseURL', base_url))
    if filter_options:
        args.append(property_value('FilterOptions', filter_options))
    if filter_data:
        args.append(property_value('FilterData', uno.Any('[]com.sun.star.beans.PropertyValue',
                                                         to_property_values(filter_data, 'filterData'))))
    if password:
        # 'Password' encrypts ODF packages and OOXML (ECMA-376 encryption) alike.
        args.append(property_value('Password', password))
    try:
        model.storeToURL(url, tuple(args))
    except Exception as exc:
        data = {'type': uno_type_name(exc), 'interactions': list(handler.requests)}
        raise RpcError(ErrorCode.STORE_FAILED, uno_message(exc), data) from exc


def close_model(model):
    """XCloseable.close(True); falls back to dispose(). Disposed models are ignored."""
    try:
        model.close(True)
    except Exception as exc:
        name = uno_type_name(exc)
        if name == 'com.sun.star.lang.DisposedException':
            return
        log.warning('close failed (%s), disposing', name)
        try:
            model.dispose()
        except Exception:
            pass


def _title(model, frame):
    try:
        return model.getTitle()
    except Exception:
        pass
    try:
        return frame.getTitle()
    except Exception:
        return ''


def _filter_name(model):
    try:
        for prop in model.getArgs():
            if prop.Name == 'FilterName':
                return prop.Value or ''
    except Exception:
        pass
    return ''


def _has_macros(model):
    """True if the document carries Basic/VBA modules or dialogs (they are never executed)."""
    for attr in ('BasicLibraries', 'DialogLibraries'):
        try:
            libraries = getattr(model, attr)
        except Exception:
            continue
        if libraries is None:
            continue
        for name in libraries.getElementNames():
            try:
                if not libraries.isLibraryLoaded(name):
                    libraries.loadLibrary(name)
                if libraries.getByName(name).hasElements():
                    return True
            except Exception:
                return True  # e.g. a password-protected library: it exists and is not empty
    return False
