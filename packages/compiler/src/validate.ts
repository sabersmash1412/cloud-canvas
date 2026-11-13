import { CATALOG, edgeRule, tiersOf } from './catalog';
import { contains, overlaps, parseCidr } from './cidr';
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
      if (!p || p.type !== def.parent) out.push({ severity: 'error', nodeId: n.id, message: `${def.label} must be placed inside a ${CATALOG[def.parent].label.toLowerCase()}` });
      else if (def.parent === 'aws.subnet') {
        const allowed = tiersOf(def, n.properties);
        const tier = String(p.properties.tier);
        if (allowed.length && !allowed.includes(tier as never)) out.push({ severity: 'error', nodeId: n.id, message: `${def.label} must be placed in a ${allowed.join(' or ')} subnet, not a ${tier} one` });
        else if (def.minAzs) {
          const zones = new Set(g.nodes.filter((x) => x.type === 'aws.subnet' && x.parentId === p.parentId && x.properties.tier === tier).map((x) => x.properties.az));
          if (zones.size < def.minAzs) out.push({ severity: 'error', nodeId: n.id, message: `${def.label} needs ${tier} subnets in at least ${def.minAzs} availability zones (found ${zones.size})` });
        }
      }
    }
    const key = `${n.type}:${n.type === 'aws.subnet' ? n.parentId : ''}:${n.properties.name}`;
    if (names.has(key)) out.push({ severity: 'error', nodeId: n.id, message: `Another ${def.label} already uses the name "${n.properties.name}"` });
    names.set(key, n.id);
  }

  // ── network layout: subnets per VPC
  for (const v of g.nodes.filter((n) => n.type === 'aws.vpc')) {
    const vc = parseCidr(v.properties.cidr);
    const subs = g.nodes.filter((n) => n.type === 'aws.subnet' && n.parentId === v.id);
    const parsed = subs.map((x) => ({ x, c: parseCidr(x.properties.cidr) }));
    const seenCell = new Map<string, string>();
    parsed.forEach(({ x, c }, i) => {
      const bad = (message: string) => out.push({ severity: 'error', nodeId: x.id, message });
      if (!c) return bad('CIDR block is not valid (expected e.g. 10.20.10.0/24)');
      if (c.prefix < 16 || c.prefix > 28) bad('Subnet size must be between /16 and /28');
      if (vc && !contains(vc, c)) bad(`CIDR ${x.properties.cidr} is outside the VPC range ${v.properties.cidr}`);
      for (const o of parsed.slice(0, i)) if (o.c && overlaps(c, o.c)) { bad(`CIDR overlaps subnet "${o.x.properties.name}"`); break; }
      const cell = `${x.properties.tier}/${x.properties.az}`;
      if (seenCell.has(cell)) bad(`There is already a ${x.properties.tier} subnet in zone ${x.properties.az} ("${seenCell.get(cell)}"); the VPC module supports one per tier per zone`);
      else seenCell.set(cell, String(x.properties.name));
    });
    // The VPC module maps each tier's list onto `azs` by index, so a tier must start at the
    // first zone and have no gaps (e.g. a; a,b; a,b,c) - but tiers need not all be the same length.
    const zonesByTier = new Map<string, Set<string>>();
    for (const x of subs) {
      const t = String(x.properties.tier);
      zonesByTier.set(t, (zonesByTier.get(t) ?? new Set()).add(String(x.properties.az)));
    }
    const all = [...new Set(subs.map((x) => String(x.properties.az)))].sort();
    for (const [t, z] of zonesByTier) {
      const mine = [...z].sort();
      if (mine.every((az, i) => az === all[i])) continue;
      const missing = all.slice(0, all.indexOf(mine[mine.length - 1]) + 1).filter((a) => !z.has(a));
      for (const x of subs.filter((y) => y.properties.tier === t))
        out.push({ severity: 'error', nodeId: x.id, message: `${t} subnets must start at zone ${all[0]} with no gaps (missing zone ${missing.join(', ')})` });
    }
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
