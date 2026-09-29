# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Reads a Windows x64 minidump as written by LibreOffice's crash handler (<profile>/crash/*.dmp):
exception, faulting module/offset and the stack of the faulting thread, symbolised with the export tables
of the DLLs on disk (vendor/libreoffice/program and System32). docs/dev/engine.md explains its use.

usage: vendor/libreoffice/program/python.exe tests/engine/diagnostics/minidump.py <file.dmp> [--all | --scan]
  --all   stacks of every thread (DbgHelp unwinding)
  --scan  every stack slot of the faulting thread that points into a module (works when unwinding fails)
"""
import ctypes
import ctypes.wintypes as wt
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from stackdump import STACKFRAME64, dbghelp  # noqa: E402

PROGRAM = os.path.abspath(os.path.join(HERE, '..', '..', '..', 'vendor', 'libreoffice', 'program'))
SEARCH = [PROGRAM, os.path.join(PROGRAM, 'python-core-3.13.15', 'bin'), os.path.join(os.environ.get('SystemRoot', r'C:\Windows'), 'System32')]

ReadMemoryRoutine = ctypes.WINFUNCTYPE(wt.BOOL, wt.HANDLE, ctypes.c_uint64, ctypes.c_void_p, wt.DWORD, ctypes.POINTER(wt.DWORD))
dbghelp.StackWalk64.argtypes = [wt.DWORD, wt.HANDLE, wt.HANDLE, ctypes.POINTER(STACKFRAME64), ctypes.c_void_p,
                                ReadMemoryRoutine, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
dbghelp.SymLoadModuleExW.restype = ctypes.c_uint64
dbghelp.SymLoadModuleExW.argtypes = [wt.HANDLE, wt.HANDLE, wt.LPCWSTR, wt.LPCWSTR, ctypes.c_uint64, wt.DWORD, ctypes.c_void_p, wt.DWORD]


class Dump:
    def __init__(self, path):
        self.data = open(path, 'rb').read()
        sig, _ver, count, rva = struct.unpack_from('<4sIII', self.data, 0)
        assert sig == b'MDMP', 'not a minidump'
        self.streams = {}
        for i in range(count):
            stype, size, srva = struct.unpack_from('<III', self.data, rva + 12 * i)
            self.streams[stype] = (srva, size)
        self.modules = self._modules()
        self.memory = self._memory()

    def string(self, rva):
        length = struct.unpack_from('<I', self.data, rva)[0]
        return self.data[rva + 4:rva + 4 + length].decode('utf-16-le')

    def _modules(self):
        rva, _ = self.streams[4]
        n = struct.unpack_from('<I', self.data, rva)[0]
        out = []
        for i in range(n):
            base, size, _ck, _ts, name_rva = struct.unpack_from('<QIIII', self.data, rva + 4 + 108 * i)
            out.append((base, size, self.string(name_rva)))
        return sorted(out)

    def _memory(self):
        ranges = []
        if 5 in self.streams:  # MemoryListStream
            rva, _ = self.streams[5]
            n = struct.unpack_from('<I', self.data, rva)[0]
            for i in range(n):
                start, size, mrva = struct.unpack_from('<QII', self.data, rva + 4 + 16 * i)
                ranges.append((start, size, mrva))
        if 9 in self.streams:  # Memory64ListStream
            rva, _ = self.streams[9]
            n, base_rva = struct.unpack_from('<QQ', self.data, rva)
            off = base_rva
            for i in range(n):
                start, size = struct.unpack_from('<QQ', self.data, rva + 16 + 16 * i)
                ranges.append((start, size, off))
                off += size
        return ranges

    def read(self, addr, size):
        for start, length, rva in self.memory:
            if start <= addr and addr + size <= start + length:
                return self.data[rva + addr - start: rva + addr - start + size]
        return None

    def threads(self):
        rva, _ = self.streams[3]
        n = struct.unpack_from('<I', self.data, rva)[0]
        out = []
        for i in range(n):
            tid, _s, _pc, _p, _teb, st_start, st_size, st_rva, ctx_size, ctx_rva = struct.unpack_from('<IIIIQQIIII', self.data, rva + 4 + 48 * i)
            out.append({'tid': tid, 'stack': (st_start, st_size, st_rva), 'ctx': (ctx_rva, ctx_size)})
        return out

    def exception(self):
        if 6 not in self.streams:
            return None
        rva, _ = self.streams[6]
        tid, _a, code, flags, _rec, addr, nparams, _u = struct.unpack_from('<IIIIQQII', self.data, rva)
        params = struct.unpack_from('<15Q', self.data, rva + 40)[:nparams]
        ctx_size, ctx_rva = struct.unpack_from('<II', self.data, rva + 8 + 152)
        return {'tid': tid, 'code': code, 'flags': flags, 'address': addr, 'params': params, 'ctx': (ctx_rva, ctx_size)}

    def module_for(self, addr):
        for base, size, name in self.modules:
            if base <= addr < base + size:
                return os.path.basename(name), addr - base
        return '?', addr


def locate(name):
    for d in SEARCH:
        p = os.path.join(d, os.path.basename(name))
        if os.path.isfile(p):
            return p
    return None


def walk(dump, ctx_rva, ctx_size, handle, max_frames=60):
    ctx = ctypes.create_string_buffer(1232 + 16)
    base = (ctypes.addressof(ctx) + 15) & ~15
    ctypes.memmove(base, dump.data[ctx_rva:ctx_rva + min(ctx_size, 1232)], min(ctx_size, 1232))

    @ReadMemoryRoutine
    def read_memory(_h, addr, buf, size, read):
        chunk = dump.read(addr, size)
        if chunk is None:
            return False
        ctypes.memmove(buf, chunk, size)
        if read:
            read[0] = size
        return True

    frame = STACKFRAME64()
    frame.AddrPC.Offset = ctypes.c_uint64.from_address(base + 0xF8).value
    frame.AddrStack.Offset = ctypes.c_uint64.from_address(base + 0x98).value
    frame.AddrFrame.Offset = ctypes.c_uint64.from_address(base + 0xA0).value
    frame.AddrPC.Mode = frame.AddrStack.Mode = frame.AddrFrame.Mode = 3
    fta = ctypes.cast(dbghelp.SymFunctionTableAccess64, ctypes.c_void_p)
    gmb = ctypes.cast(dbghelp.SymGetModuleBase64, ctypes.c_void_p)
    pcs = []
    for _ in range(max_frames):
        if not dbghelp.StackWalk64(0x8664, handle, None, ctypes.byref(frame), base, read_memory, fta, gmb, None):
            break
        if not frame.AddrPC.Offset:
            break
        pcs.append(frame.AddrPC.Offset)
    return pcs


def symbol(handle, dump, pc):
    buf = ctypes.create_string_buffer(88 + 1024)
    ctypes.c_uint32.from_buffer(buf, 0).value = 88
    ctypes.c_uint32.from_buffer(buf, 80).value = 1000
    disp = ctypes.c_uint64()
    mod, off = dump.module_for(pc)
    if dbghelp.SymFromAddr(handle, pc, ctypes.byref(disp), buf):
        n = ctypes.c_uint32.from_buffer(buf, 76).value
        return '%s!%s+0x%x' % (mod, buf.raw[84:84 + n].decode('latin-1'), disp.value)
    return '%s+0x%x' % (mod, off)


def main():
    dump = Dump(sys.argv[1])
    handle = wt.HANDLE(0x7A11)
    dbghelp.SymSetOptions(0x2 | 0x200 | 0x80000)
    dbghelp.SymInitializeW(handle, None, False)
    for base, size, name in dump.modules:
        path = locate(name)
        if path:
            dbghelp.SymLoadModuleExW(handle, None, path, None, base, size, None, 0)
    exc = dump.exception()
    if exc:
        mod, off = dump.module_for(exc['address'])
        print('exception 0x%08X at %s+0x%x (thread %d) params=%s' % (exc['code'], mod, off, exc['tid'], [hex(p) for p in exc['params']]))
        print('faulting thread:')
        for pc in walk(dump, exc['ctx'][0], exc['ctx'][1], handle):
            print('    ' + symbol(handle, dump, pc))
    if '--all' in sys.argv:
        for t in dump.threads():
            print('--- thread %d' % t['tid'])
            for pc in walk(dump, t['ctx'][0], t['ctx'][1], handle, 30):
                print('    ' + symbol(handle, dump, pc))



def scan(path):
    """Heuristic stack scan of the faulting thread: every stack slot that points into a module."""
    dump = Dump(path)
    handle = wt.HANDLE(0x7A12)
    dbghelp.SymSetOptions(0x2 | 0x200 | 0x80000)
    dbghelp.SymInitializeW(handle, None, False)
    for base, size, name in dump.modules:
        p = locate(name)
        if p:
            dbghelp.SymLoadModuleExW(handle, None, p, None, base, size, None, 0)
    exc = dump.exception()
    ctx = dump.data[exc['ctx'][0]:exc['ctx'][0] + exc['ctx'][1]]
    rsp = struct.unpack_from('<Q', ctx, 0x98)[0]
    thread = next(t for t in dump.threads() if t['tid'] == exc['tid'])
    start, size, rva = thread['stack']
    print('stack %x..%x rsp=%x' % (start, start + size, rsp))
    off = max(0, rsp - start)
    seen = 0
    while off + 8 <= size and seen < 120:
        value = struct.unpack_from('<Q', dump.data, rva + off)[0]
        mod, moff = dump.module_for(value)
        if mod != '?' and not mod.lower().endswith(('.exe',)) or mod.lower() == 'soffice.bin':
            if mod != '?':
                print('  [rsp+%04x] %s' % (off - (rsp - start), symbol(handle, dump, value)))
                seen += 1
        off += 8



if __name__ == '__main__':
    if '--scan' in sys.argv:
        scan(sys.argv[1])
    else:
        main()
