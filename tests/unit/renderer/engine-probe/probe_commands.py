# Engine probe for the ribbon's .uno: allow-list (src/shared/commands.ts). Run with LibreOffice's bundled Python:
#
#   vendor/libreoffice/program/python.exe tests/unit/renderer/engine-probe/probe_commands.py
#       Starts its own soffice (--headless, private profile test-output/shell-ui/lo-profile-probe, unique pipe),
#       creates hidden new documents (Calc, Impress, Writer — Writer last: as the first document of a fresh headless
#       instance it did not load in our runs), checks that every allowed command of the module has a dispatch
#       (frame.queryDispatch), reads back the effect of the argument forms the ribbon sends, writes
#       test-output/shell-ui/probe-commands.json and kills the whole process tree (also from a watchdog).
#       No windows are shown, nothing is sent anywhere.
#
#   vendor/libreoffice/program/python.exe tests/unit/renderer/engine-probe/probe_commands.py --labels Name [Name ...]
#       Registry lookup only (no engine start): the *Commands component and en-US label of each command.
#
# Not part of the Vitest suites (it starts the engine); see docs/dev/shell-ui.md §4 and §12.
import json
import os
import re
import subprocess
import sys
import threading
import time
import traceback
import uuid

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
PROG = os.path.join(ROOT, 'vendor', 'libreoffice', 'program')
REGISTRY = os.path.join(ROOT, 'vendor', 'libreoffice', 'share', 'registry')
OUT = os.path.join(ROOT, 'test-output', 'shell-ui')
PROFILE = os.path.join(OUT, 'lo-profile-probe')
PIPE = 'varak_shellui_probe_' + uuid.uuid4().hex[:12]
T0 = time.time()
PROC = None
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:  # noqa: BLE001
    pass


def log(*a):
    print('%.2f' % (time.time() - T0), *a, flush=True)


# ---------------------------------------------------------------------------------------------- allow-list

def read_allow_list():
    """Parses the dispatch and status lists of src/shared/commands.ts (COMMON is spread into every module)."""
    src = open(os.path.join(ROOT, 'src', 'shared', 'commands.ts'), encoding='utf-8').read()

    def block(name):
        start = src.index('const %s = [' % name)
        end = src.index('] as const;', start)
        body = src[start:end]
        items = re.findall(r"'(\.uno:[^']+)'", body)
        return (block('COMMON') if '...COMMON' in body else []) + items

    status_start = src.index('const STATUS')
    status_body = src[status_start:src.index('};', status_start)]
    status = {k: re.findall(r"'(\.uno:[^']+)'", v) for k, v in re.findall(r'(\w+): \[([^\]]*)\]', status_body)}
    return {kind: {'dispatch': sorted(set(block(kind.upper()))), 'status': status.get(kind, [])} for kind in ('writer', 'calc', 'impress')}


# ---------------------------------------------------------------------------------------------- registry

def registry_labels(names):
    xml = ''.join(open(os.path.join(REGISTRY, f), encoding='utf-8').read() for f in ('main.xcd', 'writer.xcd', 'calc.xcd'))
    components = [(m.start(), m.group(1)) for m in re.finditer(r'<oor:component-data[^>]*oor:name="(\w+Commands)"', xml)]
    for raw in names:
        name = raw if raw.startswith('.uno:') else '.uno:' + raw
        found = []
        for m in re.finditer(r'<node oor:name="%s"' % re.escape(name), xml):
            component = next((c for pos, c in reversed(components) if pos < m.start()), '?')
            body = xml[m.start():xml.index('</node>', m.start())]
            label = re.search(r'oor:name="Label"[^>]*><value[^>]*>([^<]*)', body)
            found.append('%s: %s' % (component, label.group(1) if label else '(no label)'))
        print(name.ljust(40), ' | '.join(found) if found else 'NOT FOUND')


# ---------------------------------------------------------------------------------------------- engine

def kill_tree():
    if PROC is not None:
        subprocess.run(['taskkill', '/PID', str(PROC.pid), '/T', '/F'], capture_output=True)


