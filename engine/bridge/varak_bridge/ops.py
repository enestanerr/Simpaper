# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Module-specific document operations (Writer, Calc, Impress) and document info.

All functions run on LibreOffice's main thread and receive a documents.DocSession.
"""

import logging

from .addresses import cell_name, error_name, view_data_cursor
from .errors import RpcError
from .protocol import ErrorCode
from .values import property_value

log = logging.getLogger('varak.ops')

_FORMULA_RESULT_VALUE = 1  # css::sheet::FormulaResult::VALUE
_FORMULA_RESULT_STRING = 2


def _require(session, *kinds):
    if session.kind not in kinds:
        raise RpcError(ErrorCode.UNSUPPORTED, 'not available for %s documents' % session.kind)


def _safe(fn, default=None):
    try:
        return fn()
    except Exception:
        log.debug('optional info unavailable', exc_info=True)
        return default


# ---------------------------------------------------------------------- info
def doc_info(session):
    model = session.model
    controller = session.controller
    info = {
        'docId': session.doc_id,
        'modified': bool(model.isModified()),
        'title': _safe(model.getTitle, ''),
    }
    if session.kind == 'writer':
        # Counts first: reading them brings the document statistics up to date, page count included.
        _put(info, 'wordCount', lambda: int(model.WordCount))
        _put(info, 'characterCount', lambda: int(model.CharacterCount))
        _put(info, 'pageCount', lambda: writer_page_count(model))
        _put(info, 'currentPage', lambda: int(controller.getViewCursor().getPage()))
        _put(info, 'zoom', lambda: int(controller.getViewSettings().ZoomValue))
    elif session.kind == 'calc':
        _put(info, 'sheetNames', lambda: list(model.getSheets().getElementNames()))
        _put(info, 'activeSheet', lambda: controller.getActiveSheet().getName())
        _put(info, 'zoom', lambda: int(controller.ZoomValue))
    elif session.kind in ('impress', 'draw'):
        pages = model.getDrawPages()
        info['slideCount'] = int(pages.getCount())
        _put(info, 'currentSlide', lambda: _current_slide(controller, pages))
        _put(info, 'zoom', lambda: int(controller.ZoomValue))
    return info


def writer_page_count(model):
    """Pages of the current layout, from the document statistics (SwDocStat.nPage); None without a layout.

    Never controller.PageCount: it formats the whole document with a progress bar (SwViewShell::CalcLayout),
    and Writer drops every keystroke that arrives while a progress runs (SwEditWin::KeyInput). The status bar
    asks for doc.info after changes, so typing got lost (GUI spike, 2026-09-29). Read a count property
    (WordCount) first: that updates the statistics without a layout run.
    """
    for stat in model.getDocumentProperties().DocumentStatistics:
        if stat.Name == 'PageCount':
            return int(stat.Value)
    return None


def _put(info, key, fn):
    value = _safe(fn)
    if value is not None:
        info[key] = value


# ---------------------------------------------------------------------- writer
def writer_get_text(session):
    _require(session, 'writer')
    return {'text': session.model.getText().getString()}


def writer_insert_text(session, text):
    """Inserts at the view cursor, like typing (one undoable action)."""
    _require(session, 'writer')
    cursor = session.controller.getViewCursor()
    cursor.getText().insertString(cursor, text, False)
    return {'ok': True}


# ---------------------------------------------------------------------- calc
def _sheet(session, sheet):
    sheets = session.model.getSheets()
    if sheet is None:
        try:
            return session.controller.getActiveSheet()
        except Exception:
            return sheets.getByIndex(0)
    if isinstance(sheet, bool) or not isinstance(sheet, (int, str)):
        raise RpcError(ErrorCode.INVALID_PARAMS, 'sheet must be an index or a name')
    try:
        return sheets.getByIndex(sheet) if isinstance(sheet, int) else sheets.getByName(sheet)
    except Exception:
        raise RpcError(ErrorCode.INVALID_PARAMS, 'no such sheet: %r' % (sheet,))


def _cell(sheet, address):
    if not isinstance(address, str) or not address:
        raise RpcError(ErrorCode.INVALID_PARAMS, 'address must be a cell address such as A1')
    try:
        return sheet.getCellRangeByName(address).getCellByPosition(0, 0)
    except Exception:
        raise RpcError(ErrorCode.INVALID_PARAMS, 'invalid cell address: %s' % address)


def cell_info(sheet, cell):
    kind = cell.getType().value  # EMPTY | VALUE | TEXT | FORMULA
    address = cell.getCellAddress()
    info = {
        'address': cell_name(address.Column, address.Row),
        'sheet': sheet.getName(),
        'formula': '',
        'localFormula': '',
        'value': None,
        'display': cell.getString(),
        'type': {'EMPTY': 'empty', 'VALUE': 'value', 'TEXT': 'text', 'FORMULA': 'formula'}.get(kind, 'empty'),
    }
    if kind == 'EMPTY':
        return info
    info['localFormula'] = cell.FormulaLocal
    if kind == 'VALUE':
        info['value'] = cell.getValue()
    elif kind == 'TEXT':
        info['value'] = cell.getString()
    else:
        info['formula'] = cell.getFormula()
        code = cell.getError()
        if code:
            info['error'] = error_name(code)
        else:
            result_type = cell.FormulaResultType2
            info['value'] = cell.getValue() if result_type == _FORMULA_RESULT_VALUE else cell.getString()
    return info


def calc_get_cell(session, sheet, address):
    _require(session, 'calc')
    target = _sheet(session, sheet)
    return cell_info(target, _cell(target, address))


def calc_set_cell(session, sheet, address, formula=None, value=None):
    """`formula`: input in API (English) grammar, parsed like XCell.setFormula; `value`: number or text."""
    _require(session, 'calc')
    target = _sheet(session, sheet)
    cell = _cell(target, address)
    if formula is not None:
        if not isinstance(formula, str):
            raise RpcError(ErrorCode.INVALID_PARAMS, 'formula must be a string')
        cell.setFormula(formula)
    elif isinstance(value, bool) or value is None:
        raise RpcError(ErrorCode.INVALID_PARAMS, 'either formula or value (number or string) is required')
    elif isinstance(value, (int, float)):
        cell.setValue(float(value))
    elif isinstance(value, str):
        cell.setString(value)
    else:
        raise RpcError(ErrorCode.INVALID_PARAMS, 'value must be a number or a string')
    return {'ok': True}


def calc_active_cell(session):
    _require(session, 'calc')
    controller = session.controller
    sheet = controller.getActiveSheet()
    selection = controller.getSelection()
    cursor = None
    try:
        sheets = session.model.getSheets()
        index = list(sheets.getElementNames()).index(sheet.getName())
        cursor = view_data_cursor(controller.getViewData(), index)
    except Exception:
        log.debug('view data unavailable', exc_info=True)
    if cursor is not None:
        cell = sheet.getCellByPosition(cursor[0], cursor[1])
    else:
        start = selection.getRangeAddress()
        cell = sheet.getCellByPosition(start.StartColumn, start.StartRow)
    return cell_info(sheet, cell)


def calc_goto_cell(session, reference):
    _require(session, 'calc')
    if not isinstance(reference, str) or not reference:
        raise RpcError(ErrorCode.INVALID_PARAMS, 'reference must be a non-empty string')
    session.office.dispatch_helper.executeDispatch(
        session.frame, '.uno:GoToCell', '', 0, (property_value('ToPoint', reference),))
    return {'ok': True}


def calc_set_active_cell_content(session, content):
    """Enters `content` into the active cell exactly like typing it into the formula bar
    (numbers, dates and function names are parsed in the UI/locale settings of the profile)."""
    _require(session, 'calc')
    if not isinstance(content, str):
        raise RpcError(ErrorCode.INVALID_PARAMS, 'content must be a string')
    session.office.dispatch_helper.executeDispatch(
        session.frame, '.uno:EnterString', '', 0, (property_value('StringName', content),))
    return {'ok': True}


# ---------------------------------------------------------------------- impress
def _current_slide(controller, pages):
    current = controller.getCurrentPage()
    for i in range(pages.getCount()):
        if pages.getByIndex(i) == current:
            return i
    return None


def _shape_texts(page):
    """Text of every shape in z-order ('' for shapes without text); index = shape index."""
    texts = []
    for i in range(page.getCount()):
        try:
            texts.append(page.getByIndex(i).getString())
        except Exception:
            texts.append('')
    return texts


def _notes(page):
    try:
        notes = page.getNotesPage()
    except Exception:
        return ''
    parts = []
    for i in range(notes.getCount()):
        shape = notes.getByIndex(i)
        if shape.getShapeType() == 'com.sun.star.presentation.NotesShape':
            parts.append(shape.getString())
    return '\n'.join(p for p in parts if p)


def impress_slides(session):
    _require(session, 'impress', 'draw')
    pages = session.model.getDrawPages()
    slides = []
    for i in range(pages.getCount()):
        page = pages.getByIndex(i)
        slide = {
            'index': i,
            'name': page.getName(),
            'hidden': not bool(_safe(lambda: page.Visible, True)),
            'notes': _notes(page),
            'texts': _shape_texts(page),
        }
        layout = _safe(lambda: int(page.Layout))
        if layout is not None:
            slide['layout'] = layout
        slides.append(slide)
    return {'slides': slides}


def impress_goto_slide(session, index):
    _require(session, 'impress', 'draw')
    pages = session.model.getDrawPages()
    if isinstance(index, bool) or not isinstance(index, int) or not 0 <= index < pages.getCount():
        raise RpcError(ErrorCode.INVALID_PARAMS, 'slide index out of range')
    session.controller.setCurrentPage(pages.getByIndex(index))
    return {'ok': True}


def impress_set_shape_text(session, slide, shape, text):
    _require(session, 'impress', 'draw')
    pages = session.model.getDrawPages()
    if isinstance(slide, bool) or not isinstance(slide, int) or not 0 <= slide < pages.getCount():
        raise RpcError(ErrorCode.INVALID_PARAMS, 'slide index out of range')
    page = pages.getByIndex(slide)
    if isinstance(shape, bool) or not isinstance(shape, int) or not 0 <= shape < page.getCount():
        raise RpcError(ErrorCode.INVALID_PARAMS, 'shape index out of range')
    target = page.getByIndex(shape)
    try:
        target.setString(text)
    except Exception:
        raise RpcError(ErrorCode.UNSUPPORTED, 'the shape has no text')
    # API text edits in Impress do not set the document's modified flag (unlike typing in the view).
    session.model.setModified(True)
    return {'ok': True}
