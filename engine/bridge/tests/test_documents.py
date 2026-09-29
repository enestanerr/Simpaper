# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""varak_bridge.documents without soffice: dialog tracking with real pyuno wrappers, and the arguments of
doc.store (markSaved, baseUrl) with a fake model."""
import unittest
from unittest import mock

import uno
from com.sun.star.io import IOException

from varak_bridge.documents import Documents, store_to_url
from varak_bridge.errors import RpcError
from varak_bridge.listeners import TopWindowListener
from varak_bridge.protocol import ErrorCode

OPEN = {'type': 'dialog', 'open': True}
CLOSED = {'type': 'dialog', 'open': False}


def uno_object():
    """A real UNO object (C++ component) that stands in for a dialog window."""
    ctx = uno.getComponentContext()
    return ctx.ServiceManager.createInstanceWithContext('com.sun.star.script.Invocation', ctx)


def wrappers(obj, count):
    """`count` separately converted pyuno wrappers of the same UNO object, as event.Source reads give them."""
    event = uno.createUnoStruct('com.sun.star.lang.EventObject')
    event.Source = obj
    return [event.Source for _ in range(count)]


class DialogTrackingTest(unittest.TestCase):
    """The 'dialog open: false' event must follow every tracked dialog's close (review 2026-09-29, #1)."""

    def setUp(self):
        self.events = []
        self.documents = Documents(office=None, emit=self.events.append)
        # The stand-in is no XDialog; everything else is the real code path.
        patcher = mock.patch('varak_bridge.documents.supports', lambda _obj, name: name == 'com.sun.star.awt.XDialog')
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_close_is_recognised_through_another_wrapper_of_the_same_dialog(self):
        opened, closed = wrappers(uno_object(), 2)
        self.assertIsNot(opened, closed)  # pyuno converts anew: id() differs, UNO identity does not
        self.documents.on_top_window_opened(opened)
        self.documents.on_top_window_closed(closed)
        self.assertEqual(self.events, [OPEN, CLOSED])
        self.assertEqual(len(self.documents._dialogs), 0)

    def test_listener_called_through_uno_like_soffice_does(self):
        # soffice calls the listener through UNO: every callback converts event.Source into a new wrapper,
        # and the one of windowOpened dies when the callback returns.
        listener = TopWindowListener(self.documents.on_top_window_opened, self.documents.on_top_window_closed)
        ctx = uno.getComponentContext()
        adapter = ctx.ServiceManager.createInstanceWithContext('com.sun.star.script.Invocation', ctx).createInstanceWithArguments((listener,))
        event = uno.createUnoStruct('com.sun.star.lang.EventObject')
        event.Source = uno_object()
        kept = []
        for _ in range(20):
            adapter.windowOpened(event)
            kept.append(event.Source)  # other wrappers take the freed address meanwhile (proxies of the bridge)
            adapter.windowClosed(event)
        self.assertEqual(self.events, [OPEN, CLOSED] * 20)
        self.assertEqual(len(self.documents._dialogs), 0)

    def test_unknown_and_repeated_closes_emit_nothing(self):
        dialog, other = uno_object(), uno_object()
        self.documents.on_top_window_opened(wrappers(dialog, 1)[0])
        self.documents.on_top_window_closed(wrappers(other, 1)[0])
        self.assertEqual(self.events, [OPEN])
        self.documents.on_top_window_closed(wrappers(dialog, 1)[0])
        self.documents.on_top_window_closed(wrappers(dialog, 1)[0])
        self.assertEqual(self.events, [OPEN, CLOSED])

    def test_nested_dialogs_are_tracked_separately(self):
        outer, inner = uno_object(), uno_object()
        self.documents.on_top_window_opened(wrappers(outer, 1)[0])
        self.documents.on_top_window_opened(wrappers(inner, 1)[0])
        self.documents.on_top_window_closed(wrappers(inner, 1)[0])
        self.documents.on_top_window_closed(wrappers(outer, 1)[0])
        self.assertEqual(self.events, [OPEN, OPEN, CLOSED, CLOSED])

    def test_non_dialog_windows_are_ignored(self):
        with mock.patch('varak_bridge.documents.supports', lambda _obj, _name: False):
            window = wrappers(uno_object(), 1)[0]
            self.documents.on_top_window_opened(window)
            self.documents.on_top_window_closed(window)
        self.assertEqual(self.events, [])

    def test_close_all_drops_the_dialog_proxies(self):
        self.documents.on_top_window_opened(wrappers(uno_object(), 1)[0])
        self.assertEqual(len(self.documents._dialogs), 1)
        self.assertEqual(self.documents.begin_close_all(), [])
        self.assertEqual(len(self.documents._dialogs), 0)


