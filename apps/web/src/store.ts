import { create } from 'zustand';
import { applyEdgeChanges, applyNodeChanges, type Edge, type EdgeChange, type Node, type NodeChange } from '@xyflow/react';
import { CATALOG, defaultProps, type Diagnostic, type Graph, type ProjectMeta, type Props } from '@cloudcanvas/compiler';

export type CNode = Node<{ type: string; properties: Props }>;
export type CEdge = Edge;

export const LANE_Y: Record<string, number> = { public: 56, private: 216, database: 376 };
export const LANE_H = 140;
export const VPC_DEFAULT = { w: 1040, h: 540 };

interface Snap { nodes: CNode[]; edges: CEdge[]; project: ProjectMeta }

interface State extends Snap {
  past: Snap[];
  future: Snap[];
  selected: string | null;
  diagnostics: Diagnostic[];
  setDiagnostics: (d: Diagnostic[]) => void;
  connectingFrom: string | null; // node type
  dark: boolean;
  view: 'split' | 'canvas' | 'code';
  setProject: (p: Partial<ProjectMeta>) => void;
  onNodesChange: (c: NodeChange<CNode>[]) => void;
  onEdgesChange: (c: EdgeChange[]) => void;
  checkpoint: () => void;
  addNode: (type: string, pos: { x: number; y: number }) => string | null;
  addEdge: (source: string, target: string) => void;
  setProp: (id: string, key: string, value: string | number | boolean) => void;
  select: (id: string | null) => void;
  setConnecting: (t: string | null) => void;
  undo: () => void;
  redo: () => void;
  load: (g: Graph) => void;
  openGraph: (g: Graph) => void;
  clear: () => void;
  toggleDark: () => void;
  setView: (v: State['view']) => void;
}

let seq = 1;
const nid = (prefix: string) => `${prefix}${Date.now().toString(36)}${seq++}`;

const snapOf = (s: Snap): Snap => ({ nodes: s.nodes, edges: s.edges, project: s.project });

export function uniqueName(nodes: CNode[], type: string, base: string): string {
  const taken = new Set(nodes.filter((n) => n.data.type === type).map((n) => String(n.data.properties.name)));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

export function toGraph(nodes: CNode[], edges: CEdge[], project: ProjectMeta): Graph {
  return {
    schemaVersion: '1.0.0',
    project,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.type,
      ...(n.parentId ? { parentId: n.parentId } : {}),
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      ...(n.data.type === 'aws.vpc' ? { size: { w: Math.round(Number(n.width ?? n.style?.width ?? VPC_DEFAULT.w)), h: Math.round(Number(n.height ?? n.style?.height ?? VPC_DEFAULT.h)) } } : {}),
      properties: n.data.properties,
    })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  };
}

export function fromGraph(g: Graph): { nodes: CNode[]; edges: CEdge[] } {
  const nodes: CNode[] = [...g.nodes]
    .sort((a, b) => Number(!!a.parentId) - Number(!!b.parentId)) // parents first
    .map((n) => ({
      id: n.id,
      type: n.type === 'aws.vpc' ? 'vpc' : 'resource',
      position: n.position,
      ...(n.parentId ? { parentId: n.parentId, extent: 'parent' as const } : {}),
      ...(n.type === 'aws.vpc' ? { style: { width: n.size?.w ?? VPC_DEFAULT.w, height: n.size?.h ?? VPC_DEFAULT.h }, zIndex: -1 } : {}),
      data: { type: n.type, properties: n.properties },
    }));
  const edges: CEdge[] = g.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, type: 'cc', animated: false }));
  return { nodes, edges };
}

const initialProject: ProjectMeta = { name: 'member-portal', squad: 'digital-services', environment: 'dev', region: 'ap-southeast-1' };

