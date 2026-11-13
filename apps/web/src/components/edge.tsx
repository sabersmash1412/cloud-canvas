import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import { edgeRule } from '@cloudcanvas/compiler';
import { useStore } from '../store';

export function CCEdge(p: EdgeProps) {
  const [path, lx, ly] = getSmoothStepPath({ ...p, borderRadius: 14 });
  const label = useStore((s) => {
    const a = s.nodes.find((n) => n.id === p.source), b = s.nodes.find((n) => n.id === p.target);
    return a && b ? edgeRule(a.data.type, b.data.type)?.label : undefined;
  });
  return (
    <>
      <BaseEdge id={p.id} path={path} markerEnd={p.markerEnd} style={{ stroke: p.selected ? 'var(--accent)' : 'var(--muted)', strokeWidth: p.selected ? 2.4 : 1.6 }} />
      {label && (
        <EdgeLabelRenderer>
          <div className="mono" style={{ position: 'absolute', transform: `translate(-50%,-50%) translate(${lx}px,${ly}px)`, fontSize: 9.5, padding: '2px 7px', borderRadius: 999, background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--muted)', pointerEvents: 'none' }}>
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
