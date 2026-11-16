import { memo } from 'react';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { CATALOG, edgeRule, type Diagnostic } from '@cloudcanvas/compiler';
import { useStore, type CNode } from '../store';

const icon = (name: string) => `/aws-icons/${name}.svg`;

function Compliance({ id }: { id: string }) {
  const f = useStore((s) => s.findings).filter((x) => x.nodeId === id);
  if (!f.length) return null;
  const high = f.some((x) => x.severity === 'high');
  return <div className="badge" data-testid="compliance-badge" title={f.map((x) => `${x.rule} · ${x.title}`).join('\n')} style={{ right: 'auto', left: 12, background: high ? 'var(--err)' : 'var(--warn)' }}>⚑{f.length}</div>;
}

function Badges({ id }: { id: string }) {
  const d = useStore((s) => s.diagnostics);
  const mine = d.filter((x: Diagnostic) => x.nodeId === id);
  const e = mine.filter((x) => x.severity === 'error').length;
  const w = mine.filter((x) => x.severity === 'warning').length;
  const title = mine.map((x) => x.message).join('\n');
  if (e) return <div className="badge error" title={title}>{e}</div>;
  if (w) return <div className="badge warning" title={title}>{w}</div>;
  return null;
}

export const ResourceNode = memo(({ id, data, selected }: NodeProps<CNode>) => {
  const def = CATALOG[data.type];
  const from = useStore((s) => s.connectingFrom);
  const invalid = from ? !edgeRule(from, data.type) : false;
  if (!def) return null;
  return (
    <div className={`cc-node ${selected ? 'selected' : ''} ${invalid ? 'invalid' : ''} ${data.change ? 'chg-' + data.change : ''}`}>
      {data.change && <div className={`chg-tag ${data.change}`}>{data.change === 'added' ? '+' : data.change === 'removed' ? '−' : '~'}</div>}
      <Badges id={id} />
      <Compliance id={id} />
      <Handle type="target" position={Position.Left} />
      <div className="tile"><img src={icon(def.icon)} alt="" draggable={false} /></div>
      <div className="type">{def.label}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});

const tierColor = (tier: unknown) => (tier === 'public' ? '#7aa116' : '#00a4a6');

/** AWS group style: solid coloured border, icon as a flush square tab in the top-left corner. */
const Corner = ({ icon, size, radius }: { icon: string; size: number; radius: number }) => (
  <img src={`/aws-icons/${icon}.svg`} width={size} height={size} alt="" draggable={false}
    style={{ position: 'absolute', left: -1.5, top: -1.5, borderTopLeftRadius: radius, display: 'block' }} />
);

const resizer = (min: { w: number; h: number }) => ({
  minWidth: min.w, minHeight: min.h,
  lineStyle: { borderColor: 'var(--accent)' },
  handleStyle: { background: 'var(--accent)', width: 8, height: 8, borderRadius: 3 },
  onResizeStart: () => useStore.getState().checkpoint(),
});

export const VpcNode = memo(({ id, data, selected }: NodeProps<CNode>) => (
  <div className={`group-vpc ${selected ? 'selected' : ''} ${data.change ? 'chg-' + data.change : ''}`}>
    <NodeResizer isVisible={selected} {...resizer({ w: 440, h: 220 })} />
    <Badges id={id} />
    <Corner icon="virtual-private-cloud-vpc" size={40} radius={13} />
    <div style={{ position: 'absolute', top: 0, left: 50, height: 40, display: 'flex', alignItems: 'center', gap: 10 }}>
      <b style={{ fontSize: 13, fontWeight: 600 }}>VPC</b>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{String(data.properties.name)}</span>
      <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{String(data.properties.cidr)}</span>
    </div>
  </div>
));

export const SubnetNode = memo(({ id, data, selected }: NodeProps<CNode>) => {
  const color = tierColor(data.properties.tier);
  return (
    <div className={`group-subnet ${selected ? 'selected' : ''} ${data.change ? 'chg-' + data.change : ''}`} style={{ borderColor: color, background: `color-mix(in srgb, ${color} 9%, transparent)` }}>
      <NodeResizer isVisible={selected} {...resizer({ w: 200, h: 110 })} />
      <Badges id={id} />
      <Corner icon={data.properties.tier === 'public' ? 'public-subnet' : 'private-subnet'} size={30} radius={7} />
      <div style={{ position: 'absolute', top: 0, left: 38, right: 8, height: 30, display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', whiteSpace: 'nowrap' }}>
        <b style={{ fontSize: 12, fontWeight: 500 }}>{String(data.properties.name)}</b>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>{String(data.properties.cidr)}</span>
      </div>
    </div>
  );
});
