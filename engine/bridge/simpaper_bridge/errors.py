# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""RPC errors and the mapping of Python/UNO exceptions to JSON-RPC error objects."""

import traceback

from .protocol import ErrorCode


class RpcError(Exception):
    """An error with a protocol error code; raised by method implementations."""

    def __init__(self, code, message, data=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data


# UNO exception types that mean "the office (or the connection to it) is gone".
_UNAVAILABLE_TYPES = frozenset((
    'com.sun.star.connection.NoConnectException',
    'com.sun.star.bridge.BridgeExistsException',
))
# A DisposedException is the connection only when binaryurp raised it ("Binary URP bridge disposed during
# call", "Binary URP bridge already disposed"); otherwise a document object was closed under our feet.
_DISPOSED = 'com.sun.star.lang.DisposedException'

_INVALID_PARAMS_TYPES = frozenset((
    'com.sun.star.lang.IllegalArgumentException',
    'com.sun.star.lang.IndexOutOfBoundsException',
    'com.sun.star.container.NoSuchElementException',
    'com.sun.star.beans.UnknownPropertyException',
))


def uno_type_name(exc):
    """Full UNO type name of a pyuno exception (or struct), else the Python class name."""
    name = getattr(exc, 'typeName', None)
    if isinstance(name, str) and name:
        return name
    return type(exc).__name__


def uno_message(exc):
    message = getattr(exc, 'Message', None)
    if isinstance(message, str) and message:
        return message
    text = str(exc)
    return text or type(exc).__name__


def is_connection_lost(exc):
    """True when the exception means the URP connection to soffice is broken."""
    name = uno_type_name(exc)
    if name in _UNAVAILABLE_TYPES:
        return True
    if name in (_DISPOSED, 'com.sun.star.uno.RuntimeException'):
        return 'URP bridge' in uno_message(exc)
    return False


def to_error_object(exc, include_trace=True):
    """Converts any exception into a JSON-RPC error object (`code`, `message`, `data`)."""
    if isinstance(exc, RpcError):
        err = {'code': exc.code, 'message': exc.message}
        if exc.data is not None:
            err['data'] = exc.data
        return err
    name = uno_type_name(exc)
    if is_connection_lost(exc):
        code = ErrorCode.ENGINE_UNAVAILABLE
    elif name == _DISPOSED:
        code = ErrorCode.DOC_NOT_FOUND
    elif name in _INVALID_PARAMS_TYPES:
        code = ErrorCode.INVALID_PARAMS
    else:
        code = ErrorCode.INTERNAL
    data = {'type': name}
    if include_trace:
        data['trace'] = ''.join(traceback.format_exception(type(exc), exc, exc.__traceback__))[-4000:]
    return {'code': code, 'message': uno_message(exc), 'data': data}


def detached_error(exc):
    """An RpcError equivalent to `exc` that references no stack frames and no UNO objects.

    Raised exceptions keep their traceback, and with it every local variable of the failed frames
    (proxies of document content such as shapes or cells), alive until the exception is collected,
    possibly after the document was closed. Releasing such a proxy after the close can crash soffice
    (docs/dev/engine.md, "Release after close"), so only this plain copy leaves the job that failed.
    """
    if isinstance(exc, RpcError):
        return RpcError(exc.code, exc.message, exc.data)
    err = to_error_object(exc, include_trace=True)
    return RpcError(err['code'], err['message'], err.get('data'))
