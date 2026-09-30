# Security policy

Simpaper opens documents that may come from anyone, so we treat every file as untrusted input. Thank you for helping
to keep Simpaper and its users safe.

## Supported versions

Simpaper is in early development and has **no release yet**. Until version 1.0, only the **latest release** receives
security fixes; a fix is always shipped as a new release, never as a patch to an older one.

| Version | Security fixes |
|---|---|
| `main` branch (development) | Yes, fixes land here first |
| Latest release (from v0.1.0 on) | Yes |
| Older releases | No, please update |

## Reporting a vulnerability

**Please do not report security problems in public issues, discussions or pull requests.**

Report them privately through GitHub: open the repository's **Security** tab and choose **Report a
vulnerability**, or go directly to <https://github.com/ncreativestudios/Simpaper/security/advisories/new>. Only the
maintainers can see the report. If you cannot use that form, open a public issue that asks for a private contact,
**without any details**.

Please include:

- the Simpaper version (File → About) or the commit you built, and your Windows version;
- the module (documents, spreadsheets, presentations, PDF, application) and what an attacker can achieve;
- steps to reproduce and, if possible, a **minimal proof-of-concept file that you created yourself**. Never send
  real confidential or personal documents;
- whether you want to be credited, and under which name.

What happens next: Simpaper is maintained by volunteers, so we cannot promise fixed response times. We aim to
acknowledge a report within **7 days** and to send a first assessment within **14 days**. We keep you informed while
we work on a fix, agree on a disclosure date with you, and publish a GitHub security advisory together with the
fixed release. We credit reporters unless they prefer to stay anonymous.

## Scope

In scope, for example:

- **Malicious documents**: a DOCX, XLSX, PPTX, ODF, legacy Office, RTF, CSV or PDF file that, when it is opened,
  displayed, edited, saved, exported or printed in Simpaper,
  - runs code or macros (Simpaper never executes document macros, and PDF JavaScript never runs),
  - reads, writes or deletes files other than the ones the user chose,
  - makes Simpaper or its engine access the network or start programs without an explicit user action,
  - escapes the sandbox of the user interface or abuses its connection to the main process,
  - makes Simpaper overwrite or lose the user's data without the documented warnings (for example by bypassing the
    safe-save verification or the loss-risk warning).
- **Simpaper's own code**: the main process, the preload script and its allow-listed IPC channels, the renderer
  (content security policy, navigation and link handling), the file handling (working copies, safe save, autosave
  and recovery snapshots), the engine bridge (`engine/bridge`) and the engine profile (`engine/profile`).
- **Installation**: the per-user installer and the ZIP, for example files or folders that other users can modify,
  or libraries loaded from unexpected places.

Out of scope:

- attacks that require administrator rights, an already compromised Windows account or physical access;
- the missing code signature and the SmartScreen warning (known; signing is planned, see
  [docs/PACKAGING.md](docs/PACKAGING.md#signing-plan));
- content that is lost in certain file formats as documented in [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)
  (please open a normal issue if it is not documented);
- crashes or slowness with very large files, unless they point to memory corruption or data loss. If you are not
  sure, report privately.

## The engine and other components

Simpaper redistributes an **unmodified LibreOffice** as its document engine, and uses pdf.js, Electron (Chromium) and
npm packages.

- **Vulnerabilities in LibreOffice itself** should also be reported to The Document Foundation's security team:
  `officesecurity@lists.freedesktop.org` (see <https://www.libreoffice.org/security-info/>). Please tell us
  privately as well, especially if Simpaper's configuration makes the problem easier or harder to exploit.
- **pdf.js**: report to Mozilla as described in <https://github.com/mozilla/pdf.js/security/policy>.
- **Electron and Chromium**: see <https://github.com/electron/electron/security/policy>.

### How the engine is kept up to date

- Simpaper pins one exact LibreOffice build in [`scripts/engine/engine.lock.json`](scripts/engine/engine.lock.json).
  Every build downloads it from The Document Foundation and checks its size, SHA-256 digest and OpenPGP signature
  before it is used ([docs/PACKAGING.md](docs/PACKAGING.md)).
- The engine **never updates itself**: LibreOffice's update check, its update service and its crash reporter are
  switched off in the engine profile, and Simpaper downloads nothing at run time. Security fixes for the engine
  therefore reach users **only through a new Simpaper release**.
- The maintainers follow LibreOffice's security advisories (<https://www.libreoffice.org/about-us/security/advisories/>)
  and the release notes of pdf.js and Electron. When a published vulnerability affects the version Simpaper ships,
  the lock file (or the dependency) is updated to a fixed version, the tests are run, and a new Simpaper release is
  published. The changelog names the advisory.

## Privacy by design

These properties are part of Simpaper's design; a way to break them is a security problem:

- **No telemetry**: Simpaper sends no usage data, no crash reports and no document content anywhere. It has no
  accounts and no online features. Links are opened in your web browser only when you click them.
- **Local logs without content**: logs are written to `%LOCALAPPDATA%\Simpaper\logs` and never contain document
  content; they can contain file and folder names.
- **Macros never run**: documents are loaded with macro execution disabled; VBA code is kept where the format
  allows it, but it is not executable. JavaScript in PDFs never runs.
- **No automatic link updates**: the engine loads documents without updating external links.
- **Local working data**: documents are edited as working copies in `%LOCALAPPDATA%\Simpaper\work`, and autosave
  snapshots are stored in `%LOCALAPPDATA%\Simpaper\recovery` (password-protected documents stay password-protected
  in their snapshots). Both are removed when a document is closed normally.
