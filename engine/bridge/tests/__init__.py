# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Unit tests of the engine bridge. They need LibreOffice's Python (for `uno`) but no running soffice:

    vendor\\libreoffice\\program\\python.exe -m unittest discover -s engine/bridge/tests -t engine/bridge
"""
import os
import sys

_BRIDGE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BRIDGE not in sys.path:
    sys.path.insert(0, _BRIDGE)
