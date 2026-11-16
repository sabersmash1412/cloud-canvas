import { CATALOG } from '../catalog';
import type { Graph, GraphNode, Props } from '../types';

export interface NodeRef {
  /** stable identity across versions: type + name (subnets also carry their VPC) */
  key: string;
  type: string;
  name: string;
  label: string;
}
export interface PropChange {
  key: string;
  label: string;
  from?: unknown;
  to?: unknown;
  /** a setting kept from imported Terraform rather than a catalog field */
  imported?: boolean;
}
export interface NodeChange { node: NodeRef; changes: PropChange[] }
export interface EdgeRef { source: NodeRef; target: NodeRef }

export interface ArchDiff {
  added: NodeRef[];
  removed: NodeRef[];
  changed: NodeChange[];
  edgesAdded: EdgeRef[];
  edgesRemoved: EdgeRef[];
  project: PropChange[];
  /** blocks that are not on the canvas (variables, outputs, raw resources), by `kind.label` */
  other: { added: string[]; removed: string[]; changed: string[] };
  empty: boolean;
}

export function nodeKey(g: Graph, n: GraphNode): string {
  const name = String(n.properties.name ?? n.id);
  if (n.type === 'aws.subnet') return `${n.type}:${String(g.nodes.find((x) => x.id === n.parentId)?.properties.name ?? '')}/${name}`;
  return `${n.type}:${name}`;
}
export function nodeRef(g: Graph, n: GraphNode): NodeRef {
  return { key: nodeKey(g, n), type: n.type, name: String(n.properties.name ?? n.id), label: CATALOG[n.type]?.label ?? n.type };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function propChanges(type: string, a: Props, b: Props): PropChange[] {
  const def = CATALOG[type];
  const order = def?.fields.map((f) => f.key) ?? [];
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => k !== 'name');
  keys.sort((x, y) => (order.indexOf(x) < 0 ? 999 : order.indexOf(x)) - (order.indexOf(y) < 0 ? 999 : order.indexOf(y)) || x.localeCompare(y));
  const out: PropChange[] = [];
  for (const k of keys) {
    if (same(a[k], b[k])) continue;
    const label = def?.fields.find((f) => f.key === k)?.label ?? k;
    // an unmanaged module's code is too long to show as a value
    out.push(k === 'code' ? { key: k, label: 'Code' } : { key: k, label, from: a[k], to: b[k] });
  }
  return out;
}

function extrasChanges(a: Record<string, unknown> = {}, b: Record<string, unknown> = {}): PropChange[] {
  const out: PropChange[] = [];
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) if (!same(a[k], b[k])) out.push({ key: k, label: k, from: a[k], to: b[k], imported: true });
  return out;
}

function blockHead(code: string): string {
  const body = code.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n').trim();
  const m = /^(resource|data|variable|output|provider|locals|terraform)\b((?:\s+"[^"]*")*)/.exec(body);
  if (!m) return body.slice(0, 40);
  return [m[1], ...[...m[2].matchAll(/"([^"]*)"/g)].map((x) => x[1])].join('.');
}
const norm = (s: string) => s.split('\n').filter((l) => !/^\s*#/.test(l)).join(' ').replace(/\s+/g, ' ').trim();

/** What changed in the architecture between two versions (null = nothing before). Layout is ignored. */
export function diffGraphs(a: Graph | null, b: Graph): ArchDiff {
  const A = a ?? { schemaVersion: '1.0.0' as const, project: b.project, nodes: [], edges: [] };
  const am = new Map(A.nodes.map((n) => [nodeKey(A, n), n]));
  const bm = new Map(b.nodes.map((n) => [nodeKey(b, n), n]));
  const added: NodeRef[] = [], removed: NodeRef[] = [], changed: NodeChange[] = [];
  for (const [k, n] of bm) {
    const o = am.get(k);
    if (!o) { added.push(nodeRef(b, n)); continue; }
    const changes = [...propChanges(n.type, o.properties, n.properties), ...extrasChanges(o.extras, n.extras)];
    if (changes.length) changed.push({ node: nodeRef(b, n), changes });
  }
  for (const [k, n] of am) if (!bm.has(k)) removed.push(nodeRef(A, n));

  const edgeSet = (g: Graph) => {
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    const m = new Map<string, EdgeRef>();
    for (const e of g.edges) {
      const s = byId.get(e.source), t = byId.get(e.target);
      if (s && t) m.set(`${nodeKey(g, s)}>${nodeKey(g, t)}`, { source: nodeRef(g, s), target: nodeRef(g, t) });
    }
    return m;
  };
  const ae = edgeSet(A), be = edgeSet(b);
  const edgesAdded = [...be].filter(([k]) => !ae.has(k)).map(([, v]) => v);
  const edgesRemoved = [...ae].filter(([k]) => !be.has(k)).map(([, v]) => v);

  const project: PropChange[] = [];
  if (a) for (const k of ['name', 'environment', 'region'] as const) if (a.project[k] !== b.project[k]) project.push({ key: k, label: k, from: a.project[k], to: b.project[k] });

  const blocks = (g: Graph) => new Map((g.passthrough ?? []).map((p) => [blockHead(p.code), norm(p.code)]));
  const ab = blocks(A), bb = blocks(b);
  const other = {
    added: [...bb.keys()].filter((k) => !ab.has(k)),
    removed: [...ab.keys()].filter((k) => !bb.has(k)),
    changed: [...bb.keys()].filter((k) => ab.has(k) && ab.get(k) !== bb.get(k)),
  };

  const empty = !added.length && !removed.length && !changed.length && !edgesAdded.length && !edgesRemoved.length && !project.length && !other.added.length && !other.removed.length && !other.changed.length;
  return { added, removed, changed, edgesAdded, edgesRemoved, project, other, empty };
}

const show = (v: unknown): string => {
  if (v === undefined) return '—';
  if (typeof v === 'object' && v !== null) { const s = JSON.stringify(v); return s.length > 40 ? s.slice(0, 37) + '…' : s; }
  return String(v);
};

/** Plain-language lines for a diff (used as the commit's architecture summary). */
export function describeDiff(d: ArchDiff): string[] {
  const out: string[] = [];
  const list = (verb: string, refs: NodeRef[]) => {
    const subs = refs.filter((r) => r.type === 'aws.subnet');
    for (const r of refs.filter((x) => x.type !== 'aws.subnet')) out.push(`${verb} ${r.label} “${r.name}”`);
    if (subs.length === 1) out.push(`${verb} subnet “${subs[0].name}”`);
    else if (subs.length > 1) out.push(`${verb} ${subs.length} subnets`);
  };
  list('Added', d.added);
  list('Removed', d.removed);
  for (const c of d.changed)
    out.push(`Changed ${c.node.label} “${c.node.name}”: ${c.changes.map((x) => (x.from === undefined && x.to === undefined ? `${x.label} changed` : `${x.label} ${show(x.from)} → ${show(x.to)}`)).join(', ')}`);
  for (const e of d.edgesAdded) out.push(`Connected “${e.source.name}” → “${e.target.name}”`);
  for (const e of d.edgesRemoved) out.push(`Disconnected “${e.source.name}” → “${e.target.name}”`);
  for (const p of d.project) out.push(`Project ${p.label}: ${show(p.from)} → ${show(p.to)}`);
  for (const k of d.other.added) out.push(`Added ${k} (not on the canvas)`);
  for (const k of d.other.removed) out.push(`Removed ${k} (not on the canvas)`);
  for (const k of d.other.changed) out.push(`Changed ${k} (not on the canvas)`);
  return out;
}
