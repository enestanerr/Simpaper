# ADR 0009: Product name — "Simpaper"

- **Status:** Accepted (supersedes [ADR 0007](0007-product-name.md))
- **Date:** 2026-09-30
- **Related:** `src/shared/brand.ts`, `electron-builder.yml`, `build/installer.nsh`, [ADR 0006](0006-license.md),
  [ADR 0010](0010-file-associations.md)

## Context

ADR 0007 chose "Varak" as a working name and asked for a trademark search, a GitHub organisation and domains
before the first public release. None of that had happened when the owner decided on a different name,
**Simpaper**, and on the public repository https://github.com/ncreativestudios/Simpaper (2026-09-30). Nothing
had been released under the old name; the only installation was the owner's own test install.

A read-only name check was run on 2026-09-30 (web, app stores, package registries and trademark registers, each
with a control query that did return results). It is **not** a legal clearance:

- **Software:** no software, app or package called Simpaper was found (Microsoft Store, Apple App Store, Google
  Play, npm, PyPI, Chocolatey; the GitHub user name `simpaper` is free). The spelling "SimPaper" is used by two
  unrelated academic projects (a research-paper recommender and a simulation study).
- **Trademarks:** no mark "Simpaper" or a close spelling in the USPTO or in TMview (EUIPO and the national offices
  including TÜRKPATENT; filters TR, EM, WO, US, BR and RO). The closest marks are "Simple ePaper" (German mark,
  class 9, an enterprise PDF reader) and "SimplePaper" / "Simply Paper" (paper goods, classes 16 and 41).
- **Other uses:** an Indonesian online paper store (simpaper.id), a Brazilian stationery shop on Instagram and a
  Romanian paper distributor, all selling physical paper.
- **Domains:** simpaper.com belongs to a third party and is parked for sale; simpaper.app, .dev, .net, .io, .co,
  .com.tr and .tr were not registered on the day of the check.

## Decision

- The product is called **Simpaper**, written exactly like that everywhere (not "SimPaper"). In Turkish the name
  is pronounced "simpeypır" and takes back-vowel suffixes: Simpaper'ı, Simpaper'ın, Simpaper'a, Simpaper'da,
  Simpaper'dan, Simpaper'la.
- The identity stays in one place, `src/shared/brand.ts`; `electron-builder.yml` and `build/installer.nsh` mirror
  it and `tests/unit/main/fileAssociations.test.ts` checks that they match:
  - application id (AppUserModelID, electron-builder `appId`): **`io.github.ncreativestudios.simpaper`**, which
    uses the GitHub account the project lives under instead of a domain nobody owns;
  - data folders `%APPDATA%\Simpaper` and `%LOCALAPPDATA%\Simpaper` (development runs: `Simpaper-dev`);
  - `Simpaper.exe`, `Simpaper-Setup-<version>-x64.exe`, `Simpaper-<version>-x64.zip`, installed to
    `%LOCALAPPDATA%\Programs\Simpaper`;
  - the name under `Software\RegisteredApplications` (`BRAND.registeredAppName`) and the ProgIDs
    `Simpaper.<format>` of [ADR 0010](0010-file-associations.md). These two never change again, because the users'
    default-app choices point at them.
- Internal names follow the product name as well: the `SIMPAPER_*` environment variables, the `simpaper_bridge`
  Python package, the `simpaper.log` log file, the `window.simpaperIpc` bridge and the markers Simpaper writes into
  files (`.~simpaper-…` save siblings, `/SimpaperAP` in PDF appearance streams). The CSS prefixes `vr-` and `vpdf`
  stay: they never reach users or files.
- Files written by the development builds under the old name keep working: `/VarakAP` appearance streams are still
  recognised as Simpaper's own, and `.~varak-…` leftovers of an interrupted save are still cleaned up.
- The logo and the module icons stay as they are: a sheet of paper with leaf-shaped corners and a gilded edge
  suits "simple paper" as well. The explanation of the old name was removed from the artwork's comments.
- Everything else in ADR 0007 still applies: descriptive, translated module names; never "FreeOffice" or
  Microsoft or LibreOffice marks in names; engine attribution as text only.

## Alternatives considered

| Alternative | Why not chosen |
|---|---|
| Keep "Varak" | The owner chose Simpaper; the formal search and the organisation of ADR 0007 had not been done yet |
| "SimPaper" (camel case) | Used by two unrelated academic projects; "Simpaper" matches the repository |
| Keep the old application id `org.varakoffice.varak` | Implies a domain nobody registered, and it would keep the old name in shortcuts and in the installer GUID |
| `com.ncreativestudios.simpaper` | Implies a domain that is not registered either |
| Migrate the settings from `%APPDATA%\Varak` | Nothing was released under the old name; only the owner's test installation has such a folder |

## Consequences

- A new application id means a new installer product GUID: Simpaper installs next to an existing Varak test
  installation instead of replacing it. Varak is removed through Settings › Apps; its data folders are not read.
- Screenshots in `docs/screenshots/` were taken before the rename and still show "Varak" in the title bar until
  they are captured again.
- The check above is no trademark clearance. Before a commercial launch: file the name with TÜRKPATENT in Nice
  classes 9 and 42, have a trademark attorney run a clearance search, and register the free domains that are
  wanted (for example simpaper.app and simpaper.com.tr). Indonesian registers were not searched (their public
  database blocks automated queries).
- In English, "simp" is also a slang word; this is a reputation point, not a legal one.
