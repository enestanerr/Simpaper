# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Native call stacks of every thread of a running Windows x64 process (DbgHelp StackWalk64).

Diagnostics for a hung soffice.bin (docs/dev/engine.md, "Diagnosing a hung or crashed engine"). No PDBs
are available for the TDF build, so names are the nearest *exported* symbol of each module: good enough to
see ucrtbase!setlocale, python313!PyEval_*, sal3!osl_*, ntdll!NtWait*, user32!GetMessage and friends.
Threads are suspended for a moment while their stack is read; nothing else is changed.

usage: vendor/libreoffice/program/python.exe tests/engine/diagnostics/stackdump.py <pid> [out-file]
"""
import ctypes
import ctypes.wintypes as wt
import sys

k32 = ctypes.WinDLL('kernel32', use_last_error=True)
dbghelp = ctypes.WinDLL('dbghelp', use_last_error=True)

TH32CS_SNAPTHREAD = 0x4
TH32CS_SNAPMODULE = 0x8
TH32CS_SNAPMODULE32 = 0x10
PROCESS_QUERY_INFORMATION = 0x400
PROCESS_VM_READ = 0x10
THREAD_GET_CONTEXT = 0x8
THREAD_SUSPEND_RESUME = 0x2
THREAD_QUERY_INFORMATION = 0x40
THREAD_QUERY_LIMITED_INFORMATION = 0x800
CONTEXT_FULL_AMD64 = 0x10000B
IMAGE_FILE_MACHINE_AMD64 = 0x8664
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value


class THREADENTRY32(ctypes.Structure):
    _fields_ = [('dwSize', wt.DWORD), ('cntUsage', wt.DWORD), ('th32ThreadID', wt.DWORD),
                ('th32OwnerProcessID', wt.DWORD), ('tpBasePri', wt.LONG), ('tpDeltaPri', wt.LONG),
                ('dwFlags', wt.DWORD)]


class MODULEENTRY32W(ctypes.Structure):
    _fields_ = [('dwSize', wt.DWORD), ('th32ModuleID', wt.DWORD), ('th32ProcessID', wt.DWORD),
                ('GlblcntUsage', wt.DWORD), ('ProccntUsage', wt.DWORD), ('modBaseAddr', ctypes.c_void_p),
                ('modBaseSize', wt.DWORD), ('hModule', wt.HMODULE), ('szModule', ctypes.c_wchar * 256),
                ('szExePath', ctypes.c_wchar * 260)]


class ADDRESS64(ctypes.Structure):
    _fields_ = [('Offset', ctypes.c_uint64), ('Segment', ctypes.c_uint16), ('Mode', ctypes.c_uint32)]


class KDHELP64(ctypes.Structure):
    _fields_ = [('Thread', ctypes.c_uint64), ('ThCallbackStack', wt.DWORD), ('ThCallbackBStore', wt.DWORD),
                ('NextCallback', wt.DWORD), ('FramePointer', wt.DWORD), ('KiCallUserMode', ctypes.c_uint64),
                ('KeUserCallbackDispatcher', ctypes.c_uint64), ('SystemRangeStart', ctypes.c_uint64),
                ('KiUserExceptionDispatcher', ctypes.c_uint64), ('StackBase', ctypes.c_uint64),
                ('StackLimit', ctypes.c_uint64), ('BuildVersion', wt.DWORD),
                ('RetpolineStubFunctionTableSize', wt.DWORD), ('RetpolineStubFunctionTable', ctypes.c_uint64),
                ('RetpolineStubOffset', wt.DWORD), ('RetpolineStubSize', wt.DWORD),
                ('Reserved0', ctypes.c_uint64 * 2)]


class STACKFRAME64(ctypes.Structure):
    _fields_ = [('AddrPC', ADDRESS64), ('AddrReturn', ADDRESS64), ('AddrFrame', ADDRESS64),
                ('AddrStack', ADDRESS64), ('AddrBStore', ADDRESS64), ('FuncTableEntry', ctypes.c_void_p),
                ('Params', ctypes.c_uint64 * 4), ('Far', wt.BOOL), ('Virtual', wt.BOOL),
                ('Reserved', ctypes.c_uint64 * 3), ('KdHelp', KDHELP64)]


assert ctypes.sizeof(STACKFRAME64) == 264, ctypes.sizeof(STACKFRAME64)

k32.CreateToolhelp32Snapshot.restype = wt.HANDLE
k32.CreateToolhelp32Snapshot.argtypes = [wt.DWORD, wt.DWORD]
k32.Thread32First.argtypes = [wt.HANDLE, ctypes.POINTER(THREADENTRY32)]
k32.Thread32Next.argtypes = [wt.HANDLE, ctypes.POINTER(THREADENTRY32)]
k32.Module32FirstW.argtypes = [wt.HANDLE, ctypes.POINTER(MODULEENTRY32W)]
k32.Module32NextW.argtypes = [wt.HANDLE, ctypes.POINTER(MODULEENTRY32W)]
k32.OpenProcess.restype = wt.HANDLE
k32.OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
k32.OpenThread.restype = wt.HANDLE
k32.OpenThread.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
k32.SuspendThread.argtypes = [wt.HANDLE]
k32.ResumeThread.argtypes = [wt.HANDLE]
k32.GetThreadContext.argtypes = [wt.HANDLE, ctypes.c_void_p]
k32.CloseHandle.argtypes = [wt.HANDLE]
try:
    k32.GetThreadDescription.argtypes = [wt.HANDLE, ctypes.POINTER(ctypes.c_wchar_p)]
    k32.GetThreadDescription.restype = ctypes.c_long
    HAVE_DESC = True
except AttributeError:
    HAVE_DESC = False
k32.LocalFree.argtypes = [ctypes.c_void_p]

dbghelp.SymSetOptions.argtypes = [wt.DWORD]
dbghelp.SymInitializeW.argtypes = [wt.HANDLE, wt.LPCWSTR, wt.BOOL]
dbghelp.SymCleanup.argtypes = [wt.HANDLE]
dbghelp.SymFromAddr.argtypes = [wt.HANDLE, ctypes.c_uint64, ctypes.POINTER(ctypes.c_uint64), ctypes.c_void_p]
dbghelp.StackWalk64.argtypes = [wt.DWORD, wt.HANDLE, wt.HANDLE, ctypes.POINTER(STACKFRAME64), ctypes.c_void_p,
                                ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
FN_TABLE_ACCESS = ctypes.cast(dbghelp.SymFunctionTableAccess64, ctypes.c_void_p)
FN_MODULE_BASE = ctypes.cast(dbghelp.SymGetModuleBase64, ctypes.c_void_p)

SYMOPT_UNDNAME = 0x2
SYMOPT_DEFERRED_LOADS = 0x4
SYMOPT_FAIL_CRITICAL_ERRORS = 0x200
SYMOPT_NO_PROMPTS = 0x80000


def threads_of(pid):
    snap = k32.CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0)
    out = []
    entry = THREADENTRY32()
    entry.dwSize = ctypes.sizeof(entry)
    ok = k32.Thread32First(snap, ctypes.byref(entry))
    while ok:
        if entry.th32OwnerProcessID == pid:
            out.append(entry.th32ThreadID)
        ok = k32.Thread32Next(snap, ctypes.byref(entry))
    k32.CloseHandle(snap)
    return out


def modules_of(pid):
    snap = k32.CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid)
    if snap in (None, INVALID_HANDLE_VALUE):
        return []
    out = []
    entry = MODULEENTRY32W()
    entry.dwSize = ctypes.sizeof(entry)
    ok = k32.Module32FirstW(snap, ctypes.byref(entry))
    while ok:
        out.append((entry.modBaseAddr or 0, entry.modBaseSize, entry.szModule))
        ok = k32.Module32NextW(snap, ctypes.byref(entry))
    k32.CloseHandle(snap)
    return sorted(out)


def module_for(modules, addr):
    for base, size, name in modules:
        if base <= addr < base + size:
            return name, addr - base
    return None, addr


def symbol(hproc, addr):
    buf = ctypes.create_string_buffer(88 + 1024)
    ctypes.c_uint32.from_buffer(buf, 0).value = 88     # SizeOfStruct
    ctypes.c_uint32.from_buffer(buf, 80).value = 1000  # MaxNameLen
    disp = ctypes.c_uint64()
    if dbghelp.SymFromAddr(hproc, addr, ctypes.byref(disp), buf):
        name_len = ctypes.c_uint32.from_buffer(buf, 76).value
        name = buf.raw[84:84 + name_len].decode('latin-1', 'replace')
        return name, disp.value
    return None, 0


def thread_name(tid):
    if not HAVE_DESC:
        return ''
    h = k32.OpenThread(THREAD_QUERY_LIMITED_INFORMATION, False, tid)
    if not h:
        return ''
    try:
        p = ctypes.c_wchar_p()
        if k32.GetThreadDescription(h, ctypes.byref(p)) >= 0 and p.value:
            name = p.value
            k32.LocalFree(ctypes.cast(p, ctypes.c_void_p))
            return name
        return ''
    finally:
        k32.CloseHandle(h)


def dump(pid, max_frames=48):
    lines = []
    hproc = k32.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, pid)
    if not hproc:
        return 'cannot open process %d (error %d)' % (pid, ctypes.get_last_error())
    dbghelp.SymSetOptions(SYMOPT_UNDNAME | SYMOPT_DEFERRED_LOADS | SYMOPT_FAIL_CRITICAL_ERRORS | SYMOPT_NO_PROMPTS)
    if not dbghelp.SymInitializeW(hproc, None, True):
        lines.append('SymInitialize failed (%d)' % ctypes.get_last_error())
    modules = modules_of(pid)
    names = [m[2].lower() for m in modules]
    lines.append('modules loaded: %d; python313.dll=%s pyuno.pyd=%s pythonloaderlo.dll=%s OpenCL.dll=%s' % (
        len(modules), 'python313.dll' in names, 'pyuno.pyd' in names, 'pythonloaderlo.dll' in names,
        'opencl.dll' in names))
    raw = ctypes.create_string_buffer(1232 + 16)
    base = (ctypes.addressof(raw) + 15) & ~15
    for tid in threads_of(pid):
        hthread = k32.OpenThread(THREAD_GET_CONTEXT | THREAD_SUSPEND_RESUME | THREAD_QUERY_INFORMATION, False, tid)
        if not hthread:
            lines.append('--- thread %d: cannot open' % tid)
            continue
        frames = []
        try:
            if k32.SuspendThread(hthread) == 0xFFFFFFFF:
                lines.append('--- thread %d: cannot suspend' % tid)
                continue
            try:
                ctypes.memset(base, 0, 1232)
                ctypes.c_uint32.from_address(base + 0x30).value = CONTEXT_FULL_AMD64
                if not k32.GetThreadContext(hthread, base):
                    lines.append('--- thread %d: no context (%d)' % (tid, ctypes.get_last_error()))
                    continue
                frame = STACKFRAME64()
                frame.AddrPC.Offset = ctypes.c_uint64.from_address(base + 0xF8).value
                frame.AddrPC.Mode = 3  # AddrModeFlat
                frame.AddrStack.Offset = ctypes.c_uint64.from_address(base + 0x98).value
                frame.AddrStack.Mode = 3
                frame.AddrFrame.Offset = ctypes.c_uint64.from_address(base + 0xA0).value
                frame.AddrFrame.Mode = 3
                for _ in range(max_frames):
                    if not dbghelp.StackWalk64(IMAGE_FILE_MACHINE_AMD64, hproc, hthread, ctypes.byref(frame), base,
                                               None, FN_TABLE_ACCESS, FN_MODULE_BASE, None):
                        break
                    pc = frame.AddrPC.Offset
                    if not pc:
                        break
                    frames.append(pc)
            finally:
                k32.ResumeThread(hthread)
        finally:
            k32.CloseHandle(hthread)
        lines.append('--- thread %d %s' % (tid, thread_name(tid)))
        for pc in frames:
            mod, off = module_for(modules, pc)
            name, disp = symbol(hproc, pc)
            if name:
                lines.append('    %s!%s+0x%x' % (mod or '?', name, disp))
            else:
                lines.append('    %s+0x%x' % (mod or '?', off))
    dbghelp.SymCleanup(hproc)
    k32.CloseHandle(hproc)
    return '\n'.join(lines)


if __name__ == '__main__':
    text = dump(int(sys.argv[1]))
    if len(sys.argv) > 2:
        with open(sys.argv[2], 'w', encoding='utf-8') as fh:
            fh.write(text + '\n')
    else:
        print(text)
