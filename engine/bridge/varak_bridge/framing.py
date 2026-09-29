# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""NDJSON framing: one UTF-8 encoded JSON object per line, in both directions."""

import json
import math
import re
import threading

# After json.loads a surrogate code point can only be a lone one: json combines valid pairs into one character.
_LONE_SURROGATE = re.compile('[\ud800-\udfff]')


class FramingError(ValueError):
    """The line is not a single, valid JSON object."""


def decode_line(line):
    """Parses one received line (bytes or str, trailing CR/LF allowed) into a dict."""
    if isinstance(line, (bytes, bytearray)):
        try:
            line = bytes(line).decode('utf-8')
        except UnicodeDecodeError as exc:
            raise FramingError('line is not valid UTF-8') from exc
    text = line.strip()
    if not text:
        raise FramingError('empty line')
    try:
        obj = json.loads(text)
    except ValueError as exc:
        raise FramingError('invalid JSON: %s' % exc) from exc
    if not isinstance(obj, dict):
        raise FramingError('message is not a JSON object')
    return scrub_surrogates(obj)


def scrub_surrogates(value):
    """Replaces lone UTF-16 surrogates (a JSON high or low surrogate escape without its pair) with U+FFFD in all
    strings and keys.

    binaryurp cannot marshal such a string: sending one to soffice disposes the whole URP connection.
    """
    if isinstance(value, str):
        return _LONE_SURROGATE.sub('\ufffd', value)
    if isinstance(value, dict):
        return {scrub_surrogates(k): scrub_surrogates(v) for k, v in value.items()}
    if isinstance(value, list):
        return [scrub_surrogates(item) for item in value]
    return value


def sanitize(value):
    """Makes a value strictly JSON-serialisable (non-finite floats become null)."""
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {str(k): sanitize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [sanitize(v) for v in value]
    return value


def encode_message(obj):
    """Serialises one message as a single UTF-8 line terminated by LF."""
    text = json.dumps(sanitize(obj), ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    return (text + '\n').encode('utf-8')


class MessageWriter:
    """Thread-safe writer: responses (worker thread) and events (UNO callback threads) share stdout."""

    def __init__(self, stream):
        self._stream = stream
        self._lock = threading.Lock()
        self.closed = False

    def write(self, obj):
        data = encode_message(obj)
        with self._lock:
            if self.closed:
                return False
            try:
                self._stream.write(data)
                self._stream.flush()
                return True
            except (OSError, ValueError):
                # The parent closed the pipe; nothing can be reported any more.
                self.closed = True
                return False
