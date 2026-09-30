# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Loss of the URP connection to soffice (simpaper_bridge.office / methods / server).

When the connection is gone the bridge must end its process with EXIT_CONNECTION_LOST instead of answering
ENGINE_UNAVAILABLE forever: only an exit makes the main process run its crash handling. The URP tests talk
to a peer in another process (urp_peer.py), like the bridge talks to soffice; no soffice is needed.
"""
import io
import json
import os
import re
import subprocess
import sys
import threading
import time
import unittest

import uno  # noqa: F401  (registers the com.sun.star import hook)
from com.sun.star.lang import DisposedException

from simpaper_bridge.errors import RpcError
from simpaper_bridge.framing import MessageWriter
from simpaper_bridge.methods import Methods
from simpaper_bridge.office import ConnectionLoss, MainThreadExecutor, connect
from simpaper_bridge.protocol import EXIT_CONNECTION_LOST, ErrorCode
from simpaper_bridge.server import Server

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
ENGINE_INSTANCE_TS = os.path.join(ROOT, 'src', 'main', 'engine', 'EngineInstance.ts')
# LibreOffice's Python reports its core folder as sys.executable; the launcher next to it sets up UNO.
LAUNCHER = os.path.join(os.path.dirname(sys.executable), 'python.exe' if os.name == 'nt' else 'python')


class Recorder:
    def __init__(self):
        self.calls = []
        self.called = threading.Event()

    def __call__(self, *args):
        self.calls.append(args)
        self.called.set()


class ConnectionLossTest(unittest.TestCase):
    def test_reports_once(self):
        loss, seen = ConnectionLoss(), Recorder()
        loss.watch(None, seen)
        self.assertFalse(loss.lost)
        loss.mark('first')
        loss.mark('second')
        self.assertTrue(loss.lost)
        self.assertEqual(seen.calls, [('first',)])

    def test_a_loss_noticed_before_watching_is_reported_when_watching_starts(self):
        loss, seen = ConnectionLoss(), Recorder()
        loss.mark('during the handshake')
        loss.watch(None, seen)
        loss.mark('again')
        self.assertEqual(seen.calls, [('during the handshake',)])


class FakeAsyncCallback:
    """An AsyncCallback whose jobs never run (soffice is gone)."""

    def addCallback(self, _job, _data):  # noqa: N802 (UNO name)
        pass


class ExecutorTest(unittest.TestCase):
    def test_waiting_caller_is_answered_when_the_connection_is_lost(self):
        lost = threading.Event()
        executor = MainThreadExecutor(FakeAsyncCallback(), lost)
        outcome = {}

        def call():
            started = time.monotonic()
            try:
                executor.run(lambda: 1, 60, 'doc.store')
            except RpcError as exc:
                outcome['error'] = exc
            outcome['seconds'] = time.monotonic() - started
        thread = threading.Thread(target=call)
        thread.start()
        time.sleep(0.2)
        lost.set()
        thread.join(5)
        self.assertFalse(thread.is_alive())
        self.assertEqual(outcome['error'].code, ErrorCode.ENGINE_UNAVAILABLE)
        self.assertLess(outcome['seconds'], 2, 'must not wait for the 60 s timeout')

    def test_no_job_is_posted_after_the_loss(self):
        lost = threading.Event()
        lost.set()
        posted = []

        class Acb:
            def addCallback(self, job, _data):  # noqa: N802
                posted.append(job)
        with self.assertRaises(RpcError) as ctx:
            MainThreadExecutor(Acb(), lost).run(lambda: 1, 60, 'doc.info')
        self.assertEqual(ctx.exception.code, ErrorCode.ENGINE_UNAVAILABLE)
        self.assertEqual(posted, [])


class FakeOffice:
    lost = False

    def __init__(self):
        self.lost_reasons = []
        self.terminated = threading.Event()
        self.desktop = self

    def terminate(self):
        self.terminated.set()
        return True

    def mark_lost(self, reason):
        self.lost_reasons.append(reason)


def methods_with_office():
    lost = Recorder()
    methods = Methods('unused', lambda _event: None, on_connection_lost=lost)
    office = FakeOffice()
    methods.connection.office = office
    methods.connection.ready.set()
    return methods, office, lost


class MethodsTest(unittest.TestCase):
    def test_a_lost_connection_ends_the_bridge_unless_soffice_is_being_ended(self):
        methods, _office, lost = methods_with_office()
        with self.assertLogs('simpaper.methods', 'ERROR') as logs:
            methods._connection_lost('URP bridge disposed')
        self.assertEqual(len(lost.calls), 1)
        self.assertIn('exit code %d' % EXIT_CONNECTION_LOST, logs.output[0])

        methods, _office, lost = methods_with_office()
        methods.exit_requested = True  # engine.shutdown terminates soffice: the loss is expected
        methods._connection_lost('URP bridge disposed')
        self.assertEqual(lost.calls, [])

        methods, office, lost = methods_with_office()
        methods.terminate_on_eof()  # the parent closed stdin: soffice is terminated, the loss is expected
        self.assertTrue(office.terminated.is_set())
        methods._connection_lost('URP bridge disposed')
        self.assertEqual(lost.calls, [])

    def test_a_call_that_hits_the_dead_connection_marks_it_lost(self):
        methods, office, _lost = methods_with_office()

        def fail(_p):
            raise DisposedException('Binary URP bridge disposed during call', None)
        methods._table['doc.info'] = fail
        with self.assertRaises(DisposedException):
            methods.call('doc.info', {'docId': 'd'})
        self.assertEqual(len(office.lost_reasons), 1)
        self.assertIn('Binary URP bridge disposed during call', office.lost_reasons[0])

    def test_a_closed_document_is_no_connection_loss(self):
        methods, office, _lost = methods_with_office()

        def fail(_p):
            raise DisposedException('object is disposed', None)
        methods._table['doc.info'] = fail
        with self.assertRaises(DisposedException):
            methods.call('doc.info', {'docId': 'd'})
        self.assertEqual(office.lost_reasons, [])


class BlockingStdin:
    """stdin of a parent that stays connected but sends nothing more."""

    def __init__(self, lines=()):
        self._lines = list(lines)
        self._never = threading.Event()

    def __iter__(self):
        yield from self._lines
        self._never.wait()


class ServerStopTest(unittest.TestCase):
    def test_stop_ends_an_idle_loop_with_the_code(self):
        server = Server(BlockingStdin(), MessageWriter(io.BytesIO()), object())
        threading.Timer(0.1, server.stop, (EXIT_CONNECTION_LOST,)).start()
        self.assertEqual(server.run(), EXIT_CONNECTION_LOST)

    def test_the_request_being_executed_is_answered_before_the_loop_ends(self):
        out = io.BytesIO()

        class LosingMethods:
            exit_requested = False

            def call(self, method, _params):
                server.stop(EXIT_CONNECTION_LOST)  # what main.py does when the loss is noticed
                raise RpcError(ErrorCode.ENGINE_UNAVAILABLE, 'the connection to soffice was lost: %s' % method)

        requests = [json.dumps({'jsonrpc': '2.0', 'id': i, 'method': 'doc.info', 'params': {}}).encode() + b'\n' for i in (1, 2)]
        server = Server(BlockingStdin(requests), MessageWriter(out), LosingMethods())
        self.assertEqual(server.run(), EXIT_CONNECTION_LOST)
        replies = [json.loads(line) for line in out.getvalue().decode('utf-8').splitlines()]
        self.assertEqual([r['id'] for r in replies], [1])
        self.assertEqual(replies[0]['error']['code'], ErrorCode.ENGINE_UNAVAILABLE)


@unittest.skipUnless(os.path.isfile(ENGINE_INSTANCE_TS), 'src/main/engine/EngineInstance.ts not found')
class ExitCodeSyncTest(unittest.TestCase):
    def test_exit_code_matches_the_main_process(self):
        with open(ENGINE_INSTANCE_TS, encoding='utf-8') as fh:
            match = re.search(r'BRIDGE_EXIT_CONNECTION_LOST = (\d+);', fh.read())
        self.assertIsNotNone(match)
        self.assertEqual(int(match.group(1)), EXIT_CONNECTION_LOST)


@unittest.skipUnless(os.path.isfile(LAUNCHER), 'LibreOffice Python launcher not found')
class UrpConnectionTest(unittest.TestCase):
    """connect() and ConnectionLoss against a URP peer in another process."""

    def setUp(self):
        self.pipe = 'simpaper_test_%d_%d' % (os.getpid(), int(time.monotonic() * 1000) % 1000000)
        self.peer = subprocess.Popen([LAUNCHER, os.path.join(HERE, 'urp_peer.py'), self.pipe],
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        self.addCleanup(self._end_peer)
        self.assertEqual(self.peer.stdout.readline().strip(), b'ready')
        self.remote, self.bridge = connect(self.pipe, 20)
        self.loss = ConnectionLoss()
        self.lost = Recorder()
        self.loss.watch(self.bridge, self.lost)

    def _end_peer(self):
        try:
            self.peer.stdin.close()
        except OSError:
            pass
        try:
            self.peer.wait(10)
        except subprocess.TimeoutExpired:
            subprocess.run(['taskkill', '/PID', str(self.peer.pid), '/T', '/F'], capture_output=True, check=False)
            self.peer.wait(10)
        self.peer.stdout.close()

    def test_a_working_connection_is_not_reported(self):
        self.assertEqual(self.remote.getName(), 'peer')
        self.remote.setName('Çağrı İşçi')
        self.assertEqual(self.remote.getName(), 'Çağrı İşçi')
        self.assertFalse(self.lost.called.wait(0.3))
        self.assertFalse(self.loss.lost)

    def test_the_peer_ending_is_reported_without_any_call(self):
        self.assertEqual(self.remote.getName(), 'peer')
        self.peer.stdin.close()  # the peer process ends, like a killed soffice
        self.assertTrue(self.lost.called.wait(10), 'the disposed bridge was not reported')
        self.assertTrue(self.loss.lost)

    def test_a_string_binaryurp_cannot_marshal_ends_the_connection(self):
        # A lone UTF-16 surrogate (e.g. from JSON "\\ud83d") makes binaryurp dispose the whole connection;
        # the peer (soffice) keeps running, so only the bridge can notice.
        with self.assertRaises(DisposedException):
            self.remote.setName('A\ud83dB')
        self.assertTrue(self.lost.called.wait(10))
        self.assertIsNone(self.peer.poll(), 'the peer keeps running')
        with self.assertRaises(DisposedException):
            self.remote.getName()


if __name__ == '__main__':
    unittest.main()
