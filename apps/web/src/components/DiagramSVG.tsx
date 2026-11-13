import { useId } from 'react';
import { CATALOG, SUB, type Graph, type GraphNode } from '@cloudcanvas/compiler';

const W = 96, H = 108, TILE = 56;
const tierColor = (t: unknown) => (t === 'public' ? '#7aa116' : '#00a4a6');

/** Static, dependency-free rendering of a graph. Used for dashboard thumbnails and the template preview. */
export function DiagramSVG({ graph, detail }: { graph: Graph; detail: 'mini' | 'full' }) {
  const uid = useId().replace(/:/g, '');
  const full = detail === 'full';
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const abs = (n: GraphNode) => {
    let x = n.position.x, y = n.position.y;
    let p = n.parentId ? byId.get(n.parentId) : undefined;
    for (let i = 0; p && i < 5; i++) { x += p.position.x; y += p.position.y; p = p.parentId ? byId.get(p.parentId) : undefined; }
    return { x, y };
  };
  const size = (n: GraphNode) => (n.type === 'aws.vpc' ? n.size ?? { w: 880, h: 540 } : n.type === 'aws.subnet' ? n.size ?? { w: SUB.w, h: SUB.h } : { w: W, h: H });
  if (!graph.nodes.length) return null;

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of graph.nodes) {
    const a = abs(n), { w, h } = size(n);
    x0 = Math.min(x0, a.x); y0 = Math.min(y0, a.y); x1 = Math.max(x1, a.x + w); y1 = Math.max(y1, a.y + h);
  }
  const pad = 28;
  const vb = `${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`;
  const sw = full ? 1.6 : 2.4;

  const centre = (id: string) => { const a = abs(byId.get(id)!); return { x: a.x + W / 2, y: a.y + TILE / 2 }; };
  const edgePath = (s: string, t: string) => {
    const a = centre(s), b = centre(t);
    if (Math.abs(a.x - b.x) < 40) {
      const dir = b.y > a.y ? 1 : -1;
      return `M${a.x} ${a.y + (dir * TILE) / 2} V${b.y - (dir * TILE) / 2}`;
    }
    const dir = b.x > a.x ? 1 : -1;
    const sx = a.x + (dir * TILE) / 2, tx = b.x - (dir * TILE) / 2, mid = (sx + tx) / 2;
    return a.y === b.y ? `M${sx} ${a.y} H${tx}` : `M${sx} ${a.y} H${mid} V${b.y} H${tx}`;
  };

  return (
    <svg viewBox={vb} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
      <defs>
        <marker id={`a${uid}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth={full ? 7 : 11} markerHeight={full ? 7 : 11} orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="var(--muted)" />
        </marker>
        <clipPath id={`c${uid}`} clipPathUnits="objectBoundingBox"><rect width="1" height="1" rx="0.18" /></clipPath>
      </defs>

      {graph.nodes.filter((n) => n.type === 'aws.vpc').map((n) => {
        const a = abs(n), { w, h } = size(n);
        return (
          <g key={n.id}>
            <rect x={a.x} y={a.y} width={w} height={h} rx={14} fill="none" stroke="#8c4fff" strokeWidth={sw} />
            <image href="/aws-icons/virtual-private-cloud-vpc.svg" x={a.x} y={a.y} width={40} height={40} />
            {full && <text x={a.x + 50} y={a.y + 25} fontSize={13} fontWeight={600} fill="var(--text)">VPC  <tspan fill="var(--muted)" fontWeight={400}>{String(n.properties.name)}  {String(n.properties.cidr)}</tspan></text>}
          </g>
        );
      })}

      {graph.nodes.filter((n) => n.type === 'aws.subnet').map((n) => {
        const a = abs(n), { w, h } = size(n), c = tierColor(n.properties.tier);
        return (
          <g key={n.id}>
            <rect x={a.x} y={a.y} width={w} height={h} rx={8} fill={c} fillOpacity={0.09} stroke={c} strokeWidth={sw} />
            <image href={`/aws-icons/${n.properties.tier === 'public' ? 'public' : 'private'}-subnet.svg`} x={a.x} y={a.y} width={30} height={30} />
            {full && <text x={a.x + 38} y={a.y + 20} fontSize={12} fontWeight={500} fill="var(--text)">{String(n.properties.name)}  <tspan fill="var(--muted)" fontSize={10.5}>{String(n.properties.cidr)}</tspan></text>}
          </g>
        );
      })}

      {graph.edges.filter((e) => byId.has(e.source) && byId.has(e.target)).map((e) => (
        <path key={e.id} d={edgePath(e.source, e.target)} fill="none" stroke="var(--muted)" strokeWidth={sw} markerEnd={`url(#a${uid})`} />
      ))}

      {graph.nodes.filter((n) => !CATALOG[n.type]?.container).map((n) => {
        const def = CATALOG[n.type];
        const a = abs(n);
        if (!def) return null;
        return (
          <g key={n.id}>
            <image href={`/aws-icons/${def.icon}.svg`} x={a.x + (W - TILE) / 2} y={a.y} width={TILE} height={TILE} clipPath={`url(#c${uid})`} />
            {full && (
              <>
                <text x={a.x + W / 2} y={a.y + TILE + 16} textAnchor="middle" fontSize={11} fill="var(--muted)">{def.label}</text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
