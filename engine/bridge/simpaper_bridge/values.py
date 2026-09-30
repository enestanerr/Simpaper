# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Conversion between JSON values (UnoArg / UnoPlain in engine-protocol.ts) and UNO values."""

import math
import os
import re

import uno
from com.sun.star.beans import PropertyValue

from .errors import RpcError
from .protocol import ErrorCode

_INT_RANGES = {
    'byte': (-2 ** 7, 2 ** 7 - 1),
    'short': (-2 ** 15, 2 ** 15 - 1),
    'long': (-2 ** 31, 2 ** 31 - 1),
    'hyper': (-2 ** 63, 2 ** 63 - 1),
}
TYPED_KINDS = frozenset(('float', 'double', 'string', 'boolean') + tuple(_INT_RANGES))


def _invalid(path, message):
    return RpcError(ErrorCode.INVALID_PARAMS, '%s: %s' % (path, message))


def _is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def typed_value(kind, raw, path='value'):
    """Builds a uno.Any of an explicit UNO type from the typed JSON form."""
    if kind in ('float', 'double'):
        if not _is_number(raw) or not math.isfinite(raw):
            raise _invalid(path, '%s needs a finite number' % kind)
        return uno.Any(kind, float(raw))
    if kind in _INT_RANGES:
        if not _is_number(raw) or float(raw) != int(raw):
            raise _invalid(path, '%s needs an integer' % kind)
        low, high = _INT_RANGES[kind]
        if not low <= int(raw) <= high:
            raise _invalid(path, '%s out of range' % kind)
        return uno.Any(kind, int(raw))
    if kind == 'string':
        if not isinstance(raw, str):
            raise _invalid(path, 'string needs a string value')
        return uno.Any('string', raw)
    if kind == 'boolean':
        if not isinstance(raw, bool):
            raise _invalid(path, 'boolean needs true/false')
        return uno.Any('boolean', raw)
    raise _invalid(path, 'unknown type %r' % (kind,))


def to_uno(value, path='value'):
    """JSON UnoArg -> Python value accepted by pyuno (typed forms become uno.Any)."""
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise _invalid(path, 'number is not finite')
        return value
    if isinstance(value, list):
        return tuple(to_uno(item, '%s[%d]' % (path, i)) for i, item in enumerate(value))
    if isinstance(value, dict):
        if set(value) == {'type', 'value'} and value.get('type') in TYPED_KINDS:
            return typed_value(value['type'], value['value'], path)
        raise _invalid(path, 'objects are only allowed in the typed form {type, value}')
    raise _invalid(path, 'unsupported value of type %s' % type(value).__name__)


def property_value(name, value):
    prop = PropertyValue()
    prop.Name = name
    prop.Value = value
    return prop


def to_property_values(args, path='args'):
    """{name: UnoArg} -> tuple of PropertyValue. Names such as 'FontHeight.Height' are kept as-is."""
    if args is None:
        return ()
    if not isinstance(args, dict):
        raise _invalid(path, 'must be an object')
    return tuple(property_value(str(name), to_uno(value, '%s.%s' % (path, name))) for name, value in args.items())


class StructFields:
    """Member names of UNO struct types (base members first), read from the type description manager."""

    def __init__(self, ctx=None):
        self._ctx = ctx
        self._tdm = None
        self._cache = {}

    def _manager(self):
        if self._tdm is None:
            ctx = self._ctx or uno.getComponentContext()
            self._tdm = ctx.getValueByName('/singletons/com.sun.star.reflection.theTypeDescriptionManager')
        return self._tdm

    def names(self, type_name):
        cached = self._cache.get(type_name)
        if cached is not None:
            return cached
        names = ()
        for candidate in (type_name, type_name.split('<', 1)[0]):
            try:
                desc = self._manager().getByHierarchicalName(candidate)
            except Exception:
                continue
            chain = []
            while desc is not None:
                chain.append(desc)
                desc = desc.getBaseType()
            names = tuple(name for d in reversed(chain) for name in d.getMemberNames())
            break
        self._cache[type_name] = names
        return names


_default_fields = None


def from_uno(value, fields=None, _depth=0):
    """UNO value -> JSON UnoPlain. Structs become objects with `__type`; interfaces become null."""
    global _default_fields
    if _depth > 24:
        return None
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, (tuple, list)):
        return [from_uno(item, fields, _depth + 1) for item in value]
    if isinstance(value, uno.Any):
        return from_uno(value.value, fields, _depth + 1)
    if isinstance(value, uno.Enum):
        return value.value
    if isinstance(value, uno.Char):
        return value.value
    if isinstance(value, uno.ByteSequence):
        return list(value.value)
    if isinstance(value, uno.Type):
        return value.typeName
    type_name = getattr(value, '__pyunostruct__', None)
    if isinstance(type_name, str):
        if fields is None:
            if _default_fields is None:
                _default_fields = StructFields()
            fields = _default_fields
        out = {'__type': type_name}
        for name in fields.names(type_name):
            try:
                out[name] = from_uno(getattr(value, name), fields, _depth + 1)
            except AttributeError:
                continue
        return out
    return None


_SCHEME = re.compile(r'^[A-Za-z][A-Za-z0-9+.-]+:')


def to_url(path_or_url):
    """Accepts a URL (file:///, private:…) or a system path and returns a URL."""
    if not isinstance(path_or_url, str) or not path_or_url:
        raise _invalid('url', 'must be a non-empty string')
    if _SCHEME.match(path_or_url):
        return path_or_url
    return uno.systemPathToFileUrl(os.path.abspath(path_or_url))
