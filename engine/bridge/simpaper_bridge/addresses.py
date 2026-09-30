# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Pure helpers for spreadsheet addresses and Calc error codes."""

import re


def column_name(index):
    """0 -> 'A', 25 -> 'Z', 26 -> 'AA'."""
    if index < 0:
        raise ValueError('negative column')
    name = ''
    index += 1
    while index:
        index, rem = divmod(index - 1, 26)
        name = chr(65 + rem) + name
    return name


def cell_name(column, row):
    """Zero-based column/row -> 'A1' style address."""
    if row < 0:
        raise ValueError('negative row')
    return '%s%d' % (column_name(column), row + 1)


_TAB_SEPARATOR = re.compile(r'[/+]')


def view_data_cursor(view_data, tab_index):
    """Cursor (column, row) of sheet `tab_index` from XController.getViewData() of a Calc view.

    Format (sc/source/ui/view/viewdata.cxx, WriteUserData): "zoom;activeTab;tw:width;tab0;tab1;…",
    each tab entry "curX/curY/…" ('+' replaces '/' as separator for large row numbers).
    """
    if not isinstance(view_data, str):
        return None
    parts = view_data.split(';')
    index = 3 + tab_index
    if tab_index < 0 or index >= len(parts):
        return None
    fields = _TAB_SEPARATOR.split(parts[index])
    if len(fields) < 2:
        return None
    try:
        return int(fields[0]), int(fields[1])
    except ValueError:
        return None


# Calc error codes with a direct Excel equivalent (include/formula/errorcodes.hxx). Locale-independent
# on purpose: the localised display text ("#AD?" in Turkish) is reported separately.
_ERROR_NAMES = {
    503: '#NUM!',     # IllegalFPOperation
    519: '#VALUE!',   # NoValue
    521: '#NULL!',    # NoCode
    524: '#REF!',     # NoRef
    525: '#NAME?',    # NoName
    532: '#DIV/0!',   # DivisionByZero
    32767: '#N/A',    # NotAvailable
}


def error_name(code):
    """Excel-style name for a Calc error code; 'Err:<code>' for codes without an equivalent."""
    if not code:
        return None
    return _ERROR_NAMES.get(code, 'Err:%d' % code)
