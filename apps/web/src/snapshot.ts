import { CATALOG, type ArchDiff, type Graph } from '@cloudcanvas/compiler';
import { fromGraph, type CEdge, type CNode } from './store';

/** A historical version as read-only canvas nodes, coloured by what changed versus the version it is compared with. */
export interface SnapshotView { graph: Graph; base: Graph | null; diff: ArchDiff | null }

export function snapshot(h: SnapshotView, selectedId: string | null): { nodes: CNode[]; edges: CEdge[] } {
  const g = h.graph;
  const { nodes, edges } = fromGraph(g);
  const d = h.diff;
  const keyOf = (n: CNode) => `${n.data.type}:${n.data.type === 'aws.subnet' ? String(nodes.find((x) => x.id === n.parentId)?.data.properties.name ?? '') + '/' : ''}${n.data.properties.name}`;
  const added = new Set(d?.added.map((x) => x.key)), changed = new Set(d?.changed.map((x) => x.node.key));
  const out: CNode[] = nodes.map((n) => {
    const k = keyOf(n);
    const change = added.has(k) ? 'added' : changed.has(k) ? 'changed' : undefined;
    return { ...n, draggable: false, selectable: true, connectable: false, selected: n.id === selectedId, data: { ...n.data, ...(change ? { change } : {}) } };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ek = (id: string) => { const n = byId.get(id); return n ? keyOf(n) : ''; };
  const addedE = new Set(d?.edgesAdded.map((e) => `${e.source.key}>${e.target.key}`));
  const outE: CEdge[] = edges.map((e) => ({ ...e, selectable: false, className: addedE.has(`${ek(e.source)}>${ek(e.target)}`) ? 'added' : '' }));
  // things that existed in the older version but are gone now, shown ghosted so the removal is visible
  if (h.base && d) {
    const gone = new Set(d.removed.map((x) => x.key));
    const old = fromGraph(h.base);
    const oldById = new Map(old.nodes.map((n) => [n.id, n]));
    const okey = (n: CNode) => `${n.data.type}:${n.data.type === 'aws.subnet' ? String(old.nodes.find((x) => x.id === n.parentId)?.data.properties.name ?? '') + '/' : ''}${n.data.properties.name}`;
    const keep = new Set(out.map((n) => n.id));
    // the older VPC may have been bigger (an availability zone was removed): grow ours so the ghosts sit inside it
    for (const ov of old.nodes.filter((n) => n.data.type === 'aws.vpc')) {
      const mine = out.find((n) => n.data.type === 'aws.vpc' && n.data.properties.name === ov.data.properties.name);
      if (mine) { const w = Math.max(Number(mine.width ?? 0), Number(ov.width ?? 0)), h = Math.max(Number(mine.height ?? 0), Number(ov.height ?? 0)); mine.width = w; mine.height = h; mine.style = { ...mine.style, width: w, height: h }; }
    }
    for (const n of old.nodes) {
      if (!gone.has(okey(n))) continue;
      const parentOk = !n.parentId || keep.has(n.parentId);
      // a removed free-standing service has no home in this layout: stack it under the others in the free column
      let position = n.position;
      if (!(parentOk && n.parentId)) {
        const free = out.filter((x) => !x.parentId && !CATALOG[x.data.type]?.container);
        const vpcRight = out.filter((x) => x.data.type === 'aws.vpc').reduce((m, v) => Math.max(m, v.position.x + Number(v.width ?? 0) + 60), 0);
        position = { x: free[0]?.position.x ?? vpcRight, y: free.reduce((m, x) => Math.max(m, x.position.y + 150), 0) };
      }
      out.push({ ...n, id: `gone-${n.id}`, parentId: parentOk && n.parentId ? n.parentId : undefined, position, draggable: false, selectable: false, connectable: false, data: { ...n.data, change: 'removed' } });
    }
    for (const e of d.edgesRemoved) {
      const s = old.nodes.find((n) => okey(n) === e.source.key), t = old.nodes.find((n) => okey(n) === e.target.key);
      if (!s || !t) continue;
      const sid = out.find((n) => n.id === `gone-${s.id}`) ? `gone-${s.id}` : nodes.find((n) => keyOf(n) === e.source.key)?.id;
      const tid = out.find((n) => n.id === `gone-${t.id}`) ? `gone-${t.id}` : nodes.find((n) => keyOf(n) === e.target.key)?.id;
      if (sid && tid) outE.push({ id: `gone-${s.id}-${t.id}`, source: sid, target: tid, type: 'cc', selectable: false, className: 'removed' });
    }
  }
  return { nodes: out, edges: outE };
}
