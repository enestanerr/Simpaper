# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Pure helpers: spreadsheet addresses, Calc error names, accelerator key names."""
import unittest

from varak_bridge.addresses import cell_name, column_name, error_name, view_data_cursor
from varak_bridge.keys import format_key_name, key_constant_name, parse_key_name


class ColumnNameTest(unittest.TestCase):
    def test_letters(self):
        cases = {0: 'A', 1: 'B', 25: 'Z', 26: 'AA', 27: 'AB', 51: 'AZ', 52: 'BA', 701: 'ZZ', 702: 'AAA', 16383: 'XFD'}
        for index, name in cases.items():
            with self.subTest(index=index):
                self.assertEqual(column_name(index), name)

    def test_cell_names(self):
        self.assertEqual(cell_name(0, 0), 'A1')
        self.assertEqual(cell_name(2, 9), 'C10')
        self.assertEqual(cell_name(16383, 1048575), 'XFD1048576')

    def test_negative(self):
        with self.assertRaises(ValueError):
            column_name(-1)
        with self.assertRaises(ValueError):
            cell_name(0, -1)


class ViewDataTest(unittest.TestCase):
    # Format of XController.getViewData() in Calc: "zoom;activeTab;tw:width;tab0;tab1;...".
    DATA = '100/60/0;1;tw:270;0/0/0/0/0/0/2/0/0/0/0;4/9/0/0/0/0/2/0/0/0/0'

    def test_cursor_of_each_sheet(self):
        self.assertEqual(view_data_cursor(self.DATA, 0), (0, 0))
        self.assertEqual(view_data_cursor(self.DATA, 1), (4, 9))

    def test_plus_separator_for_large_rows(self):
        self.assertEqual(view_data_cursor('100;0;tw:270;3+1048575+0+0', 0), (3, 1048575))

    def test_malformed(self):
        self.assertIsNone(view_data_cursor(self.DATA, 2))
        self.assertIsNone(view_data_cursor(self.DATA, -1))
        self.assertIsNone(view_data_cursor(None, 0))
        self.assertIsNone(view_data_cursor('100;0;tw:270;x/y', 0))
        self.assertIsNone(view_data_cursor('100;0;tw:270;5', 0))


class ErrorNameTest(unittest.TestCase):
    def test_excel_names(self):
        self.assertEqual(error_name(525), '#NAME?')
        self.assertEqual(error_name(532), '#DIV/0!')
        self.assertEqual(error_name(519), '#VALUE!')
        self.assertEqual(error_name(524), '#REF!')
        self.assertEqual(error_name(32767), '#N/A')

    def test_other_codes(self):
        self.assertEqual(error_name(502), 'Err:502')
        self.assertIsNone(error_name(0))
        self.assertIsNone(error_name(None))


class KeyNameTest(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(parse_key_name('F12_SHIFT_MOD1'), ('F12', 3))
        self.assertEqual(parse_key_name('1_MOD1_MOD2'), ('1', 6))
        self.assertEqual(parse_key_name('ESCAPE'), ('ESCAPE', 0))
        self.assertEqual(parse_key_name('COMMA_SHIFT_MOD1'), ('COMMA', 3))

    def test_invalid(self):
        for bad in ('', 'f12', 'F12_SHIFT_SHIFT', 'F12 SHIFT', None, 'A-B'):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    parse_key_name(bad)

    def test_constants_and_round_trip(self):
        self.assertEqual(key_constant_name('5'), 'NUM5')
        self.assertEqual(key_constant_name('F4'), 'F4')
        for name in ('F12_SHIFT_MOD1', 'A_MOD1_MOD2', 'EQUAL_SHIFT_MOD1', 'RIGHT_SHIFT_MOD2', 'DELETE'):
            with self.subTest(name=name):
                self.assertEqual(format_key_name(*parse_key_name(name)), name)


if __name__ == '__main__':
    unittest.main()
