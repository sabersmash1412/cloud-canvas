import { useId } from 'react';
import { CATALOG, type Graph, type GraphNode } from '@cloudcanvas/compiler';
import { LANE_H, LANE_Y } from '../store';

const W = 96, H = 108, TILE = 56;
const TIERS = [
  { key: 'public', color: '#7aa116', label: 'Public subnets', icon: 'public-subnet' },
  { key: 'private', color: '#00a4a6', label: 'Private subnets', icon: 'private-subnet' },
  { key: 'database', color: '#00a4a6', label: 'Database subnets', icon: 'private-subnet' },
];

/** Static, dependency-free rendering of a graph. Used for dashboard thumbnails and the template preview. */
export function DiagramSVG({ graph, detail }: { graph: Graph; detail: 'mini' | 'full' }) {
  const uid = useId().replace(/:/g, '');
  const full = detail === 'full';
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const abs = (n: GraphNode) => {
    const p = n.parentId ? byId.get(n.parentId) : undefined;
    return { x: n.position.x + (p?.position.x ?? 0), y: n.position.y + (p?.position.y ?? 0) };
  };
  if (!graph.nodes.length) return null;

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of graph.nodes) {
    const a = abs(n);
    const w = n.type === 'aws.vpc' ? n.size?.w ?? 880 : W;
    const h = n.type === 'aws.vpc' ? n.size?.h ?? 540 : H;
    x0 = Math.min(x0, a.x); y0 = Math.min(y0, a.y); x1 = Math.max(x1, a.x + w); y1 = Math.max(y1, a.y + h);
  }
  const pad = 28;
  const vb = `${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`;
  const sw = full ? 1.6 : 2.4;

  const centre = (id: string) => { const n = byId.get(id)!; const a = abs(n); return { x: a.x + W / 2, y: a.y + TILE / 2 }; };
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
        const a = abs(n), w = n.size?.w ?? 880, h = n.size?.h ?? 540;
        return (
          <g key={n.id}>
            <rect x={a.x} y={a.y} width={w} height={h} rx={14} fill="none" stroke="#8c4fff" strokeWidth={sw} />
            {TIERS.map((t) => (
              <g key={t.key}>
                <rect x={a.x + 14} y={a.y + LANE_Y[t.key]} width={w - 28} height={LANE_H} rx={8} fill={t.color} fillOpacity={0.09} stroke={t.color} strokeWidth={sw} />
                <image href={`/aws-icons/${t.icon}.svg`} x={a.x + 14} y={a.y + LANE_Y[t.key]} width={30} height={30} />
                {full && <text x={a.x + 54} y={a.y + LANE_Y[t.key] + 20} fontSize={12} fontWeight={500} fill="var(--text)">{t.label}</text>}
              </g>
            ))}
            <image href="/aws-icons/virtual-private-cloud-vpc.svg" x={a.x} y={a.y} width={40} height={40} />
            {full && <text x={a.x + 50} y={a.y + 25} fontSize={13} fontWeight={600} fill="var(--text)">VPC  <tspan fill="var(--muted)" fontWeight={400}>{String(n.properties.name)}  {String(n.properties.cidr)}</tspan></text>}
          </g>
        );
      })}

      {graph.edges.filter((e) => byId.has(e.source) && byId.has(e.target)).map((e) => (
        <path key={e.id} d={edgePath(e.source, e.target)} fill="none" stroke="var(--muted)" strokeWidth={sw} markerEnd={`url(#a${uid})`} />
      ))}

      {graph.nodes.filter((n) => n.type !== 'aws.vpc').map((n) => {
        const def = CATALOG[n.type];
        const a = abs(n);
        if (!def) return null;
        return (
          <g key={n.id}>
            <image href={`/aws-icons/${def.icon}.svg`} x={a.x + (W - TILE) / 2} y={a.y} width={TILE} height={TILE} clipPath={`url(#c${uid})`} />
            {full && (
              <>
                <text x={a.x + W / 2} y={a.y + TILE + 16} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--text)">{String(n.properties.name)}</text>
                <text x={a.x + W / 2} y={a.y + TILE + 30} textAnchor="middle" fontSize={10} fill="var(--muted)">{def.label}</text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
