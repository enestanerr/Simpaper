# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""JSON <-> UNO value conversion (varak_bridge.values). Needs `uno`, no soffice."""
import os
import unittest

import uno
from com.sun.star.awt import Rectangle
from com.sun.star.beans import PropertyValue

from varak_bridge.errors import RpcError
from varak_bridge.protocol import ErrorCode
from varak_bridge.values import from_uno, property_value, to_property_values, to_uno, to_url, typed_value


class TypedValueTest(unittest.TestCase):
    def test_numeric_kinds(self):
        value = typed_value('float', 12)
        self.assertIsInstance(value, uno.Any)
        self.assertEqual(value.type.typeName, 'float')
        self.assertEqual(value.value, 12.0)
        self.assertEqual(typed_value('double', 1.5).value, 1.5)
        self.assertEqual(typed_value('short', 700).type.typeName, 'short')
        self.assertEqual(typed_value('hyper', 2 ** 40).value, 2 ** 40)
        self.assertEqual(typed_value('long', 3.0).value, 3)

    def test_ranges_and_types(self):
        cases = [('byte', 128), ('short', -40000), ('long', 2 ** 31), ('long', 1.5), ('float', float('nan')),
                 ('double', 'x'), ('string', 1), ('boolean', 1), ('byte', True), ('unknown', 1)]
        for kind, raw in cases:
            with self.subTest(kind=kind, raw=raw):
                with self.assertRaises(RpcError) as ctx:
                    typed_value(kind, raw)
                self.assertEqual(ctx.exception.code, ErrorCode.INVALID_PARAMS)

    def test_string_and_boolean(self):
        self.assertEqual(typed_value('string', 'İ').value, 'İ')
        self.assertIs(typed_value('boolean', False).value, False)


class ToUnoTest(unittest.TestCase):
    def test_plain_values(self):
        self.assertIsNone(to_uno(None))
        self.assertIs(to_uno(True), True)
        self.assertEqual(to_uno('Çağrı'), 'Çağrı')
        self.assertEqual(to_uno(7), 7)
        self.assertEqual(to_uno(2.5), 2.5)
        self.assertEqual(to_uno([1, 'a', [True]]), (1, 'a', (True,)))

    def test_typed_form_inside_lists(self):
        out = to_uno([{'type': 'float', 'value': 11}])
        self.assertEqual(out[0].type.typeName, 'float')

    def test_rejects_objects_and_non_finite(self):
        for bad in ({'Name': 'x'}, {'type': 'float'}, float('inf'), object()):
            with self.subTest(bad=bad):
                with self.assertRaises(RpcError) as ctx:
                    to_uno(bad, 'args.X')
                self.assertEqual(ctx.exception.code, ErrorCode.INVALID_PARAMS)
                self.assertIn('args.X', ctx.exception.message)


class PropertyValuesTest(unittest.TestCase):
    def test_names_are_kept(self):
        props = to_property_values({'FontHeight.Height': {'type': 'float', 'value': 14}, 'Bold': True})
        self.assertEqual([p.Name for p in props], ['FontHeight.Height', 'Bold'])
        # pyuno hands back the plain value of an `any` member; the typed Any decides the UNO type on the way in.
        self.assertEqual(props[0].Value, 14.0)
        self.assertEqual(to_property_values(None), ())

    def test_error_path_names_the_argument(self):
        with self.assertRaises(RpcError) as ctx:
            to_property_values({'Size': {'nope': 1}}, 'filterData')
        self.assertIn('filterData.Size', ctx.exception.message)
        with self.assertRaises(RpcError):
            to_property_values(['not', 'a', 'dict'])

    def test_property_value(self):
        prop = property_value('Hidden', True)
        self.assertIsInstance(prop, PropertyValue)
        self.assertEqual((prop.Name, prop.Value), ('Hidden', True))


class FromUnoTest(unittest.TestCase):
    def test_scalars_and_sequences(self):
        self.assertEqual(from_uno((1, 'a', (2.5, None))), [1, 'a', [2.5, None]])
        self.assertIsNone(from_uno(float('nan')))
        self.assertEqual(from_uno(uno.Any('long', 5)), 5)
        self.assertEqual(from_uno(uno.Char('x')), 'x')
        self.assertEqual(from_uno(uno.ByteSequence(b'\x01\x02')), [1, 2])
        self.assertEqual(from_uno(uno.getTypeByName('string')), 'string')

    def test_enum(self):
        self.assertEqual(from_uno(uno.Enum('com.sun.star.awt.WindowClass', 'TOP')), 'TOP')

    def test_struct_with_base_members(self):
        rect = Rectangle(1, 2, 3, 4)
        self.assertEqual(from_uno(rect), {'__type': 'com.sun.star.awt.Rectangle', 'X': 1, 'Y': 2, 'Width': 3, 'Height': 4})
        prop = property_value('Name', (1, 2))
        out = from_uno(prop)
        self.assertEqual(out['__type'], 'com.sun.star.beans.PropertyValue')
        self.assertEqual(out['Name'], 'Name')
        self.assertEqual(out['Value'], [1, 2])

    def test_depth_limit(self):
        deep = 1
        for _ in range(40):
            deep = (deep,)
        out = from_uno(deep)
        for _ in range(25):
            self.assertIsInstance(out, list)
            out = out[0]
        self.assertIsNone(out, 'nesting deeper than 24 levels is cut off')


class ToUrlTest(unittest.TestCase):
    def test_urls_pass_through(self):
        for url in ('file:///C:/x/a.docx', 'private:factory/swriter', 'vnd.sun.star.pkg://x'):
            self.assertEqual(to_url(url), url)

    def test_system_paths_become_file_urls(self):
        path = os.path.join(os.path.abspath(os.sep), 'Belgeler', 'Çağrı İşçi.docx')
        url = to_url(path)
        self.assertTrue(url.startswith('file:///'))
        self.assertEqual(uno.fileUrlToSystemPath(url), path)

    def test_rejects_empty(self):
        with self.assertRaises(RpcError):
            to_url('')


if __name__ == '__main__':
    unittest.main()
