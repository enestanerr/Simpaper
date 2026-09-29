/** Win32 constants used by the platform layer (values from the Windows SDK headers). */

// Window styles (GWL_STYLE)
export const WS_POPUP = 0x8000_0000;
export const WS_CHILD = 0x4000_0000;
export const WS_MINIMIZE = 0x2000_0000;
export const WS_VISIBLE = 0x1000_0000;
export const WS_DISABLED = 0x0800_0000;
export const WS_CLIPSIBLINGS = 0x0400_0000;
export const WS_CLIPCHILDREN = 0x0200_0000;
export const WS_MAXIMIZE = 0x0100_0000;
export const WS_BORDER = 0x0080_0000;
export const WS_DLGFRAME = 0x0040_0000;
export const WS_CAPTION = WS_BORDER | WS_DLGFRAME;
export const WS_SYSMENU = 0x0008_0000;
export const WS_THICKFRAME = 0x0004_0000;
export const WS_MINIMIZEBOX = 0x0002_0000;
export const WS_MAXIMIZEBOX = 0x0001_0000;
export const WS_OVERLAPPEDWINDOW = WS_CAPTION | WS_SYSMENU | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;

// Extended window styles (GWL_EXSTYLE)
export const WS_EX_DLGMODALFRAME = 0x0000_0001;
export const WS_EX_NOPARENTNOTIFY = 0x0000_0004;
export const WS_EX_TOPMOST = 0x0000_0008;
export const WS_EX_TRANSPARENT = 0x0000_0020;
export const WS_EX_TOOLWINDOW = 0x0000_0080;
export const WS_EX_WINDOWEDGE = 0x0000_0100;
export const WS_EX_CLIENTEDGE = 0x0000_0200;
export const WS_EX_CONTROLPARENT = 0x0001_0000;
export const WS_EX_STATICEDGE = 0x0002_0000;
export const WS_EX_APPWINDOW = 0x0004_0000;
export const WS_EX_LAYERED = 0x0008_0000;
export const WS_EX_NOREDIRECTIONBITMAP = 0x0020_0000;
export const WS_EX_NOACTIVATE = 0x0800_0000;

// GetWindowLongPtr / SetWindowLongPtr
export const GWL_STYLE = -16;
export const GWL_EXSTYLE = -20;
export const GWLP_HWNDPARENT = -8;

// SetWindowPos
export const SWP_NOSIZE = 0x0001;
export const SWP_NOMOVE = 0x0002;
export const SWP_NOZORDER = 0x0004;
export const SWP_NOACTIVATE = 0x0010;
export const SWP_FRAMECHANGED = 0x0020;
export const SWP_SHOWWINDOW = 0x0040;
export const SWP_HIDEWINDOW = 0x0080;
export const SWP_NOOWNERZORDER = 0x0200;
export const SWP_ASYNCWINDOWPOS = 0x4000;
export const HWND_TOP = 0n;

// ShowWindow
export const SW_HIDE = 0;
export const SW_SHOWNOACTIVATE = 4;
export const SW_SHOWNA = 8;

// Messages
export const WM_NULL = 0x0000;
export const WM_WINDOWPOSCHANGED = 0x0047;
export const WM_KEYDOWN = 0x0100;
export const WM_KEYUP = 0x0101;
export const WM_SYSKEYDOWN = 0x0104;
export const WM_SYSKEYUP = 0x0105;
export const WM_DPICHANGED = 0x02e0;

// SendMessageTimeout
export const SMTO_BLOCK = 0x0001;
export const SMTO_ABORTIFHUNG = 0x0002;

// GetAncestor / GetWindow
export const GA_PARENT = 1;
export const GA_ROOTOWNER = 3;
export const GW_HWNDPREV = 3;
export const GW_OWNER = 4;
export const GW_CHILD = 5;

// PrintWindow / layered windows / GDI
export const PW_RENDERFULLCONTENT = 0x0000_0002;
export const LWA_ALPHA = 0x0000_0002;
export const BI_RGB = 0;
export const DIB_RGB_COLORS = 0;

// Monitors / DPI
export const MONITOR_DEFAULTTONEAREST = 2;
export const MDT_EFFECTIVE_DPI = 0;

// Low-level keyboard hook and WinEvents
export const WH_KEYBOARD_LL = 13;
export const HC_ACTION = 0;
export const LLKHF_EXTENDED = 0x01;
export const LLKHF_INJECTED = 0x10;
export const LLKHF_ALTDOWN = 0x20;
export const LLKHF_UP = 0x80;
export const EVENT_SYSTEM_FOREGROUND = 0x0003;
export const WINEVENT_OUTOFCONTEXT = 0x0000;

// Virtual keys
export const VK_LBUTTON = 0x01;
export const VK_RBUTTON = 0x02;
export const VK_MBUTTON = 0x04;
export const VK_XBUTTON1 = 0x05;
export const VK_XBUTTON2 = 0x06;

// Processes, jobs, waits
export const PROCESS_TERMINATE = 0x0001;
export const PROCESS_SET_QUOTA = 0x0100;
export const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
export const SYNCHRONIZE = 0x0010_0000;
export const TH32CS_SNAPPROCESS = 0x0000_0002;
export const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x0000_2000;
export const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS = 9;
export const WAIT_OBJECT_0 = 0x0000_0000;
export const WAIT_TIMEOUT = 0x0000_0102;
export const WAIT_FAILED = 0xffff_ffff;
export const INVALID_HANDLE_VALUE = 0xffff_ffff_ffff_ffffn;

// Errors (GetLastError)
export const ERROR_ACCESS_DENIED = 5;
export const ERROR_INVALID_PARAMETER = 87;
