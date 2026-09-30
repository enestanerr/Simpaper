# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Simpaper engine bridge.

Runs on LibreOffice's bundled Python, speaks newline-delimited JSON-RPC 2.0 with the Electron
main process over stdin/stdout and UNO with its own soffice instance over a named pipe.
The wire protocol is defined in src/shared/engine-protocol.ts.
"""

__version__ = '0.1.0'
