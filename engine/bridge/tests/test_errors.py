# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Mapping of Python/UNO exceptions to protocol errors (simpaper_bridge.errors). Needs `uno`, no soffice."""
import unittest

import uno  # noqa: F401  (registers the com.sun.star import hook)
from com.sun.star.beans import UnknownPropertyException
from com.sun.star.connection import NoConnectException
from com.sun.star.io import IOException
from com.sun.star.lang import DisposedException, IllegalArgumentException
from com.sun.star.uno import RuntimeException

from simpaper_bridge.errors import RpcError, detached_error, is_connection_lost, to_error_object, uno_type_name
from simpaper_bridge.protocol import ErrorCode


def _raised(exc):
    """The exception as it looks after being raised (with a traceback)."""
    try:
        raise exc
    except BaseException as caught:  # noqa: BLE001
        return caught


class ErrorMappingTest(unittest.TestCase):
    def test_rpc_error_is_passed_through(self):
        err = to_error_object(RpcError(ErrorCode.DOC_NOT_FOUND, 'no open document x', {'docId': 'x'}))
        self.assertEqual(err, {'code': ErrorCode.DOC_NOT_FOUND, 'message': 'no open document x', 'data': {'docId': 'x'}})
        self.assertNotIn('data', to_error_object(RpcError(ErrorCode.BUSY, 'busy')))

    def test_connection_loss(self):
        cases = [
            (DisposedException('Binary URP bridge disposed during call', None), True),
            (DisposedException('Binary URP bridge already disposed', None), True),
            (RuntimeException('Binary URP bridge disposed during call', None), True),
            (NoConnectException('no pipe', None), True),
            (DisposedException('the object is disposed', None), False),
            (RuntimeException('something else', None), False),
            (ValueError('x'), False),
        ]
        for exc, lost in cases:
            with self.subTest(exc=exc):
                self.assertEqual(is_connection_lost(exc), lost)
                code = to_error_object(exc)['code']
                if lost:
                    self.assertEqual(code, ErrorCode.ENGINE_UNAVAILABLE)
                else:
                    self.assertNotEqual(code, ErrorCode.ENGINE_UNAVAILABLE)

    def test_disposed_document_objects_are_not_found(self):
        err = to_error_object(DisposedException('', None))
        self.assertEqual(err['code'], ErrorCode.DOC_NOT_FOUND)
        self.assertEqual(err['data']['type'], 'com.sun.star.lang.DisposedException')

    def test_invalid_params_and_internal(self):
        self.assertEqual(to_error_object(IllegalArgumentException('bad', None, 1))['code'], ErrorCode.INVALID_PARAMS)
        self.assertEqual(to_error_object(UnknownPropertyException('Foo', None))['code'], ErrorCode.INVALID_PARAMS)
        err = to_error_object(_raised(IOException('disk', None)))
        self.assertEqual(err['code'], ErrorCode.INTERNAL)
        self.assertEqual(err['data']['type'], 'com.sun.star.io.IOException')
        self.assertIn('IOException', err['data']['trace'])
        plain = to_error_object(_raised(KeyError('k')), include_trace=False)
        self.assertEqual(plain['code'], ErrorCode.INTERNAL)
        self.assertEqual(plain['data'], {'type': 'KeyError'})

    def test_type_names(self):
        self.assertEqual(uno_type_name(IllegalArgumentException('', None, 0)), 'com.sun.star.lang.IllegalArgumentException')
        self.assertEqual(uno_type_name(ValueError()), 'ValueError')


class DetachedErrorTest(unittest.TestCase):
    def test_uno_exception_becomes_plain_rpc_error_without_traceback(self):
        original = _raised(IllegalArgumentException('Geçersiz', None, 0))
        self.assertIsNotNone(original.__traceback__)
        clean = detached_error(original)
        self.assertIsInstance(clean, RpcError)
        self.assertIsNone(clean.__traceback__)
        self.assertIsNone(clean.__context__)
        self.assertEqual(clean.code, ErrorCode.INVALID_PARAMS)
        self.assertEqual(clean.message, 'Geçersiz')
        self.assertEqual(clean.data['type'], 'com.sun.star.lang.IllegalArgumentException')
        self.assertIn('Traceback', clean.data['trace'])

    def test_rpc_error_keeps_code_and_data_but_not_its_frames(self):
        try:
            try:
                raise ValueError('inner')
            except ValueError:
                raise RpcError(ErrorCode.UNSUPPORTED, 'not here', {'x': 1})
        except RpcError as exc:
            original = exc
        self.assertIsNotNone(original.__context__)
        clean = detached_error(original)
        self.assertEqual((clean.code, clean.message, clean.data), (ErrorCode.UNSUPPORTED, 'not here', {'x': 1}))
        self.assertIsNone(clean.__traceback__)
        self.assertIsNone(clean.__context__)

    def test_connection_loss_survives_detaching(self):
        clean = detached_error(_raised(DisposedException('Binary URP bridge disposed during call', None)))
        self.assertEqual(clean.code, ErrorCode.ENGINE_UNAVAILABLE)


if __name__ == '__main__':
    unittest.main()
