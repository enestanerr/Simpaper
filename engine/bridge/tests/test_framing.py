# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""NDJSON framing (simpaper_bridge.framing)."""
import io
import json
import threading
import unittest

from simpaper_bridge.framing import FramingError, MessageWriter, decode_line, encode_message, sanitize


class DecodeLineTest(unittest.TestCase):
    def test_bytes_and_str_with_line_endings(self):
        self.assertEqual(decode_line(b'{"a":1}\r\n'), {'a': 1})
        self.assertEqual(decode_line('{"a":"Çağrı"}\n'), {'a': 'Çağrı'})
        self.assertEqual(decode_line('  {"x": [1, 2]}  '), {'x': [1, 2]})

    def test_turkish_utf8_bytes(self):
        raw = json.dumps({'t': 'İşçi ığdır ÖŞÜ'}, ensure_ascii=False).encode('utf-8') + b'\n'
        self.assertEqual(decode_line(raw)['t'], 'İşçi ığdır ÖŞÜ')

    def test_rejects_invalid_lines(self):
        for bad in (b'\xff\xfe{}', b'', b'   \n', b'{"a":', b'[1,2]', b'"text"', b'42'):
            with self.subTest(bad=bad):
                with self.assertRaises(FramingError):
                    decode_line(bad)


class EncodeTest(unittest.TestCase):
    def test_one_line_utf8_without_ascii_escapes(self):
        data = encode_message({'jsonrpc': '2.0', 'id': 1, 'result': {'text': 'satır 1\nsatır 2 Çağrı'}})
        self.assertTrue(data.endswith(b'\n'))
        self.assertEqual(data.count(b'\n'), 1, 'newlines inside strings must be escaped')
        self.assertIn('Çağrı'.encode('utf-8'), data)
        self.assertEqual(json.loads(data.decode('utf-8'))['result']['text'], 'satır 1\nsatır 2 Çağrı')

    def test_non_finite_numbers_become_null(self):
        self.assertEqual(sanitize({'a': float('nan'), 'b': [float('inf'), 1.5], 'c': (float('-inf'),)}),
                         {'a': None, 'b': [None, 1.5], 'c': [None]})
        self.assertEqual(json.loads(encode_message({'v': float('nan')})), {'v': None})

    def test_compact_separators(self):
        self.assertEqual(encode_message({'a': 1, 'b': [1, 2]}), b'{"a":1,"b":[1,2]}\n')


class _Broken(io.RawIOBase):
    def write(self, _data):
        raise OSError('pipe closed')


class MessageWriterTest(unittest.TestCase):
    def test_writes_whole_lines_from_many_threads(self):
        stream = io.BytesIO()
        writer = MessageWriter(stream)

        def work(n):
            for i in range(200):
                writer.write({'thread': n, 'i': i, 'pad': 'x' * 50})
        threads = [threading.Thread(target=work, args=(n,)) for n in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        lines = stream.getvalue().decode('utf-8').splitlines()
        self.assertEqual(len(lines), 800)
        for line in lines:
            self.assertEqual(set(json.loads(line)), {'thread', 'i', 'pad'})

    def test_closed_pipe_stops_writing(self):
        writer = MessageWriter(_Broken())
        self.assertFalse(writer.write({'a': 1}))
        self.assertTrue(writer.closed)
        self.assertFalse(writer.write({'a': 2}))


class SurrogateTest(unittest.TestCase):
    """binaryurp cannot marshal lone UTF-16 surrogates: decode_line replaces them before any use."""

    def test_lone_surrogates_become_replacement_characters(self):
        line = b'{"text": "A\\ud83dB \\udc00", "k\\udfff": ["x\\ud800", {"y": "\\udbff"}]}'
        self.assertEqual(decode_line(line), {'text': 'A\ufffdB \ufffd', 'k\ufffd': ['x\ufffd', {'y': '\ufffd'}]})

    def test_valid_pairs_and_other_values_are_kept(self):
        line = b'{"emoji": "\\ud83d\\ude00", "tr": "\xc3\xa7\xc4\x9f\xc4\xb1", "n": 1.5, "b": true, "z": null}'
        self.assertEqual(decode_line(line), {'emoji': '\U0001F600', 'tr': '\u00e7\u011f\u0131', 'n': 1.5, 'b': True, 'z': None})


if __name__ == '__main__':
    unittest.main()
