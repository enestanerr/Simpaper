/**
 * Finding catalogue: severity of each detectable feature and whether saving to a given target format
 * puts it at risk. Classification follows the LibreOffice 26.8 feature-fidelity table
 * (vendor/research-raw/formats.md, table 2):
 *  - `risk`    not supported or lost on save (slicers, Power Query, Morph, ink, 3D, chartex drawing ...)
 *  - `warning` kept but degraded/not editable, or preserved with known bugs
 *  - `info`    supported; listed so the user knows what the file contains
 */
import type { CompatFinding, CompatSeverity } from '@shared/api/documents';
import type { FormatInfo } from '@shared/formats';
import type { OfficeKind } from '@shared/modules';

export type FindingId = CompatFinding['id'];

export interface SaveContext {
  kind: OfficeKind;
  target: FormatInfo;
}

interface FindingRule {
  severity: CompatSeverity | ((kind: OfficeKind) => CompatSeverity);
  /** True when saving to the target may drop or alter this content. */
  atRisk: (ctx: SaveContext) => boolean;
}

const always = () => true;
const never = () => false;
const notOoxml = ({ target }: SaveContext) => target.family !== 'ooxml';

export const FINDING_RULES: Record<FindingId, FindingRule> = {
  // VBA survives only in macro-enabled formats (DOCM/PPTM byte copy, XLSM regenerated); never executed.
  macros: { severity: (k) => (k === 'calc' ? 'warning' : 'info'), atRisk: ({ target }) => !target.macroEnabled },
  // PowerPoint ActiveX controls have no export code; Word/Excel export them only to OOXML.
  activeX: { severity: (k) => (k === 'impress' ? 'risk' : 'warning'), atRisk: (c) => c.kind === 'impress' || notOoxml(c) },
  embeddedObjects: { severity: 'info', atRisk: never },
  // Original SmartArt is kept with its fallback drawing; not editable, many round-trip bugs (tdf#106547).
  smartArt: { severity: 'warning', atRisk: always },
  // Office 2016+ charts round-trip partially but are not drawn; pareto export incomplete (tdf#165742).
  chartEx: { severity: 'risk', atRisk: always },
  charts: { severity: 'info', atRisk: never },
  pivotTables: { severity: 'warning', atRisk: never },
  slicers: { severity: 'risk', atRisk: always },
  timelines: { severity: 'risk', atRisk: always },
  externalLinks: { severity: 'info', atRisk: never },
  powerQuery: { severity: 'risk', atRisk: always },
  dataModel: { severity: 'risk', atRisk: always },
  // 26.8 keeps them but shows them as plain notes without replies (tdf#172194).
  threadedComments: { severity: 'warning', atRisk: always },
  trackedChanges: { severity: 'info', atRisk: never },
  contentControls: { severity: 'info', atRisk: ({ target }) => target.family === 'binary' || target.family === 'text' },
  // Inline equations in PowerPoint text are not supported (tdf#129061).
  equations: { severity: (k) => (k === 'impress' ? 'warning' : 'info'), atRisk: ({ kind }) => kind === 'impress' },
  ink: { severity: 'risk', atRisk: always },
  model3d: { severity: 'risk', atRisk: always },
  media: { severity: 'info', atRisk: never },
  morphTransition: { severity: 'risk', atRisk: always },
  customXml: { severity: (k) => (k === 'writer' ? 'info' : 'warning'), atRisk: (c) => c.kind !== 'writer' || notOoxml(c) },
  // Any modification invalidates signatures; the engine does not re-sign.
  digitalSignature: { severity: 'risk', atRisk: always },
  encryption: { severity: 'warning', atRisk: always },
  // Strict files are imported as Transitional and can only be saved as Transitional (tdf#149658).
  strictOoxml: { severity: 'warning', atRisk: never },
  // The target's own known losses (compat.loss.legacyBinary ...) cover legacy targets.
  legacyFormat: { severity: 'warning', atRisk: never },
  templateMacros: { severity: 'risk', atRisk: ({ target }) => !target.macroEnabled },
  missingFonts: { severity: 'warning', atRisk: never },
  fontEmbedding: { severity: 'info', atRisk: never },
};

export function severityOf(id: FindingId, kind: OfficeKind): CompatSeverity {
  const s = FINDING_RULES[id].severity;
  return typeof s === 'function' ? s(kind) : s;
}

export function makeFinding(id: FindingId, kind: OfficeKind, extra: { count?: number; detail?: string[]; severity?: CompatSeverity; messageKey?: string } = {}): CompatFinding {
  const f: CompatFinding = { id, severity: extra.severity ?? severityOf(id, kind), messageKey: extra.messageKey ?? `compat.finding.${id}` };
  if (extra.count !== undefined && extra.count > 0) f.count = extra.count;
  if (extra.detail && extra.detail.length) f.detail = extra.detail;
  return f;
}

const SEVERITY_RANK: Record<CompatSeverity, number> = { risk: 0, warning: 1, info: 2 };

/** Most severe first, then by id; one finding per id. */
export function normalizeFindings(findings: CompatFinding[]): CompatFinding[] {
  const byId = new Map<string, CompatFinding>();
  for (const f of findings) {
    const prev = byId.get(f.id);
    if (!prev || SEVERITY_RANK[f.severity] < SEVERITY_RANK[prev.severity]) byId.set(f.id, f);
  }
  return [...byId.values()].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.id.localeCompare(b.id));
}
