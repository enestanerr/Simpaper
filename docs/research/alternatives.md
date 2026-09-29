# Alternatives to building on LibreOffice (Collabora CODA, ONLYOFFICE/Euro-Office, other OSS engines) and product-name conflicts

> Research notes of 2026-09-28 on alternatives to building on LibreOffice and product-name conflicts, prepared before the architecture decision and published
> with details about the research machine removed. Findings age quickly: check the linked sources before relying
> on a version number, a price, a bug status or a release date. Decisions are recorded in [docs/adr](../adr/README.md).

## Summary
**Bottom line.** Nothing I found in Sept 2026 displaces an **unmodified, bundled LibreOffice** as the engine for priorities 1–3.
- **Collabora's new desktop app (CODA)** shows a different way to embed the engine: a web UI with LibreOfficeKit (LOK) running in the same process. But its binaries can't be redistributed, and its source means compiling a LibreOffice-sized engine.
- **ONLYOFFICE / Euro-Office** is the only alternative with a (reputed) better OOXML fidelity. It forces AGPL-3.0 plus attribution on the whole app, and its Windows source build is heavy and poorly documented.
- **Everything else** either can't really edit and save DOCX/XLSX/PPTX, doesn't ship for Windows, or is proprietary.
- **Names:** Folyo, Pusula, Defter and Kalem collide badly. I propose **Varak**, **Tezhip** and **Tomar**.

**Engine version notes.**
- The stock LibreOffice 26.2.6 `mergedlo.dll` contains the `libreofficekit_hook`/`_2` entry points, and Python 3.12 with pyuno is bundled.
- **Data-integrity point:** LibreOffice 26.8 added preservation of Excel's newer chart types (waterfall, treemap, funnel, etc.) when a file is opened and re-saved. 26.2 predates that.

**1. Collabora**
- **Status:** the new "Collabora Office" desktop app first shipped on 2025-11-26. Version 26.04 shipped on 2026-07-01 and is described as "not yet enterprise-supported".
- **How it works on Windows (CODA-W):** the JavaScript UI runs in WebView2, the engine runs in the same process, and automated testing started in March 2026.
- **Platforms:** Windows via the Microsoft Store (MSIX) only, macOS via the App Store, Linux via Flathub and Snap. GitHub releases contain only helm charts.
- **License:** the source is primarily MPL-2.0. Collabora's own executables are distributed "with additional conditions under a proprietary license" (MPL §3.2(b)). Modified builds must remove every Collabora trademark.
- **Building on Windows:** the former Collabora core is the `engine/` folder of the `online` monorepo, so a full engine compile is required. That needs VS 2026, MSYS2, Strawberry Perl and Node. The build has `APP_NAME`/`VENDOR` variables for branding.
- **Reusing its browser UI:** legally fine under MPL once the trademarks are removed. Technically it is tied to Collabora's kit and engine protocol; it has not been shown to work against upstream LibreOffice (inference).
- **Verdict:** use it as a reference design, not as a base.

**2. ONLYOFFICE and Euro-Office**
- **License change:** the license is AGPL-3.0. On 2026-05-06 and 05-14 ONLYOFFICE restructured its additional terms and **dropped the "retain the original logo" clause**. The current terms require:
  - keeping all notices;
  - marking modifications with dates and saying the product is based on ONLYOFFICE (Ascensio System SIA);
  - showing legal notices in the UI;
  - no trademark rights are granted;
  - non-code assets such as icons and illustrations are CC BY-SA 4.0.
- **Conflict:** ONLYOFFICE's License FAQ **still says the logo may not be removed**.
- **Euro-Office dispute timeline:**
  - 2026-03-27: the fork launches and strips ONLYOFFICE's extra terms.
  - 03-30/31: ONLYOFFICE calls it copyright infringement and suspends its Nextcloud partnership.
  - 04-15: the FSF says the logo term is a "further restriction" that recipients may remove.
  - 08-18: Nextcloud says Euro-Office will adopt ONLYOFFICE's new license.