def watchdog(seconds):
    def run():
        time.sleep(seconds)
        log('WATCHDOG: timeout, killing soffice')
        kill_tree()
        os._exit(3)
    threading.Thread(target=run, daemon=True).start()


def main_probe():
    import uno
    import unohelper
    from com.sun.star.awt import XCallback
    from com.sun.star.beans import PropertyValue
    from com.sun.star.frame import XStatusListener
    from com.sun.star.util import URL

    allow = read_allow_list()

    class Job(unohelper.Base, XCallback):
        def __init__(self, fn):
            self.fn = fn
            self.ev = threading.Event()
            self.res = None
            self.err = None

        def notify(self, data):
            try:
                self.res = self.fn()
            except Exception:
                self.err = traceback.format_exc()
            finally:
                self.ev.set()

    class Listener(unohelper.Base, XStatusListener):
        def __init__(self, store):
            self.store = store

        def statusChanged(self, ev):
            self.store[ev.FeatureURL.Complete] = ev.IsEnabled

        def disposing(self, ev):
            pass

    state = {'acb': None}

    def on_main(fn, timeout=90):
        job = Job(fn)
        state['acb'].addCallback(job, None)
        if not job.ev.wait(timeout):
            raise RuntimeError('main-thread job timeout')
        if job.err:
            raise RuntimeError(job.err)
        return job.res

    def pv(name, value):
        p = PropertyValue()
        p.Name = name
        p.Value = value
        return p

    def start():
        global PROC
        user = os.path.join(PROFILE, 'user')
        os.makedirs(user, exist_ok=True)
        with open(os.path.join(user, 'registrymodifications.xcu'), 'w', encoding='utf-8') as f:
            f.write('<?xml version="1.0" encoding="UTF-8"?>\n'
                    '<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" '
                    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n'
                    '<item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="ShowTipOfTheDay" oor:op="fuse"><value>false</value></prop></item>\n'
                    '<item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="FirstRun" oor:op="fuse"><value>false</value></prop></item>\n'
                    '<item oor:path="/org.openoffice.Setup/L10N"><prop oor:name="ooLocale" oor:op="fuse"><value>en-US</value></prop></item>\n'
                    '</oor:items>\n')
        cmd = [os.path.join(PROG, 'soffice.exe'), '-env:UserInstallation=' + uno.systemPathToFileUrl(PROFILE),
               '--accept=pipe,name=%s;urp;StarOffice.ComponentContext' % PIPE,
               '--norestore', '--nologo', '--nodefault', '--nolockcheck', '--headless']
        env = {k: v for k, v in os.environ.items() if k not in ('UNO_PATH', 'URE_BOOTSTRAP', 'PYTHONPATH', 'PYTHONHOME')}
        PROC = subprocess.Popen(cmd, env=env)
        log('soffice launcher pid', PROC.pid, 'pipe', PIPE)

    def connect():
        local = uno.getComponentContext()
        resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
        last = None
        for _ in range(240):
            try:
                return resolver.resolve('uno:pipe,name=%s;urp;StarOffice.ComponentContext' % PIPE)
            except Exception as e:  # noqa: BLE001
                last = e
                time.sleep(0.5)
        raise RuntimeError('connect failed: %s' % last)

    def url(ctx, s):
        t = ctx.ServiceManager.createInstanceWithContext('com.sun.star.util.URLTransformer', ctx)
        u = URL()
        u.Complete = s
        return t.parseStrict(u)[1]

    def available(ctx, frame, commands):
        return {c: on_main(lambda u=url(ctx, c): frame.queryDispatch(u, '', 0) is not None) for c in commands}

    def subscribe(ctx, frame, commands):
        keep, states = [], {}
        for c in commands:
            u = url(ctx, c)
            d = on_main(lambda u=u: frame.queryDispatch(u, '', 0))
            if d is not None:
                lst = Listener(states)
                on_main(lambda d=d, lst=lst, u=u: d.addStatusListener(lst, u))
                keep.append((d, lst, u))
        return keep, states

    def dispatch(ctx, frame, cmd, args=()):
        helper = ctx.ServiceManager.createInstanceWithContext('com.sun.star.frame.DispatchHelper', ctx)
        return on_main(lambda: helper.executeDispatch(frame, cmd, '', 0, tuple(args)))

    def dispatch_typed(ctx, frame, cmd, args):
        helper = ctx.ServiceManager.createInstanceWithContext('com.sun.star.frame.DispatchHelper', ctx)
        seq = uno.Any('[]com.sun.star.beans.PropertyValue', tuple(args))
        return on_main(lambda: uno.invoke(helper, 'executeDispatch', (frame, cmd, '', 0, seq)))

    def settle():
        time.sleep(0.6)

    def writer_checks(ctx, doc, frame, r):
        text = on_main(lambda: doc.getText())
        on_main(lambda: text.insertString(text.getEnd(), 'Varak deneme ıİşğ', False))

        def para(name):
            def get():
                c = text.createTextCursor()
                c.gotoStart(False)
                c.gotoEndOfParagraph(True)
                return c.getPropertyValue(name)
            return on_main(get)

        dispatch(ctx, frame, '.uno:SelectAll')
        settle()
        dispatch(ctx, frame, '.uno:Bold')
        settle()
        r['Bold: CharWeight'] = para('CharWeight')
        dispatch(ctx, frame, '.uno:CharFontName', [pv('CharFontName.FamilyName', 'Liberation Serif')])
        settle()
        r['CharFontName.FamilyName: CharFontName'] = para('CharFontName')
        dispatch_typed(ctx, frame, '.uno:FontHeight', [pv('FontHeight.Height', uno.Any('float', 16.0))])
        settle()
        r['FontHeight.Height (float 16): CharHeight'] = para('CharHeight')
        dispatch(ctx, frame, '.uno:Color', [pv('Color', 0xC0303F)])
        settle()
        r['Color (long): CharColor'] = hex(para('CharColor') & 0xFFFFFFFF)
        dispatch(ctx, frame, '.uno:CharBackColor', [pv('CharBackColor', 0xFFFF00)])
        settle()
        r['CharBackColor (long): CharBackColor'] = hex(para('CharBackColor') & 0xFFFFFFFF)
        dispatch(ctx, frame, '.uno:StyleApply', [pv('Style', 'Heading 1'), pv('FamilyName', 'ParagraphStyles')])
        settle()
        r['StyleApply (Heading 1): ParaStyleName'] = para('ParaStyleName')
        vs = on_main(lambda: doc.getCurrentController().getViewSettings())
        dispatch(ctx, frame, '.uno:Zoom', [pv('Zoom.Value', 150)])
        settle()
        r['Zoom.Value (150): ZoomValue'] = on_main(lambda: vs.ZoomValue)
        dispatch(ctx, frame, '.uno:GoToEndOfDoc')
        dispatch_typed(ctx, frame, '.uno:InsertTable', [pv('Columns', uno.Any('short', 3)), pv('Rows', uno.Any('short', 2))])
        settle()
        tables = on_main(lambda: doc.getTextTables())
        if on_main(lambda: tables.getCount()):
            t = on_main(lambda: tables.getByIndex(0))
            r['InsertTable (Columns 3, Rows 2): table'] = '%dx%d' % (on_main(lambda: t.getColumns().getCount()), on_main(lambda: t.getRows().getCount()))
        else:
            r['InsertTable (Columns 3, Rows 2): table'] = None

    def calc_checks(ctx, doc, frame, r):
        sheet = on_main(lambda: doc.getSheets().getByIndex(0))
        cell = on_main(lambda: sheet.getCellRangeByName('B2'))
        on_main(lambda: cell.setValue(0.25))
        dispatch(ctx, frame, '.uno:GoToCell', [pv('ToPoint', 'B2')])
        settle()
        dispatch(ctx, frame, '.uno:StyleApply', [pv('Style', 'Good'), pv('FamilyName', 'CellStyles')])
        settle()
        r['StyleApply (Good, CellStyles): CellStyle'] = on_main(lambda: cell.CellStyle)
        dispatch(ctx, frame, '.uno:BackgroundColor', [pv('BackgroundColor', 0xFCC419)])
        dispatch(ctx, frame, '.uno:NumberFormatPercent')
        time.sleep(1.5)
        # Observed without effect on hidden headless Calc documents (see docs/dev/shell-ui.md, known gaps).
        r['BackgroundColor (long): CellBackColor'] = hex(on_main(lambda: cell.CellBackColor) & 0xFFFFFFFF)
        r['NumberFormatPercent: String'] = on_main(lambda: cell.getString())

    def impress_checks(ctx, doc, frame, r):
        pages = on_main(lambda: doc.getDrawPages())
        counts = [on_main(lambda: pages.getCount())]
        for cmd in ('.uno:InsertPage', '.uno:DuplicatePage', '.uno:DeletePage'):
            dispatch(ctx, frame, cmd)
            settle()
            counts.append(on_main(lambda: pages.getCount()))
        r['InsertPage, DuplicatePage, DeletePage: slides'] = counts
        page = on_main(lambda: doc.getCurrentController().getCurrentPage())
        for layout in (3, 20):
            dispatch(ctx, frame, '.uno:AssignLayout', [pv('WhatLayout', layout)])
            settle()
            r['AssignLayout (WhatLayout %d): Layout' % layout] = on_main(lambda: page.Layout)

    watchdog(300)
    start()
    results = {'allowList': {k: len(v['dispatch']) + len(v['status']) for k, v in allow.items()}}
    try:
        ctx = connect()
        smgr = ctx.ServiceManager
        desktop = smgr.createInstanceWithContext('com.sun.star.frame.Desktop', ctx)
        state['acb'] = smgr.createInstanceWithContext('com.sun.star.awt.AsyncCallback', ctx)
        log('connected')
        for kind, factory, checks in (('calc', 'private:factory/scalc', calc_checks),
                                      ('impress', 'private:factory/simpress', impress_checks),
                                      ('writer', 'private:factory/swriter', writer_checks)):
            res = {}
            results[kind] = res
            try:
                doc = on_main(lambda f=factory: desktop.loadComponentFromURL(f, '_blank', 0, (pv('Hidden', True), pv('MacroExecutionMode', 0))))
                frame = on_main(lambda: doc.getCurrentController().getFrame())
                commands = allow[kind]['dispatch'] + allow[kind]['status']
                res['available'] = available(ctx, frame, commands)
                res['missing'] = [c for c, ok in res['available'].items() if not ok]
                log(kind, 'dispatch available: %d/%d' % (len(commands) - len(res['missing']), len(commands)), 'missing:', ' '.join(res['missing']) or '-')
                keep, _ = subscribe(ctx, frame, allow[kind]['dispatch'])  # like the ribbon: status listeners first
                res['args'] = {}
                checks(ctx, doc, frame, res['args'])
                log(kind, 'args', json.dumps(res['args'], ensure_ascii=False))
                on_main(lambda: doc.close(True), timeout=30)
            except Exception:
                res['error'] = traceback.format_exc()[-2000:]
                log(kind, 'FAILED', res['error'][-400:])
        try:
            on_main(lambda: desktop.terminate(), timeout=20)
        except Exception:  # noqa: BLE001
            pass
    finally:
        os.makedirs(OUT, exist_ok=True)
        with open(os.path.join(OUT, 'probe-commands.json'), 'w', encoding='utf-8') as f:
            json.dump(results, f, ensure_ascii=False, indent=1, default=str)
        time.sleep(1.0)
        kill_tree()
        log('process tree killed; results in test-output/shell-ui/probe-commands.json')


if __name__ == '__main__':
    if len(sys.argv) > 2 and sys.argv[1] == '--labels':
        registry_labels(sys.argv[2:])
    elif len(sys.argv) > 1 and sys.argv[1] == '--list':
        print(json.dumps({k: {'dispatch': len(v['dispatch']), 'status': len(v['status'])} for k, v in read_allow_list().items()}))
    else:
        main_probe()
