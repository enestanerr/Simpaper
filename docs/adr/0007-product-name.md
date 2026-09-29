# ADR 0007: Product name — "Varak"

- **Status:** Accepted as the working name; a formal trademark search is required before the first public
  release
- **Date:** 2026-09-28
- **Related:** `src/shared/brand.ts`, [ADR 0006](0006-license.md), research:
  [alternatives](../research/alternatives.md#name-check)

## Context

The project started in a folder called "Free-Office". A product needs a distinctive name that:

- does not collide with existing office software, especially in Turkey (the first audience) and in the
  Windows/Microsoft Store ecosystem;
- does not use third-party marks: **"FreeOffice"** is a live US trademark of SoftMaker Software GmbH
  (Reg. No. 4,024,688, classes 9/38/42, covering word-processing and spreadsheet software); The Document
  Foundation's policy forbids "LibreOffice" in our product or app-store name; Microsoft's brand guidelines
  forbid Microsoft marks (Word, Excel, PowerPoint, Microsoft 365 …) in third-party product names;
- works in Turkish and English and can be written without special characters.

Eight candidates were checked on the web, on GitHub and by DNS (September 2026): Folyo and Pusula carry a very
high risk (an Electron offline office suite called "Folio Office"; a Turkish IT company "Pusula Ofis"), Defter
and Kalem a high risk (note-taking apps, Turkey's official e-Defter, Turkish software firms), Katip and Ream a
medium-to-high risk, Ebru and Nar the least risk but weak distinctiveness. Three new proposals showed no
software collisions: **Varak**, **Tezhip**, **Tomar**.

## Decision

- The product is called **Varak**. *Varak* is Ottoman Turkish for a leaf or sheet of paper, and also for gold
  leaf (as in gilded manuscripts). The logo is an original drawing of a sheet with a gilded edge and a gold leaf
  (`resources/brand/`); it must not resemble the logos of Microsoft Office, LibreOffice or ONLYOFFICE.
- The name, application id and brand colours live in one place, `src/shared/brand.ts`
  (`appId: org.varakoffice.varak`), so that a rename touches as few files as possible.
- Module names are descriptive and translated (documents, spreadsheets, presentations, PDF; the exact labels
  live in the i18n resources) and never use Word, Excel, PowerPoint or other third-party marks.
- **Never** use "FreeOffice" or "Free Office" as a product, module or store name. The folder name
  "Free-Office" is internal only.
- Attribution to the engine is text only: "Includes LibreOffice® (The Document Foundation), unmodified."
- **Before the first public release:** run register searches at TÜRKPATENT, EUIPO (TMview), the WIPO Global
  Brand Database and the USPTO in Nice classes 9 and 42; secure the GitHub organisation `varak-office` and the
  domains used by the application id (`varakoffice.org`/`.com`). If the search fails, fall back to **Tezhip**,
  then **Tomar**.

## Alternatives considered

| Alternative | Why not chosen |
|---|---|
| Free Office / FreeOffice | Registered trademark of SoftMaker for the same class of software |
| Folyo, Pusula, Defter, Kalem | High to very high collision risk (see research) |
| Katip, Ream | Existing document/contract software with similar names |
| Ebru, Nar | Low collision risk but weak distinctiveness; same-name Turkish software firms |
| Tezhip, Tomar | Good backups; Varak was preferred for its double meaning (sheet and gold leaf) |

## Consequences

- The name check so far covered the web, GitHub and DNS only; it is **not** a trademark clearance. Launching
  publicly without the formal search is a legal risk.
- The application id `org.varakoffice.varak` implies a domain that is not registered yet; the domain must be
  secured, or the id changed, **before** the first public release (changing it later moves Windows settings
  and taskbar identity).
- "Varak" is not affiliated with Microsoft or The Document Foundation, and all documentation says so.
