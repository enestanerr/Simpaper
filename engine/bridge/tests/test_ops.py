# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""varak_bridge.ops without soffice: doc.info must never make Writer lay out the whole document."""
import unittest

import uno

from varak_bridge.ops import doc_info, writer_page_count


def named(name, value):
    nv = uno.createUnoStruct('com.sun.star.beans.NamedValue')
    nv.Name = name
    nv.Value = value
    return nv


class Props:
    def __init__(self, stats):
        self.DocumentStatistics = tuple(stats)


class WriterModel:
    WordCount = 171
    CharacterCount = 1181

    def __init__(self, stats):
        self._props = Props(stats)

    def isModified(self):
        return True

    def getTitle(self):
        return 'Belge.docx'

    def getDocumentProperties(self):
        return self._props


class ViewCursor:
    def getPage(self):
        return 2


class ViewSettings:
    ZoomValue = 100


class WriterController:
    """controller.PageCount runs SwViewShell::CalcLayout with a progress bar, and Writer drops every keystroke
    that arrives meanwhile (SwEditWin::KeyInput): the status bar's doc.info lost typed text in the GUI spike."""

    def __init__(self):
        self.page_count_read = False

    @property
    def PageCount(self):
        self.page_count_read = True
        return 99

    def getViewCursor(self):
        return ViewCursor()

    def getViewSettings(self):
        return ViewSettings()


class Session:
    def __init__(self, model, controller):
        self.doc_id = 'w1'
        self.kind = 'writer'
        self.model = model
        self.controller = controller


class WriterInfoTest(unittest.TestCase):
    def test_page_count_comes_from_the_statistics_not_from_a_layout_run(self):
        controller = WriterController()
        stats = [named('WordCount', 171), named('PageCount', 3), named('CharacterCount', 1181)]
        info = doc_info(Session(WriterModel(stats), controller))
        self.assertEqual(info['pageCount'], 3)
        self.assertEqual(info['currentPage'], 2)
        self.assertEqual((info['wordCount'], info['characterCount']), (171, 1181))
        self.assertFalse(controller.page_count_read)

    def test_no_page_count_without_a_layout(self):
        # SwDocStat leaves PageCount out when nPage is 0 (no layout).
        self.assertIsNone(writer_page_count(WriterModel([named('WordCount', 0)])))
        controller = WriterController()
        info = doc_info(Session(WriterModel([named('WordCount', 0)]), controller))
        self.assertNotIn('pageCount', info)
        self.assertFalse(controller.page_count_read)


if __name__ == '__main__':
    unittest.main()
