# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Owned views (varak_bridge.owned and Methods._open_document): the frame window gets its owner before the
load can show it. Real Win32 windows here are created hidden and never shown."""
import sys
import threading
import time
import unittest
from unittest import mock

from varak_bridge import owned
from varak_bridge.documents import PreparedView
from varak_bridge.errors import RpcError
from varak_bridge.protocol import ErrorCode

# Same vectors as tests/unit/platform/styles.test.ts ('owned styles match the engine bridge').
STYLE_VECTORS = [
    (0x16CF0000, 0x96000000),  # WS_OVERLAPPEDWINDOW | WS_VISIBLE | WS_CLIPCHILDREN | WS_CLIPSIBLINGS → popup, still visible
    (0x02CF0000, 0x86000000),  # WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN (hidden)
    (0x44000000, 0x86000000),  # WS_CHILD | WS_CLIPSIBLINGS → top-level popup
    (0x86000000, 0x86000000),  # already an owned popup: unchanged
    (0x0ACF0000, 0x8E000000),  # WS_DISABLED | WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN: WS_DISABLED is kept
]
EX_STYLE_VECTORS = [
    (0x00040100, 0x00000080),  # WS_EX_APPWINDOW | WS_EX_WINDOWEDGE → WS_EX_TOOLWINDOW
    (0x00000304, 0x00000084),  # WS_EX_CLIENTEDGE | WS_EX_WINDOWEDGE | WS_EX_NOPARENTNOTIFY → NOPARENTNOTIFY kept
    (0x00080080, 0x00080080),  # WS_EX_LAYERED | WS_EX_TOOLWINDOW: unchanged
    (0x00020001, 0x00000080),  # WS_EX_STATICEDGE | WS_EX_DLGMODALFRAME
]


class StyleTest(unittest.TestCase):
    def test_vectors(self):
        for style, expected in STYLE_VECTORS:
            with self.subTest(style=hex(style)):
                self.assertEqual(owned.owned_popup_style(style), expected)
        for ex_style, expected in EX_STYLE_VECTORS:
            with self.subTest(ex_style=hex(ex_style)):
                self.assertEqual(owned.owned_popup_ex_style(ex_style), expected)

    def test_sign_extended_input(self):
        # GetWindowLongPtrW hands WS_POPUP styles back sign-extended.
        self.assertEqual(owned.owned_popup_style(-0x7A000000), 0x86000000)


class HiddenWindow:
    """A hidden top-level STATIC window owned by a thread that pumps messages; never shown."""

    def __init__(self, title):
        import ctypes
        from ctypes import wintypes
        self._ctypes = ctypes
        self._user32 = ctypes.WinDLL('user32', use_last_error=True)
        self._kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
        self._user32.CreateWindowExW.restype = wintypes.HWND
        self._user32.CreateWindowExW.argtypes = [wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD,
                                                 ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.HWND,
                                                 wintypes.HMENU, wintypes.HINSTANCE, wintypes.LPVOID]
        self._kernel32.GetModuleHandleW.restype = wintypes.HMODULE
        self._kernel32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
        self._user32.PostThreadMessageW.argtypes = [wintypes.DWORD, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
        self.hwnd = None
        self._tid = None
        ready = threading.Event()

        def run():
            # WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN with WS_EX_APPWINDOW, no WS_VISIBLE.
            self.hwnd = self._user32.CreateWindowExW(0x00040000, 'STATIC', title, 0x00CF0000 | 0x02000000,
                                                     100, 100, 400, 300, None, None,
                                                     self._kernel32.GetModuleHandleW(None), None)
            self._tid = self._kernel32.GetCurrentThreadId()
            ready.set()
            msg = wintypes.MSG()
            while self._user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
                self._user32.DispatchMessageW(ctypes.byref(msg))

        self._thread = threading.Thread(target=run, name='hidden-window', daemon=True)
        self._thread.start()
        ready.wait(10)
        if not self.hwnd:
            raise RuntimeError('CreateWindowExW failed')

    def close(self):
        self._user32.PostThreadMessageW(self._tid, 0x0012, 0, 0)  # WM_QUIT: the thread's windows go with it
        self._thread.join(10)


@unittest.skipUnless(sys.platform == 'win32', 'Win32 only')
class OwnWindowTest(unittest.TestCase):
    def setUp(self):
        self.host = HiddenWindow('Varak test host')
        self.view = HiddenWindow('Varak test view')
        _, self.user32 = owned._user32()

    def tearDown(self):
        self.view.close()
        self.host.close()

    def style(self, index):
        return self.user32.GetWindowLongPtrW(self.view.hwnd, index) & 0xFFFFFFFF

    def test_hidden_frame_becomes_an_owned_tool_window_and_stays_hidden(self):
        owned.own_window(self.view.hwnd, self.host.hwnd)
        self.assertEqual(self.style(owned.GWL_STYLE), owned.owned_popup_style(0x02CF0000))
        self.assertTrue(self.style(owned.GWL_EXSTYLE) & owned.WS_EX_TOOLWINDOW)
        self.assertFalse(self.style(owned.GWL_EXSTYLE) & owned.WS_EX_APPWINDOW)
        self.assertTrue(owned._same_hwnd(self.user32.GetWindow(self.view.hwnd, owned.GW_OWNER), self.host.hwnd))
        self.assertFalse(self.user32.IsWindowVisible(self.view.hwnd))
        # Idempotent: a second call changes nothing and still succeeds.
        owned.own_window(self.view.hwnd, self.host.hwnd)
        self.assertTrue(owned._same_hwnd(self.user32.GetWindow(self.view.hwnd, owned.GW_OWNER), self.host.hwnd))

    def test_owner_must_be_a_window(self):
        self.host.close()
        time.sleep(0.2)
        with self.assertRaises(RpcError) as ctx:
            owned.own_window(self.view.hwnd, self.host.hwnd)
        self.assertEqual(ctx.exception.code, ErrorCode.INVALID_PARAMS)
        self.host = HiddenWindow('Varak test host')  # for tearDown


class FakeUser32:
    """Just enough of user32 for the guard paths of owned._own_now."""

    def __init__(self, visible=False, hung=False):
        self.visible, self.hung = visible, hung
        self.changes = []

    def IsWindow(self, _hwnd):
        return True

    def IsWindowVisible(self, _hwnd):
        return self.visible

    def IsHungAppWindow(self, _hwnd):
        return self.hung

    def SetWindowLongPtrW(self, *args):
        self.changes.append(args)
        return 1

    def SetWindowPos(self, *args):
        self.changes.append(args)
        return 1


@unittest.skipUnless(sys.platform == 'win32', 'Win32 only')
class OwnWindowGuardTest(unittest.TestCase):
    def run_with(self, fake):
        import ctypes
        with mock.patch.object(owned, '_user32', return_value=(ctypes, fake)):
            with self.assertRaises(RpcError) as ctx:
                owned.own_window(1, 2)
        return ctx.exception

    def test_a_visible_window_is_never_converted(self):
        fake = FakeUser32(visible=True)
        self.assertEqual(self.run_with(fake).code, ErrorCode.LOAD_FAILED)
        self.assertEqual(fake.changes, [])

    def test_a_hung_window_is_never_touched(self):
        fake = FakeUser32(hung=True)
        self.assertEqual(self.run_with(fake).code, ErrorCode.LOAD_FAILED)
        self.assertEqual(fake.changes, [])

    def test_a_blocked_engine_costs_at_most_the_timeout(self):
        release = threading.Event()
        with mock.patch.object(owned, '_own_now', side_effect=lambda *_: release.wait(10)):
            started = time.monotonic()
            with self.assertRaises(RpcError) as ctx:
                owned.own_window(1, 2, timeout_s=0.2)
            self.assertLess(time.monotonic() - started, 2)
        release.set()
        self.assertEqual(ctx.exception.code, ErrorCode.LOAD_FAILED)


class JobExecutor:
    """Runs jobs inline and records whether code runs inside one (like office.MainThreadExecutor)."""

    def __init__(self, log):
        self.log = log
        self.in_job = False

    def run(self, fn, _timeout, label='', _release=None):
        self.log.append(('job', label))
        self.in_job = True
        try:
            return fn()
        finally:
            self.in_job = False


class FlowOffice:
    lost = False

    def __init__(self, log):
        self.executor = JobExecutor(log)


class FakeDocuments:
    def __init__(self, log, executor):
        self.log, self.executor = log, executor

    def prepare_window(self, doc_id, view):
        self.log.append(('prepare', doc_id, view['mode'], self.executor.in_job))
        return PreparedView('window', 'frame', '4242')

    def discard_window(self, prepared):
        self.log.append(('discard', prepared.hwnd, self.executor.in_job))

    def open(self, doc_id, url, view, prepared=None, **_kwargs):
        self.log.append(('open', doc_id, prepared.hwnd if prepared else None, self.executor.in_job))
        return {'docId': doc_id, 'hwnd': '4242'}


class OpenDocumentFlowTest(unittest.TestCase):
    """doc.load / doc.new: owned views are owned between two main-thread jobs, never inside one."""

    def setUp(self):
        from varak_bridge.methods import Methods
        self.log = []
        self.office = FlowOffice(self.log)
        self.methods = Methods('unused', lambda _e: None)
        self.methods.connection.office = self.office
        self.methods.connection.ready.set()
        self.methods.documents = FakeDocuments(self.log, self.office.executor)

    def own(self, hwnd, owner):
        self.log.append(('own', hwnd, owner, self.office.executor.in_job))

    def load(self, view):
        return self.methods.call('doc.load', {'docId': 'd1', 'url': 'file:///C:/x/a.docx', 'view': view})

    def test_owned_view_is_owned_between_two_jobs(self):
        with mock.patch('varak_bridge.methods.own_window', side_effect=self.own):
            result = self.load({'mode': 'owned', 'parentHwnd': '777', 'bounds': {'x': 1, 'y': 2, 'width': 3, 'height': 4}})
        self.assertEqual(result['hwnd'], '4242')
        self.assertEqual(self.log, [
            ('job', 'doc.load'), ('prepare', 'd1', 'owned', True),
            ('own', 4242, 777, False),
            ('job', 'doc.load'), ('open', 'd1', '4242', True),
        ])

    def test_new_owned_document_takes_the_same_route(self):
        with mock.patch('varak_bridge.methods.own_window', side_effect=self.own):
            self.methods.call('doc.new', {'docId': 'n1', 'kind': 'writer', 'view': {'mode': 'owned', 'parentHwnd': '9'}})
        self.assertEqual([entry[0] for entry in self.log], ['job', 'prepare', 'own', 'job', 'open'])

    def test_failed_ownership_disposes_the_window_and_loads_nothing(self):
        failure = RpcError(ErrorCode.LOAD_FAILED, 'cannot attach')
        with mock.patch('varak_bridge.methods.own_window', side_effect=failure):
            with self.assertRaises(RpcError) as ctx:
                self.load({'mode': 'owned', 'parentHwnd': '777'})
        self.assertEqual(ctx.exception.code, ErrorCode.LOAD_FAILED)
        self.assertEqual([entry[0] for entry in self.log], ['job', 'prepare', 'job', 'discard'])
        self.assertTrue(self.log[-1][2])  # disposed inside a main-thread job

    def test_other_views_load_in_a_single_job(self):
        with mock.patch('varak_bridge.methods.own_window') as own, \
                mock.patch('varak_bridge.methods.set_no_parent_notify'):
            self.load({'mode': 'hidden'})
            self.load({'mode': 'owned'})  # no owner given: the host converts the window itself
            self.load({'mode': 'child', 'parentHwnd': '5'})
        own.assert_not_called()
        self.assertEqual([entry[0] for entry in self.log], ['job', 'open'] * 3)
        self.assertTrue(all(entry[2] is None for entry in self.log if entry[0] == 'open'))

    def test_invalid_owner_is_rejected_before_any_window_exists(self):
        with self.assertRaises(RpcError) as ctx:
            self.load({'mode': 'owned', 'parentHwnd': 'not-a-handle'})
        self.assertEqual(ctx.exception.code, ErrorCode.INVALID_PARAMS)
        self.assertEqual(self.log, [])


if __name__ == '__main__':
    unittest.main()
