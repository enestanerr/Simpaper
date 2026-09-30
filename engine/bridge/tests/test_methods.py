"""Command-name validation of RPC parameters (simpaper_bridge.methods)."""
import unittest

from simpaper_bridge.errors import RpcError
from simpaper_bridge.methods import _command


class CommandNameTest(unittest.TestCase):
    def test_accepts_plain_and_argument_commands(self):
        for name in ('.uno:Bold', '.uno:StyleApply?Style:string=Heading 1', '.uno:SidebarDeck.A11yCheckDeck'):
            self.assertEqual(_command(name), name)

    def test_accepts_hyphenated_shape_commands(self):
        # Shape menus of the ribbon use these registry-verified names.
        for name in ('.uno:BasicShapes.round-rectangle', '.uno:ArrowShapes.left-right-arrow', '.uno:CalloutShapes.cloud-callout'):
            self.assertEqual(_command(name), name)

    def test_rejects_non_uno_commands(self):
        for name in ('macro:///Standard.Module1.Main', 'vnd.sun.star.script:x', '.uno:', '.uno:-Bold', 'Bold', '', None, 42):
            with self.assertRaises(RpcError):
                _command(name)


if __name__ == '__main__':
    unittest.main()
