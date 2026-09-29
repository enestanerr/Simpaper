# LibreOffice as an embeddable, redistributable engine on Windows (as of Sept 2026)

> Research notes of 2026-09-28 on LibreOffice as an embeddable, redistributable engine, prepared before the architecture decision and published
> with details about the research machine removed. Findings age quickly: check the linked sources before relying
> on a version number, a price, a bug status or a release date. Decisions are recorded in [docs/adr](../adr/README.md).

## Summary
**Verdict.** Embedding an unmodified TDF LibreOffice 26.8.x through UNO (`Toolkit.createSystemChild(HWND, [], SYSTEM_WIN32)` → `Frame.initialize(win)` → `loadComponentFromURL(url,"_self",0,args)`) is still supported on Windows. The code is identical on `libreoffice-26-8` and master. The same pattern is used by the still-built OfficeBean and by the optional ActiveX control. It is still the only credible no-compile way to get full LibreOffice editing inside our window, but it is not low-risk:
- **Open 2026 bugs:** black areas, flicker and crashes on Windows when LibreOffice 26.x is driven by an external process (tdf#172048, tdf#172304). Skia has been mandatory on Windows since 26.2.
- **DPI:** LibreOffice is not per-monitor DPI aware (tdf#145710, open since 2021).
- **Window coupling:** a parent/child window pair across two processes shares one input queue, so a hang in one process can freeze the other.

LibreOfficeKit (LOK, the in-process C API that renders documents as bitmap tiles) is **not** a better option with stock TDF builds. TDF removed its dialog-to-JSON layer (JSDialog) in June 2026, so it is absent from 26.8. Collabora's Windows desktop app built on LOK needs Collabora's own engine build. Recommendation: keep the UNO-embedding candidate, but gate it on a short spike with explicit pass/fail tests.

**1. Releases and downloads**
- **Current:** the newer "fresh" line is 26.8.0 (build 26.8.0.3, announced 2026-08-26). The older "still" line is 26.2.6 (published 3–4 Sep 2026).
- **Next:** 26.8.1 was planned for week 39, but `/stable/26.8.1/` returned 404 on 2026-09-28.
- **End of life:** 26.2 on 2026-11-30, which is too soon to ship on. 26.8 on 2027-06-13, with bugfix releases up to 26.8.7.
- **Pinning:** entries under `/stable/` disappear over time, so pin builds via `downloadarchive…/old/26.8.0.3/…`.
- **Integrity files:** only `.asc` signatures sit next to each MSI (signing key C2839ECA…AFEEAEA3). The download server generates `.sha256`, `.md5`, `.meta4`, `.mirrorlist` and similar on request.
- **Languages:** the Windows MSI contains all UI languages; there are no separate language-pack MSIs, only help packs.
- **Extraction:** `msiexec /a … TARGETDIR=` gives a runnable full image of about 0.9–1.4 GB with all languages.
  - TDF's wiki says admin rights are needed only for system folders (not verified during the research).
  - The extracted image registers nothing and does not deploy the VC++ runtime, which comes as a merge module.
- **Portable use:** proven by PortableApps. Point the profile elsewhere with `-env:UserInstallation=file:///…` instead of editing `bootstrap.ini`.

**2. Licensing and trademark**
- The core is MPL-2.0, but the binary bundle also contains GPL, LGPL and other third-party parts (poppler, fonts, dictionaries, Python, the VC++ runtime).
- For unmodified redistribution:
  - keep every LICENSE and notice file;
  - tell recipients where the exact source is (MPL §3.2(a));
  - for the GPL/LGPL parts, also provide the corresponding source (mirror the tarballs).
- Our own app can use any license; MPL §3.3 treats it as a "Larger Work".
- TDF's Mark Policy allows referring to "substantially unmodified" LibreOffice and identifying it "as a distinct component of a software offering". So "Includes / Powered by LibreOffice®" is fine as text, or with the logo that does not carry the TDF subline.
- It forbids "LibreOffice" in our app or app-store name and any implied affiliation with TDF.
- TDF's Logo Policy lets distributors of substantially unmodified binaries ship TDF's branding inside the product. So LibreOffice strings in its own dialogs are fine.

**3. Embedding details (from source)**
- On Windows, `createSystemChild` ignores the ProcessId argument. VCL creates a `WS_CHILD` frame whose parent is our HWND.
- We must drive resizing ourselves with `XWindow.setPosSize`. The DevGuide says VCL cannot fill the parent automatically on Windows.
- Append the frame to `Desktop.getFrames()` and set `AutomaticToolbars=false`, as the ActiveX control's code does.
- Win32 caveats:
  - shared input queues between the two processes;
  - mixed-DPI parenting is officially "unexpected behavior" for SetParent;
  - HTML menus from the Electron UI probably cannot overlap the native LibreOffice window (inference).

**4. LOK**
- LOK is compiled into `sofficeapp.dll` on Windows, and `paintTile` has a Windows code path.
- It needs in-process native code (a native addon or helper).
- 26.8 has no JSDialog, and the UNO tiled-rendering interface (`XTiledRenderable`) was removed in 25.8.
- Collabora's Windows desktop app (CODA-W) needs an engine built with `--with-distro=CODAWindows`.
- The April 2026 split between TDF and Collabora lowers expectations for LOK maintenance in TDF's code.

**5. APIs**
- All the requested interfaces exist and are documented.
- Behaviour verified in source:
  - XKeyHandlers run in `PreNotify`, before LibreOffice handles the key, and can consume it.
  - Modifier-only keys (Alt, Ctrl or Shift alone) raise `KeyModChange`, so a key handler never sees a bare Alt. Ribbon key-tips need another mechanism.
  - The toolkit's top-window listener fires when LibreOffice's own (VCL) dialogs open and close. Use it to lock our ribbon while a modal dialog is up.
  - Some UI actions bypass the dispatch framework (tdf#36210). Also use `Office.Commands/Execute/Disabled`.

**6. Python**
- 26.8.0.3 bundles Python 3.13.15; the 26.2 branch bundles 3.12.14.
- `program\python.exe` is a launcher:
  - it sets `UNO_PATH` and `URE_BOOTSTRAP` only if they are not already set;
  - it prepends the program folder to `PATH` and sets `PYTHONPATH` and `PYTHONHOME`;
  - it then spawns and waits for `python-core-…\bin\python.exe`.
- Connection pattern, the same as LibreOffice's own `officehelper.py`:
  - start `soffice --nologo --nodefault --accept=pipe,name=X;urp;`
  - connect to `uno:pipe,name=X;urp;StarOffice.ComponentContext`.
- The Windows pipe is `\\.\pipe\OSL_PIPE_<user>_X` with the default DACL.
- `soffice.exe` spawns `soffice.bin`; killing `soffice.exe` does not kill `soffice.bin`.
- There is one soffice instance per user-profile path.

**7. Configuration.** The keys are in the table. Preset them with a pre-seeded `registrymodifications.xcu` in our own profile (format verified), or with a locked (`finalized`) layer added through `fundamental.override.ini` / `CONFIGURATION_LAYERS`. Machine policies under `HKLM`/`HKCU\Software\Policies\LibreOffice` also apply to our bundled copy.

## Tables
### A. Release lines and Windows downloads (checked 2026-09-28)
| Item | Value | Source |
|---|---|---|
| Fresh | **26.8.0** (build 26.8.0.3), announced 2026-08-26 | TDF blog, `src/26.8.0/` |
| Still | **26.2.6**, published 2026-09-03 | `/stable/` listing |
| Next | 26.8.1 planned wk 39; `/stable/26.8.1/` = 404 on 09-28 | ReleasePlan/26.8 |
| EOL | 26.2 → **2026-11-30**; 26.8 → **2027-06-13**; 25.8 already EOL | ReleasePlan |
| x64 MSI | `https://download.documentfoundation.org/libreoffice/stable/26.8.0/win/x86_64/LibreOffice_26.8.0_Win_x86-64.msi`, 374,906,880 B, SHA-256 `4aa6c6e1895f4055104effcb556bd3362d20c6ad707c149543304f395ef9db95` | .mirrorlist |
| arm64 MSI | `…/stable/26.8.0/win/aarch64/LibreOffice_26.8.0_Win_aarch64.msi` (344 MB) | listing |
| x86 MSI | `…/stable/26.8.0/win/x86/LibreOffice_26.8.0_Win_x86.msi` (337 MB; 32-bit deprecated since 25.8) | listing |
| Still x64 | `…/stable/26.2.6/win/x86_64/LibreOffice_26.2.6_Win_x86-64.msi` (356 MB) | listing |
| Pinned URL | `https://downloadarchive.documentfoundation.org/libreoffice/old/26.8.0.3/win/x86_64/LibreOffice_26.8.0.3_Win_x86-64.msi` | archive |
| Files next to MSI | `.asc` only; `.sha256/.sha1/.md5/.meta4/.metalink/.torrent/.magnet/.zsync/.mirrorlist` generated on request | .mirrorlist |
| Signing key | `C283 9ECA D940 8FBE 9531 C3E9 F434 A1EF AFEE AEA3` | .asc packet |
| Languages | Main MSI has all UI languages (UI_LANGS); help packs are separate MSIs | Deployment wiki |

### B. Configuration keys (26.8 schema)
| Goal | Path → property | Set to | Default |
|---|---|---|---|
| No macro execution | `/org.openoffice.Office.Common/Security/Scripting` → `DisableMacrosExecution` | true | false |
| Macro level | same → `MacroSecurityLevel` (0 Low … 3 Very High) | 3 | 2 |
| Block OLE/DDE | same → `DisableActiveContent` | true (optional) | false |
| VBA (Writer) | `/org.openoffice.Office.Writer/Filter/Import/VBA` → `Load` / `Executable` / `Save` | true / false / true | all true |
| VBA (Calc) | `/org.openoffice.Office.Calc/Filter/Import/VBA` → `Load` / `Executable` / `Save` (+`UseExport`) | true / false / true | all true |
| VBA (Impress) | `/org.openoffice.Office.Impress/Filter/Import/VBA` → `Load` / `Save` | true / true | true |
| Keep-format dialog | `/org.openoffice.Office.Common/Save/Document` → `WarnAlienFormat` | false | true |
| AutoRecovery | `/org.openoffice.Office.Recovery/RecoveryInfo` → `Enabled`; `/…/AutoSave` → `Enabled`, `TimeIntervall` (1–60 min), `UserAutoSaveEnabled` | true; true, e.g. 5, false | true; true, 10, false |
| Theme | `/org.openoffice.Office.Common/Appearance` → `ApplicationAppearance` (0 system / 1 light / 2 dark); `LibreOfficeTheme` | match our UI; 0 | 0; 0 |
| UI language | `/org.openoffice.Office.Linguistic/General` → `UILocale` ("" = desktop); also `/org.openoffice.Setup/L10N` → `ooLocale` | e.g. `tr` | "" |
| Document language | `/org.openoffice.Office.Linguistic/General` → `DefaultLocale` (+`_CJK`, `_CTL`) | `tr-TR` | "" |
| Tip of the day | `/org.openoffice.Office.Common/Misc` → `ShowTipOfTheDay` | false | true |
| Welcome/What's New | `/org.openoffice.Setup/Product` → `WhatsNew`, `WhatsNewDialog`; `/org.openoffice.Office.UI.Infobar/Enabled` → `WhatsNew` | false | true |
| Donate/Get Involved | `/org.openoffice.Office.UI.Infobar/Enabled` → `Donate`, `GetInvolved`; `…/Misc` → `ShowDonation` | false | true |
| Update check (classic) | `/org.openoffice.Office.Jobs/Jobs/org.openoffice.Office.Jobs:Job['UpdateCheck']/Arguments` → `AutoCheckEnabled` | false | true |
| MAR updater | `/org.openoffice.Office.Update/Update` → `Enabled` | false | true |
| Crash-report dialog | `/org.openoffice.Office.Common/Misc` → `CrashReport` | false | true |
| Start Center | no key: start with `--nodefault`; intercept `.uno:CloseDoc`/`CloseWin`/`Quit` | — | — |
| File pickers | `/org.openoffice.Office.Common/Misc` → `UseSystemFileDialog` | false (if LO's own wanted) | true |
| Skia GPU | `/org.openoffice.Office.Common/VCL` → `ForceSkiaGPU` (or env `SAL_SKIA=raster`) | false | false |
| Disable commands | `/org.openoffice.Office.Commands/Execute/Disabled/<node>` → `Command` (e.g. `OptionsTreeDialog`) | as needed | empty |
| Default save format | `/org.openoffice.Setup/Office/Factories/org.openoffice.Setup:Factory['com.sun.star.text.TextDocument']` → `ooSetupFactoryDefaultFilter` | `MS Word 2007 XML` (Calc: `Calc MS Excel 2007 XML`; Impress: `Impress MS PowerPoint 2007 XML`) | ODF |
| Read-only | no global key: MediaDescriptor `ReadOnly=true` at load; per-document DocumentSettings `LoadReadonly` | — | — |
| Profile location | `-env:UserInstallation=file:///…` (or `fundamental.override.ini`) | own folder | `$SYSUSERCONFIG/LibreOffice/4` |

`registrymodifications.xcu` skeleton (format from configmgr's writer):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="ShowTipOfTheDay" oor:op="fuse"><value>false</value></prop></item>
<item oor:path="/org.openoffice.Office.Jobs/Jobs/org.openoffice.Office.Jobs:Job['UpdateCheck']/Arguments"><prop oor:name="AutoCheckEnabled" oor:op="fuse"><value>false</value></prop></item>
</oor:items>
```

### C. UNO APIs for the embedding path
| Need | API | Verified behavior / caveat |
|---|---|---|
| Embed | `com.sun.star.awt.Toolkit` → `XSystemChildFactory.createSystemChild(hwnd, [], SystemDependent.SYSTEM_WIN32=1)` | ProcessId ignored; creates a `WS_CHILD` frame; we resize with `setPosSize` |
| Frame | `com.sun.star.frame.Frame.initialize(xWindow)`; `Desktop.getFrames().append(frame)`; `frame.loadComponentFromURL(url,"_self",0,args)` | same pattern as SOActiveX |
| Hide LO UI | frame property `LayoutManager`: `AutomaticToolbars=false`, `hideElement("private:resource/menubar/menubar")`, `setVisible(false)`, `HideCurrentUI` | the sidebar is not managed by the layout manager |
| Intercept commands | `XDispatchProviderInterception.registerDispatchProviderInterceptor` | some UI actions bypass dispatch (tdf#36210) |
| Command state | `XDispatch.addStatusListener` → `FeatureStateEvent{FeatureURL, IsEnabled, State, Requery}` | IDL: notification is not guaranteed |
| Completion | `XNotifyingDispatch.dispatchWithNotification` → `DispatchResultEvent` | — |
| Context menu | `ui.XContextMenuInterception` on the controller | — |
| Keys | controller `XUserInputInterception.addKeyHandler`; toolkit `XExtendedToolkit.addKeyHandler` | runs before LO; can consume; **no bare Alt/Ctrl/Shift** |
| Dialogs | `XExtendedToolkit.addTopWindowListener` | fires for VCL dialogs; lock our UI during modal dialogs |
| Dirty/save | `XModifiable(isModified, addModifyListener)`; `XStorable.store/storeAsURL/storeToURL(url, FilterName=…)` | `storeToURL` keeps the document's location and modified state |

### D. UNO frame embedding vs LOK (stock TDF 26.8, no compiling)
| Criterion | UNO frame embedding | LibreOfficeKit (LOK) |
|---|---|---|
| Works with stock TDF build | Yes (API unchanged in 26.8) | Code present, but no Windows production use on TDF builds found |
| Full LO dialogs/sidebar | Yes, native VCL | No JSDialog in 26.8; must build all dialog UI ourselves |
| Process model | Separate `soffice.bin`; cross-process child HWND | In-process DLL (native addon or helper) |
| Main risks | Skia/external-control glitches (tdf#172048/172304), DPI (tdf#145710), shared input queue, airspace, Alt key | Unsupported path; CODA-W needs Collabora engine build; TDF trimming LOK |
| Verdict | Primary candidate, gated by a spike | Not recommended now |

## Risks
- Rendering or crash bugs: open, unassigned bugs report black areas, flicker and crashes when LibreOffice 26.x is driven by an external process on Windows with Skia mandatory (tdf#172048, tdf#172304). A spike must prove the default Skia raster (and SAL_SKIA=raster) works.
- Cross-process HWND parenting attaches the input queues of soffice.bin and the Electron UI thread (transitively). A long operation or hang in LibreOffice can freeze our ribbon, and focus changes become synchronous.
- Mixed DPI: LibreOffice is not per-monitor DPI aware (tdf#145710, open since 2021); Electron is. Moving between monitors with different scaling may mis-scale or blur the document area. Microsoft documents cross-process mixed-DPI parenting as unexpected behavior.
- Airspace (inference): HTML dropdowns and galleries in the Electron ribbon probably cannot draw over the native LibreOffice child window. Design popups as separate windows or keep them out of the document area.
- Keyboard: XKeyHandler never receives modifier-only keys (bare Alt/Ctrl/Shift), so Office-style Alt key-tips need another mechanism. Turkish AltGr (Ctrl+Alt) combinations must not be treated as shortcuts.
- Dispatch interception is incomplete: some actions bypass the dispatch framework (tdf#36210). LibreOffice modal dialogs do not disable our Electron UI; this needs top-window listeners.
- Performance (inference): a remote (out-of-process) Python interceptor, status listener or key handler turns each queryDispatch or keypress into a synchronous IPC round trip. Run hot-path listeners inside soffice.
- Updaters: both the classic update check and the MAR updater are enabled by default and could try to update or replace the bundled engine. Disable both in the profile.
- Machine policies under HKLM/HKCU\Software\Policies\LibreOffice (winreg configuration layers) also apply to the bundled copy and can override our settings.
- Licensing: the bundle includes GPL/LGPL components (e.g. poppler, fonts, dictionaries) besides MPL-2.0 code. MPL §3.2 source notice plus GPL corresponding-source duties apply; mirror the exact tarballs, including external dependencies. This is not legal advice.
- Trademark: 'LibreOffice' may not be in our product or app-store name, and wording must not imply TDF affiliation. The TDF-subline logo cannot be used in our own materials.
- VC++ runtime: an admin-extracted image does not deploy the VC++ 14.x runtime (merge module), so users without a recent runtime may fail to start soffice.
- Unverified: whether 'msiexec /a' runs without elevation. TDF's wiki says admin rights are needed only for system folders; one secondary source says elevation is required.
- Lifecycle: 26.2 reaches end of life 2026-11-30. 26.8 needs roughly monthly bugfix updates until 2027-06-13, and security fixes force regular re-bundling and pinning via downloadarchive.
- Process management: soffice.exe spawns soffice.bin, and killing soffice.exe leaves soffice.bin running. program\python.exe spawns a second python process, and existing UNO_PATH/URE_BOOTSTRAP/PYTHONPATH values in the environment leak in.
- Security: a UNO acceptor grants arbitrary command execution. Pipes use the default DACL and do not reject remote clients; use a random per-session pipe name, never a TCP socket, and never ScriptForge's well-known default pipe name PIPE2LIBREOFFICE.
- Ecosystem: the TDF–Collabora split (April 2026) and TDF's removal of JSDialog lower expectations for LOK and embedding fixes in TDF core. Bugs in this niche may stay unfixed.

## Recommendation
Keep "Electron shell + unmodified TDF LibreOffice embedded via UNO" as the leading architecture, but treat it as unproven until a 2–3 day go/no-go spike passes. Target the 26.8 line (pin 26.8.1 or later once it appears on the download server). Do not ship on 26.2, which reaches end of life on 2026-11-30.

**Spike setup**
1. Download `LibreOffice_26.8.0.3_Win_x86-64.msi` from downloadarchive. Verify the SHA-256 and the `.asc` signature against key C2839ECAD9408FBE9531C3E9F434A1EFAFEEAEA3.
2. Run `msiexec /a <msi> /qb TARGETDIR=<engine folder>` and record whether it needs elevation.
3. Pre-seed `<profile>\user\registrymodifications.xcu` with the table B keys:
   - both updaters, the crash dialog, tips, What's New and the infobars off;
   - macros disabled, VBA Load/Save on and Executable off;
   - WarnAlienFormat off, a fixed ApplicationAppearance, UILocale and DefaultLocale.
4. Start `soffice.exe -env:UserInstallation=file:///<profile> --nologo --nodefault --accept=pipe,name=<random>;urp;`
5. From LibreOffice's Python:
   - create a system child on the Electron HWND (`getNativeWindowHandle`, `SYSTEM_WIN32`);
   - initialize a `Frame` on it, append the frame to `Desktop.getFrames()`, and load a DOCX/XLSX/PPTX with `_self`;
   - through the LayoutManager, set `AutomaticToolbars=false` and hide the menubar, toolbars and statusbar;
   - drive resizing with `setPosSize` from Electron's resize events (`hookWindowMessage`);
   - intercept `.uno:Save`, `SaveAs`, `Open`, `Print`, `CloseDoc`, `CloseWin` and `Quit`.

**Pass criteria**
- No black, flickering or corrupt areas with the default raster Skia (retest with `SAL_SKIA=raster`).
- Correct Turkish typing (AltGr and IME).
- Ctrl shortcuts reach our interceptor; Alt key-tips have a working alternative.
- LibreOffice modal dialogs are owned by our window, and our ribbon is blocked while they are open.
- Correct scaling at 100/125/150% and after moving between monitors.
- The Electron UI stays usable when soffice is busy, and recovers cleanly after `soffice.bin` is killed (restart plus document recovery).
- Measure the latency of cross-process listener calls.

**Architecture guidance (partly inference)**
- Put the hot-path UNO glue (dispatch interceptor, status listeners, key handler) inside `soffice.bin` as a Python UNO component or extension that runs on LibreOffice's bundled Python. Talk to Electron over one coarse message channel on a random-named, same-user pipe.
- Use the remote bridge only for control actions (start, load, close, terminate).
- Our supervisor must own soffice.bin's lifetime (`--pidfile`, or a Windows Job Object created from the helper via ctypes). Always attempt a graceful `XDesktop.terminate` first.

**Packaging**
- Ship the admin image trimmed to the needed languages.
- Include LibreOffice's LICENSE, NOTICE, CREDITS and readmes unchanged.
- Bundle or install the VC++ 14.x runtime.
- Never register LibreOffice's Maintenance Service.
- Mirror the exact source tarballs (core plus external dependencies) and say where they are, both in the About box and in the repository.
- Name the product without "LibreOffice" and use "Includes LibreOffice® (The Document Foundation)" as text.

**Do not build on LOK with stock TDF builds**: JSDialog is gone in 26.8, and Collabora's Windows LOK app needs its own engine build. If the spike fails, fall back to one of these:
- (a) LibreOffice's own top-level windows with its built-in Tabbed NotebookBar, integrated through UNO rather than embedded;
- (b) evaluate Collabora's MPL-2.0 CODA stack, which means accepting their engine build.

**Disk space:** the engine adds about 0.36 GB (MSI) plus 0.9–1.4 GB (extracted), or about 0.7–0.8 GB after trimming languages.

## Facts
- [high] Fresh line: LibreOffice 26.8.0 (source tag/tarball 26.8.0.3) announced 2026-08-26; files dated 24-Aug-2026. The 26.8 announcement also says 26.2 reaches end of life on 30 November 2026. (https://blog.documentfoundation.org/blog/2026/08/26/libreoffice-26-8/)
- [high] Still line: 26.2.6 (stable/26.2.6/ dated 03-Sep-2026). As of 2026-09-28, /libreoffice/stable/ lists only 25.8.7, 26.2.5, 26.2.6 and 26.8.0. (https://download.documentfoundation.org/libreoffice/stable/)
- [high] 26.8.1 was scheduled for week 39/2026 (RC1 in week 38), but https://download.documentfoundation.org/libreoffice/stable/26.8.1/ returned HTTP 404 on 2026-09-28. (https://wiki.documentfoundation.org/ReleasePlan/26.8)
- [high] 26.8 schedule: 26.8.2–26.8.7 in weeks 40, 43, 48 of 2026 and weeks 5, 10, 16 of 2027; End of Life June 13, 2027. (https://wiki.documentfoundation.org/ReleasePlan/26.8)
- [high] 26.2 End of Life is November 30, 2026; the last planned release is 26.2.7 in weeks 41–44 of 2026. (https://wiki.documentfoundation.org/ReleasePlan)
- [high] Cadence: two releases per year (latest line for early adopters, previous line for corporate use); a release lives about nine months and reaches EOL one month after its last planned release. (https://wiki.documentfoundation.org/ReleasePlan)
- [high] Windows x64 MSI: https://download.documentfoundation.org/libreoffice/stable/26.8.0/win/x86_64/LibreOffice_26.8.0_Win_x86-64.msi — 374,906,880 bytes, SHA-256 4aa6c6e1895f4055104effcb556bd3362d20c6ad707c149543304f395ef9db95. (https://download.documentfoundation.org/libreoffice/stable/26.8.0/win/x86_64/LibreOffice_26.8.0_Win_x86-64.msi.mirrorlist)
- [high] 26.8.0 also ships Windows arm64 (LibreOffice_26.8.0_Win_aarch64.msi, 344 MB) and 32-bit x86 (LibreOffice_26.8.0_Win_x86.msi, 337 MB) MSIs; 32-bit Windows builds have been deprecated since 25.8, and Windows 7/8/8.1 support was removed in 25.8. (https://download.documentfoundation.org/libreoffice/stable/26.8.0/win/aarch64/ ; https://wiki.documentfoundation.org/ReleaseNotes/25.8)
- [high] The only physical file published next to each MSI is a detached PGP signature (.asc, 833 bytes). The download server (MirrorBrain) serves .sha256, .sha1, .md5, .meta4, .metalink, .torrent, .magnet, .zsync and .mirrorlist on request. (https://download.documentfoundation.org/libreoffice/stable/26.8.0/win/x86_64/LibreOffice_26.8.0_Win_x86-64.msi.mirrorlist)
- [high] The 26.8.0 x64 MSI .asc names issuer fingerprint C2839ECAD9408FBE9531C3E9F434A1EFAFEEAEA3 and was created 2026-08-24. (https://download.documentfoundation.org/libreoffice/stable/26.8.0/win/x86_64/LibreOffice_26.8.0_Win_x86-64.msi.asc)
- [high] Stable pinned URL format uses the 4-part version: https://downloadarchive.documentfoundation.org/libreoffice/old/26.8.0.3/win/x86_64/LibreOffice_26.8.0.3_Win_x86-64.msi (358 MB, with .asc). (https://downloadarchive.documentfoundation.org/libreoffice/old/26.8.0.3/win/x86_64/)
- [high] Exact sources for 26.8.0: libreoffice-26.8.0.3.tar.xz (288 MB) plus dictionaries, help and translations tarballs, each with .asc. (https://download.documentfoundation.org/libreoffice/src/26.8.0/)
- [high] The Windows main MSI is multilingual: the Windows directory has only help-pack and SDK MSIs, no language packs. The MSI property UI_LANGS picks installed UI languages; a default silent install selects the system's UI languages. (https://wiki.documentfoundation.org/Deployment_and_Migration)
- [medium] An administrative install (msiexec /a <msi> TARGETDIR=...) produces a runnable, fully extracted copy including all localizations (~500 MB of language files). It does not appear in Add/Remove Programs, and admin rights are needed only when the target is a system folder such as Program Files. Not verified during the research. (https://wiki.documentfoundation.org/Installing_in_parallel/Windows)
- [high] An administrative install runs only the AdminExecuteSequence/AdminUISequence tables; transforms applied while creating the admin image have no valid effect. (https://learn.microsoft.com/en-us/windows/win32/msi/administrative-installation)
- [medium] The VC++ runtime ships as a Microsoft merge module (VC143/VC145 CRT, condition VC_REDIST=1), not in program\, so an extracted copy relies on a system-installed VC++ 14.x runtime (inference from installer script plus TDF wiki note). (https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/scp2/source/ooo/vc_redist.scp)
- [high] PortableApps LibreOffice Portable 26.2.4 x64: Multilingual-All is 281 MB download / 900–1400 MB installed; Multilingual-Standard is 213 MB / 681–800 MB; it runs from any folder. (https://portableapps.com/apps/office/libreoffice_portable)
- [high] -env:<VAR>=<VALUE> sets a bootstrap variable, e.g. -env:UserInstallation=file:///path gives a non-default profile. --accept=pipe,name=X;urp creates a UNO acceptor, and the help warns that API access allows execution of arbitrary commands. (https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/desktop/source/app/cmdlinehelp.cxx)
- [medium] The sal bootstrap reads program\fundamental.override.ini to override bootstrap variables. (https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/sal/rtl/bootstrap.cxx)
- [high] On Windows the default configuration layers include winreg:LOCAL_MACHINE and winreg:CURRENT_USER, so HKLM/HKCU\SOFTWARE\Policies\LibreOffice\<config path> values also apply to any bundled copy. (https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/instsetoo_native/CustomTarget_setup.mk ; https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/configmgr/source/winreg.cxx)
- [high] LibreOffice is released under MPL-2.0; contributions are licensed jointly under MPL-2.0 and LGPLv3+; third-party code carries many other licenses listed in LICENSE. (https://www.libreoffice.org/about-us/licenses/)
- [high] The shipped LICENSE (license.xml) covers GPL-licensed items (poppler, poppler-data, Culmus fonts), Python (PSF), the Microsoft Visual C++ 2015 runtime, and many BSD/LGPL/MPL libraries. (https://raw.githubusercontent.com/LibreOffice/core/master/readlicense_oo/license/license.xml)
- [high] MPL-2.0 §3.2: whoever distributes the executable form must make the source form available and tell recipients how to obtain it at no more than cost. §3.3: a Larger Work may be under any terms. §3.4: license and copyright notices may not be removed. (https://www.mozilla.org/en-US/MPL/2.0/)
- [high] MPL FAQ Q7: redistributing complete, unchanged executables typically requires nothing more if upstream complied, but distributing only some parts may require extra steps to inform users. Q8: tell recipients where the source is. (https://www.mozilla.org/en-US/MPL/2.0/FAQ/)
- [high] TDF Mark Policy permits, without permission, (1) referring to LibreOffice in substantially unmodified form (feature defaults, extensions, fonts and templates allowed) and (2) identifying LibreOffice as a distinct component of a software offering. It forbids marks in an app-store app name, implying greater association, or implying a successor ('LibreOffice++'); 'Bob's LibreOffice' is not allowed. (https://wiki.documentfoundation.org/TDF/Policies/Trademark_Policy)
- [high] Logo Policy: distributors of substantially unmodified binaries may ship the product with the TDF-subline logo inside it (e.g. splash screen); third parties should otherwise use the logo without the TDF subline. (https://wiki.documentfoundation.org/TDF/Policies/Logo_Policy)
- [high] VCLXToolkit::createSystemChild: for SYSTEM_WIN32 (=1) it takes the HWND (any integer type, upcast to sal_Int64), ignores ProcessId, builds SystemParentData{hWnd} and returns a VCLXTopWindow wrapping a WorkWindow. The function is identical on libreoffice-26-8 and master. (https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/toolkit/source/awt/vclxtoolkit.cxx)
- [high] On Windows, a window created from SystemParentData becomes a frame created by CreateChildFrame with the PLUG flag; ImplSalCreateFrame gives PLUG/SYSTEMCHILD frames the WS_CHILD style under the foreign HWND. (https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/vcl/win/window/salframe.cxx ; https://raw.githubusercontent.com/LibreOffice/core/master/vcl/source/window/window.cxx)
- [high] The DevGuide documents createSystemChild as the 'Legal Solution' and xFrame.initialize(xWindow) for manual frames. It notes the child cannot fill the parent automatically on Windows; the bean subclasses the parent WndProc to forward WM_SIZE. (https://wiki.documentfoundation.org/Documentation/DevGuide/Office_Development)
- [high] OfficeBean is still built when Java is enabled (not on macOS/Android) on the 26-8 branch and master. 26.8 removed only the obsolete OfficeBean SDK example and Java applet settings. tdf#170415 (add macOS support to OfficeBean, ASSIGNED, 2026) is open. (https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/bean/Module_bean.mk ; https://wiki.documentfoundation.org/ReleaseNotes/26.8)
- [high] The ActiveX control (Library_so_activex) is still built for Windows/MSVC and is an optional MSI feature, off by default. Its code creates a com.sun.star.frame.Frame on a system-dependent parent window, appends it to Desktop.getFrames(), sets LayoutManager AutomaticToolbars=false, loads with '_self', and registers a dispatch interceptor. (https://raw.githubusercontent.com/LibreOffice/core/master/extensions/source/activex/SOActiveX.cxx ; https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/scp2/source/activex/module_activex.scp)
- [medium] tdf#172048 (NEW, filed on 26.2.3.2, Windows): Writer started and controlled from an external program shows blacked-out areas, flicker and crashes with Skia hardware rendering; a commenter reports forcing raster did not fix it in 26.x. (https://bugs.documentfoundation.org/show_bug.cgi?id=172048)
- [medium] tdf#172304 (NEW, 26.2.3.2): rendering glitches since 26.2 when LibreOffice is started from a Java process (OOoBean embedding or UNO bridge on Windows 11); a standalone launch renders fine. (https://bugs.documentfoundation.org/show_bug.cgi?id=172304)
- [high] Skia is mandatory on Windows/macOS since 26.2; 26.2.5 moved Skia GPU acceleration behind experimental mode. In 26.8, SAL_DISABLESKIA is ignored on Windows, and the render method defaults to raster unless ForceSkiaGPU=true or SAL_SKIA=vulkan. (https://wiki.documentfoundation.org/ReleaseNotes/26.2 ; https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/vcl/skia/SkiaHelper.cxx)
- [high] tdf#145710 (NEW since 2021): LibreOffice apps become blurry when moved to a monitor with different DPI on Windows (not per-monitor DPI aware). (https://bugs.documentfoundation.org/show_bug.cgi?id=145710)
- [medium] Microsoft documents unexpected behavior when parent and child windows run under different DPI-awareness modes; a cross-process SetParent causes a 'Forced reset (of child window's process)'. Applying this to VCL's CreateWindowEx child is an inference. (https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setparent)
- [high] A cross-process parent/child window relationship is legal but implicitly and transitively attaches the two threads' input queues; Raymond Chen calls it very difficult to manage. (https://devblogs.microsoft.com/oldnewthing/20130412-00/?p=4683)
- [high] On Windows, VK_SHIFT/VK_CONTROL/VK_MENU pressed alone produce SalEvent::KeyModChange, which becomes CommandEventId::ModKeyChange, not KEYINPUT. XKeyHandler, via both XUserInputInterception and XExtendedToolkit.addKeyHandler, receives only KEYINPUT/KEYUP, so it never sees a bare Alt. (https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/vcl/win/window/salframe.cxx ; https://raw.githubusercontent.com/LibreOffice/core/master/vcl/source/window/winproc.cxx ; https://raw.githubusercontent.com/LibreOffice/core/master/sfx2/source/view/userinputinterception.cxx)
- [high] XUserInputInterception key handlers run in SfxFrameWindow_Impl::PreNotify, before the view shell's KeyInput and accelerators; returning true consumes the event. Mouse-click handlers run only for the document view window and its children. (https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/sfx2/source/view/frame2.cxx)
- [high] XExtendedToolkit top-window listeners get windowOpened/Closed/Activated/Deactivated/Closing/Minimized/Normalized from VCL WindowShow/Hide/... events for VCL top windows (including LibreOffice's own dialogs). (https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/toolkit/source/awt/vclxtoolkit.cxx)
- [high] XLayoutManager has showElement/hideElement/isElementVisible/lock/unlock/doLayout and setVisible(false), which hides all UI elements. The LayoutManager service exposes MenuBarCloser, AutomaticToolbars, HideCurrentUI and PreserveContentSize; resource URLs include private:resource/menubar/menubar and private:resource/statusbar/statusbar. (https://raw.githubusercontent.com/LibreOffice/core/master/offapi/com/sun/star/frame/LayoutManager.idl ; https://api.libreoffice.org/docs/idl/ref/interfacecom_1_1sun_1_1star_1_1frame_1_1XLayoutManager.html)
- [high] The requested UNO interfaces exist in current IDL with reference pages: XDispatchProviderInterceptor/Interception, XStatusListener + FeatureStateEvent (FeatureURL, IsEnabled, Requery, State), XNotifyingDispatch.dispatchWithNotification, ui.XContextMenuInterceptor.notifyContextMenuExecute, XUserInputInterception, XExtendedToolkit, XModifiable, and XStorable.storeToURL/storeAsURL/store. (https://api.libreoffice.org/docs/idl/ref/interfacecom_1_1sun_1_1star_1_1frame_1_1XDispatchProviderInterceptor.html)
- [medium] Not every UI action goes through the dispatch framework: disabling 'Insert' (sheet) via dispatch still leaves the sheet-tab '+' button and empty-area click working (tdf#36210, NEW). (https://bugs.documentfoundation.org/show_bug.cgi?id=36210)
- [high] /org.openoffice.Office.Commands/Execute/Disabled is a set of nodes, each with a Command property (command name without protocol), that disables those commands in the UI. (https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/officecfg/registry/schema/org/openoffice/Office/Commands.xcs)
- [high] LibreOffice 26.8.0.3 bundles Python 3.13.15 (PYTHON_TARBALL := Python-3.13.15.tar.xz); the libreoffice-26-2 branch bundles Python 3.12.14. (https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26.8.0.3/download.lst ; https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-2/download.lst)
- [high] program\python.exe is a launcher. It sets UNO_PATH (program dir) and URE_BOOTSTRAP=vnd.sun.star.pathname:<program>\fundamental.ini only if they are unset, prepends the program dir to PATH, and sets PYTHONPATH (program; python-core-<ver>\lib; lib\site-packages; plus any existing PYTHONPATH) and PYTHONHOME. It then CreateProcessW-launches python-core-<ver>\bin\python.exe (bInheritHandles=FALSE, no job object) and waits. (https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/pyuno/zipcore/python.cxx)
- [high] LibreOffice's own officehelper.bootstrap() starts soffice with --nologo --nodefault --accept=pipe,name=uno<random>;urp; and connects with retries to uno:pipe,name=...;urp;StarOffice.ComponentContext. (https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/pyuno/source/officehelper.py)
- [high] 26.8 ScriptForge lets Python scripts run as a client of a LibreOffice server over a pipe or socket, with a well-known default pipe name PIPE2LIBREOFFICE. (https://wiki.documentfoundation.org/ReleaseNotes/26.8)
- [high] The UNO pipe acceptor creates \\.\pipe\OSL_PIPE_<userIdent>_<name> with default security attributes and without PIPE_REJECT_REMOTE_CLIENTS. The default named-pipe DACL gives full control to LocalSystem, administrators and the creator owner, and read access to Everyone/anonymous. (https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/sal/osl/w32/pipe.cxx ; https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createnamedpipea)
- [high] The single-instance IPC pipe name is derived from a hash of the user-installation directory, so a separate UserInstallation gives a separate soffice process; a second launch on the same profile forwards to the first. (https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/desktop/source/deployment/misc/dp_misc.cxx)
- [high] soffice.exe launches soffice.bin (handles inherited) and restarts it on restart exit codes; the ATTACHED_PARENT_PROCESSID self-destruct mechanism is set only in --headless mode, so killing soffice.exe does not end soffice.bin. (https://raw.githubusercontent.com/LibreOffice/core/master/desktop/win32/source/loader.cxx)
- [high] LOK is compiled into sofficeapp.dll on WNT builds; lok_init loads sofficeapp.dll/mergedlo.dll in-process; doc_paintTile has a Windows (non-headless) path that copies the rendered bitmap into the buffer. (https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/desktop/Library_sofficeapp.mk ; https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/include/LibreOfficeKit/LibreOfficeKitInit.h ; https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/desktop/source/lib/init.cxx)
- [high] TDF removed JSDialog in commit 8a91868 'drop JSDialog machinery — It's no longer needed and not used internally' (June 2026, −6,437 lines). vcl/jsdialog and LOK sendDialogEvent are absent on libreoffice-26-8/master but present on 26-2 and 25-8. (https://github.com/LibreOffice/core/commit/8a91868)
- [high] The XTiledRenderable UNO interface was removed in 25.8. (https://wiki.documentfoundation.org/ReleaseNotes/25.8)
- [medium] Collabora Office for Windows (CODA-W) runs its JavaScript UI in WebView2 and needs Collabora's own engine build (configure --with-distro=CODAWindows) from their repository; Collabora Online is MPL-2.0. (https://www.collaboraoffice.org/post/build-co-windows/ ; https://www.collaboraonline.com/blog/start-of-automated-testing-of-the-new-collabora-office-on-windows/ ; https://raw.githubusercontent.com/CollaboraOnline/online/main/COPYING)
- [medium] Relations between TDF and Collabora broke down in April 2026, when TDF's Membership Committee removed more than 30 Collabora staff and partners; TDF voted in March 2026 to revive LibreOffice Online. (https://itsfoss.com/news/libreoffice-26-8-release/ ; https://www.theregister.com/software/2026/03/02/libreoffice-online-dragged-out-of-the-attic/4388766)
- [high] 26.8 schema defaults: Security/Scripting MacroSecurityLevel=2 (range 0–3), DisableMacrosExecution=false (when true it disables Basic/BeanShell/JavaScript/Python macros and ignores the level), DisableActiveContent=false; Save/Document WarnAlienFormat=true; Misc ShowTipOfTheDay=true, CrashReport=true, UseSystemFileDialog=true. (https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/officecfg/registry/schema/org/openoffice/Office/Common.xcs)
- [high] VBA options (default true): Writer and Calc Filter/Import/VBA have Load, Executable, Save (Calc also UseExport); Impress has Load and Save. Help: 'Save original Basic code' takes precedence over 'Load Basic code'. (https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/officecfg/registry/schema/org/openoffice/Office/Calc.xcs ; https://help.libreoffice.org/latest/en-US/text/shared/optionen/01130100.html)
- [high] Recovery settings: RecoveryInfo/Enabled=true, AutoSave/Enabled=true, AutoSave/TimeIntervall=10 (minutes, 1–60), AutoSave/UserAutoSaveEnabled=false. Common/Save/Document/AutoSaveTimeIntervall is deprecated. (https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/officecfg/registry/schema/org/openoffice/Office/Recovery.xcs)
- [high] Appearance in 26.8: /org.openoffice.Office.Common/Appearance/ApplicationAppearance (0 = follow system, 1 = light, 2 = dark; default 0) and LibreOfficeTheme (0 disabled / 1 enabled). The schema has no Misc/Appearance key. (https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/officecfg/registry/schema/org/openoffice/Office/Common.xcs)
- [high] Locale keys: Linguistic/General/UILocale (empty = desktop UI language), DefaultLocale, DefaultLocale_CJK, DefaultLocale_CTL; Setup/L10N/ooLocale and ooSetupSystemLocale. The --language={lang} switch applies if no UI language is selected yet. (https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/officecfg/registry/schema/org/openoffice/Office/Linguistic.xcs)
- [high] Setup/Product/WhatsNew=false suppresses both the Welcome/What's New dialog and the infobar. Tip-of-the-day depends on Misc/ShowTipOfTheDay. The WhatsNew, Donate and GetInvolved infobars are gated by /org.openoffice.Office.UI.Infobar/Enabled/<Id>. (https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/sfx2/source/view/viewfrm.cxx ; https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/sfx2/source/dialog/infobar.cxx)
- [high] At startup, the crash-report UI appears only if Misc/CrashReport is true and crash info exists. The recovery UI is suppressed by --norestore/--headless, RecoveryInfo/Enabled=false or OOO_DISABLE_RECOVERY. --norestore disables AutoRecovery entirely. The Start Center is not shown with --nodefault. (https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/desktop/source/app/app.cxx)
- [high] Two updaters: the classic job /org.openoffice.Office.Jobs/Jobs/org.openoffice.Office.Jobs:Job['UpdateCheck']/Arguments/AutoCheckEnabled (default true) and the MAR updater /org.openoffice.Office.Update/Update/Enabled (default true, URL update-mar.libreoffice.org). Since 25.8 the Maintenance Service is registered only when installed under C:\Program Files; tdf#164225 (privilege escalation when installed to a non-default location) is fixed. (https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/extensions/source/update/check/org/openoffice/Office/Jobs.xcu ; https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/officecfg/registry/schema/org/openoffice/Office/Update.xcs ; https://wiki.documentfoundation.org/ReleaseNotes/25.8)
- [high] registrymodifications.xcu format: <oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs=... xmlns:xsi=...> containing <item oor:path="/..."><prop oor:name="X" oor:op="fuse"><value>..</value></prop></item>. (https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/configmgr/source/writemodfile.cxx)
- [high] Configuration layer types include xcsxcu (reads .xcd files plus schema/ and data/ from a URL), res, bundledext, sharedext, userext, winreg (Windows) and user. (https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/configmgr/source/components.cxx)
- [high] LoadReadonly is not a global config key: it is a per-document setting (DocumentSettings 'LoadReadonly', saved in the file). To open read-only, use MediaDescriptor ReadOnly=true in loadComponentFromURL. (https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/sw/source/uibase/uno/SwXDocumentSettings.cxx ; https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/offapi/com/sun/star/document/MediaDescriptor.idl)
- [high] OOXML filter names in 26.8: 'MS Word 2007 XML', 'Calc MS Excel 2007 XML', 'Impress MS PowerPoint 2007 XML'. The default save filter per document type is set with /org.openoffice.Setup/Office/Factories/org.openoffice.Setup:Factory['<service>']/ooSetupFactoryDefaultFilter. (https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26-8/filter/source/config/fragments/filters/MS_Word_2007_XML.xcu)
- [high] Electron BaseWindow.getNativeWindowHandle() returns a Buffer holding the HWND on Windows; hookWindowMessage (Windows-only) lets the main process observe WndProc messages. (https://www.electronjs.org/docs/latest/api/base-window)
