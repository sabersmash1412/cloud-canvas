import { useState } from 'react';
import { ChevronRight, Plus, Minus } from 'lucide-react';
import { CATALOG, type DetailInput } from '@cloudcanvas/compiler';
import { useStore } from '../store';

export const humanize = (k: string) => (k.charAt(0).toUpperCase() + k.slice(1)).replace(/_/g, ' ');

export function RefChip({ nodeId, attr, go }: { nodeId: string; attr?: string; go: (id: string) => void }) {
  const n = useStore((s) => s.nodes.find((x) => x.id === nodeId));
  if (!n) return null;
  const def = CATALOG[n.data.type];
  return (
    <button className="chip" title={`Go to ${def?.label ?? ''} ${n.data.properties.name}`} onClick={(e) => { e.stopPropagation(); go(nodeId); }}>
      {def && <img src={`/aws-icons/${def.icon}.svg`} alt="" />}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(n.data.properties.name)}{attr ? <span style={{ opacity: 0.65 }}>.{attr}</span> : null}</span>
    </button>
  );
}

export function Value({ input, go }: { input: DetailInput; go: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  if (input.kind === 'ref' && input.refs[0]) return <RefChip nodeId={input.refs[0].nodeId} attr={input.refs[0].attr} go={go} />;
  const color = input.kind === 'string' ? 'var(--str)' : input.kind === 'boolean' ? 'var(--bool)' : 'var(--num)';
  if (input.kind === 'object' || input.kind === 'list' || input.kind === 'expr') {
    const multi = input.text.includes('\n');
    return (
      <div style={{ minWidth: 0 }}>
        <button onClick={() => setOpen(!open)} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--muted)' }}>
          <ChevronRight size={13} style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform .15s' }} />
          <span className="mono" style={{ fontSize: 11.5 }}>{input.kind === 'object' ? '{ … }' : input.kind === 'list' ? `[ ${input.text.startsWith('[') && !multi ? input.text.slice(1, -1).slice(0, 38) : '…'} ]` : input.text.slice(0, 44)}</span>
        </button>
        {open && <pre className="mono" style={{ margin: '6px 0 0', fontSize: 11.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text)', background: 'var(--panel-2)', borderRadius: 8, padding: '8px 10px' }}>{input.text}</pre>}
        {open && input.refs.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>{input.refs.map((r) => <RefChip key={r.nodeId + r.attr} nodeId={r.nodeId} attr={r.attr} go={go} />)}</div>}
      </div>
    );
  }
  return <span className="mono" style={{ color, fontSize: 12.5, overflowWrap: 'anywhere' }}>{input.text}</span>;
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 42%) 1fr', gap: 10, padding: '6px 0', alignItems: 'start' }}>
      <span style={{ fontWeight: 450 }}>{label}</span>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

/** Every module input Cloud Canvas generates for a node (read-only). */
export function FullConfig({ inputs, go }: { inputs: DetailInput[]; go: (id: string) => void }) {
  return <div>{inputs.map((i) => <Row key={i.key} label={humanize(i.key)}><Value input={i} go={go} /></Row>)}</div>;
}

export function ShowFull({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const I = open ? Minus : Plus;
  return (
    <button onClick={onToggle} style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 4px 4px', fontWeight: 500, color: 'var(--text)' }}>
      <I size={15} /> {open ? 'Hide' : 'Show'} full configuration
    </button>
  );
}
