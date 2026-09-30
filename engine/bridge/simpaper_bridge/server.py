# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Request loop: stdin lines are read on a thread and executed in order on one worker."""

import logging
import queue
import threading
import time

from .errors import RpcError, to_error_object
from .framing import FramingError, decode_line
from .protocol import ErrorCode

log = logging.getLogger('simpaper.server')

_EOF = object()
_STOP = object()


def event_message(event):
    return {'jsonrpc': '2.0', 'method': 'event', 'params': event}


class Server:
    """Executes requests sequentially. Responses carry the request id; events are notifications."""

    def __init__(self, stdin, writer, methods):
        self._stdin = stdin
        self._writer = writer
        self._methods = methods
        self._queue = queue.Queue()
        self._stop_code = None

    def stop(self, code):
        """Makes run() return `code`: at once when idle, else after the request being executed was answered.
        Requests still queued are not answered (the parent fails them when the process ends). Any thread."""
        if self._stop_code is None:
            self._stop_code = code
            self._queue.put(_STOP)

    def _read(self):
        try:
            for line in self._stdin:
                if line.strip():
                    self._queue.put(line)
        except (OSError, ValueError):
            log.info('stdin closed')
        finally:
            self._queue.put(_EOF)

    def run(self):
        """Returns 0 when stdin reaches EOF or after engine.shutdown was answered, or the code given to stop()."""
        threading.Thread(target=self._read, name='simpaper-stdin', daemon=True).start()
        while True:
            item = self._queue.get()
            if item is _STOP:
                return self._stop_code
            if item is _EOF:
                log.info('parent closed the channel')
                self._methods.terminate_on_eof()
                return 0
            self.handle(item)
            if self._stop_code is not None:
                return self._stop_code
            if self._methods.exit_requested:
                return 0

    def _reply(self, request_id, result=None, error=None):
        message = {'jsonrpc': '2.0', 'id': request_id}
        if error is not None:
            message['error'] = error
        else:
            message['result'] = result
        self._writer.write(message)

    def handle(self, raw):
        try:
            message = decode_line(raw)
        except FramingError as exc:
            self._reply(None, error={'code': ErrorCode.PARSE, 'message': str(exc)})
            return
        request_id = message.get('id')
        method = message.get('method')
        valid_id = isinstance(request_id, int) and not isinstance(request_id, bool)
        if message.get('jsonrpc') != '2.0' or not isinstance(method, str) or not valid_id:
            if request_id is None and isinstance(method, str):
                return  # a notification: none are defined for this direction
            self._reply(request_id if valid_id else None,
                        error={'code': ErrorCode.INVALID_REQUEST, 'message': 'invalid JSON-RPC request'})
            return
        started = time.monotonic()
        try:
            result = self._methods.call(method, message.get('params'))
        except Exception as exc:
            error = to_error_object(exc, include_trace=not isinstance(exc, RpcError))
            log.info('%s #%d failed in %.0f ms: %s (%s)', method, request_id,
                     (time.monotonic() - started) * 1000, error['code'], error.get('data', {}).get('type', ''))
            self._reply(request_id, error=error)
            return
        log.debug('%s #%d ok in %.0f ms', method, request_id, (time.monotonic() - started) * 1000)
        self._reply(request_id, result=result)
