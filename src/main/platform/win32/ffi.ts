/**
 * Lazily loaded Win32 bindings (koffi 3.3.2).
 *
 * koffi 3 semantics (verified on this machine with a Node experiment, see docs/dev/platform.md):
 * - pointer/handle return values are BigInt, NULL is `null`;
 * - pointer arguments accept BigInt, Number or null (never strings);
 * - `intptr_t`/`uintptr_t` results are Numbers (BigInt only beyond 2^53);
 * - Buffers/TypedArrays passed as `void *` are passed by reference, also for `.async` calls;
 * - `.async` runs the call on a koffi worker thread and calls back on the JS thread.
 * All types are anonymous: koffi's named-type registry is process-global and other modules
 * (e.g. src/main/files/win32Replace.ts) load koffi too.
 */
import { createRequire } from 'node:module';
import type { KoffiFunc, TypeObject } from 'koffi';

type KoffiModule = typeof import('koffi');
type Ptr = bigint | number | null;

export interface Rect32 {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Point32 {
  x: number;
  y: number;
}

export interface ProcessEntry32 {
  dwSize: number;
  th32ProcessID: number;
  th32ParentProcessID: number;
  szExeFile: string;
}

export interface KbdLlHookStruct {
  vkCode: number;
  scanCode: number;
  flags: number;
  time: number;
}

/** Typed koffi functions (sync call + `.async` variant). */
export interface Win32Api {
  koffi: KoffiModule;
  types: {
    RECT: TypeObject;
    POINT: TypeObject;
    KBDLLHOOKSTRUCT: TypeObject;
    LowLevelHookProc: TypeObject;
    WinEventProc: TypeObject;
  };
  user32: {
    IsWindow: KoffiFunc<(hwnd: Ptr) => boolean>;
    IsWindowVisible: KoffiFunc<(hwnd: Ptr) => boolean>;
    IsHungAppWindow: KoffiFunc<(hwnd: Ptr) => boolean>;
    IsIconic: KoffiFunc<(hwnd: Ptr) => boolean>;
    IsZoomed: KoffiFunc<(hwnd: Ptr) => boolean>;
    GetParent: KoffiFunc<(hwnd: Ptr) => bigint | null>;
    SetParent: KoffiFunc<(hwnd: Ptr, parent: Ptr) => bigint | null>;
    GetWindow: KoffiFunc<(hwnd: Ptr, cmd: number) => bigint | null>;
    GetAncestor: KoffiFunc<(hwnd: Ptr, flags: number) => bigint | null>;
    GetForegroundWindow: KoffiFunc<() => bigint | null>;
    SetForegroundWindow: KoffiFunc<(hwnd: Ptr) => boolean>;
    AllowSetForegroundWindow: KoffiFunc<(pid: number) => boolean>;
    GetFocus: KoffiFunc<() => bigint | null>;
    SetFocus: KoffiFunc<(hwnd: Ptr) => bigint | null>;
    IsChild: KoffiFunc<(parent: Ptr, hwnd: Ptr) => boolean>;
    GetWindowThreadProcessId: KoffiFunc<(hwnd: Ptr, pid: number[]) => number>;
    GetWindowLongPtrW: KoffiFunc<(hwnd: Ptr, index: number) => number | bigint>;
    SetWindowLongPtrW: KoffiFunc<(hwnd: Ptr, index: number, value: number | bigint) => number | bigint>;
    SetWindowPos: KoffiFunc<(hwnd: Ptr, after: Ptr, x: number, y: number, cx: number, cy: number, flags: number) => boolean>;
    ShowWindow: KoffiFunc<(hwnd: Ptr, cmd: number) => boolean>;
    ShowWindowAsync: KoffiFunc<(hwnd: Ptr, cmd: number) => boolean>;
    GetWindowRect: KoffiFunc<(hwnd: Ptr, rect: Partial<Rect32>) => boolean>;
    GetClientRect: KoffiFunc<(hwnd: Ptr, rect: Partial<Rect32>) => boolean>;
    ClientToScreen: KoffiFunc<(hwnd: Ptr, point: Point32) => boolean>;
    GetDpiForWindow: KoffiFunc<(hwnd: Ptr) => number>;
    MonitorFromWindow: KoffiFunc<(hwnd: Ptr, flags: number) => bigint | null>;
    CreateWindowExW: KoffiFunc<
      (exStyle: number, className: string, title: string, style: number, x: number, y: number, w: number, h: number, parent: Ptr, menu: Ptr, instance: Ptr, param: Ptr) => bigint | null
    >;
    DestroyWindow: KoffiFunc<(hwnd: Ptr) => boolean>;
    SetLayeredWindowAttributes: KoffiFunc<(hwnd: Ptr, colorKey: number, alpha: number, flags: number) => boolean>;
    SendMessageTimeoutW: KoffiFunc<(hwnd: Ptr, msg: number, wParam: number, lParam: number, flags: number, timeoutMs: number, result: number[]) => number | bigint>;
    PrintWindow: KoffiFunc<(hwnd: Ptr, hdc: Ptr, flags: number) => boolean>;
    GetDC: KoffiFunc<(hwnd: Ptr) => bigint | null>;
    ReleaseDC: KoffiFunc<(hwnd: Ptr, hdc: Ptr) => number>;
    SetWindowsHookExW: KoffiFunc<(idHook: number, proc: bigint, module: Ptr, threadId: number) => bigint | null>;
    UnhookWindowsHookEx: KoffiFunc<(hook: Ptr) => boolean>;
    CallNextHookEx: KoffiFunc<(hook: Ptr, code: number, wParam: number | bigint, lParam: Ptr) => number | bigint>;
    GetAsyncKeyState: KoffiFunc<(vk: number) => number>;
    SetWinEventHook: KoffiFunc<(eventMin: number, eventMax: number, module: Ptr, proc: bigint, pid: number, tid: number, flags: number) => bigint | null>;
    UnhookWinEvent: KoffiFunc<(hook: Ptr) => boolean>;
  };
  gdi32: {
    CreateCompatibleDC: KoffiFunc<(hdc: Ptr) => bigint | null>;
    CreateCompatibleBitmap: KoffiFunc<(hdc: Ptr, w: number, h: number) => bigint | null>;
    SelectObject: KoffiFunc<(hdc: Ptr, obj: Ptr) => bigint | null>;
    DeleteObject: KoffiFunc<(obj: Ptr) => boolean>;
    DeleteDC: KoffiFunc<(hdc: Ptr) => boolean>;
    GetDIBits: KoffiFunc<(hdc: Ptr, bitmap: Ptr, start: number, lines: number, bits: Uint8Array, info: Uint8Array, usage: number) => number>;
  };
  shcore: {
    GetDpiForMonitor: KoffiFunc<(monitor: Ptr, type: number, dpiX: number[], dpiY: number[]) => number>;
  } | null;
  /** File associations (read only). */
  shlwapi: {
    AssocQueryStringW: KoffiFunc<(flags: number, str: number, assoc: string, extra: string | null, out: Uint16Array, chars: number[]) => number>;
  };
  advapi32: {
    RegGetValueW: KoffiFunc<(hkey: Ptr, subKey: string, value: string, flags: number, type: Ptr, data: Ptr, bytes: number[]) => number>;
  };
  kernel32: {
    GetLastError: KoffiFunc<() => number>;
    GetModuleHandleW: KoffiFunc<(name: string | null) => bigint | null>;
    GetCurrentProcess: KoffiFunc<() => bigint | null>;
    OpenProcess: KoffiFunc<(access: number, inherit: boolean, pid: number) => bigint | null>;
    CloseHandle: KoffiFunc<(handle: Ptr) => boolean>;
    TerminateProcess: KoffiFunc<(process: Ptr, exitCode: number) => boolean>;
    WaitForSingleObject: KoffiFunc<(handle: Ptr, timeoutMs: number) => number>;
    WaitForMultipleObjects: KoffiFunc<(count: number, handles: BigUint64Array, waitAll: boolean, timeoutMs: number) => number>;
    GetProcessTimes: KoffiFunc<(process: Ptr, creation: bigint[], exit: bigint[], kernel: bigint[], user: bigint[]) => boolean>;
    QueryFullProcessImageNameW: KoffiFunc<(process: Ptr, flags: number, buffer: Uint16Array, size: number[]) => boolean>;
    CreateToolhelp32Snapshot: KoffiFunc<(flags: number, pid: number) => bigint | null>;
    Process32FirstW: KoffiFunc<(snapshot: Ptr, entry: ProcessEntry32) => boolean>;
    Process32NextW: KoffiFunc<(snapshot: Ptr, entry: ProcessEntry32) => boolean>;
    CreateJobObjectW: KoffiFunc<(attributes: Ptr, name: string | null) => bigint | null>;
    SetInformationJobObject: KoffiFunc<(job: Ptr, infoClass: number, info: unknown, length: number) => boolean>;
    AssignProcessToJobObject: KoffiFunc<(job: Ptr, process: Ptr) => boolean>;
    IsProcessInJob: KoffiFunc<(process: Ptr, job: Ptr, result: number[]) => boolean>;
  };
  sizes: {
    PROCESSENTRY32W: number;
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION: number;
  };
}

let cached: Win32Api | null | undefined;
let loadError: string | null = null;

/** Why `win32()` returned null (for logs). */
export function win32LoadError(): string | null {
  return loadError;
}

/** The bindings, or null when not on Windows or koffi cannot be loaded. */
export function win32(): Win32Api | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (process.platform !== 'win32') {
    loadError = `unsupported platform ${process.platform}`;
    return cached;
  }
  try {
    cached = bind(createRequire(import.meta.url)('koffi') as KoffiModule);
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
    cached = null;
  }
  return cached;
}