- **Euro-Office status:** the server product is at v9.3.4-hotfix.1, with v9.3.5-rc.1 on 09-28. The desktop app has **no releases yet**; it was announced on 09-16 for "the coming weeks".
- **Build:** ONLYOFFICE's build_tools documents Linux only (reference machine: 8 GB RAM, 100 GB SSD). Windows defaults to VS2019 and is undocumented; the GitHub issue asking for Windows instructions has been open since 2020.
- **Binaries:** v9.4.0 has Windows installers, but it is a Qt + Chromium Embedded Framework (CEF) app, not something we can embed.
- **Fidelity:** reputedly the best open-source OOXML fidelity because OOXML is its native model. I found no rigorous independent benchmark (low confidence).
- **Rebranding:** allowed without ONLYOFFICE trademarks, as long as attribution stays.

**3. Others**
- **Calligra** (GPL): DOCX import and export exist, but XLSX and PPTX are import-only. No official Windows build. Reject.
- **AbiWord / Gnumeric** (GPL): Windows builds discontinued. Word processor or spreadsheet only. Reject.
- **Apache OpenOffice** (Apache-2.0): no OOXML export (medium confidence). Reject.
- **WPS Office / SoftMaker FreeOffice:** proprietary. FREEOFFICE is a live US trademark (Reg. 4,024,688) covering word-processing and spreadsheet software.
- **Univer** (Apache-2.0): XLSX/DOCX import and export are only in the paid Pro edition.
- **BetterOffice** (Apache-2.0): Rust/WASM, still at 0.1–0.2 beta, fidelity unverified.
- **office_oxide:** a library, not an editor.

