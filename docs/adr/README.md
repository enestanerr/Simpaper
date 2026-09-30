# Architecture decision records

Each record describes one decision: its context, what was decided, the alternatives that were considered and
the consequences. The overall picture is in [ARCHITECTURE.md](../ARCHITECTURE.md); the research behind the
decisions, with sources, is in [docs/research](../research/README.md).

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-engine.md) | Unmodified LibreOffice 26.8 as the office document engine, driven over UNO, one instance per document | Accepted |
| [0002](0002-shell.md) | Electron, React and TypeScript for the application shell | Accepted |
| [0003](0003-document-surface.md) | LibreOffice's editing window hosted in the Varak window: child embedding by default (amended after the GUI spike), owned overlay for development only | Accepted (amended) |
| [0004](0004-pdf-stack.md) | pdf.js in the renderer, @cantoo/pdf-lib in the main process | Accepted for v0.1 (amended) |
| [0005](0005-data-integrity.md) | Working copies, safe save, loss-risk warnings, recovery, no macro execution | Accepted |
| [0006](0006-license.md) | Mozilla Public License 2.0 | Accepted |
| [0007](0007-product-name.md) | Product name "Varak" (formal trademark search still required) | Accepted (working name) |
| [0008](0008-packaging.md) | Pinned, verified engine; per-user NSIS installer and ZIP with electron-builder | Accepted for v0.1 |

## Writing a new ADR

Copy the structure of an existing record (Status, Date, Related, Context, Decision, Alternatives considered,
Consequences), use the next free number, and link it from this table. A decision that replaces an earlier one
sets the old record's status to "Superseded by ADR NNNN" instead of deleting it.
