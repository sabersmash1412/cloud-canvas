import { create } from 'zustand';
import { applyEdgeChanges, applyNodeChanges, type Edge, type EdgeChange, type Node, type NodeChange } from '@xyflow/react';
import {
  AZ_LETTERS, CATALOG, SUB, TIER_ORDER, defaultProps, inSubnetPos, migrateGraph, subnetCell, subnetId, subnetNode, suggestCidr, tiersOf, vpcSize,
  type Diagnostic, type Graph, type GraphNode, type ProjectMeta, type Props, type Tier,
} from '@cloudcanvas/compiler';

export type CNode = Node<{ type: string; properties: Props; label?: string; extras?: Record<string, unknown>; change?: 'added' | 'changed' | 'removed' }>;
export type CEdge = Edge;

const CONTAINER_KIND: Record<string, string> = { 'aws.vpc': 'vpc', 'aws.subnet': 'subnet' };
const isContainer = (type: string) => type in CONTAINER_KIND;

interface Snap { nodes: CNode[]; edges: CEdge[]; project: ProjectMeta; passthrough?: Graph['passthrough'] }

interface State extends Snap {
  past: Snap[];
  future: Snap[];
  selected: string | null;
  diagnostics: Diagnostic[];
  notice: string | null;
  /** repo-linked projects: the canvas can be inspected but never changed */
  readOnly: boolean;
  setDiagnostics: (d: Diagnostic[]) => void;
  connectingFrom: string | null; // node type
  dark: boolean;
  view: 'split' | 'canvas' | 'code';
  setProject: (p: Partial<ProjectMeta>) => void;
  onNodesChange: (c: NodeChange<CNode>[]) => void;
  onEdgesChange: (c: EdgeChange[]) => void;
  checkpoint: () => void;
  addNode: (type: string, pos: { x: number; y: number }) => string | null;
  startDrag: (id: string) => void;
  dropNode: (id: string) => void;
  addEdge: (source: string, target: string) => void;
  setProp: (id: string, key: string, value: string | number | boolean) => void;
  select: (id: string | null) => void;
  setConnecting: (t: string | null) => void;
  say: (msg: string) => void;
  undo: () => void;
  redo: () => void;
  load: (g: Graph) => void;
  openGraph: (g: Graph) => void;
  clear: () => void;
  toggleDark: () => void;
  setView: (v: State['view']) => void;
  setReadOnly: (v: boolean) => void;
}

let seq = 1;
const nid = (prefix: string) => `${prefix}${Date.now().toString(36)}${seq++}`;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let dragOrigin: { id: string; parentId?: string; position: { x: number; y: number } } | null = null;
let lastProp = '';

const snapOf = (s: Snap): Snap => ({ nodes: s.nodes, edges: s.edges, project: s.project, passthrough: s.passthrough });

