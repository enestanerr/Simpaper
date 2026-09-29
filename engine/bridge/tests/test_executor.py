# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Main-thread marshalling (varak_bridge.office.MainThreadExecutor) with a fake AsyncCallback."""
import threading
import time
import unittest

from varak_bridge.errors import RpcError
from varak_bridge.office import MainThreadExecutor
from varak_bridge.protocol import ErrorCode


class FakeAsyncCallback:
    """Calls XCallback.notify() on one "main thread", like soffice's AsyncCallback, optionally late or never."""

    def __init__(self, delay=0.0, run=True):
        self.delay = delay
        self.run = run
        self.threads = set()

    def addCallback(self, job, _data):  # noqa: N802 (UNO name)
        if not self.run:
            return

        def fire():
            time.sleep(self.delay)
            self.threads.add(threading.get_ident())
            job.notify(None)
        threading.Thread(target=fire, daemon=True).start()


class ExecutorTest(unittest.TestCase):
    def test_result_is_computed_on_the_callback_thread(self):
        acb = FakeAsyncCallback()
        seen = []
        result = MainThreadExecutor(acb).run(lambda: seen.append(threading.get_ident()) or 42, 5, 'job')
        self.assertEqual(result, 42)
        self.assertEqual(set(seen), acb.threads)
        self.assertNotIn(threading.get_ident(), acb.threads)

    def test_errors_arrive_detached(self):
        def fail():
            raise ValueError('bozuk')
        with self.assertRaises(RpcError) as ctx:
            MainThreadExecutor(FakeAsyncCallback()).run(fail, 5, 'job')
        err = ctx.exception
        self.assertEqual(err.code, ErrorCode.INTERNAL)
        self.assertEqual(err.message, 'bozuk')
        self.assertEqual(err.data['type'], 'ValueError')
        # Only the frames of run() itself, never those of the job (they held UNO proxies).
        frames = []
        tb = err.__traceback__
        while tb is not None:
            frames.append(tb.tb_frame.f_code.co_name)
            tb = tb.tb_next
        self.assertNotIn('fail', frames)

    def test_job_that_never_starts_is_cancelled(self):
        executor = MainThreadExecutor(FakeAsyncCallback(run=False))
        with self.assertRaises(RpcError) as ctx:
            executor.run(lambda: 1, 0.2, 'doc.new')
        self.assertEqual(ctx.exception.code, ErrorCode.TIMEOUT)
        self.assertIn('did not start', ctx.exception.message)
        # A cancelled job does not block the next one.
        executor._acb = FakeAsyncCallback()
        self.assertEqual(executor.run(lambda: 2, 5, 'next'), 2)

    def test_running_job_makes_the_engine_busy_until_it_ends(self):
        gate = threading.Event()
        executor = MainThreadExecutor(FakeAsyncCallback())
        with self.assertRaises(RpcError) as ctx:
            executor.run(gate.wait, 0.3, 'doc.load')
        self.assertEqual(ctx.exception.code, ErrorCode.TIMEOUT)
        self.assertIn('did not finish', ctx.exception.message)
        with self.assertRaises(RpcError) as busy:
            executor.run(lambda: 1, 5, 'doc.info')
        self.assertEqual(busy.exception.code, ErrorCode.BUSY)
        gate.set()
        time.sleep(0.1)
        self.assertEqual(executor.run(lambda: 3, 5, 'doc.info'), 3)

    def test_modal_dialog_releases_the_caller(self):
        opened = threading.Event()
        gate = threading.Event()

        def dispatch_that_opens_a_dialog():
            opened.set()
            gate.wait(5)
            return 'closed'
        executor = MainThreadExecutor(FakeAsyncCallback())
        self.assertIsNone(executor.run(dispatch_that_opens_a_dialog, 5, 'cmd.dispatch', release=opened))
        # Later jobs may run while the dialog's loop is active (no BUSY for modal jobs).
        executor._check_lingering()
        gate.set()


if __name__ == '__main__':
    unittest.main()