function bind(koffi: KoffiModule): Win32Api {
  const P = 'void *';
  const user32Lib = koffi.load('user32.dll');
  const gdi32Lib = koffi.load('gdi32.dll');
  const kernel32Lib = koffi.load('kernel32.dll');
  const shlwapiLib = koffi.load('shlwapi.dll');
  const advapi32Lib = koffi.load('advapi32.dll');
  const fn = <T extends (...args: never[]) => unknown>(lib: ReturnType<KoffiModule['load']>, name: string, ret: string | TypeObject, args: (string | TypeObject | ReturnType<KoffiModule['out']>)[]) =>
    lib.func('__stdcall', name, ret, args) as unknown as KoffiFunc<T>;

  const RECT = koffi.struct({ left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
  const POINT = koffi.struct({ x: 'int32', y: 'int32' });
  const KBDLLHOOKSTRUCT = koffi.struct({ vkCode: 'uint32', scanCode: 'uint32', flags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr_t' });
  const PROCESSENTRY32W = koffi.struct({
    dwSize: 'uint32',
    cntUsage: 'uint32',
    th32ProcessID: 'uint32',
    th32DefaultHeapID: 'uintptr_t',
    th32ModuleID: 'uint32',
    cntThreads: 'uint32',
    th32ParentProcessID: 'uint32',
    pcPriClassBase: 'int32',
    dwFlags: 'uint32',
    szExeFile: koffi.array('char16_t', 260, 'String'),
  });
  const BASIC_LIMIT = koffi.struct({
    PerProcessUserTimeLimit: 'int64',
    PerJobUserTimeLimit: 'int64',
    LimitFlags: 'uint32',
    MinimumWorkingSetSize: 'size_t',
    MaximumWorkingSetSize: 'size_t',
    ActiveProcessLimit: 'uint32',
    Affinity: 'uintptr_t',
    PriorityClass: 'uint32',
    SchedulingClass: 'uint32',
  });
  const IO_COUNTERS = koffi.struct({
    ReadOperationCount: 'uint64',
    WriteOperationCount: 'uint64',
    OtherOperationCount: 'uint64',
    ReadTransferCount: 'uint64',
    WriteTransferCount: 'uint64',
    OtherTransferCount: 'uint64',
  });
  const EXTENDED_LIMIT = koffi.struct({
    BasicLimitInformation: BASIC_LIMIT,
    IoInfo: IO_COUNTERS,
    ProcessMemoryLimit: 'size_t',
    JobMemoryLimit: 'size_t',
    PeakProcessMemoryUsed: 'size_t',
    PeakJobMemoryUsed: 'size_t',
  });
  const LowLevelHookProc = koffi.proto('__stdcall', null, 'intptr_t', ['int', 'uintptr_t', P]);
  const WinEventProc = koffi.proto('__stdcall', null, 'void', [P, 'uint32', P, 'int32', 'int32', 'uint32', 'uint32']);

  let shcore: Win32Api['shcore'];
  try {
    const shcoreLib = koffi.load('shcore.dll');
    shcore = { GetDpiForMonitor: fn(shcoreLib, 'GetDpiForMonitor', 'int32', [P, 'int', koffi.out(koffi.pointer('uint32')), koffi.out(koffi.pointer('uint32'))]) };
  } catch {
    shcore = null; // Windows < 8.1: callers fall back to the window DPI
  }

  return {
    koffi,
    types: { RECT, POINT, KBDLLHOOKSTRUCT, LowLevelHookProc, WinEventProc },
    user32: {
      IsWindow: fn(user32Lib, 'IsWindow', 'bool', [P]),
      IsWindowVisible: fn(user32Lib, 'IsWindowVisible', 'bool', [P]),
      IsHungAppWindow: fn(user32Lib, 'IsHungAppWindow', 'bool', [P]),
      IsIconic: fn(user32Lib, 'IsIconic', 'bool', [P]),
      IsZoomed: fn(user32Lib, 'IsZoomed', 'bool', [P]),
      GetParent: fn(user32Lib, 'GetParent', P, [P]),
      SetParent: fn(user32Lib, 'SetParent', P, [P, P]),
      GetWindow: fn(user32Lib, 'GetWindow', P, [P, 'uint32']),
      GetAncestor: fn(user32Lib, 'GetAncestor', P, [P, 'uint32']),
      GetForegroundWindow: fn(user32Lib, 'GetForegroundWindow', P, []),
      SetForegroundWindow: fn(user32Lib, 'SetForegroundWindow', 'bool', [P]),
      AllowSetForegroundWindow: fn(user32Lib, 'AllowSetForegroundWindow', 'bool', ['uint32']),
      GetFocus: fn(user32Lib, 'GetFocus', P, []),
      SetFocus: fn(user32Lib, 'SetFocus', P, [P]),
      IsChild: fn(user32Lib, 'IsChild', 'bool', [P, P]),
      GetWindowThreadProcessId: fn(user32Lib, 'GetWindowThreadProcessId', 'uint32', [P, koffi.out(koffi.pointer('uint32'))]),
      GetWindowLongPtrW: fn(user32Lib, 'GetWindowLongPtrW', 'intptr_t', [P, 'int']),
      SetWindowLongPtrW: fn(user32Lib, 'SetWindowLongPtrW', 'intptr_t', [P, 'int', 'intptr_t']),
      SetWindowPos: fn(user32Lib, 'SetWindowPos', 'bool', [P, P, 'int', 'int', 'int', 'int', 'uint32']),
      ShowWindow: fn(user32Lib, 'ShowWindow', 'bool', [P, 'int']),
      ShowWindowAsync: fn(user32Lib, 'ShowWindowAsync', 'bool', [P, 'int']),
      GetWindowRect: fn(user32Lib, 'GetWindowRect', 'bool', [P, koffi.out(koffi.pointer(RECT))]),
      GetClientRect: fn(user32Lib, 'GetClientRect', 'bool', [P, koffi.out(koffi.pointer(RECT))]),
      ClientToScreen: fn(user32Lib, 'ClientToScreen', 'bool', [P, koffi.inout(koffi.pointer(POINT))]),
      GetDpiForWindow: fn(user32Lib, 'GetDpiForWindow', 'uint32', [P]),
      MonitorFromWindow: fn(user32Lib, 'MonitorFromWindow', P, [P, 'uint32']),
      CreateWindowExW: fn(user32Lib, 'CreateWindowExW', P, ['uint32', 'str16', 'str16', 'uint32', 'int', 'int', 'int', 'int', P, P, P, P]),
      DestroyWindow: fn(user32Lib, 'DestroyWindow', 'bool', [P]),
      SetLayeredWindowAttributes: fn(user32Lib, 'SetLayeredWindowAttributes', 'bool', [P, 'uint32', 'uint8', 'uint32']),
      SendMessageTimeoutW: fn(user32Lib, 'SendMessageTimeoutW', 'intptr_t', [P, 'uint32', 'uintptr_t', 'intptr_t', 'uint32', 'uint32', koffi.out(koffi.pointer('uintptr_t'))]),
      PrintWindow: fn(user32Lib, 'PrintWindow', 'bool', [P, P, 'uint32']),
      GetDC: fn(user32Lib, 'GetDC', P, [P]),
      ReleaseDC: fn(user32Lib, 'ReleaseDC', 'int', [P, P]),
      SetWindowsHookExW: fn(user32Lib, 'SetWindowsHookExW', P, ['int', koffi.pointer(LowLevelHookProc), P, 'uint32']),
      UnhookWindowsHookEx: fn(user32Lib, 'UnhookWindowsHookEx', 'bool', [P]),
      CallNextHookEx: fn(user32Lib, 'CallNextHookEx', 'intptr_t', [P, 'int', 'uintptr_t', P]),
      GetAsyncKeyState: fn(user32Lib, 'GetAsyncKeyState', 'int16', ['int']),
      SetWinEventHook: fn(user32Lib, 'SetWinEventHook', P, ['uint32', 'uint32', P, koffi.pointer(WinEventProc), 'uint32', 'uint32', 'uint32']),
      UnhookWinEvent: fn(user32Lib, 'UnhookWinEvent', 'bool', [P]),
    },
    gdi32: {
      CreateCompatibleDC: fn(gdi32Lib, 'CreateCompatibleDC', P, [P]),
      CreateCompatibleBitmap: fn(gdi32Lib, 'CreateCompatibleBitmap', P, [P, 'int', 'int']),
      SelectObject: fn(gdi32Lib, 'SelectObject', P, [P, P]),
      DeleteObject: fn(gdi32Lib, 'DeleteObject', 'bool', [P]),
      DeleteDC: fn(gdi32Lib, 'DeleteDC', 'bool', [P]),
      GetDIBits: fn(gdi32Lib, 'GetDIBits', 'int', [P, P, 'uint32', 'uint32', P, P, 'uint32']),
    },
    shcore,
    shlwapi: {
      AssocQueryStringW: fn(shlwapiLib, 'AssocQueryStringW', 'int32', ['uint32', 'int', 'str16', 'str16', P, koffi.inout(koffi.pointer('uint32'))]),
    },
    advapi32: {
      RegGetValueW: fn(advapi32Lib, 'RegGetValueW', 'int32', [P, 'str16', 'str16', 'uint32', P, P, koffi.inout(koffi.pointer('uint32'))]),
    },
    kernel32: {
      GetLastError: fn(kernel32Lib, 'GetLastError', 'uint32', []),
      GetModuleHandleW: fn(kernel32Lib, 'GetModuleHandleW', P, ['str16']),
      GetCurrentProcess: fn(kernel32Lib, 'GetCurrentProcess', P, []),
      OpenProcess: fn(kernel32Lib, 'OpenProcess', P, ['uint32', 'bool', 'uint32']),
      CloseHandle: fn(kernel32Lib, 'CloseHandle', 'bool', [P]),
      TerminateProcess: fn(kernel32Lib, 'TerminateProcess', 'bool', [P, 'uint32']),
      WaitForSingleObject: fn(kernel32Lib, 'WaitForSingleObject', 'uint32', [P, 'uint32']),
      WaitForMultipleObjects: fn(kernel32Lib, 'WaitForMultipleObjects', 'uint32', ['uint32', P, 'bool', 'uint32']),
      GetProcessTimes: fn(kernel32Lib, 'GetProcessTimes', 'bool', [
        P,
        koffi.out(koffi.pointer('uint64')),
        koffi.out(koffi.pointer('uint64')),
        koffi.out(koffi.pointer('uint64')),
        koffi.out(koffi.pointer('uint64')),
      ]),
      QueryFullProcessImageNameW: fn(kernel32Lib, 'QueryFullProcessImageNameW', 'bool', [P, 'uint32', P, koffi.inout(koffi.pointer('uint32'))]),
      CreateToolhelp32Snapshot: fn(kernel32Lib, 'CreateToolhelp32Snapshot', P, ['uint32', 'uint32']),
      Process32FirstW: fn(kernel32Lib, 'Process32FirstW', 'bool', [P, koffi.inout(koffi.pointer(PROCESSENTRY32W))]),
      Process32NextW: fn(kernel32Lib, 'Process32NextW', 'bool', [P, koffi.inout(koffi.pointer(PROCESSENTRY32W))]),
      CreateJobObjectW: fn(kernel32Lib, 'CreateJobObjectW', P, [P, 'str16']),
      SetInformationJobObject: fn(kernel32Lib, 'SetInformationJobObject', 'bool', [P, 'int', koffi.pointer(EXTENDED_LIMIT), 'uint32']),
      AssignProcessToJobObject: fn(kernel32Lib, 'AssignProcessToJobObject', 'bool', [P, P]),
      IsProcessInJob: fn(kernel32Lib, 'IsProcessInJob', 'bool', [P, P, koffi.out(koffi.pointer('int'))]),
    },
    sizes: {
      PROCESSENTRY32W: koffi.sizeof(PROCESSENTRY32W),
      JOBOBJECT_EXTENDED_LIMIT_INFORMATION: koffi.sizeof(EXTENDED_LIMIT),
    },
  };
}

/** Runs a koffi function on a worker thread and resolves with its result. */
export function callAsync<A extends unknown[], R>(f: KoffiFunc<(...args: A) => R>, ...args: A): Promise<R> {
  return new Promise<R>((resolve, reject) => {
    const done = (err: unknown, result: R): void => {
      if (err) reject(err instanceof Error ? err : new Error(String(err)));
      else resolve(result);
    };
    (f.async as (...a: unknown[]) => void)(...args, done);
  });
}