export function uniqueName(nodes: CNode[], type: string, base: string): string {
  const taken = new Set(nodes.filter((n) => n.data.type === type).map((n) => String(n.data.properties.name)));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

// ───────────────────────── geometry helpers ─────────────────────────
const sizeOf = (n: CNode) => ({ w: Number(n.width ?? n.style?.width ?? 0), h: Number(n.height ?? n.style?.height ?? 0) });
const withSize = (n: CNode, w: number, h: number): CNode => ({ ...n, width: w, height: h, style: { ...n.style, width: w, height: h } });

function absPos(nodes: CNode[], n: CNode) {
  let x = n.position.x, y = n.position.y;
  let p = n.parentId ? nodes.find((q) => q.id === n.parentId) : undefined;
  for (let i = 0; p && i < 5; i++) { x += p.position.x; y += p.position.y; p = p.parentId ? nodes.find((q) => q.id === p!.parentId) : undefined; }
  return { x, y };
}

/** Smallest container of `type` whose absolute rectangle contains the point. */
function containerAt(nodes: CNode[], pt: { x: number; y: number }, type: string, accept: (n: CNode) => boolean = () => true): CNode | undefined {
  let best: CNode | undefined, bestArea = Infinity;
  for (const n of nodes) {
    if (n.data.type !== type || !accept(n)) continue;
    const a = absPos(nodes, n), { w, h } = sizeOf(n);
    if (pt.x >= a.x && pt.x <= a.x + w && pt.y >= a.y && pt.y <= a.y + h && w * h < bestArea) { best = n; bestArea = w * h; }
  }
  return best;
}

// ───────────────────────── graph <-> react-flow ─────────────────────────
function toRF(n: GraphNode): CNode {
  const kind = CONTAINER_KIND[n.type];
  const dflt = n.type === 'aws.vpc' ? { w: 880, h: 540 } : { w: SUB.w, h: SUB.h };
  const w = n.size?.w ?? dflt.w, h = n.size?.h ?? dflt.h;
  return {
    id: n.id,
    type: kind ?? 'resource',
    position: n.position,
    ...(n.parentId ? { parentId: n.parentId } : {}),
    ...(n.type === 'aws.subnet' ? { extent: 'parent' as const } : {}),
    ...(kind ? { width: w, height: h, style: { width: w, height: h } } : {}),
    ...(n.type === 'aws.vpc' ? { zIndex: -1 } : {}),
    data: { type: n.type, properties: n.properties, ...(n.label ? { label: n.label } : {}), ...(n.extras ? { extras: n.extras } : {}) },
  };
}

export function fromGraph(input: Graph): { nodes: CNode[]; edges: CEdge[]; passthrough?: Graph['passthrough'] } {
  const g = migrateGraph(input);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const depth = (n: GraphNode) => { let d = 0, p = n.parentId ? byId.get(n.parentId) : undefined; while (p && d < 6) { d++; p = p.parentId ? byId.get(p.parentId) : undefined; } return d; };
  const nodes = [...g.nodes].sort((a, b) => depth(a) - depth(b)).map(toRF);
  const edges: CEdge[] = g.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, type: 'cc', animated: false }));
  return { nodes, edges, passthrough: g.passthrough };
}

export function toGraph(nodes: CNode[], edges: CEdge[], project: ProjectMeta, passthrough?: Graph['passthrough']): Graph {
  return {
    schemaVersion: '1.0.0',
    project,
    ...(passthrough?.length ? { passthrough } : {}),
    nodes: nodes.map((n) => {
      const { w, h } = sizeOf(n);
      return {
        id: n.id,
        type: n.data.type,
        ...(n.parentId ? { parentId: n.parentId } : {}),
        position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        ...(isContainer(n.data.type) ? { size: { w: Math.round(w), h: Math.round(h) } } : {}),
        properties: n.data.properties,
        ...(n.data.label ? { label: n.data.label } : {}),
        ...(n.data.extras ? { extras: n.data.extras } : {}),
      };
    }),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  };
}

const initialProject: ProjectMeta = { name: 'member-portal', squad: 'digital-services', environment: 'dev', region: 'ap-southeast-1' };

/** A new VPC node plus its default subnet grid (all tiers across `azCount` zones, or only `tiers`). */
function newVpc(nodes: CNode[], pos: { x: number; y: number }, azCount = 2, tiers: Tier[] = TIER_ORDER) {
  const id = nid('vpc');
  const props = defaultProps('aws.vpc');
  props.name = uniqueName(nodes, 'aws.vpc', 'main');
  const size = vpcSize(azCount);
  const gnodes: GraphNode[] = [
    { id, type: 'aws.vpc', position: pos, size, properties: props },
    ...TIER_ORDER.filter((t) => tiers.includes(t)).flatMap((t) => Array.from({ length: azCount }, (_, i) => subnetNode(id, String(props.cidr), t, i))),
  ];
  return { id, nodes: gnodes.map(toRF) };
}

