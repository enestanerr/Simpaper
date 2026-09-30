# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Headless interaction handling and dispatch interception (simpaper_bridge.listeners) with fake UNO objects."""
import unittest

import uno  # noqa: F401

from simpaper_bridge.listeners import DispatchInterceptor, InteractionHandler, KeyHandler, base_command


class Fake:
    """Answers queryInterface() for the interface names it was given."""

    def __init__(self, *interfaces, **attrs):
        self._interfaces = set(interfaces)
        self.__dict__.update(attrs)

    def queryInterface(self, type_):  # noqa: N802 (UNO name)
        return self if type_.typeName in self._interfaces else None


class Continuation(Fake):
    def __init__(self, interface):
        super().__init__(interface)
        self.selected = False
        self.password = None

    def select(self):
        self.selected = True

    def setPassword(self, password):  # noqa: N802
        self.password = password


class Mode:
    def __init__(self, value):
        self.value = value


def request(type_name, *continuations, mode=None):
    payload = Fake(typeName=type_name)
    if mode:
        payload.Mode = Mode(mode)
    return Fake(getRequest=lambda: payload, getContinuations=lambda: continuations)


ABORT = 'com.sun.star.task.XInteractionAbort'
APPROVE = 'com.sun.star.task.XInteractionApprove'
DISAPPROVE = 'com.sun.star.task.XInteractionDisapprove'
PASSWORD = 'com.sun.star.task.XInteractionPassword'
MS_PASSWORD = 'com.sun.star.task.DocumentMSPasswordRequest2'


class InteractionHandlerTest(unittest.TestCase):
    def test_password_required_without_a_password(self):
        abort, pw = Continuation(ABORT), Continuation(PASSWORD)
        handler = InteractionHandler()
        handler.handleInteractionRequest(request(MS_PASSWORD, abort, pw, mode='PASSWORD_ENTER'))
        self.assertTrue(abort.selected)
        self.assertFalse(pw.selected)
        self.assertEqual(handler.outcome, 'password-required')
        self.assertEqual(handler.requests, [MS_PASSWORD])

    def test_password_is_supplied_once(self):
        abort, pw = Continuation(ABORT), Continuation(PASSWORD)
        handler = InteractionHandler('Şifre-123')
        handler.handleInteractionRequest(request(MS_PASSWORD, abort, pw, mode='PASSWORD_ENTER'))
        self.assertEqual(pw.password, 'Şifre-123')
        self.assertTrue(pw.selected)
        self.assertIsNone(handler.outcome)
        # LibreOffice asks again when the password was wrong.
        abort2, pw2 = Continuation(ABORT), Continuation(PASSWORD)
        handler.handleInteractionRequest(request(MS_PASSWORD, abort2, pw2, mode='PASSWORD_REENTER'))
        self.assertTrue(abort2.selected)
        self.assertIsNone(pw2.password)
        self.assertEqual(handler.outcome, 'wrong-password')

    def test_reenter_mode_is_never_answered(self):
        abort, pw = Continuation(ABORT), Continuation(PASSWORD)
        handler = InteractionHandler('x')
        handler.handleInteractionRequest(request('com.sun.star.task.DocumentPasswordRequest2', abort, pw, mode='PASSWORD_REENTER'))
        self.assertTrue(abort.selected)
        self.assertEqual(handler.outcome, 'wrong-password')

    def test_warnings_are_approved_everything_else_aborted(self):
        approve, abort = Continuation(APPROVE), Continuation(ABORT)
        handler = InteractionHandler()
        handler.handleInteractionRequest(request('com.sun.star.task.ErrorCodeRequest2', abort, approve))
        self.assertTrue(approve.selected)
        self.assertFalse(abort.selected)
        other_abort, other_approve = Continuation(ABORT), Continuation(APPROVE)
        handler.handleInteractionRequest(request('com.sun.star.ucb.InteractiveIOException', other_approve, other_abort))
        self.assertTrue(other_abort.selected)
        self.assertFalse(other_approve.selected)
        only_disapprove = Continuation(DISAPPROVE)
        handler.handleInteractionRequest(request('com.sun.star.document.FilterOptionsRequest', only_disapprove))
        self.assertTrue(only_disapprove.selected)


class Url:
    def __init__(self, complete):
        self.Complete = complete


class Slave:
    def __init__(self):
        self.queried = []

    def queryDispatch(self, url, target, flags):  # noqa: N802
        self.queried.append(url.Complete)
        return 'slave-dispatch'


class DispatchInterceptorTest(unittest.TestCase):
    def test_intercepted_commands_are_reported_not_executed(self):
        seen = []
        interceptor = DispatchInterceptor(lambda command, args: seen.append((command, args)), ('.uno:Save', '.uno:Quit'))
        slave = Slave()
        interceptor.setSlaveDispatchProvider(slave)
        self.assertEqual(interceptor.getInterceptedURLs(), ('.uno:Save', '.uno:Save?*', '.uno:Quit', '.uno:Quit?*'))
        self.assertIs(interceptor.queryDispatch(Url('.uno:Save?VersionComment:string=x'), '', 0), interceptor)
        self.assertEqual(interceptor.queryDispatch(Url('.uno:Bold'), '', 0), 'slave-dispatch')
        self.assertEqual(slave.queried, ['.uno:Bold'])
        interceptor.dispatch(Url('.uno:Save?x:bool=true'), ())
        self.assertEqual(seen, [('.uno:Save', ())])

    def test_without_slave_nothing_is_dispatchable(self):
        interceptor = DispatchInterceptor(lambda *_: None, ('.uno:Save',))
        self.assertIsNone(interceptor.queryDispatch(Url('.uno:Bold'), '', 0))

    def test_base_command(self):
        self.assertEqual(base_command('.uno:Save?A:string=b'), '.uno:Save')
        self.assertEqual(base_command('.uno:Bold'), '.uno:Bold')


class KeyEvent:
    def __init__(self, code, modifiers=0):
        self.KeyCode = code
        self.Modifiers = modifiers


class KeyHandlerTest(unittest.TestCase):
    def test_shell_keys_are_consumed_until_released(self):
        seen = []
        handler = KeyHandler(lambda code, mods: 'F6' if (code, mods) == (1, 0) else None, seen.append)
        self.assertTrue(handler.keyPressed(KeyEvent(1)))
        self.assertTrue(handler.keyReleased(KeyEvent(1)))
        self.assertFalse(handler.keyReleased(KeyEvent(1)))
        self.assertFalse(handler.keyPressed(KeyEvent(2)))
        self.assertEqual(seen, ['F6'])


if __name__ == '__main__':
    unittest.main()
