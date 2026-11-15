import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import { edgeRule } from '@cloudcanvas/compiler';
import { useStore } from '../store';

export function CCEdge(p: EdgeProps) {
  const [path] = getSmoothStepPath({ ...p, borderRadius: 14 });
  // The relationship (e.g. "routes to") is only shown as a hover tooltip, to keep the canvas uncluttered.
  const label = useStore((s) => {
    const a = s.nodes.find((n) => n.id === p.source), b = s.nodes.find((n) => n.id === p.target);
    return a && b ? edgeRule(a.data.type, b.data.type)?.label : undefined;
  });
  return (
    <g>
      {label && <title>{label}</title>}
      <BaseEdge id={p.id} path={path} markerEnd={p.markerEnd} interactionWidth={20} style={{ stroke: p.selected ? 'var(--accent)' : 'var(--muted)', strokeWidth: p.selected ? 2.4 : 1.6 }} />
    </g>
  );
}