class FakeModel:
    def __init__(self, fail=None):
        self.calls = []
        self._fail = fail

    def storeToURL(self, url, args):  # noqa: N802 (UNO name)
        self.calls.append(('storeToURL', url, {a.Name: a.Value for a in args}))
        if self._fail is not None:
            raise self._fail

    def setModified(self, modified):  # noqa: N802
        self.calls.append(('setModified', modified))


class FakeSession:
    doc_id = 'd1'

    def __init__(self, model):
        self.model = model


class StoreTest(unittest.TestCase):
    def store(self, model, **kwargs):
        Documents(office=None, emit=lambda _e: None).store(FakeSession(model), 'file:///C:/x/a.docx', 'MS Word 2007 XML', **kwargs)
        return model.calls

    def test_mark_saved_clears_the_flag_right_after_the_store(self):
        calls = self.store(FakeModel(), mark_saved=True)
        self.assertEqual([c[0] for c in calls], ['storeToURL', 'setModified'])
        self.assertEqual(calls[1], ('setModified', False))

    def test_without_mark_saved_the_flag_is_kept(self):
        calls = self.store(FakeModel())
        self.assertEqual([c[0] for c in calls], ['storeToURL'])

    def test_a_failed_store_keeps_the_flag(self):
        model = FakeModel(fail=IOException('disk full', None))
        with self.assertRaises(RpcError) as ctx:
            self.store(model, mark_saved=True)
        self.assertEqual(ctx.exception.code, ErrorCode.STORE_FAILED)
        self.assertEqual([c[0] for c in model.calls], ['storeToURL'])

    def test_base_url(self):
        # None: LibreOffice's default (links relative to the target); '' or a URL: DocumentBaseURL.
        self.assertNotIn('DocumentBaseURL', self.store(FakeModel())[0][2])
        self.assertEqual(self.store(FakeModel(), base_url='')[0][2]['DocumentBaseURL'], '')
        self.assertEqual(self.store(FakeModel(), base_url='file:///C:/Belgeler/plan.docx')[0][2]['DocumentBaseURL'], 'file:///C:/Belgeler/plan.docx')

    def test_store_to_url_arguments(self):
        model = FakeModel()
        store_to_url(model, 'file:///C:/x/s.odt', 'writer8', password='gizli', base_url='')
        args = model.calls[0][2]
        self.assertEqual(args['FilterName'], 'writer8')
        self.assertIs(args['Overwrite'], True)
        self.assertEqual(args['Password'], 'gizli')
        self.assertEqual(args['DocumentBaseURL'], '')


class DirectExecutor:
    def __init__(self):
        self.jobs = 0

    def run(self, fn, _timeout, _label='', _release=None):
        self.jobs += 1
        return fn()


class StoreOffice:
    lost = False

    def __init__(self):
        self.executor = DirectExecutor()


class DocStoreMethodTest(unittest.TestCase):
    """The doc.store RPC parameters (src/shared/engine-protocol.ts)."""

    def setUp(self):
        from varak_bridge.methods import Methods
        self.model = FakeModel()
        self.office = StoreOffice()
        self.methods = Methods('unused', lambda _e: None)
        self.methods.connection.office = self.office
        self.methods.connection.ready.set()
        self.methods.documents = Documents(self.office, lambda _e: None)
        session = FakeSession(self.model)
        session.closing = False
        self.methods.documents.sessions['d1'] = session

    def call(self, **params):
        return self.methods.call('doc.store', {'docId': 'd1', 'url': 'file:///C:/x/a.docx', 'filter': 'MS Word 2007 XML', **params})

    def test_mark_saved_and_empty_base_url_in_one_main_thread_job(self):
        self.assertEqual(self.call(markSaved=True, baseUrl=''), {'ok': True})
        self.assertEqual(self.office.executor.jobs, 1)
        self.assertEqual(self.model.calls[0][2]['DocumentBaseURL'], '')
        self.assertEqual(self.model.calls[1], ('setModified', False))

    def test_defaults_keep_the_old_behaviour(self):
        self.call()
        self.assertEqual(len(self.model.calls), 1)
        self.assertNotIn('DocumentBaseURL', self.model.calls[0][2])

    def test_base_url_paths_become_file_urls(self):
        self.call(baseUrl='C:\\Belgeler\\plan.docx')
        self.assertEqual(self.model.calls[0][2]['DocumentBaseURL'], 'file:///C:/Belgeler/plan.docx')

    def test_invalid_parameters(self):
        for params in ({'markSaved': 'yes'}, {'baseUrl': 5}):
            with self.subTest(params=params), self.assertRaises(RpcError) as ctx:
                self.call(**params)
            self.assertEqual(ctx.exception.code, ErrorCode.INVALID_PARAMS)
        self.assertEqual(self.model.calls, [])


if __name__ == '__main__':
    unittest.main()
