import { CATALOG, edgeRule } from './catalog';
import type { Diagnostic, FieldDef, Graph, PropValue } from './types';

export function checkField(f: FieldDef, v: PropValue | undefined): string | null {
  const empty = v === undefined || v === '';
  if (empty) return f.required ? `${f.label} is required` : null;
  if (f.type === 'number') {
    if (typeof v !== 'number' || Number.isNaN(v)) return `${f.label} must be a number`;
    if (f.min !== undefined && v < f.min) return `${f.label} must be ≥ ${f.min}`;
    if (f.max !== undefined && v > f.max) return `${f.label} must be ≤ ${f.max}`;
  }
  if (f.type === 'string' && f.pattern && !new RegExp(f.pattern).test(String(v))) return `${f.label} has an invalid format`;
  if (f.type === 'select' && f.options && !f.options.includes(v as string | number)) return `${f.label} must be one of ${f.options.join(', ')}`;
  return null;
}

export function validateGraph(g: Graph): Diagnostic[] {
  const out: Diagnostic[] = [];
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const names = new Map<string, string>();

  for (const n of g.nodes) {
    const def = CATALOG[n.type];
    if (!def) {
      out.push({ severity: 'error', nodeId: n.id, message: `Unknown resource type "${n.type}"` });
      continue;
    }
    for (const f of def.fields) {
      const m = checkField(f, n.properties[f.key]);
      if (m) out.push({ severity: 'error', nodeId: n.id, message: m });
    }
    if (def.parent && !(def.optionalParent && !n.parentId)) {
      const p = n.parentId ? byId.get(n.parentId) : undefined;
      if (!p || p.type !== def.parent) out.push({ severity: 'error', nodeId: n.id, message: `${def.label} must be placed inside a ${CATALOG[def.parent].label}` });
    }
    const key = `${n.type}:${n.properties.name}`;
    if (names.has(key)) out.push({ severity: 'error', nodeId: n.id, message: `Another ${def.label} already uses the name "${n.properties.name}"` });
    names.set(key, n.id);
  }

  const seen = new Set<string>();
  for (const e of g.edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) {
      out.push({ severity: 'error', edgeId: e.id, message: 'Connection references a missing node' });
      continue;
    }
    if (!edgeRule(s.type, t.type))
      out.push({ severity: 'error', edgeId: e.id, nodeId: s.id, message: `${CATALOG[s.type]?.label ?? s.type} cannot connect to ${CATALOG[t.type]?.label ?? t.type}` });
    if (s.type === 'aws.lambda' && t.type.startsWith('aws.rds_') && !s.parentId)
      out.push({ severity: 'error', edgeId: e.id, nodeId: s.id, message: 'Place this Lambda inside the VPC so it can reach the database' });
    const k = `${e.source}>${e.target}`;
    if (seen.has(k)) out.push({ severity: 'warning', edgeId: e.id, message: 'Duplicate connection' });
    seen.add(k);
  }

  if (!g.nodes.length) out.push({ severity: 'info', message: 'The canvas is empty. Drag a service from the palette to begin.' });
  return out;
}
