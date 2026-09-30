# Desktop shell technology and hosting soffice.bin's native window from another process inside the app window on Windows (Electron 44, koffi, packaging, alternatives, a11y/i18n)

> Research notes of 2026-09-28 on the desktop shell and native window hosting, prepared before the architecture decision and published
> with details about the research machine removed. Findings age quickly: check the linked sources before relying
> on a version number, a price, a bug status or a release date. Decisions are recorded in [docs/adr](../adr/README.md).

## Summary
**Bottom line.** Electron 44 works as a UI shell. The risky part is hosting soffice.bin's editing window as a cross-process `WS_CHILD` of an Electron window. That runs into five Windows-level hazards, each confirmed in primary sources or measured on a Windows 11 test machine. Do not commit to this architecture until a one-week spike passes explicit tests (Table A). Keep LibreOfficeKit (LOK) tile rendering as the strategic plan B. Collabora already ships that design.

**Electron today**
- Latest stable is 44.4.5 (23 Sep 2026; Chromium 152, Node 24.21). 45 is due 20 Oct 2026.
- The latest 3 majors are supported; 42 reaches end of life on 20 Oct.
- Secure defaults: contextIsolation (≥12), sandbox (≥20), nodeIntegration off (≥5). Add CSP, a custom protocol instead of `file://`, IPC-sender validation, and fuses.
- `getNativeWindowHandle()` returns a Buffer containing the HWND. There is no API for hosting a foreign window (issue #10547, open since 2017).

**Hazards**
1. **No redirection surface.** From Chrome 139, top-level windows get `WS_EX_NOREDIRECTIONBITMAP` (measured on Electron 43.6). A child window that paints with GDI or raster becomes invisible. Fixes suggested on chromium-dev: set `WS_EX_LAYERED` + `SetLayeredWindowAttributes(255)` on the child, or put the content inside your own intermediate child window. A temporary switch also works: `--disable-features=RemoveRedirectionBitmap`.
2. **Legacy window z-order.** The "Chrome Legacy Window" (`Chrome_RenderWidgetHostHWND`) covers the WebContents and handles hit-tests. Its `SetBounds` calls `SetWindowPos(hwnd, nullptr, …)` without `SWP_NOZORDER`, so every bounds change moves it back to the top. It can then sit above LO and take its clicks. The GPU process's "Intermediate D3D Window" is a cross-process child placed at the bottom, disabled, and harmless.
3. **DPI mismatch.**
   - Electron is **Per-Monitor v1**, not v2: its manifest says `true/pm`, and the measured windows are PMv1.
   - LibreOffice is **System-aware**: the 25.8.7.3 binary and the 26-8 and master manifests all declare it. Bug tdf#145710 is still NEW.
   - Microsoft's rule: every window in one parent/child tree must share the same DPI mode. A cross-process `CreateWindow` under a parent with a different mode causes a "Forced reset (of caller's process)" (Windows 10 1703+). `SetThreadDpiHostingBehavior` only covers windows created by the calling thread.
   - Other Microsoft products follow the same rule: Office refuses cross-process OLE in-place activation on a mismatch, and WebView2 fails with 0x8007139F.
   - The real effect must be measured at 125/150% scaling; this was not possible during the research.
4. **Input-queue coupling.** A cross-thread parent/child or owner/owned link attaches the two threads' input queues automatically, and the link is transitive. Focus changes become synchronous, and `SWP_ASYNCWINDOWPOS` does not help. Microsoft cites these hangs as one reason for WebView2 "visual hosting". A hung soffice.bin can freeze the whole window. An old OpenOffice forum post reports `createSystemChild` deadlocking its host.
5. **Airspace.** HTML can never paint over the LO child. Galleries, split menus, ScreenTips, dialogs and Backstage must each be a separate top-level window (child BrowserWindow, `Menu.popup`), or LO must be hidden while they show. Fluent.Ribbon's Backstage hides hosted native windows for exactly this reason. PrintWindow snapshots are synchronous and depend on LO's UI thread.

**Keys and focus.** When LO has focus, keys go to LO. `SfxBaseController` supports `XUserInputInterception.addKeyHandler`, so Alt (KeyTips) and F6 can be intercepted. Each key is a synchronous cross-process call, so the handler must stay trivial.

**Portability.** `createSystemChild` ignores ProcessId. It takes an HWND on Windows, supports XEmbed on X11, and casts the handle to `NSView*` on macOS. Cross-process embedding is therefore impossible on macOS and on Wayland.

**Precedent.** Collabora Office Desktop (MPL-2.0; 26.04, Jul 2026) runs a web UI with LOK in-process: WebView2 on Windows, WKWebView on macOS, Qt6 WebEngine on Linux. Stock `mergedlo.dll` (25.8.7.3) contains `libreofficekit_hook_2`, but TDF's README still calls tiled rendering "experimental".

**koffi 3.3.2 (MIT)**
- Ships prebuilt Node-API binaries for win32 x64, ia32 and arm64, so no compiler is needed.
- Supports `__stdcall` prototypes and BigInt pointers. `.async()` runs calls on worker threads, and callbacks from other threads are queued to the JS main thread.
- v3 is a May-2026 rewrite, so pin the exact version.
- Pass the HWND value (`buf.readBigUInt64LE(0)`), not the Buffer itself.

