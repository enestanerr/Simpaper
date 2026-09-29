# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""A stand-in for soffice's UNO acceptor in another process (test_connection.py; not a test module).

    python urp_peer.py <pipe name>

Accepts URP connections on the named pipe and offers an XNamed object as every instance. Prints 'ready'
once the acceptor is about to listen and ends its process when stdin is closed, which closes the
connection the way a dying soffice does.
"""
import os
import sys
import threading

import uno
import unohelper
from com.sun.star.bridge import XInstanceProvider
from com.sun.star.container import XNamed


class Named(unohelper.Base, XNamed):
    def __init__(self):
        self.name = 'peer'

    def getName(self):  # noqa: N802 (UNO name)
        return self.name

    def setName(self, name):  # noqa: N802
        self.name = name


class Provider(unohelper.Base, XInstanceProvider):
    def __init__(self):
        self.named = Named()

    def getInstance(self, _name):  # noqa: N802
        return self.named


def main(pipe):
    ctx = uno.getComponentContext()
    acceptor = ctx.ServiceManager.createInstanceWithContext('com.sun.star.connection.Acceptor', ctx)
    factory = ctx.ServiceManager.createInstanceWithContext('com.sun.star.bridge.BridgeFactory', ctx)
    provider = Provider()
    bridges = []

    def accept_loop():
        while True:
            try:
                connection = acceptor.accept('pipe,name=%s' % pipe)
            except Exception:
                return
            if connection is None:
                return
            bridges.append(factory.createBridge('', 'urp', connection, provider))

    threading.Thread(target=accept_loop, daemon=True).start()
    print('ready', flush=True)
    sys.stdin.read()
    # Like a killed soffice: no orderly bridge shutdown (and no waiting for pyuno's threads).
    os._exit(0)


if __name__ == '__main__':
    main(sys.argv[1])