**5. Names**
- **Very high risk:** **Folyo** reads the same as "Folio Office", an Electron offline office suite for Windows (Apache-2.0, updated Sept 2026). **Pusula**: "Pusula Ofis" is a Turkish IT firm that sells e-invoice and e-Defter services.
- **High risk:** **Defter** (several note-taking apps plus Turkey's official e-Defter system). **Kalem** (Kalem Yazılım, a Turkish software firm, and Kalem Ofis).
- **Medium–high:** **Katip** (Kâtip legal and document software with Turkish/English UI; Haskell `katip`). **Ream** (reamdocs contract software; `ream` Vue framework).
- **Least bad of the eight:** **Ebru** and **Nar**. Neither has an office-suite collision, but both have same-name Turkish software firms and weak distinctiveness.
- **Proposals** (no software collisions found on the web or GitHub; `X-office` .com/.org domains have no DNS; GitHub handles free):
  1. **Varak** — Ottoman Turkish for a sheet or leaf of paper, also "gold leaf".
  2. **Tezhip** — the art of manuscript illumination.
  3. **Tomar** — a roll or scroll of paper.
- A formal search of the Turkish, EU, WIPO and US trademark registers in classes 9 and 42 has not been done yet and is required before launch.

## Tables
### Engine alternatives

| Option | License & distribution constraints | DOCX/XLSX/PPTX editing fidelity | Windows build/bundle without compiling a huge C++ codebase | Rebranding / original UI | Verdict |
|---|---|---|---|---|---|
| **Unmodified LibreOffice (current plan)** | MPL-2.0 (plus third-party licenses). Unmodified binaries can be redistributed. TDF trademarks: don't use "LibreOffice" in our product name; say "includes/based on" | Full open/edit/recalc/save for all three. Good, but reputedly behind ONLYOFFICE on complex OOXML layout (low–med). 26.8 preserves newer Excel chart types (chartex) it can't render; 26.2 doesn't | **Yes.** Official MSI extracted to an admin image (about 1.6 GB). Bundled Python + pyuno. LibreOfficeKit (LOK) entry points present | Own Electron shell and ribbon. The embedded LibreOffice window shows LibreOffice's own UI, unless we render LOK tiles under our own UI | **Keep as primary** |
| **Collabora Office desktop (CODA / CODA-W)** | Source MPL-2.0. Collabora's executables carry proprietary conditions (MPL §3.2(b)). Modified builds must strip all Collabora marks. Windows: Microsoft Store only | LibreOffice-lineage engine (Collabora branch), roughly like LibreOffice | **No.** The `engine/` core must be compiled (VS 2026 + MSYS2 + Perl + Node). No redistributable binaries | Legal after removing marks (`APP_NAME`/`VENDOR` build variables). Its tabbed web UI (MPL) is usable only with Collabora's kit and engine | **Reference design only** (web UI + in-process LOK in WebView2) |
| **ONLYOFFICE Desktop Editors** | AGPL-3.0, so the whole app becomes AGPL. Since May 2026: keep notices, mark changes as "based on ONLYOFFICE", show UI notices, no trademark rights, icons CC BY-SA 4.0. FAQ still demands the logo (conflict) | Best open-source OOXML fidelity by reputation; OOXML is its native model (low–med, no rigorous benchmark) | **Partly.** Prebuilt Windows installers (v9.4.0) are Qt + CEF apps, not embeddable. Source build documented for Linux only (100 GB reference); Windows undocumented (VS2019 / Qt5 / CEF). Reusing it in Electron means re-implementing the desktop JS bridge and shipping the x2t converter (inference) | Rebranding allowed without ONLYOFFICE marks, with attribution. Our own ribbon on its JS editor core is a large job | **Only serious alternative**, and only if AGPL is acceptable |
| **Euro-Office** | AGPL-3.0 fork (IONOS, Nextcloud, Proton…). Aligning with ONLYOFFICE's new terms (Aug 2026) | Same as ONLYOFFICE 9.3 | **No, today.** No desktop releases. `build.ps1` needs VS 2022 + v141 + Cygwin + vcpkg | Already de-branded; AGPL | **Monitor**; reassess when the desktop app ships |
| **Calligra** | GPL-2.0-or-later; distributed via Flathub/AppStream | DOCX import and export; XLSX/PPTX import-only | No official Windows build; Qt6/KF6 C++ | n/a | **Reject** |
| **AbiWord / Gnumeric** | GPL | Partial DOCX; Gnumeric's XLSX write incomplete; no presentations | Windows builds discontinued | n/a | **Reject** |
| **Apache OpenOffice** | Apache-2.0 | OOXML import only; cannot save DOCX/XLSX/PPTX (medium) | Prebuilt, but low activity | n/a | **Reject** |
| **WPS Office / SoftMaker FreeOffice** | Proprietary EULAs. FREEOFFICE is a live US trademark (4,024,688) | Good, but proprietary | Not allowed | Not allowed | **Excluded**; also avoid the name |
| **Univer / BetterOffice (web-native)** | Apache-2.0. Univer's import/export is paid Pro only. BetterOffice is 0.x beta | Immature / unverified | Easy (JS/WASM) | Easy | **Not an engine** (maybe for previews/tests) |

### Name check

| Name | Collisions found (web / GitHub / same market) | Risk | Rank (given 8) |
|---|---|---|---|
| Ebru Office | No office suite. EbruSoft Yazılım (Ankara), Ebru Technologies AS (NO), Ebru painting app. Common first name | Low–med | 1 |
| Nar Office | No office suite. Nar Bilişim, NAR-SOFT, Nar Software (Turkish IT firms). Poor searchability | Medium | 2 |
| Ream Office | Ream contract/e-sign SaaS; `ream/ream` Vue 3 framework (585★). Pronounced differently in Turkish | Med–high | 3 |
| Katip Office | Kâtip legal and document software (TR/EN); Haskell `katip` (215★) | Med–high | 4 |
| Kalem Office | Kalem Yazılım (Turkish software firm); Kalem Ofis (office supplies) | High | 5 |
| Defter Office | Defter Notes, Defter: Simple Notes, defter.app; Turkey's official e-Defter | High | 6 |
| Pusula Office | "Pusula Ofis Sistemleri Bilişim" sells e-Fatura/e-Defter services; Pusula Yazılım | Very high | 7 |
| Folyo Office | "Folio Office": Electron offline doc/sheet/slide suite for Windows (same sound, same category); Folyo AI workspace | Very high | 8 |
| **Varak** (proposed #1) | No software found. Catering (EG) and confectionery (IN) only. varak.com/.app taken; varakoffice.com/.org no DNS; github.com/varak-office free | Low | – |
| **Tezhip** (proposed #2) | No software found. tezhip.com (parked) and .org taken; tezhip.app and tezhipoffice.com/.org no DNS; github.com/tezhip free | Low | – |
| **Tomar** (proposed #3) | No software found. City, surname, Spanish verb. tomar.app taken; tomaroffice.com/.org no DNS; github.com/tomar-office free | Low–med | – |

## Risks
- Going from 26.8 back to 26.2 loses 26.8's preservation of newer Excel chart types (waterfall, treemap, funnel, etc.) on re-save. That is a data-integrity regression (priority 2) and the version choice should be made deliberately.
- Disk space: building any alternative engine from source needs tens of gigabytes (Collabora's engine; ONLYOFFICE's reference build machine has a 100 GB SSD; Euro-Office), far more than bundling a prebuilt LibreOffice.
- ONLYOFFICE legal ambiguity: the LICENSE files (May 2026) no longer require keeping the logo, but the License FAQ still forbids removing it, and Ascensio publicly accused Euro-Office of infringement. Adopting its code also means AGPL-3.0 for the whole app (including network-use obligations) and CC BY-SA 4.0 for its icons and illustrations.
- Collabora's Windows app is Store-only and ships under proprietary conditions, so it can't be bundled or rebranded. Our own build would have to strip every Collabora mark, and its web UI is tied to Collabora's kit/engine protocol.
- LibreOfficeKit on stock Windows LibreOffice: the entry points exist, but it is far less exercised upstream than in Collabora's engine (inference). Collabora's web UI has not been shown to work against unmodified LibreOffice. Prove this in the feasibility spike before relying on it.
- Web-native engines (Univer, BetterOffice) make fidelity claims that are unverified. Univer's file import/export is commercial-only, and BetterOffice is 0.x beta.
- Name-check limits: only web, GitHub and DNS were searched. No Turkish (TÜRKPATENT), EU (EUIPO/TMview), WIPO or US register word search was done, apart from the USPTO FREEOFFICE record. Common Turkish words are weakly distinctive in classes 9/42. No DNS record does not prove a domain is available. Microsoft Store app names must be unique.
- Using 'Office' in the name: Microsoft's guidelines forbid Microsoft brand assets in third-party product names. Whether 'Office' alone is claimed was not verified. Never use Word/Excel/PowerPoint/365/Microsoft in product or module names.
- Office-like ribbon: Microsoft historically ran a licensing program for the Office UI. Its current status was not researched (low confidence); check it before closely mimicking MS Office visuals.
- Euro-Office and Collabora's desktop app are moving quickly (release candidates in Sept 2026), so these conclusions may date within weeks.

## Recommendation
1) Keep the unmodified, bundled LibreOffice engine (MPL-2.0). It is the only option that meets priorities 1–3 with prebuilt, redistributable Windows binaries, no C++ compile, and a disk footprint that fits.
- Re-decide 26.2.6 vs 26.8.x explicitly: 26.8 keeps newer Excel chart types intact on round-trips.

2) Use Collabora's desktop app as the reference design, not as a base. In the feasibility spike, test LibreOfficeKit tiled rendering against the stock 26.x `mergedlo.dll` as a fallback to the native-window (createSystemChild) embedding. Do not plan on Collabora's binaries or on building its engine.

3) Keep ONLYOFFICE / Euro-Office as the only fidelity-driven Plan B. Adopt it only if the project accepts AGPL-3.0 for the whole app plus ONLYOFFICE attribution. Reassess when Euro-Office's desktop app ships.

4) Reject Calligra, AbiWord/Gnumeric, Apache OpenOffice, WPS, FreeOffice, Univer and BetterOffice as engines.

