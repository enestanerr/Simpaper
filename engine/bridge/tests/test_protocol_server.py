# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Protocol constants vs. src/shared/engine-protocol.ts, and the request loop (simpaper_bridge.server)."""
import io
import json
import os
import re
import unittest

from simpaper_bridge.errors import RpcError
from simpaper_bridge.framing import MessageWriter
from simpaper_bridge.protocol import INTERCEPTED_COMMANDS, PROTOCOL_VERSION, ErrorCode
from simpaper_bridge.server import Server

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
TS_PROTOCOL = os.path.join(ROOT, 'src', 'shared', 'engine-protocol.ts')


@unittest.skipUnless(os.path.isfile(TS_PROTOCOL), 'src/shared/engine-protocol.ts not found')
class ProtocolSyncTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(TS_PROTOCOL, encoding='utf-8') as fh:
            cls.ts = fh.read()

    def test_protocol_version(self):
        self.assertEqual(int(re.search(r'ENGINE_PROTOCOL_VERSION = (\d+)', self.ts).group(1)), PROTOCOL_VERSION)

    def test_error_codes(self):
        block = re.search(r'RPC_ERROR = \{(.*?)\}', self.ts, re.S).group(1)
        ts_codes = {name: int(value) for name, value in re.findall(r'(\w+): (-?\d+)', block)}
        py_codes = {name: value for name, value in vars(ErrorCode).items() if name.isupper()}
        self.assertEqual(ts_codes, py_codes)

    def test_intercepted_commands(self):
        block = re.search(r'INTERCEPTED_COMMANDS = \[(.*?)\] as const', self.ts, re.S).group(1)
        self.assertEqual(tuple(re.findall(r"'([^']+)'", block)), INTERCEPTED_COMMANDS)


class FakeMethods:
    def __init__(self):
        self.exit_requested = False
        self.eof = False
        self.calls = []

    def call(self, method, params):
        self.calls.append((method, params))
        if method == 'boom':
            raise KeyError('secret')
        if method == 'rpc':
            raise RpcError(ErrorCode.DOC_NOT_FOUND, 'no open document x')
        if method == 'engine.shutdown':
            self.exit_requested = True
        return {'echo': params}

    def terminate_on_eof(self):
        self.eof = True


def run_server(lines):
    out = io.BytesIO()
    methods = FakeMethods()
    stdin = io.BytesIO(''.join(line + '\n' for line in lines).encode('utf-8'))
    code = Server(stdin, MessageWriter(out), methods).run()
    replies = [json.loads(line) for line in out.getvalue().decode('utf-8').splitlines()]
    return code, replies, methods


class ServerTest(unittest.TestCase):
    def test_results_errors_and_order(self):
        code, replies, methods = run_server([
            json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'doc.info', 'params': {'docId': 'Çağrı'}}, ensure_ascii=False),
            json.dumps({'jsonrpc': '2.0', 'id': 2, 'method': 'rpc', 'params': {}}),
            json.dumps({'jsonrpc': '2.0', 'id': 3, 'method': 'boom', 'params': {}}),
        ])
        self.assertEqual(code, 0)
        self.assertTrue(methods.eof, 'EOF on stdin must bring soffice down')
        self.assertEqual([r['id'] for r in replies], [1, 2, 3])
        self.assertEqual(replies[0]['result'], {'echo': {'docId': 'Çağrı'}})
        self.assertEqual(replies[1]['error'], {'code': ErrorCode.DOC_NOT_FOUND, 'message': 'no open document x'})
        self.assertEqual(replies[2]['error']['code'], ErrorCode.INTERNAL)
        self.assertEqual(replies[2]['error']['data']['type'], 'KeyError')

    def test_invalid_input(self):
        _code, replies, methods = run_server([
            'not json',
            json.dumps({'id': 5, 'method': 'x'}),
            json.dumps({'jsonrpc': '2.0', 'id': True, 'method': 'x'}),
            json.dumps({'jsonrpc': '2.0', 'method': 'notification'}),
        ])
        self.assertEqual(methods.calls, [])
        self.assertEqual(replies[0]['error']['code'], ErrorCode.PARSE)
        self.assertIsNone(replies[0]['id'])
        self.assertEqual(replies[1], {'jsonrpc': '2.0', 'id': 5, 'error': {'code': ErrorCode.INVALID_REQUEST, 'message': 'invalid JSON-RPC request'}})
        self.assertIsNone(replies[2]['id'])
        self.assertEqual(len(replies), 3, 'notifications get no reply')

    def test_shutdown_ends_the_loop(self):
        code, replies, methods = run_server([
            json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'engine.shutdown', 'params': {}}),
            json.dumps({'jsonrpc': '2.0', 'id': 2, 'method': 'doc.info', 'params': {}}),
        ])
        self.assertEqual(code, 0)
        self.assertEqual([r['id'] for r in replies], [1])
        self.assertFalse(methods.eof)


if __name__ == '__main__':
    unittest.main()
