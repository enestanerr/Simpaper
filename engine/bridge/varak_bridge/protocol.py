# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Constants shared with src/shared/engine-protocol.ts (kept in sync by a unit test)."""

PROTOCOL_VERSION = 1

# Exit code of the bridge process when its URP connection to soffice was lost although nobody asked soffice
# to end (BRIDGE_EXIT_CONNECTION_LOST in src/main/engine/EngineInstance.ts; the instance counts as crashed).
EXIT_CONNECTION_LOST = 3


class ErrorCode:
    PARSE = -32700
    INVALID_REQUEST = -32600
    METHOD_NOT_FOUND = -32601
    INVALID_PARAMS = -32602
    INTERNAL = -32603
    ENGINE_UNAVAILABLE = 1001
    DOC_NOT_FOUND = 1002
    LOAD_FAILED = 1003
    PASSWORD_REQUIRED = 1004
    WRONG_PASSWORD = 1005
    STORE_FAILED = 1006
    TIMEOUT = 1007
    BUSY = 1008
    UNSUPPORTED = 1009


# Commands the bridge intercepts in every frame and reports as `intercept` events instead of executing.
INTERCEPTED_COMMANDS = (
    '.uno:Save',
    '.uno:SaveAs',
    '.uno:SaveAll',
    '.uno:Open',
    '.uno:OpenRemote',
    '.uno:AddDirect',
    '.uno:NewDoc',
    '.uno:CloseDoc',
    '.uno:CloseWin',
    '.uno:Quit',
    '.uno:ExportToPDF',
    '.uno:ExportDirectToPDF',
    '.uno:SendMail',
    '.uno:SaveAsTemplate',
    '.uno:OpenTemplate',
    '.uno:OptionsTreeDialog',
    '.uno:About',
    '.uno:HelpIndex',
    '.uno:ExtendedHelp',
    '.uno:RunMacro',
    '.uno:MacroDialog',
    '.uno:ScriptOrganizer',
)

# LibreOffice factory URLs for new documents (src/shared/modules.ts NEW_DOCUMENT_URL).
NEW_DOCUMENT_URL = {
    'writer': 'private:factory/swriter',
    'calc': 'private:factory/scalc',
    'impress': 'private:factory/simpress',
}

# Module identifiers used by the UI configuration (accelerators, toolbars).
MODULE_IDENTIFIER = {
    'writer': 'com.sun.star.text.TextDocument',
    'calc': 'com.sun.star.sheet.SpreadsheetDocument',
    'impress': 'com.sun.star.presentation.PresentationDocument',
}

VIEW_MODES = ('child', 'owned', 'hidden')