5) Naming:
- Never ship as "FreeOffice" or "Free Office" (live SoftMaker trademark covering office software). The folder name is fine internally.
- Drop Folyo, Pusula, Defter and Kalem; avoid Katip and Ream.
- Preferred: **Varak** ("Varak Office" / "Varak Ofis"), then Tezhip, then Tomar.
- Before announcing:
  - run register searches (TÜRKPATENT, EUIPO/TMview, WIPO Global Brand Database, USPTO) in classes 9 and 42;
  - secure the GitHub org (varak-office) and domains (varakoffice.org/.com).

## Facts
- [high] Collabora released its first new desktop app (Collabora Online UI on desktop) on 2025-11-26 for Windows, macOS and Linux; the initial release had no enterprise support. (https://www.collaboraonline.com/blog/collabora-online-now-available-on-desktop/)
- [high] Collabora Office 26.04 was released 2026-07-01; Windows via Microsoft Store (APPX/MSIX), macOS App Store, Linux Flathub/Snap; free; 'this is not yet enterprise-supported software'; runs the engine in-process. (https://www.collaboraonline.com/blog/collabora-office-26-04-release/)
- [high] CODA-W (Collabora Office on Windows) runs its JavaScript UI in WebView2; C#/Selenium automated testing started 2026-03-31. (https://www.collaboraonline.com/blog/start-of-automated-testing-of-the-new-collabora-office-on-windows/)
- [high] Collabora Online source is primarily MPL-2.0 (COPYING = MPL 2.0); development moved to Gerrit; the GitHub mirror contains engine/, browser/, windows/, macos/, qt/, wasm/, kit/, wsd/. (https://github.com/CollaboraOnline/online.mirror ; https://raw.githubusercontent.com/CollaboraOnline/online/master/COPYING)
- [high] Building Collabora Office for Windows requires Visual Studio 2026 (C++ and .NET workloads), MSYS2, Strawberry Perl and Node.js LTS; the former Collabora Office core is the engine/ subdirectory of the online monorepo (full engine build); branding variables APP_NAME/VENDOR/INFO_URL exist. (https://www.collaboraoffice.org/post/build-co-windows/)
- [high] Collabora Online source is under MPLv2, but 'Executable Forms ... are distributed with additional conditions under a proprietary license' (MPL 3.2(b)). (https://www.collaboraonline.com/terms/collabora-online-mplv2/)
- [high] Collabora trademark policy: when distributing modified software 'you must remove all trademark uses of the Marks'; the marks include Collabora, Collabora Office, Collabora Online, CODE. (https://www.collaboraonline.com/trademark-policy/)
- [medium] CollaboraOnline/online GitHub releases currently contain helm charts only (no desktop binaries); a Collabora staff member said in April 2025 that Windows desktop builds are distributed through the Microsoft Store with no direct .msi/.exe. (https://github.com/CollaboraOnline/online/releases ; https://forum.collaboraonline.com/t/collabora-office-on-windows-without-paying-microsoft/3619)
- [high] Upstream LibreOfficeKitInit.h (MPL-2.0) supports Windows: it loads sofficeapp.dll / mergedlo.dll with LoadLibraryW and resolves libreofficekit_hook / libreofficekit_hook_2. (https://raw.githubusercontent.com/LibreOffice/core/master/include/LibreOfficeKit/LibreOfficeKitInit.h)
- [high] The stock LibreOffice 26.2.6 mergedlo.dll (142 MB) contains the strings libreofficekit_hook and libreofficekit_hook_2; bundled python.exe (python-core-3.12.14), pyuno.pyd and uno.py are present. (program/mergedlo.dll of the 26.2.6 administrative image)
- [high] LibreOffice 26.8 recognizes chartex charts (box-and-whisker, funnel, Pareto, radial, treemap, waterfall), cannot display/edit them, but preserves the definition unchanged and rewrites it on save. (https://blog.documentfoundation.org/blog/2026/09/17/libreoffice-26-8-and-interoperability/)
- [medium] LibreOffice 26.2.x lacks this chartex round-trip preservation (it is described as new in 26.8). (https://blog.documentfoundation.org/blog/2026/09/17/libreoffice-26-8-and-interoperability/)
- [medium] BLFS estimates a LibreOffice 26.8.0 Linux source build at 7.6 GB disk (with system libraries); Windows builds bundle externals so need more (inference). (https://www.linuxfromscratch.org/blfs/view/svn/xsoft/libreoffice.html)
- [high] ONLYOFFICE DesktopEditors LICENSE was updated 2026-05-06 and 2026-05-14 ('Update LICENSE with restructured AGPLv3 additional terms'); sdkjs LICENSE updated 2026-05-14. (https://api.github.com/repos/ONLYOFFICE/DesktopEditors/commits?path=LICENSE ; https://api.github.com/repos/ONLYOFFICE/sdkjs/commits?path=LICENSE.txt)
- [high] Current ONLYOFFICE additional terms: retain all notices; modified versions must carry prominent modification notices with dates and state they are based on ONLYOFFICE by Ascensio System SIA; UIs must show Appropriate Legal Notices identifying ONLYOFFICE as original developer; no trademark rights; non-code elements (illustrations, icon sets, technical writing) are CC BY-SA 4.0. No logo-retention clause remains. (https://raw.githubusercontent.com/ONLYOFFICE/DesktopEditors/master/LICENSE)
- [high] ONLYOFFICE sdkjs source headers now read 'SPDX-License-Identifier: AGPL-3.0-only' with no Section 7(b) logo sentence. (https://raw.githubusercontent.com/ONLYOFFICE/sdkjs/master/word/Editor/Document.js)
- [high] ONLYOFFICE License FAQ still states: 'We do not allow you to remove the original ONLYOFFICE logo from ONLYOFFICE products and components or change it to your own one.' (https://www.onlyoffice.com/license-faq)
- [high] ONLYOFFICE blog (2026-05-20): modified versions cannot use ONLYOFFICE as their name, must state they are modified; White Label requires a paid Developer license. (https://www.onlyoffice.com/blog/2026/05/onlyoffice-license-and-trademark-policy)
- [high] ONLYOFFICE build_tools README documents Linux builds only (tested Ubuntu 24.04, 4 cores, 8 GB RAM, 4 GB swap, 100 GB SSD). (https://github.com/ONLYOFFICE/build_tools)
- [high] build_tools defaults Windows builds to Visual Studio 2019 (2015 for XP targets). (https://raw.githubusercontent.com/ONLYOFFICE/build_tools/master/scripts/config.py)
- [high] build_tools issue #105 'Add proper build instruction for windows' has been open since 2020-05-14. (https://github.com/ONLYOFFICE/build_tools/issues/105)
- [high] ONLYOFFICE DesktopEditors v9.4.0 (2026-05-19) ships Windows x64/x86/arm64 .exe and .msi (x64 exe 356.4 MB, msi 587.3 MB). (https://api.github.com/repos/ONLYOFFICE/DesktopEditors/releases)
- [medium] ONLYOFFICE desktop-sdk contains a 'ChromiumBasedEditors' tree (Chromium/CEF host); core (C++, AGPL-3.0) provides the x2t converter used by Desktop Editors and Document Server. (https://github.com/ONLYOFFICE/desktop-sdk ; https://github.com/ONLYOFFICE/core)
- [medium] Euro-Office (IONOS, Nextcloud, XWiki, OpenProject and others) launched 2026-03-27 as an ONLYOFFICE fork and removed the licensing addenda; ONLYOFFICE called it a violation on 03-30 and suspended the Nextcloud partnership on 03-31. (https://en.wikipedia.org/wiki/Euro-Office)
- [high] ONLYOFFICE CEO: 'The Euro-Office project is currently infringing on our copyright in a deliberate and unacceptable manner' (Computerworld, 2026-04-02). (https://www.computerworld.com/article/4153893/onlyoffice-accuses-euro-office-of-licensing-violations-suspends-nextcloud-partnership.html)
- [high] FSF (2026-04-15): the obligation to 'retain the original Product logo' is not included in Sec. 7(b) and is a further restriction that recipients may remove. (https://www.fsf.org/blogs/licensing/agpl-is-not-a-tool-for-taking-freedom-away)
- [high] Nextcloud (edit 2026-08-18): ONLYOFFICE shared a proposal with license changes on GitHub; Euro-Office will update its code and license headers to match the new license. (https://nextcloud.com/blog/euro-office-license-compliance-and-what-open-source-means/)
- [high] Euro-Office DocumentServer releases: v9.3.1 (Jun 9), v9.3.4 (Aug 25), v9.3.4-hotfix.1 (Aug 28), v9.3.5-rc.1 (Sep 28, 2026). (https://github.com/Euro-Office/DocumentServer/releases)
- [high] Euro-Office DesktopEditors has no releases; its Windows build (build.ps1) needs VS 2022 + v141 toolset, Windows 10 SDK, ATL/MFC, CMake, Ninja, perl/python/git, Cygwin and vcpkg. (https://github.com/Euro-Office/DesktopEditors/releases ; https://github.com/Euro-Office/DesktopEditors/tree/main/build/windows)
- [medium] Nextcloud announced on 2026-09-16 that the Euro-Office desktop app (Windows x64/ARM64, Linux, macOS ARM64) will be downloadable 'in the coming weeks'. (https://www.tech2geek.net/euro-office-desktop-app-windows-linux-macos/)
- [medium] Calligra: GPL-2.0-or-later; latest 26.08.1 (2026-09-10); install options listed are Discover/AppStream and Flathub (no Windows). (https://apps.kde.org/calligra/)
- [medium] Calligra filters: words/docx has import and export subdirectories; sheets xlsx is gated by SHOULD_BUILD_FILTER_XLSX_TO_ODS and stage pptx by SHOULD_BUILD_FILTER_PPTX_TO_ODP (import-only). (https://invent.kde.org/office/calligra/-/raw/master/filters/words/docx/CMakeLists.txt ; https://invent.kde.org/office/calligra/-/raw/master/filters/sheets/CMakeLists.txt ; https://invent.kde.org/office/calligra/-/raw/master/filters/stage/CMakeLists.txt)
- [medium] AbiWord: GPL-2.0-or-later, 3.0.8 (2026-02-18); Windows development ended (last 2.8.6 / 2.9.4 beta); partial DOCX import/export. (https://en.wikipedia.org/wiki/AbiWord)
- [high] Gnumeric: 'We do not currently release or distribute Windows binaries'; latest source 1.12.62. (https://gnome.pages.gitlab.gnome.org/gnumeric-web//download.html)
- [medium] Apache OpenOffice (Apache-2.0) can import but not export OOXML (DOCX/XLSX/PPTX). (https://forum.openoffice.org/en/forum/viewtopic.php?t=13858)
- [medium] WPS Office is proprietary; its EULA prohibits redistribution outside the agreement. (https://www.wps.com/eula/)
- [high] SoftMaker FreeOffice is proprietary freeware ('free for personal and business use'); FREEOFFICE is a live US registration No. 4,024,688 (2011-09-13) owned by SoftMaker Software GmbH, classes 9/38/42 incl. word processing and spreadsheet software. (https://www.freeoffice.com/en/ ; https://tsdr.uspto.gov/statusview/sn79090774)
- [high] Univer (Apache-2.0): Sheets most mature; import/export, print, charts, pivot tables are Univer Pro (commercial) features. (https://github.com/dream-num/univer)
- [medium] BetterOffice (openooxml): Apache-2.0 Rust/WASM OOXML engines, beta versions DOCX 0.2.1, XLSX 0.2.1, PPTX 0.1.1, ~255 stars; fidelity claims unverified. (https://github.com/openooxml/betteroffice)
- [medium] office_oxide is an MIT/Apache Rust library for programmatic OOXML read/write/edit, not an interactive editor. (https://github.com/yfedoseev/office_oxide)
- [medium] TDF trademark policy: modified software should be described as 'based on'/'derivative of' LibreOffice; unmodified binaries may be distributed. (https://wiki.documentfoundation.org/TDF/Policies/Trademark_Policy)
- [high] Microsoft brand guidelines: 'Don't use Microsoft's Brand Assets in the name of your business, product, service, app...'. (https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks)
- [high] 'Folio Office' is an Apache-2.0 Electron offline desktop suite for documents, spreadsheets, presentations (Windows tested; DOCX/XLSX/PPTX conversion), updated 2026-09-12; 'Folyo' is also an AI writing/planning workspace. (https://github.com/shrishmanglik/folio-office ; https://folyoai.com/)
- [high] Pusula Ofis Sistemleri Bilişim (Turkey) sells Canon office systems and provides e-Fatura, e-İmza, e-Defter, e-Arşiv services; Pusula Yazılım offers corporate business software. (https://www.pusulaofis.com.tr/ ; https://www.pusulayazilim.com.tr/)
- [high] Kâtip is an AI legal-practice management product with document generation/management, full Turkish and English support; Soostone/katip is a 215-star Haskell logging library. (https://www.katiplegal.com/ ; https://github.com/Soostone/katip)
- [high] 'Defter' is used by several productivity apps: Defter Notes (iPad), Defter: Simple Notes, defter.app. (https://defternotes.com/ ; https://www.defter.app/ ; https://apps.apple.com/bb/app/defter-simple-notes/id1662311843)
- [high] Kalem Yazılım is a Turkish software company (retail/POS/ERP, Logo partner); Kalem Ofis is an office-supplies brand. (https://kalemyazilim.com/en/contact/ ; https://www.kalemofis.com/)
- [medium] Ream: reamdocs.com markets contract drafting/e-sign software; ream/ream is a 585-star Vue 3 framework. (https://reamdocs.com/ ; https://github.com/ream/ream)
- [medium] No office suite named Nar Office or Ebru Office was found; Turkish IT firms named Nar (Nar Bilişim, NAR-SOFT, Nar Software) and EbruSoft Yazılım exist. (https://www.nar-soft.com/ ; https://narsoftware.com/ ; https://www.kariyer.net/firma-profil/ebrusoft-yazilim-elektronik-ltd-sti-136302-61050)
- [medium] On 2026-09-28 naroffice.com, ebruoffice.com, pusulaoffice.com, katipoffice.com, folyooffice.com, reamoffice.com, defteroffice.com, kalemoffice.com, varakoffice.com/.org, tomaroffice.com/.org, tezhipoffice.com/.org and tezhip.app returned no NS records; varak.com, varak.app, tomar.app, tezhip.com, tezhip.org, yazman.com are registered. (DNS lookups with Resolve-DnsName)
- [medium] No software/office product named Varak, Tezhip or Tomar was found (Varak = Egyptian catering company and Indian confectionery; Tomar = city/surname); GitHub handles varak-office, tezhip and tomar-office return 404. (https://www.facebook.com/VarakEG/ ; https://github.com/varak-office ; https://github.com/tezhip ; https://github.com/tomar-office)
- [medium] 'Yazman' was considered and rejected: alpozcan/yazman (Turkish writing checker) and edukah/yazman (JS WYSIWYG editor) exist. (https://github.com/alpozcan/yazman ; https://github.com/edukah/yazman)