export const useStore = create<State>((set, get) => ({
  nodes: [],
  edges: [],
  project: initialProject,
  past: [],
  future: [],
  selected: null,
  diagnostics: [],
  setDiagnostics: (diagnostics) => set({ diagnostics }),
  connectingFrom: null,
  dark: typeof localStorage !== 'undefined' ? localStorage.getItem('cc-dark') !== '0' : true,
  view: 'split',

  checkpoint: () => set((s) => ({ past: [...s.past.slice(-80), snapOf(s)], future: [] })),

  setProject: (p) => { get().checkpoint(); set((s) => ({ project: { ...s.project, ...p } })); },

  onNodesChange: (changes) =>
    set((s) => {
      const removals = changes.filter((c) => c.type === 'remove').map((c) => (c as { id: string }).id);
      let nodes = applyNodeChanges(changes, s.nodes);
      let edges = s.edges;
      if (removals.length) {
        // removing a VPC removes its children too
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
      const removing = changes.some((c) => c.type === 'remove');
      return { edges: applyEdgeChanges(changes, s.edges), ...(removing ? { past: [...s.past.slice(-80), snapOf(s)], future: [] } : {}) };
    }),

  addNode: (type, pos) => {
    const def = CATALOG[type];
    if (!def) return null;
    const s = get();
    const props = defaultProps(type);
    props.name = uniqueName(s.nodes, type, String(props.name));
    let nodes = [...s.nodes];
    const id = nid(type.split('.')[1].slice(0, 3));
    let node: CNode;

    if (type === 'aws.vpc') {
      node = { id, type: 'vpc', position: pos, style: { width: VPC_DEFAULT.w, height: VPC_DEFAULT.h }, zIndex: -1, data: { type, properties: props } };
    } else if (def.parent) {
      // find (or create) the VPC this node belongs in
      let vpc = nodes.find((n) => n.data.type === 'aws.vpc' && inside(n, pos)) ?? nodes.find((n) => n.data.type === 'aws.vpc');
      if (!vpc) {
        const vp = { ...defaultProps('aws.vpc') };
        vp.name = 'main';
        vpc = { id: nid('vpc'), type: 'vpc', position: { x: Math.max(0, pos.x - 300), y: Math.max(0, pos.y - 200) }, style: { width: VPC_DEFAULT.w, height: VPC_DEFAULT.h }, zIndex: -1, data: { type: 'aws.vpc', properties: vp } };
        nodes = [vpc, ...nodes];
      }
      const w = Number(vpc.style?.width ?? VPC_DEFAULT.w);
      const rel = { x: pos.x - vpc.position.x, y: pos.y - vpc.position.y };
      const x = Math.min(Math.max(rel.x, 24), w - 120);
      const y = LANE_Y[def.tier ?? 'private'] + (LANE_H - 96) / 2;
      node = { id, type: 'resource', position: { x, y }, parentId: vpc.id, extent: 'parent', data: { type, properties: props } };
    } else {
      node = { id, type: 'resource', position: pos, data: { type, properties: props } };
    }
    set({ nodes: [...nodes, node], past: [...s.past.slice(-80), snapOf(s)], future: [], selected: id });
    return id;
  },

  addEdge: (source, target) => {
    const s = get();
    if (s.edges.some((e) => e.source === source && e.target === target)) return;
    set({ edges: [...s.edges, { id: nid('e'), source, target, type: 'cc' }], past: [...s.past.slice(-80), snapOf(s)], future: [] });
  },

  setProp: (id, key, value) =>
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, properties: { ...n.data.properties, [key]: value } } } : n)),
      past: s.past.length && s.future.length === 0 && lastProp === `${id}.${key}` ? s.past : [...s.past.slice(-80), snapOf(s)],
      future: [],
      ...((lastProp = `${id}.${key}`), {}),
    })),

  select: (selected) => set({ selected }),
  setConnecting: (connectingFrom) => set({ connectingFrom }),

  undo: () => { const s = get(); const p = s.past.at(-1); if (!p) return; set({ ...p, past: s.past.slice(0, -1), future: [snapOf(s), ...s.future], selected: null }); lastProp = ''; },
  redo: () => { const s = get(); const f = s.future[0]; if (!f) return; set({ ...f, future: s.future.slice(1), past: [...s.past, snapOf(s)], selected: null }); lastProp = ''; },

  load: (g) => { const s = get(); const { nodes, edges } = fromGraph(g); set({ nodes, edges, project: g.project, selected: null, past: [...s.past.slice(-80), snapOf(s)], future: [] }); },
  openGraph: (g) => { const { nodes, edges } = fromGraph(g); lastProp = ''; set({ nodes, edges, project: g.project, selected: null, past: [], future: [], diagnostics: [] }); },
  clear: () => { const s = get(); set({ nodes: [], edges: [], selected: null, past: [...s.past.slice(-80), snapOf(s)], future: [] }); },

  toggleDark: () => set((s) => { try { localStorage.setItem('cc-dark', s.dark ? '0' : '1'); } catch { /* ignore */ } return { dark: !s.dark }; }),
  setView: (view) => set({ view }),
}));

let lastProp = '';

function inside(n: CNode, p: { x: number; y: number }) {
  const w = Number(n.style?.width ?? VPC_DEFAULT.w), h = Number(n.style?.height ?? VPC_DEFAULT.h);
  return p.x >= n.position.x && p.x <= n.position.x + w && p.y >= n.position.y && p.y <= n.position.y + h;
}