export const useStore = create<State>((set, get) => ({
  nodes: [],
  edges: [],
  project: initialProject,
  passthrough: undefined,
  past: [],
  future: [],
  selected: null,
  diagnostics: [],
  notice: null,
  readOnly: false,
  setDiagnostics: (diagnostics) => set({ diagnostics }),
  connectingFrom: null,
  dark: typeof localStorage !== 'undefined' ? localStorage.getItem('cc-dark') !== '0' : true,
  view: 'split',
  setReadOnly: (readOnly) => set({ readOnly }),

  say: (notice) => {
    set({ notice });
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => set({ notice: null }), 4200);
  },

  checkpoint: () => set((s) => ({ past: [...s.past.slice(-80), snapOf(s)], future: [] })),

  setProject: (p) => { if (get().readOnly) return; get().checkpoint(); set((s) => ({ project: { ...s.project, ...p } })); },

  onNodesChange: (changes) =>
    set((s) => {
      if (s.readOnly) changes = changes.filter((c) => c.type === 'dimensions' || c.type === 'select');
      const removals = changes.filter((c) => c.type === 'remove').map((c) => (c as { id: string }).id);
      let nodes = applyNodeChanges(changes, s.nodes);
      let edges = s.edges;
      if (removals.length) {
        // removing a container removes everything nested in it
        const gone = new Set(removals);
        let grew = true;
        while (grew) { grew = false; for (const n of nodes) if (n.parentId && gone.has(n.parentId) && !gone.has(n.id)) { gone.add(n.id); grew = true; } }
        nodes = nodes.filter((n) => !gone.has(n.id));
        edges = edges.filter((e) => !gone.has(e.source) && !gone.has(e.target));
        return { nodes, edges, past: [...s.past.slice(-80), snapOf(s)], future: [], selected: s.selected && gone.has(s.selected) ? null : s.selected };
      }
      return { nodes };
    }),

  onEdgesChange: (changes) =>
    set((s) => {
      if (s.readOnly) changes = changes.filter((c) => c.type === 'select');
      const removing = changes.some((c) => c.type === 'remove');
      return { edges: applyEdgeChanges(changes, s.edges), ...(removing ? { past: [...s.past.slice(-80), snapOf(s)], future: [] } : {}) };
    }),

  addNode: (type, pos) => {
    if (get().readOnly) return null;
    const def = CATALOG[type];
    if (!def) return null;
    const s = get();
    let nodes = [...s.nodes];
    const props = defaultProps(type);
    const id = nid(type.split('.')[1].slice(0, 3));
    const commit = (node: CNode, extra: CNode[] = []) => {
      set({ nodes: [...nodes, ...extra, node], past: [...s.past.slice(-80), snapOf(s)], future: [], selected: node.id });
      return node.id;
    };

    // ── VPC: comes with a default subnet grid
    if (type === 'aws.vpc') {
      const v = newVpc(nodes, pos);
      set({ nodes: [...nodes, ...v.nodes], past: [...s.past.slice(-80), snapOf(s)], future: [], selected: v.id });
      return v.id;
    }

    const vpcAt = (p: { x: number; y: number }) => containerAt(nodes, p, 'aws.vpc') ?? nodes.find((n) => n.data.type === 'aws.vpc');

    // ── Subnet: fills the next free tier/zone cell of a VPC
    if (type === 'aws.subnet') {
      let vpc = vpcAt(pos);
      if (!vpc) {
        const v = newVpc(nodes, { x: Math.max(0, pos.x - 40), y: Math.max(0, pos.y - 60) }, 2, []);
        nodes = [...nodes, ...v.nodes];
        vpc = v.nodes[0];
      }
      const existing = nodes.filter((n) => n.data.type === 'aws.subnet' && n.parentId === vpc!.id);
      const taken = new Set(existing.map((n) => `${n.data.properties.tier}/${n.data.properties.az}`));
      let cell: { tier: Tier; azi: number } | undefined;
      for (let azi = 0; azi < AZ_LETTERS.length && !cell; azi++) for (const tier of TIER_ORDER) if (!taken.has(`${tier}/${AZ_LETTERS[azi]}`)) { cell = { tier, azi }; break; }
      if (!cell) { get().say('This VPC already has a subnet in every tier and zone.'); return null; }
      const g = subnetNode(vpc.id, String(vpc.data.properties.cidr), cell.tier, cell.azi);
      const node = toRF({ ...g, id: nid('sub') });
      const need = vpcSize(cell.azi + 1);
      const vs = sizeOf(vpc);
      if (need.w > vs.w) nodes = nodes.map((n) => (n.id === vpc!.id ? withSize(n, need.w, vs.h) : n));
      return commit(node);
    }

    props.name = uniqueName(nodes, type, String(props.name));

    // ── Services that live in a subnet
    if (def.parent === 'aws.subnet') {
      const tiers = tiersOf(def, props);
      const ok = (n: CNode) => !tiers.length || tiers.includes(String(n.data.properties.tier) as Tier);
      const direct = containerAt(nodes, pos, 'aws.subnet', ok);
      const wrongTier = !direct && containerAt(nodes, pos, 'aws.subnet');

      if (!direct && !wrongTier && def.optionalParent) {
        // e.g. Lambda outside any VPC
        return commit({ id, type: 'resource', position: pos, data: { type, properties: props } });
      }

      let target = direct;
      const tier = tiers[0] ?? 'private';
      if (!target) {
        let vpc = (wrongTier && nodes.find((n) => n.id === wrongTier.parentId)) || vpcAt(pos);
        if (!vpc) {
          const v = newVpc(nodes, { x: Math.max(0, pos.x - 120), y: Math.max(0, pos.y - 140) }, 2, []);
          nodes = [...nodes, ...v.nodes];
          vpc = v.nodes[0];
        }
        let subs = nodes.filter((n) => n.data.type === 'aws.subnet' && n.parentId === vpc!.id && n.data.properties.tier === tier);
        if (!subs.length) {
          // add this tier for every zone the VPC already spans
          const zones = [...new Set(nodes.filter((n) => n.data.type === 'aws.subnet' && n.parentId === vpc!.id).map((n) => String(n.data.properties.az)))].sort();
          const azs = zones.length ? zones.map((z) => AZ_LETTERS.indexOf(z as 'a')) : [0, 1];
          const added = azs.map((azi) => toRF(subnetNode(vpc!.id, String(vpc!.data.properties.cidr), tier, azi)));
          nodes = [...nodes, ...added];
          subs = added;
          get().say(`Added ${tier} subnets for ${def.label}.`);
        } else if (wrongTier) get().say(`${def.label} belongs in a ${tier} subnet — placed there.`);
        target = [...subs].sort((a, b) => String(a.data.properties.az).localeCompare(String(b.data.properties.az)))[0];
      }
      const ta = absPos(nodes, target), ts = sizeOf(target);
      const kids = nodes.filter((n) => n.parentId === target!.id).length;
      const rel = direct ? { x: pos.x - ta.x, y: pos.y - ta.y } : { x: inSubnetPos().x - kids * 110, y: inSubnetPos().y };
      const x = Math.min(Math.max(rel.x, 8), Math.max(8, ts.w - 104));
      const y = Math.min(Math.max(rel.y, 34), Math.max(34, ts.h - 100));
      return commit({ id, type: 'resource', position: { x, y }, parentId: target.id, data: { type, properties: props } });
    }

    // ── Free-standing service (S3, CloudFront, API Gateway ...)
    return commit({ id, type: 'resource', position: pos, data: { type, properties: props } });
  },

  startDrag: (id) => {
    if (get().readOnly) return;
    const n = get().nodes.find((x) => x.id === id);
    dragOrigin = n ? { id, parentId: n.parentId, position: { ...n.position } } : null;
  },

  /** After a drag: re-home a service into the subnet it was dropped on (or snap back). */
  dropNode: (id) => {
    if (get().readOnly) return;
    const s = get();
    const n = s.nodes.find((x) => x.id === id);
    const origin = dragOrigin?.id === id ? dragOrigin : null;
    dragOrigin = null;
    if (!n) return;
    const def = CATALOG[n.data.type];
    if (!def || def.parent !== 'aws.subnet' || isContainer(n.data.type)) return;
    const a = absPos(s.nodes, n);
    const centre = { x: a.x + 48, y: a.y + 40 };
    const target = containerAt(s.nodes, centre, 'aws.subnet');
    if (!target) {
      if (def.optionalParent) { set({ nodes: s.nodes.map((x) => (x.id === id ? { ...x, parentId: undefined, extent: undefined, position: a } : x)) }); return; }
      if (origin) { set({ nodes: s.nodes.map((x) => (x.id === id ? { ...x, position: origin.position, parentId: origin.parentId } : x)) }); s.say('Services must stay inside a subnet.'); }
      return;
    }
    const ta = absPos(s.nodes, target), ts = sizeOf(target);
    const rel = { x: Math.min(Math.max(a.x - ta.x, 8), Math.max(8, ts.w - 104)), y: Math.min(Math.max(a.y - ta.y, 34), Math.max(34, ts.h - 100)) };
    if (target.id !== n.parentId || rel.x !== n.position.x || rel.y !== n.position.y)
      set({ nodes: s.nodes.map((x) => (x.id === id ? { ...x, parentId: target.id, position: rel } : x)) });
  },

  addEdge: (source, target) => {
    if (get().readOnly) return;
    const s = get();
    if (s.edges.some((e) => e.source === source && e.target === target)) return;
    set({ edges: [...s.edges, { id: nid('e'), source, target, type: 'cc' }], past: [...s.past.slice(-80), snapOf(s)], future: [] });
  },

  setProp: (id, key, value) => {
    if (get().readOnly) return;
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, properties: { ...n.data.properties, [key]: value } } } : n)),
      past: s.past.length && s.future.length === 0 && lastProp === `${id}.${key}` ? s.past : [...s.past.slice(-80), snapOf(s)],
      future: [],
      ...((lastProp = `${id}.${key}`), {}),
    }));
  },

  select: (selected) =>
    set((s) => {
      const dirty = s.nodes.some((n) => !!n.selected !== (n.id === selected));
      return { selected, ...(dirty ? { nodes: s.nodes.map((n) => (!!n.selected === (n.id === selected) ? n : { ...n, selected: n.id === selected })) } : {}) };
    }),
  setConnecting: (connectingFrom) => set({ connectingFrom }),

  undo: () => { if (get().readOnly) return; const s = get(); const p = s.past.at(-1); if (!p) return; set({ ...p, past: s.past.slice(0, -1), future: [snapOf(s), ...s.future], selected: null }); lastProp = ''; },
  redo: () => { if (get().readOnly) return; const s = get(); const f = s.future[0]; if (!f) return; set({ ...f, future: s.future.slice(1), past: [...s.past, snapOf(s)], selected: null }); lastProp = ''; },

  load: (g) => { if (get().readOnly) return; const s = get(); const { nodes, edges } = fromGraph(g); set({ nodes, edges, passthrough: g.passthrough, project: g.project, selected: null, past: [...s.past.slice(-80), snapOf(s)], future: [] }); },
  openGraph: (g) => { const { nodes, edges, passthrough } = fromGraph(g); lastProp = ''; set({ nodes, edges, passthrough, project: g.project, selected: null, past: [], future: [], diagnostics: [], notice: null }); },
  clear: () => { if (get().readOnly) return; const s = get(); set({ nodes: [], edges: [], selected: null, past: [...s.past.slice(-80), snapOf(s)], future: [] }); },

  toggleDark: () => set((s) => { try { localStorage.setItem('cc-dark', s.dark ? '0' : '1'); } catch { /* ignore */ } return { dark: !s.dark }; }),
  setView: (view) => set({ view }),
}));

export { subnetCell, subnetId, suggestCidr };