**Packaging.** electron-builder 26.x builds a one-click NSIS installer that installs per-user to `%LOCALAPPDATA%\Programs` without admin rights. Gotchas:
- Built-in `fileAssociations` on NSIS "works only if nsis.perMachine is true". A per-user install needs a custom NSIS include that writes the associations under HKCU and calls SHChangeNotify. _Correction 2026-09-30:_ that sentence of the documentation is outdated: the NSIS templates write the associations below `SHELL_CONTEXT`, i.e. under HKCU for a per-user install. The project uses its own include anyway ([ADR 0010](../adr/0010-file-associations.md)).
- NSIS silently produces a broken installer above 2 GB uncompressed. The payload is about 1.05–1.1 GB (LO 696 MB + Electron about 360 MB, both measured on existing installations).
- The `portable` target re-extracts to %TEMP% on every launch, so ship a ZIP instead.
- electron-updater supports NSIS only. Forge has no NSIS maker.
- Signing is optional; without it users see SmartScreen warnings. Azure Artifact Signing is open to individuals only in the US or Canada. SignPath Foundation is free for OSI-licensed open-source projects.

**Accessibility and i18n**
- Chromium uses native UIA by default since Chrome 138.
- Use the APG tabs and toolbar patterns plus custom KeyTips.
- i18next 26.4.2 is MIT-licensed.
- Turkish, verified with Node 22.20: use `toLocale*Case('tr-TR')` and `Intl.Collator('tr')`, set `lang="tr"`, and never rely on the regex `/i` flag.

## Tables
### A. Electron + LO child HWND: hazard, mitigation and spike pass criterion
| # | Hazard | Evidence | Mitigation | Spike pass criterion |
|---|---|---|---|---|
| 1 | GDI/raster LO child invisible (top-level has `WS_EX_NOREDIRECTIONBITMAP`, Chrome ≥139) | chromium-dev Aug 2025; measured on Electron 43.6 | Option 1: parent LO to an own layered intermediate child (e.g. a `STATIC` window created via koffi, `WS_EX_LAYERED` + `SetLayeredWindowAttributes(255)`, no JS WndProc). Option 2: make the LO child layered (cross-process style change, untested). Option 3: `--disable-features=RemoveRedirectionBitmap`. Test `SAL_SKIA=raster` vs vulkan | LO paints correctly after create, resize, minimize, maximize and snap, in both Skia modes |
| 2 | Chrome Legacy Window moves above LO and takes its clicks | `legacy_render_widget_host_win.cc` SetBounds (no `SWP_NOZORDER`) | Use BaseWindow with ribbon and status bar as separate WebContentsViews that never overlap the document area. Re-assert `HWND_TOP` after resize. `--disable-legacy-window` only as last resort (accessibility risk) | After 500 random resize/maximize/snap cycles, every click and wheel event still reaches LO |
| 3 | DPI mismatch: LO is System-aware, Electron is PMv1; Windows forces a reset | MS High-DPI docs; Office and WebView2 precedents | Measure the actual effect. Drive LO zoom from Electron display events. Evaluate LO as an owned borderless top-level overlay (each top-level window may have its own DPI mode). Otherwise accept System-DPI behaviour | Scaling 100/125/150% and mixed monitors, dragging between them: document and LO dialogs keep correct size, no crash |
| 4 | Hang or deadlock through attached input queues | Raymond Chen 2013; WebView2 docs; OpenOffice 2008 forum post | Never block the Electron UI thread. Make Win32 calls via koffi `.async` or a utilityProcess. Watchdog: `SendMessageTimeout(WM_NULL, SMTO_ABORTIFHUNG)` from a worker thread; on hang, kill and use LO autorecovery. Drive UNO from a separate Python process | Suspending soffice.bin leaves the ribbon responsive; recovery UI appears in under 5 s |
| 5 | Airspace (HTML cannot draw over LO) | WPF regions doc; mpv README | Dropdowns, galleries, ScreenTips and dialogs as parented frameless BrowserWindows or `Menu.popup`. Backstage hides the LO container | Every overlapping UI element renders above LO; keyboard navigation works |
| 6 | Keys and focus go to LO | Chen; `XUserInputInterception` | Trivial UNO key handler for Alt and F6 that notifies Electron. Restore LO focus on window `focus` | Alt shows KeyTips, F6 cycles, Ctrl+S works, Alt+Tab round trip keeps focus, emoji panel works |
| 7 | Destroying the parent or an LO crash kills the frame | inference | Close documents via UNO before destroying the window; watch for soffice exit | Closing with unsaved changes prompts; killing soffice mid-edit leads to recovery |

