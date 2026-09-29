# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Key names as used by LibreOffice's accelerator configuration ("F12_SHIFT_MOD1").

Base names follow framework/source/accelerators/keymapping.cxx: digits are "0".."9"
(css::awt::Key::NUM0..NUM9), every other name equals the css::awt::Key constant name.
Modifier suffixes: SHIFT, MOD1 (Ctrl), MOD2 (Alt), MOD3.
"""

MODIFIERS = ('SHIFT', 'MOD1', 'MOD2', 'MOD3')
_MODIFIER_BITS = {'SHIFT': 1, 'MOD1': 2, 'MOD2': 4, 'MOD3': 8}  # css::awt::KeyModifier


def parse_key_name(name):
    """'F12_SHIFT_MOD1' -> ('F12', 3). Raises ValueError for malformed names."""
    if not isinstance(name, str) or not name:
        raise ValueError('empty key name')
    tokens = name.split('_')
    bits = 0
    while len(tokens) > 1 and tokens[-1] in _MODIFIER_BITS:
        bit = _MODIFIER_BITS[tokens.pop()]
        if bits & bit:
            raise ValueError('duplicate modifier in %r' % name)
        bits |= bit
    base = '_'.join(tokens)
    if not base or not all(c.isalnum() or c == '_' for c in base) or base != base.upper():
        raise ValueError('invalid key name %r' % name)
    return base, bits


def key_constant_name(base):
    """Accelerator base name -> css::awt::Key constant name."""
    if len(base) == 1 and base.isdigit():
        return 'NUM' + base
    return base


def format_key_name(base, bits):
    suffix = ''.join('_' + m for m in MODIFIERS if bits & _MODIFIER_BITS[m])
    return base + suffix
