import { memo } from 'react';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { CATALOG, edgeRule, type Diagnostic } from '@cloudcanvas/compiler';
import { LANE_H, LANE_Y, useStore, type CNode } from '../store';

const icon = (name: string) => `/aws-icons/${name}.svg`;

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
    <div className={`cc-node ${selected ? 'selected' : ''} ${invalid ? 'invalid' : ''}`}>
      <Badges id={id} />
      <Handle type="target" position={Position.Left} />
      <div className="tile"><img src={icon(def.icon)} alt="" draggable={false} /></div>
      <div className="name">{String(data.properties.name)}</div>
      <div className="type">{def.label}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});

const TIERS: { key: string; label: string; color: string; icon: string }[] = [
  { key: 'public', label: 'PUBLIC SUBNETS', color: '#7aa116', icon: 'public-subnet' },
  { key: 'private', label: 'PRIVATE SUBNETS', color: '#00a4a6', icon: 'private-subnet' },
  { key: 'database', label: 'DATABASE SUBNETS', color: '#3b48cc', icon: 'private-subnet' },
];

export const VpcNode = memo(({ id, data, selected }: NodeProps<CNode>) => (
  <div className={`group-vpc ${selected ? 'selected' : ''}`}>
    <NodeResizer isVisible={selected} minWidth={640} minHeight={540} lineStyle={{ borderColor: 'var(--accent)' }} handleStyle={{ background: 'var(--accent)', width: 8, height: 8, borderRadius: 3 }} />
    <Badges id={id} />
    <div style={{ position: 'absolute', top: 12, left: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
      <img src={icon('virtual-private-cloud-vpc')} width={22} height={22} alt="" />
      <b style={{ fontSize: 12, color: '#8c4fff' }}>VPC · {String(data.properties.name)}</b>
      <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{String(data.properties.cidr)}</span>
    </div>
    {TIERS.map((t) => (
      <div key={t.key} className="group-tier" style={{ top: LANE_Y[t.key], height: LANE_H, borderColor: t.color + '99', background: t.color + '0d' }}>
        <span style={{ color: t.color }}><img src={icon(t.icon)} alt="" />{t.label}</span>
      </div>
    ))}
    <Handle type="target" position={Position.Left} style={{ top: 20 }} />
    <Handle type="source" position={Position.Right} style={{ top: 20 }} />
  </div>
));
