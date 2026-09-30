# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Owned views: the frame window becomes a borderless tool window owned by the host BEFORE anything shows it.

LibreOffice shows a freshly loaded frame and brings it to the foreground (LoadEnv, ShowFlags::ForegroundTask).
Converting that visible, active top-level window afterwards (hide, restyle and set the owner from the host
process) left Simpaper's UI thread hung inside PeekMessage while soffice sat idle in GetMessage (GUI spike,
2026-09-29). Methods._open_document therefore creates the frame window in one main-thread job, calls
own_window() outside of any job and loads the document into the window in a second job; the host's
makeOwned() then finds nothing left to change.

The style arithmetic mirrors src/main/platform/win32/styles.ts (ownedPopupStyle / ownedPopupExStyle); both
sides are tested against the same vectors.
"""

import sys
import threading

from .errors import RpcError
from .protocol import ErrorCode

GWL_STYLE = -16
GWL_EXSTYLE = -20
GWLP_HWNDPARENT = -8
GW_OWNER = 4

WS_POPUP = 0x80000000
WS_CHILD = 0x40000000
WS_CLIPSIBLINGS = 0x04000000
WS_CLIPCHILDREN = 0x02000000
WS_CAPTION = 0x00C00000
WS_SYSMENU = 0x00080000
WS_THICKFRAME = 0x00040000
WS_MINIMIZEBOX = 0x00020000
WS_MAXIMIZEBOX = 0x00010000
WS_EX_DLGMODALFRAME = 0x00000001
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_WINDOWEDGE = 0x00000100
WS_EX_CLIENTEDGE = 0x00000200
WS_EX_STATICEDGE = 0x00020000
WS_EX_APPWINDOW = 0x00040000

SWP_NOSIZE = 0x0001
SWP_NOMOVE = 0x0002
SWP_NOZORDER = 0x0004
SWP_NOACTIVATE = 0x0010
SWP_FRAMECHANGED = 0x0020
SWP_NOOWNERZORDER = 0x0200

OWNED_STYLE_REMOVE = WS_CHILD | WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX
OWNED_STYLE_ADD = WS_POPUP | WS_CLIPCHILDREN | WS_CLIPSIBLINGS
OWNED_EX_REMOVE = WS_EX_APPWINDOW | WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE | WS_EX_DLGMODALFRAME | WS_EX_STATICEDGE
OWNED_EX_ADD = WS_EX_TOOLWINDOW

OWN_WINDOW_TIMEOUT_S = 10.0


def owned_popup_style(style):
    """Borderless popup: no caption, frame, system menu or min/max boxes, never WS_CHILD."""
    return ((style & 0xFFFFFFFF) & ~OWNED_STYLE_REMOVE | OWNED_STYLE_ADD) & 0xFFFFFFFF


def owned_popup_ex_style(ex_style):
    """No taskbar button / Alt+Tab entry (WS_EX_TOOLWINDOW, no WS_EX_APPWINDOW) and no 3-D edges."""
    return ((ex_style & 0xFFFFFFFF) & ~OWNED_EX_REMOVE | OWNED_EX_ADD) & 0xFFFFFFFF


def _user32():
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.WinDLL('user32', use_last_error=True)
    for name in ('IsWindow', 'IsWindowVisible', 'IsHungAppWindow'):
        getattr(user32, name).argtypes = [wintypes.HWND]
        getattr(user32, name).restype = wintypes.BOOL
    user32.GetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.GetWindowLongPtrW.restype = ctypes.c_ssize_t
    user32.SetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_ssize_t]
    user32.SetWindowLongPtrW.restype = ctypes.c_ssize_t
    user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                                    ctypes.c_int, wintypes.UINT]
    user32.SetWindowPos.restype = wintypes.BOOL
    user32.GetWindow.argtypes = [wintypes.HWND, wintypes.UINT]
    user32.GetWindow.restype = wintypes.HWND
    return ctypes, user32


def _same_hwnd(a, b):
    """HWNDs are 32-bit values that 64-bit Windows may hand out sign-extended."""
    return a is not None and b is not None and (int(a) & 0xFFFFFFFF) == (int(b) & 0xFFFFFFFF)


def _own_now(hwnd, owner):
    ctypes, user32 = _user32()
    if not user32.IsWindow(owner):
        raise RpcError(ErrorCode.INVALID_PARAMS, 'view.parentHwnd is not a window')
    if not user32.IsWindow(hwnd):
        raise OSError('the document window is gone')
    if user32.IsHungAppWindow(hwnd):
        raise OSError('the document window is not responding')
    if user32.IsWindowVisible(hwnd):
        # Nothing may show the frame before it is owned; converting a visible (possibly active) window is
        # exactly what this module avoids.
        raise OSError('the document window is already visible')

    def set_long(index, value):
        ctypes.set_last_error(0)
        if not user32.SetWindowLongPtrW(hwnd, index, value) and ctypes.get_last_error():
            raise OSError(ctypes.get_last_error(), 'SetWindowLongPtrW(%d) failed' % index)

    style = user32.GetWindowLongPtrW(hwnd, GWL_STYLE) & 0xFFFFFFFF
    ex_style = user32.GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & 0xFFFFFFFF
    if owned_popup_style(style) != style:
        set_long(GWL_STYLE, owned_popup_style(style))
    if owned_popup_ex_style(ex_style) != ex_style:
        set_long(GWL_EXSTYLE, owned_popup_ex_style(ex_style))
    set_long(GWLP_HWNDPARENT, owner)
    flags = SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER
    if not user32.SetWindowPos(hwnd, None, 0, 0, 0, 0, flags):
        raise OSError(ctypes.get_last_error(), 'SetWindowPos failed')
    if not _same_hwnd(user32.GetWindow(hwnd, GW_OWNER), owner):
        raise OSError('the owner was not set')


def own_window(hwnd, owner, timeout_s=OWN_WINDOW_TIMEOUT_S):
    """Makes the hidden frame window `hwnd` an owned borderless popup of `owner` (both ints).

    SetWindowLongPtrW and SetWindowPos send messages to soffice's main thread and wait for it, so this must
    never run inside a main-thread job (the main thread is blocked in the job's notify() call). It runs on a
    helper thread: a hung soffice costs at most timeout_s here, never a blocked bridge. Raises RpcError.
    """
    if sys.platform != 'win32':
        raise RpcError(ErrorCode.UNSUPPORTED, 'owned views need Windows')
    outcome = {}

    def run():
        try:
            _own_now(hwnd, owner)
            outcome['ok'] = True
        except BaseException as exc:  # reported to the caller below
            outcome['error'] = exc

    thread = threading.Thread(target=run, name='simpaper-own-window', daemon=True)
    thread.start()
    thread.join(timeout_s)
    if thread.is_alive():
        raise RpcError(ErrorCode.LOAD_FAILED, 'the document window did not respond while it was attached')
    error = outcome.get('error')
    if isinstance(error, RpcError):
        raise error
    if error is not None:
        raise RpcError(ErrorCode.LOAD_FAILED, 'cannot attach the document window: %s' % error)
