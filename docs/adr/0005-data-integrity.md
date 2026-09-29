# ADR 0005: Data integrity — working copies, safe save, loss-risk warnings, recovery, no macro execution

- **Status:** Accepted
- **Date:** 2026-09-28
- **Related:** [ARCHITECTURE.md](../ARCHITECTURE.md#5-data-integrity), [ADR 0001](0001-engine.md),
  [COMPATIBILITY.md](../COMPATIBILITY.md), research: [formats](../research/formats.md),
  [corpus](../research/corpus.md), contracts: `src/main/documents/types.ts`, `src/shared/api/documents.ts`,
  `src/shared/api/recovery.ts`

## Context

Stability and data integrity are the second priority, directly after compatibility. The risks are concrete:

- The engine can **silently drop content** when it saves certain formats: slicers, timelines, Power Query,
  the Excel Data Model, the Morph transition, ink, 3D models, macros in DOTM/XLTM/POTM/PPSM; it keeps but cannot
  edit or draw SmartArt and Office 2016+ charts; XLSB cannot be saved at all (see
  [COMPATIBILITY.md](../COMPATIBILITY.md)).
- Engine processes can crash (open upstream bugs when LibreOffice is driven externally), be killed, or hang.
- A save interrupted half-way (power loss, full disk, cloud-sync lock) must never destroy the user's file.
- Documents can contain macros; running them is a security risk.
- LibreOffice's own save path would show its own dialogs ("keep current format") and bypass Varak's checks.

## Decision

1. **Working copy.** When a file is opened, the engine edits a working copy under the user's local app data
   folder; the user's file is only read. All engine save commands are intercepted and routed to Varak.
2. **Safe save pipeline** (`SafeWriter`):
   write to a temporary file in the **same folder** as the target → flush to disk → **verify** (package/zip
   integrity for OOXML and ODF, structure check for PDF, optional re-open in the conversion instance) →
   **atomic replace** with `ReplaceFileW` (keeps the previous file until the new one is in place) →
   clean up. If any step fails, the original file is untouched and the user is told what happened.
   Fault-injection tests prove this (roadmap M1).
3. **Loss-risk warning.** Before writing a format that can lose content, the compatibility analyzer
   (`src/main/compat/`) inspects the original package for parts the engine drops or does not draw (macros,
   SmartArt, chartex, slicers, Power Query, pivot caches, ink, 3D models, legacy binary formats …) and shows what
   is at risk. The user can **save a copy** in a safe format instead of overwriting the original.
4. **Autosave and crash recovery.** Modified documents are snapshotted as ODF recovery files at an interval;
   after an engine crash or an app crash Varak offers to restore them. Killing the engine during editing loses
   at most the autosave interval (acceptance criterion of M1).
5. **Macros are never executed.** Engine profiles set `DisableMacrosExecution=true` and the highest macro
   security level; documents are loaded with macro execution disabled. VBA code is still **loaded and saved** so
   that macro-enabled formats keep their macros where the format allows.
6. **Logs never contain document content**, only technical metadata (`src/main/log.ts`).

## Alternatives considered

| Alternative | Why not chosen |
|---|---|
| Let LibreOffice save directly to the user's file | No verification, no atomic replace, LibreOffice dialogs, no loss analysis |
| Rely only on LibreOffice's AutoRecovery | Recovery UI would appear inside the engine window; not integrated with the working-copy model |
| Always convert to ODF internally | Changes the user's format; many users must deliver OOXML |
| Allow macros with a prompt | Security risk out of scope for an offline suite focused on documents; VBA support in the engine is partial anyway |

## Consequences

- Positive: an interrupted save cannot leave a half-written file; users learn about content that would be lost
  before it is lost.
- Negative: saves take longer (verification) and use more disk space (working copies, snapshots, temporary
  files). Very large files need progress reporting and cancellation (M3).
- Negative: folders synchronised by cloud clients or files locked by other programs can make the atomic
  replace fail; Varak must report this clearly and keep the working copy.
- Negative: the loss-risk rules must be kept in sync with engine updates and verified with the test corpus;
  a rule that is missing means a missing warning, never a changed file.
