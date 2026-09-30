# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Command line entry point: python -m simpaper_bridge --pipe <name> [--log-level info]."""

import argparse
import logging
import os
import re
import sys
import threading
import time

_LEVELS = {'debug': logging.DEBUG, 'info': logging.INFO, 'warn': logging.WARNING,
           'warning': logging.WARNING, 'error': logging.ERROR}
# After a connection loss the request loop normally ends within milliseconds (pending main-thread jobs
# are abandoned, calls on the dead bridge fail at once); this is the safety net.
LOST_EXIT_GRACE_S = 5.0


def parse_args(argv):
    parser = argparse.ArgumentParser(prog='simpaper_bridge', description='Simpaper engine bridge')
    parser.add_argument('--pipe', required=True, help='name of the soffice UNO pipe acceptor')
    parser.add_argument('--log-level', default='info', choices=sorted(_LEVELS))
    parser.add_argument('--connect-timeout', type=float, default=120.0, help='seconds to wait for soffice')
    parser.add_argument('--office-pid-file', default=None, help='file written by soffice --pidfile')
    args = parser.parse_args(argv)
    if not re.fullmatch(r'[A-Za-z0-9_]{1,64}', args.pipe):
        parser.error('--pipe may only contain letters, digits and underscores')
    return args


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    logging.basicConfig(stream=sys.stderr, level=_LEVELS[args.log_level],
                        format='%(levelname)s %(name)s: %(message)s')
    protocol_out = sys.stdout.buffer
    stdin = sys.stdin.buffer
    # Nothing but protocol messages may reach stdout: stray prints go to the log instead.
    sys.stdout = sys.stderr

    # Imported late so that argument errors do not need a working UNO environment.
    from .framing import MessageWriter
    from .methods import Methods
    from .protocol import EXIT_CONNECTION_LOST
    from .server import Server, event_message

    def flush():
        try:
            protocol_out.flush()
            sys.stderr.flush()
        except Exception:
            pass

    writer = MessageWriter(protocol_out)
    methods = Methods(args.pipe, lambda event: writer.write(event_message(event)),
                      connect_timeout=args.connect_timeout, pid_file=args.office_pid_file)
    server = Server(stdin, writer, methods)

    def connection_lost():
        # The instance is unusable: end the process so that the parent sees it end (as a crash).
        server.stop(EXIT_CONNECTION_LOST)

        def force_exit():
            time.sleep(LOST_EXIT_GRACE_S)
            logging.getLogger('simpaper').error('request loop still busy after the connection loss; exiting')
            flush()
            os._exit(EXIT_CONNECTION_LOST)
        threading.Thread(target=force_exit, name='simpaper-lost-exit', daemon=True).start()

    methods.on_connection_lost = connection_lost
    methods.start()
    code = 1
    try:
        code = server.run()
    except BaseException:
        logging.getLogger('simpaper').exception('bridge failed')
    finally:
        flush()
        # Skip interpreter teardown: joining pyuno's bridge threads can hang after soffice is gone.
        os._exit(code)