### B. Shell options for this need
| Criterion | Electron 44 | Tauri 2.12 | WPF + Fluent.Ribbon 11.0.2 | Qt 6 / PySide6 6.11 |
|---|---|---|---|---|
| License | MIT | MIT / Apache-2.0 | MIT | LGPL-3.0 / GPL (SARibbon MIT) |
| Builds without a C++ toolchain or the .NET SDK | Yes (Node 22) | No (needs MSVC C++ Build Tools + Rust) | No (needs the .NET SDK) | Yes (Python; large wheels) |
| Host DPI awareness | PMv1, fixed by the electron.exe manifest | PMv2; WebView2 must match the host | Chosen in app.manifest (System matches LO) | PMv2 default; `dpiawareness=1` in qt.conf matches LO |
| GDI child visible in host | Needs layered container or flag | WebView2 is itself a cross-process child | Yes | Yes |
| Popups over the LO area | Must be separate windows | Separate windows | Popup/ContextMenu are HWNDs, so fine; Backstage and adorners need hiding | Menus/popups are top-level, so fine |
| Office-like ribbon | Custom HTML (full control) | Custom HTML | Mature (KeyTips, Backstage, QAT, themes) | SARibbon / pyqtribbon |
| Foreign-HWND API | None (Win32 via koffi) | None (raw HWND) | HwndHost | QWindow::fromWinId + createWindowContainer |
| Accessibility | Chromium native UIA | WebView2 UIA | WPF UIA | Qt accessibility (not verified) |
| macOS/Linux | Yes; UI reusable with LOK | Yes | No | Yes |
| Cross-process embedding on macOS / Wayland | Impossible for every toolkit | Impossible | n/a | X11 only |

### C. Packaging for Windows: electron-builder 26.x vs Forge 7
| Need | electron-builder | Forge |
|---|---|---|
| Per-user installer, no admin | NSIS one-click (perMachine=false), installs to `%LOCALAPPDATA%\Programs` | Squirrel.Windows / MSIX / WiX |
| NSIS support | Built in | No official maker |
| .docx/.xlsx/.pptx/.pdf associations | Built-in only for perMachine; per-user needs an `nsis.include` writing HKCU Classes/Capabilities + SHChangeNotify. _Correction 2026-09-30:_ the built-in templates write under HKCU for per-user installs too; the project uses its own include anyway ([ADR 0010](../adr/0010-file-associations.md)) | Not evaluated |
| ~1.1 GB payload | Fine (limit is 2 GB uncompressed; NSISBI above that) | Not evaluated |
| Portable build | `portable` re-extracts to %TEMP% on each launch, so use `zip` | maker-zip |
| Auto-update | electron-updater (NSIS only, blockmap differential updates) | Squirrel-based |
| Code signing | Optional (signtool/Azure); unsigned triggers SmartScreen; SignPath Foundation for OSS | Optional |
| Compression | store/normal/maximum (store for dev builds; installer size and compression time not measured) | n/a |

### D. Turkish checks (Node 22.20 / ICU 77.1)
| Operation | Naive result | Correct approach and result |
|---|---|---|
| Uppercase "istanbul" | `toUpperCase` gives ISTANBUL | `toLocaleUpperCase('tr-TR')` gives İSTANBUL |
| Lowercase "IŞIK İZMİR" | `toLowerCase` gives "işik i̇zmi̇r" (İ → i + U+0307) | `toLocaleLowerCase('tr-TR')` gives "ışık izmir" |
| Sorting | Code-unit order puts ç ğ ı İ ö ş ü last | `Intl.Collator('tr')` gives cam çilek gül ğ ırmak Istanbul ışık iğne inci İzmir … |
| Case-insensitive search | `/i/i.test('İ')` and `/ı/i.test('I')` are both false | Fold both sides with the tr locale, or use `Collator('tr',{sensitivity:'base'})` |
| Number and date formats | – | tr-TR gives 1.234.567,891 and "28 Eylül 2026 Pazartesi" |

## Risks
- Chromium ≥139 gives top-level windows no GDI redirection surface (WS_EX_NOREDIRECTIONBITMAP), so a GDI/raster LO child renders invisibly. The fixes rely on layered windows or on a Chromium feature flag that Chromium may later remove.
- DPI-mode mismatch (LO System-aware vs Electron PMv1) triggers Microsoft's documented 'forced reset' of LO's process DPI mode. The visible effect is unknown: LO content or dialogs may end up the wrong size or blurry on mixed-DPI setups.
- Chromium re-raises its 'Chrome Legacy Window' on every bounds change (SetWindowPos with nullptr and no SWP_NOZORDER). It can then cover the LO child and take its clicks and wheel events.
- Input-queue attachment couples Electron's UI thread with LO's main thread. A hung or modal soffice.bin can freeze input to the whole window, and synchronous cross-thread Win32 calls (SetWindowPos, PrintWindow, focus changes) can hang or deadlock the Electron UI thread.
- Airspace forces every ribbon dropdown, gallery, ScreenTip and dialog that overlaps the document into its own top-level window. That adds focus and activation complexity and slows UX work; Backstage requires hiding LO.
- Keyboard routing: while LO has focus it receives Alt, F6 and Ctrl shortcuts. The UNO key handler is a synchronous cross-process call on every key, which adds latency or can hang LO if the Python bridge stalls.
- Data integrity: destroying the parent HWND or an LO crash tears down the LO frame. Documents must be closed via UNO first, and a crash has to be recovered through LO autorecovery.
- The architecture is Windows-only. Cross-process embedding is impossible on macOS (LO expects an in-process NSView*) and on Wayland, so a cross-platform version needs a different document surface (LOK tiles).
- LOK alternative: TDF's README still labels tiled rendering 'experimental', and Collabora ships its own core branch. Editing parity on the stock TDF Windows build is unverified, and a large web front-end is required (Collabora's is MPL-2.0 reusable, but its branding must be removed).
- koffi 3.x churn: a May-2026 rewrite plus frequent point releases. Mistakes such as passing the getNativeWindowHandle Buffer instead of the HWND value crash or misbehave silently.
- Packaging: file associations need a custom per-user NSIS script; NSIS breaks silently above 2 GB uncompressed if more LO language or help packs are added; the portable EXE target is unusable at this size. _(Correction 2026-09-30: electron-builder's own templates also write per user; the project uses its own include for other reasons, see [ADR 0010](../adr/0010-file-associations.md).)_
- Code signing: Azure Artifact Signing is not available to individuals in Turkey. Unsigned installers trigger SmartScreen warnings. SignPath Foundation requires a published signing policy, MFA and a CI-built release.
- PDF module security: pdf.js must be ≥4.2.67 (CVE-2024-4367) with isEvalSupported:false, running in a sandboxed renderer with a strict CSP.

## Recommendation
Keep Electron 44 as the UI shell (move to 45 after its 20 Oct 2026 release). Do not commit to embedding soffice.bin's window as a cross-process WS_CHILD until a one-week spike passes the Table A criteria.

Spike design:
- Use a BaseWindow with the ribbon and status bar as separate WebContentsViews. No WebContents may overlap the document rectangle.
- Parent LO (createSystemChild) to our own layered intermediate child window, created via pinned koffi 3.3.2 as a STATIC-class window, so no JS WndProc is needed. Also try `--disable-features=RemoveRedirectionBitmap`, and compare `SAL_SKIA=raster` against vulkan.
- Re-assert HWND_TOP after every resize.
- Do all Win32 calls on LO's windows through koffi `.async` or a utilityProcess, never on the UI thread. Add a SendMessageTimeout watchdog with kill-and-autorecovery. Drive UNO from LO's bundled Python over a named pipe with a random name.
- Make every overlapping UI element its own top-level window (parented frameless BrowserWindow or `Menu.popup`); Backstage hides the LO container.
- Use a trivial XUserInputInterception key handler for Alt (KeyTips) and F6 (focus cycling).
- Before destroying the window, close documents via UNO.
- Set one monitor to 125% or 150% and measure LO's DPI context and how its dialogs look. Compare the WS_CHILD approach with a borderless owned top-level LO frame, which avoids the one-DPI-mode-per-window-tree rule.

In parallel, run a 2–3-day LOK spike from a utilityProcess: koffi → `libreofficekit_hook_2` → `documentLoad` → `paintTile` into a canvas → `postKeyEvent`.
- If stock LO handles this, make LOK tile rendering the strategic document surface, as Collabora does. It removes the redirection-surface, z-order, DPI and airspace problems and unlocks macOS/Linux, while reusing the same web ribbon.
- If the embedding spike fails and LOK is not viable, the fallback host is WPF + Fluent.Ribbon (MIT) with a System-aware manifest matching LO. It is Windows-only and needs the .NET SDK.

Packaging:
- electron-builder NSIS, one-click, per-user.
- Custom NSIS include for HKCU file associations; let the user choose the default app.
- ZIP for the portable build; electron-updater later.
- SignPath Foundation for signing, or ship unsigned at first.
- Keep the uncompressed payload well under 2 GB, and pin every tool version.

Disk space: build output and caches can be moved to another drive with ELECTRON_BUILDER_CACHE, electron_config_cache and the npm cache settings when the system drive is small.

For i18n use i18next with `lang="tr"`, tr-TR locale casing and `Intl.Collator('tr')`. For accessibility use the APG tabs and toolbar patterns plus custom KeyTips, tested with NVDA and Narrator.

## Facts
- [high] Latest stable Electron is 44.4.5 (2026-09-23; Chromium 152.0.7977.130, Node 24.21.0); newest pre-release is 45.0.0-alpha.12 (2026-09-24). (https://releases.electronjs.org/)
- [high] Electron schedule: 44.0.0 stable 2026-08-25 (M152, EOL 2027-03-02); 45.0.0 stable planned 2026-10-20 (M156, EOL 2027-04-27); 43 EOL 2027-01-05; 42 EOL 2026-10-20. (https://releases.electronjs.org/schedule)
- [high] Electron supports the latest three stable majors; majors ship every 8 weeks (4-week alpha + 4-week beta). (https://www.electronjs.org/docs/latest/tutorial/electron-timelines)
- [high] Electron security checklist has 20 items (CSP, custom protocol instead of file://, validate IPC sender, limit navigation/new windows, check fuses, etc.); contextIsolation default since 12, sandbox since 20, nodeIntegration disabled since 5. (https://www.electronjs.org/docs/latest/tutorial/security)
- [high] Fuses runAsNode, nodeOptions, nodeCliInspect, grantFileProtocolExtraPrivileges default ON (recommended OFF); embeddedAsarIntegrityValidation and onlyLoadAppFromAsar default OFF (recommended ON); flip with @electron/fuses. (https://www.electronjs.org/docs/latest/tutorial/fuses)
- [high] BaseWindow.getNativeWindowHandle() returns a Buffer with the HWND on Windows; hookWindowMessage exposes WndProc messages; View/WebContentsView cannot wrap a foreign native handle. (https://www.electronjs.org/docs/latest/api/base-window)
- [high] 'Embed External Native Windows' (electron/electron#10547, 2017) is still an open enhancement: no supported embedding API. (https://github.com/electron/electron/issues/10547)
- [high] Electron's Windows manifest declares <dpiAware>true/pm</dpiAware> (per-monitor v1) with no PerMonitorV2 dpiAwareness element. (https://raw.githubusercontent.com/electron/electron/main/shell/browser/resources/win/dpi_aware.manifest)
- [high] Measured (window inspection via PowerShell P/Invoke, 2026-09-28): an application built on Electron 43.6 (Chrome 150) runs its top-level and child windows as Per-Monitor V1; a CEF-based and a WebView2-based application run as PMv2. (window inspection on a Windows 11 test machine)
- [high] Measured: an Electron 43 top-level window (Chrome_WidgetWin_1) has WS_EX_NOREDIRECTIONBITMAP (ex-style 0x00200100) and no WS_CLIPCHILDREN; an application built on Electron 22.3.27 lacks WS_EX_NOREDIRECTIONBITMAP. (window inspection on a Windows 11 test machine)
- [high] Chrome 139 on Windows 11 applies WS_EX_NOREDIRECTIONBITMAP to the top-level window, breaking products that put child HWNDs in it. Suggested fixes: make the child WS_EX_LAYERED + SetLayeredWindowAttributes(hwnd,0,255,LWA_ALPHA), or parent the content to an own intermediate child window. Temporary workaround: --disable-features=RemoveRedirectionBitmap. (https://groups.google.com/a/chromium.org/g/chromium-dev/c/hIJazxXfUD4/m/qtZ_1d9GAQAJ)
- [high] Measured child z-order of an Electron window, top to bottom: 'Chrome Legacy Window' (Chrome_RenderWidgetHostHWND; browser process; style 0x56300000; WS_EX_TRANSPARENT; full client area), then 'Intermediate D3D Window' owned by the separate GPU process (WS_CHILD|WS_VISIBLE|WS_DISABLED; ex 0x00280024). (window inspection of an Electron 43 application on a Windows 11 test machine)
- [high] Chromium creates 'Intermediate D3D Window' with WS_EX_NOPARENTNOTIFY|WS_EX_LAYERED|WS_EX_TRANSPARENT|WS_EX_NOREDIRECTIONBITMAP and WS_CHILDWINDOW|WS_DISABLED|WS_VISIBLE, which makes it transparent for input. (https://raw.githubusercontent.com/chromium/chromium/main/ui/gl/child_window_win.cc)
- [high] The browser process checks the GPU child's process id, calls ::SetParent(child,parent) and then SetWindowPos(child, HWND_BOTTOM, …) ('Move D3D window behind Chrome's window to avoid losing some messages'). Chromium itself therefore ships a cross-process child HWND. (https://raw.githubusercontent.com/chromium/chromium/main/ui/gfx/win/rendering_window_manager.cc)
- [high] LegacyRenderWidgetHostHWND serves accessibility (WM_GETOBJECT) and trackpad/DirectManipulation; styles WS_CHILDWINDOW|WS_CLIPCHILDREN|WS_CLIPSIBLINGS + WS_EX_TRANSPARENT; SetBounds calls ::SetWindowPos(hwnd(), nullptr, x,y,w,h, SWP_NOREDRAW) without SWP_NOZORDER; its hit-test delegates to Chromium (HTCLIENT when the parent returns HTNOWHERE). (https://raw.githubusercontent.com/chromium/chromium/main/content/browser/renderer_host/legacy_render_widget_host_win.cc)
- [high] HWND_TOP is (HWND)0, so hWndInsertAfter=nullptr without SWP_NOZORDER raises the window to the top. SWP_ASYNCWINDOWPOS only posts when the two threads are attached to different input queues. (https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos)
- [medium] Inference: because Chromium re-raises the legacy HWND on bounds changes, an embedded LO child can end up beneath it and lose mouse input. This does not happen if no WebContents overlaps the document rectangle, or if the z-order is re-asserted after each change. (legacy_render_widget_host_win.cc + SetWindowPos docs (above))
- [medium] Chromium switch --disable-legacy-window exists ('Disable the Legacy Window which corresponds to the size of the WebContents'); side effects on accessibility and trackpad in Electron are unverified. (https://raw.githubusercontent.com/chromium/chromium/main/content/public/common/content_switches.cc)
- [high] Chromium switches can be set from Electron with app.commandLine.appendSwitch before the 'ready' event. (https://www.electronjs.org/docs/latest/api/command-line-switches)
- [high] WebContentsView is added to a BaseWindow with contentView.addChildView() + setBounds(); BrowserView is deprecated. (https://www.electronjs.org/docs/latest/api/web-contents-view)
- [high] Cross-process parent/child or owner/owned relationships are 'technically legal' but implicitly attach the threads' input queues, and the attachment is transitive. (https://devblogs.microsoft.com/oldnewthing/20130412-00/?p=4683)
- [high] Chen: SetParent across threads 'synchronized the two threads'; attached queues mean 'cooperative multitasking'; SetFocus waits for the previous window's WM_KILLFOCUS; cross-process parenting of windows not designed for it is 'almost certainly doomed'. (https://devblogs.microsoft.com/oldnewthing/20130607-00/?p=4143)
- [high] Microsoft lists two benefits of WebView2 Window-to-Visual hosting: apps 'won't potentially cause each other to hang due to attached window input queues', and a monitor-scale change won't hang VSTO hosts. This implies windowed (child-HWND) hosting carries both hang risks. (https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/windowed-vs-visual-hosting)
- [high] Measured: a WebView2 host application hosts msedgewebview2.exe's Chrome_WidgetWin_1 as a cross-process child (WS_EX_NOREDIRECTIONBITMAP), with both processes PMv2. (window inspection on a Windows 11 test machine)
- [medium] Historic report: a Win32 host's call to createSystemChild 'never returns' and the app 'looks deadlocked'. The thread never confirmed the root cause; a blocked host UI thread is the likely explanation. (https://forum.openoffice.org/en/forum/viewtopic.php?t=10430)
- [high] PrintWindow is synchronous and the owning app renders on WM_PRINT/WM_PRINTCLIENT, so snapshots of the LO child depend on LO's UI thread being responsive. (https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-printwindow)
- [high] Microsoft: 'it is not possible to have different HWNDs in an HWND tree run in different DPI awareness modes'. On Windows 10 1703+, a cross-process CreateWindow under a parent of different awareness causes a 'Forced reset (of caller's process)'; a cross-process SetParent causes a 'Forced reset (of child window's process)'. The docs do not say what the reset target is. (https://learn.microsoft.com/en-us/windows/win32/hidpi/high-dpi-desktop-application-development-on-windows)
- [high] SetParent docs: 'Unexpected behavior or errors may occur if hWndNewParent and hWndChild are running in different DPI awareness modes' (same table). (https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setparent)
- [high] SetThreadDpiHostingBehavior (Windows 10 1803+) only affects new windows created in the calling thread; the docs make no cross-process statement. (https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setthreaddpihostingbehavior)
- [high] PMv1 notifies only top-level HWNDs of DPI changes, while PMv2 also notifies child HWNDs. System-aware windows are bitmap-stretched (blurry) at other DPIs. (https://learn.microsoft.com/en-us/windows/win32/hidpi/high-dpi-desktop-application-development-on-windows)
- [high] Office ('does not support Per Monitor v2') states 'some combinations of parent to child window mixed modes are not supported by the current Windows architecture'. It allows OLE in-place activation only when the container's DPI awareness is compatible: PM with PM, or System with System at the same system DPI. (https://learn.microsoft.com/en-us/office/client-developer/ddpi/handle-high-dpi-and-dpi-scaling-in-your-office-solution)
- [high] WebView2 initialization fails with 0x8007139F ('mismatch in DPI awareness') when the host's DPI awareness differs from the WebView2 processes sharing the user data folder. (https://github.com/MicrosoftEdge/WebView2Feedback/issues/4971)
- [high] LibreOffice 25.8.7.3 soffice.bin, soffice.exe and bundled python.exe embed <dpiAware>true</dpiAware> (System DPI aware; supportedOS Windows 10/11). The program binaries contain no SetProcessDpiAwarenessContext, SetThreadDpiAwarenessContext, GetDpiForWindow or SetThreadDpiHostingBehavior strings. (byte scan of program/soffice.bin and *.dll of a LibreOffice 25.8.7.3 installation)
- [high] DeclareDPIAware.manifest on both the libreoffice-26-8 branch and master contains only <dpiAware>true</dpiAware> (no PerMonitorV2), so 26.x is System-aware. This comes from source; a 26.8 binary was not available to inspect. (https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/solenv/gbuild/platform/DeclareDPIAware.manifest)
- [high] tdf#145710 'LibreOffice apps become blurry when moved to a different DPI monitor on Windows' is NEW with no patches; a developer comment says the OS, not LO, does the scaling. (https://bugs.documentfoundation.org/rest/bug/145710)
- [high] SAL_SKIA=raster|vulkan|metal selects the Skia backend (Vulkan by default when available). SAL_FORCEDPI only works for gen/gtk/qt VCL plugins, not Windows. (https://raw.githubusercontent.com/LibreOffice/core/master/vcl/README.vars.md)
- [high] VCLXToolkit::createSystemChild ignores ProcessId and creates a WorkWindow from SystemParentData: an HWND on Windows, an X11 window (+XEMBED flag) on Unix, and a cast to NSView* on macOS. (https://raw.githubusercontent.com/LibreOffice/core/master/toolkit/source/awt/vclxtoolkit.cxx)
- [medium] Inference: macOS takes an in-process NSView* pointer, and Wayland cannot map foreign window ids (QWindow::fromWinId). LO child-window embedding is therefore Windows/X11-only. (vclxtoolkit.cxx (above) + https://blog.martin-graesslin.com/blog/2015/07/porting-qt-applications-to-wayland/)
- [high] SfxBaseController implements XUserInputInterception (addKeyHandler/addMouseClickHandler); the handlers can consume events. (https://raw.githubusercontent.com/LibreOffice/core/master/sfx2/source/view/sfxbasecontroller.cxx ; https://api.libreoffice.org/docs/idl/ref/interfacecom_1_1sun_1_1star_1_1awt_1_1XUserInputInterception.html)
- [high] Stock LibreOffice 25.8.7.3 mergedlo.dll (137.6 MB) contains the LOK entry points libreofficekit_hook, libreofficekit_hook_2 and lok_preinit. Whether tiled editing works on the stock build is unverified. (program/mergedlo.dll of a LibreOffice 25.8.7.3 installation, byte search)
- [medium] The LOK README describes C/C++ access without UNO, calls tiled rendering 'experimental' (32-bit BGRA buffers), and includes 'Building and running gtktiledviewer on Windows'. (https://raw.githubusercontent.com/LibreOffice/core/master/libreofficekit/README.md)
- [high] Collabora Office desktop (first release 2025-11-26; 26.04 on 2026-07-01) uses an HTML/JS UI with the engine in-process: Win32/WebView2 on Windows (DPI aware, APPX/MSIX), WKWebView on macOS, Qt6 WebEngine on Linux. The source repo CollaboraOnline/online is MPL-2.0. (https://www.collaboraonline.com/blog/collabora-office-26-04-release/ ; https://www.collaboraonline.com/blog/collabora-online-now-available-on-desktop/ ; https://raw.githubusercontent.com/CollaboraOnline/online/main/COPYING)
- [medium] Electron runtime footprint, measured on an installed Electron 43 application: the main executable is 226.5 MB plus about 133 MB of DLL/pak/locale files (about 360 MB unpacked). (measurement on a Windows 11 test machine)
- [high] koffi 3.3.2 (2026-09-25) is MIT-licensed and ships prebuilt binaries for Windows x64/ia32/arm64 as optional platform subpackages, so it installs without a C++ compiler. (https://registry.npmjs.org/koffi/latest ; https://koffi.dev/)
- [high] koffi was relicensed to MIT in 2.3.9 (2023-03-30). 3.0.0 (2026-05-16) rewrote the call path, split native code into subpackages, switched pointers to BigInt, and removed koffi.callback/koffi.handle. (https://koffi.dev/changelog ; https://koffi.dev/migration)
- [high] koffi: supports __stdcall prototypes. fn.async() runs on worker threads (not available for variadic functions). Callbacks from secondary threads are queued to the JS main thread, which deadlocks if that thread never yields. Maximum 8192 registered callbacks. (https://koffi.dev/load ; https://koffi.dev/misc ; https://koffi.dev/callbacks)
- [medium] Bundling koffi naively includes all platform binaries (about 72 MB); a community Forge plugin prunes the unused ones. (https://github.com/rhy3h/electron-forge-plugin-koffi)
- [high] electron-builder npm dist-tags: latest 26.15.3, v26 26.17.0, next 27.0.0-alpha.9; MIT license. (https://registry.npmjs.org/-/package/electron-builder/dist-tags)
- [high] NSIS defaults: oneClick true, perMachine false, allowElevation true, allowToChangeInstallationDirectory false, differentialPackage true, useZip false, unicode true. Per-user install dir is $LocalAppData\Programs\${APP_FILENAME}; per-machine is $PROGRAMFILES64. (https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/app-builder-lib/src/targets/win/nsis/nsisOptions.ts ; .../templates/nsis/multiUser.nsh)
- [high] FileAssociation docs: 'On Windows (NSIS) works only if nsis.perMachine is set to true.' (https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/app-builder-lib/src/options/FileAssociation.ts) _Correction 2026-09-30:_ the docs are outdated here: the NSIS template `include/FileAssociation.nsh` (electron-builder 26.15.3) writes below `SHELL_CONTEXT`, i.e. under HKCU for a per-user install ([ADR 0010](../adr/0010-file-associations.md)).
- [high] electron-builder NSIS installers for apps larger than 2 GB uncompressed are silently malformed (#8399); workarounds are a custom NSISBI binary or nsis-web. (https://github.com/electron-userland/electron-builder/issues/8399)
- [medium] The portable target unpacks resources into %TEMP% at launch (unpackDirName defaults to a per-build UUID). (nsisOptions.ts (above) ; https://github.com/electron-userland/electron-builder/issues/8739)
- [high] electron-updater supports NSIS as the only Windows auto-update target (Squirrel.Windows is unsupported) and verifies code signatures. (https://raw.githubusercontent.com/electron-userland/electron-builder/master/website/docs/features/auto-update.md)
- [high] Electron Forge's Windows makers are Squirrel.Windows, WiX MSI, AppX, MSIX and ZIP; there is no NSIS maker. (https://www.electronforge.io/llms.txt)
- [high] Azure Artifact Signing Public Trust: individuals must be in the US or Canada; organizations in US/CA/EU/UK/AU/NZ/JP/KR/SG/CH/NO/IL; a paid subscription is required. (https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart ; https://learn.microsoft.com/en-us/azure/artifact-signing/faq)
- [high] SignPath Foundation signs free for OSI-licensed projects without proprietary components; unsigned upstream OSS binaries may be included; a code-signing policy page and MFA are required. (https://signpath.org/terms.html)
- [high] Default-app choice on Windows is user-driven: apps register ProgIDs/Capabilities (HKCU for per-user), and 'An application should never reclaim a default without asking the user.' (https://learn.microsoft.com/en-us/windows/win32/shell/default-programs)
- [high] Electron's download cache (default %LOCALAPPDATA%\electron\Cache) moves with electron_config_cache; electron-builder's cache moves with ELECTRON_BUILDER_CACHE (absolute path). (https://www.electronjs.org/docs/latest/tutorial/installation ; https://raw.githubusercontent.com/electron-userland/electron-builder/master/website/docs/environment-variables.md)
- [high] Tauri: latest stable 2.12.0 (2026-09-26), 3.0.0-alpha.3 also out; license Apache-2.0 OR MIT. Windows requires Microsoft C++ Build Tools, the MSVC Rust toolchain and WebView2. Multiple webviews per window are behind the 'unstable' feature. (https://crates.io/api/v1/crates/tauri ; https://v2.tauri.app/start/prerequisites/ ; https://github.com/tauri-apps/tauri/pull/8280)
- [medium] Tauri users embedding VLC/mpv reported the native video drawing over the webview and fell back to separate position-synced windows. (https://github.com/orgs/tauri-apps/discussions/6343)
- [high] Fluent.Ribbon is MIT, latest 11.0.2 (targets .NET 6/.NET 8), with KeyTips, Backstage, light/dark themes and localization. Its Backstage.cs collapses HwndHost elements ('We have to collapse WindowsFormsHost while Backstage is open'). (https://api.nuget.org/v3-flatcontainer/fluent.ribbon/index.json ; https://raw.githubusercontent.com/fluentribbon/Fluent.Ribbon/develop/Fluent.Ribbon/Controls/Backstage.cs)
- [high] WPF airspace: each pixel belongs to exactly one HWND, and rendering WPF over a Win32 region is disallowed. (https://learn.microsoft.com/en-us/dotnet/desktop/wpf/advanced/technology-regions-overview)
- [high] Qt 6 is Per-Monitor V2 by default and can be switched via qt.conf [Platforms] WindowsArguments=dpiawareness=0|1|2. QWindow::fromWinId can embed a window 'created by another process' where the platform supports it, but manipulating that window is 'incidental, highly platform dependent and untested'. (https://doc.qt.io/qt-6/highdpi.html ; https://doc.qt.io/qt-6/qwindow.html)
- [high] PySide6 6.11.2 (2026-08-18) is LGPL-3.0-only OR GPL-2.0/3.0. SARibbon (a Qt ribbon) is MIT and has PySide6 bindings. (https://pypi.org/pypi/PySide6/json ; https://raw.githubusercontent.com/czyt1988/SARibbon/master/LICENSE)
- [high] mpv recommends its render API over window embedding: with raw embedding you cannot draw your own OSD on top of the video, and X11 has focus problems. (https://github.com/mpv-player/mpv-examples/blob/master/libmpv/README.md)
- [low] Node-MPV #106: mpv embedded via --wid into an Electron BrowserWindow played but showed no video (not diagnosed; consistent with z-order or missing redirection surface). (https://github.com/j-holub/Node-MPV/issues/106)
- [medium] Chrome 138+ enables native UI Automation on Windows by default, without the MSAA-to-UIA proxy. Electron 44 (Chromium 152) is expected to inherit this. (https://developer.chrome.com/blog/windows-uia-support-update)
- [high] Electron enables accessibility automatically when assistive technology is present; app.setAccessibilitySupportEnabled can force it on. (https://www.electronjs.org/docs/latest/tutorial/accessibility)
- [high] APG toolbar pattern: one Tab stop, arrow keys with roving tabindex, optional Home/End, role=toolbar with aria-label or aria-labelledby, aria-orientation. (https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/)
- [high] i18next 26.4.2 is MIT-licensed. (https://registry.npmjs.org/i18next/latest)
- [high] Verified in Node 22.20 (ICU 77.1): 'istanbul'.toUpperCase() gives 'ISTANBUL' but toLocaleUpperCase('tr-TR') gives 'İSTANBUL'. 'IŞIK İZMİR'.toLowerCase() gives 'işik i̇zmi̇r' (İ becomes i+U+0307, length 2) but toLocaleLowerCase('tr-TR') gives 'ışık izmir'. The default sort misorders ç/ğ/ı/İ/ö/ş/ü while Intl.Collator('tr') orders them correctly. /i/i.test('İ') and /ı/i.test('I') are both false. (`node -e` test with Node 22.20.0)
- [high] pdf.js ≤4.1.392 allowed arbitrary JavaScript execution from a malicious PDF (CVE-2024-4367); fixed in 4.2.67; workaround isEvalSupported:false. (https://github.com/mozilla/pdf.js/security/advisories/GHSA-wgrm-67xf-hhpq)
