import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight, Code2, LayoutList, Search, XCircle } from 'lucide-react';
import { CATALOG, type CompileResult, type Diagnostic } from '@cloudcanvas/compiler';
import { useStore, type CNode } from '../store';
import { CodeView, NodeCode } from './CodeView';
import { FullConfig, RefChip, Row, ShowFull, Value, humanize } from './Config';
import { DeleteNode, NodeForm } from './Form';

type Tab = 'list' | 'code' | 'issues';

/** Pick the few settings worth showing on a card: user-facing fields first, then derived wiring. */
function summary(node: CNode, result: CompileResult) {
  const def = CATALOG[node.data.type];
  const d = result.details[node.id];
  const rows: { label: string; node: React.ReactNode }[] = [];
  for (const f of def.fields) {
    if (f.key === 'name' || rows.length >= 4) continue;
    const v = node.data.properties[f.key] ?? f.default;
    rows.push({ label: f.label, node: <span className="mono" style={{ fontSize: 12.5, overflowWrap: 'anywhere', color: typeof v === 'string' ? 'var(--str)' : typeof v === 'boolean' ? 'var(--bool)' : 'var(--num)' }}>{String(v)}</span> });
  }
  return { rows, extra: d ? d.inputs.filter((i) => i.refs.length > 0 && i.kind === 'ref').length : 0 };
}

function Card({ node, result, selected, go, onOpen }: { node: CNode; result: CompileResult; selected: boolean; go: (id: string) => void; onOpen: () => void }) {
  const def = CATALOG[node.data.type];
  const ref = useRef<HTMLDivElement>(null);
  const diags = useStore((s) => s.diagnostics).filter((d) => d.nodeId === node.id && d.severity !== 'info');
  useEffect(() => { if (selected) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [selected]);
  const { rows } = summary(node, result);
  const refs = result.details[node.id]?.inputs.filter((i) => i.kind === 'ref' && i.refs[0] && i.refs[0].nodeId !== node.id).slice(0, 3) ?? [];
  const worst = diags.some((d) => d.severity === 'error') ? 'error' : diags.length ? 'warning' : null;
  return (
    <div ref={ref} className={`rcard ${selected ? 'sel' : ''}`} data-testid="rcard" data-node={node.id} onClick={() => useStore.getState().select(node.id)} style={{ padding: 14, cursor: 'pointer' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <img src={`/aws-icons/${def.icon}.svg`} width={30} height={30} style={{ borderRadius: 7, flex: 'none' }} alt="" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(node.data.properties.name)}</div>
          <div style={{ color: 'var(--muted)', fontSize: 11.5 }}>{def.label}</div>
        </div>
        {worst && <span title={diags.map((d) => d.message).join('\n')} style={{ color: worst === 'error' ? 'var(--err)' : 'var(--warn)', display: 'flex' }}>{worst === 'error' ? <XCircle size={16} /> : <AlertTriangle size={16} />}</span>}
        <button className="btn icon" style={{ border: 0, width: 28, height: 28 }} title="Open details" data-testid="open-detail" onClick={(e) => { e.stopPropagation(); useStore.getState().select(node.id); onOpen(); }}><ChevronRight size={16} /></button>
      </div>
      {rows.map((r) => <Row key={r.label} label={r.label}>{r.node}</Row>)}
      {refs.map((r) => <Row key={r.key} label={humanize(r.key)}><Value input={r} go={go} /></Row>)}
    </div>
  );
}

function Detail({ node, result, onBack, go }: { node: CNode; result: CompileResult; onBack: () => void; go: (id: string) => void }) {
  const def = CATALOG[node.data.type];
  const [mode, setMode] = useState<'form' | 'code'>('form');
  const [full, setFull] = useState(false);
  const d = result.details[node.id];
  const block = result.blocks.find((b) => b.nodeId === node.id);
  const main = result.files.find((f) => f.path === 'main.tf');
  const text = useMemo(() => {
    if (!block || !main) return '';
    return main.content.split('\n').slice(block.startLine - 1, block.endLine).join('\n');
  }, [block, main]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
        <button className="btn icon" style={{ border: 0 }} data-testid="detail-back" aria-label="Back to list" onClick={onBack}><ArrowLeft size={16} /></button>
        <img src={`/aws-icons/${def.icon}.svg`} width={28} height={28} style={{ borderRadius: 7 }} alt="" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(node.data.properties.name)}</div>
          <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d ? `${d.source.replace('terraform-aws-modules/', '')} ${d.version}` : def.label}</div>
        </div>
        <div style={{ display: 'flex', gap: 2, background: 'var(--panel-2)', borderRadius: 9, padding: 3 }}>
          <button className={`tabbtn ${mode === 'form' ? 'on' : ''}`} data-testid="mode-form" onClick={() => setMode('form')}>Form</button>
          <button className={`tabbtn ${mode === 'code' ? 'on' : ''}`} data-testid="mode-code" onClick={() => setMode('code')}>Code</button>
        </div>
      </div>
      {mode === 'form' ? (
        <div style={{ overflow: 'auto', flex: 1 }}>
          <NodeForm id={node.id} />
          {d && (
            <div style={{ padding: '0 16px 24px' }}>
              <ShowFull open={full} onToggle={() => setFull(!full)} />
              {full && (
                <div data-testid="full-config" style={{ marginTop: 6, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                  {d.virtual && <div style={{ color: 'var(--muted)', fontSize: 12, lineHeight: 1.45, marginBottom: 6 }}>Subnets are generated by the VPC module. These are the inputs of that module.</div>}
                  <FullConfig inputs={d.inputs} go={go} />
                  {d.companions.length > 0 && (
                    <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>Also generates: {d.companions.map((c) => <span key={c.label} className="mono kbd" style={{ marginRight: 5 }}>{c.label}</span>)}</div>
                  )}
                </div>
              )}
            </div>
          )}
          <div style={{ padding: '0 16px 24px' }}><DeleteNode id={node.id} /></div>
        </div>
      ) : text ? (
        <div style={{ flex: 1, minHeight: 0 }}><NodeCode text={text} /></div>
      ) : (
        <div style={{ padding: 24, color: 'var(--muted)', lineHeight: 1.5 }}>Fix the errors on this resource to see its Terraform.</div>
      )}
    </div>
  );
}

function Issues({ items, go }: { items: Diagnostic[]; go: (id: string) => void }) {
  const nodes = useStore((s) => s.nodes);
  if (!items.length)
    return <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--muted)' }}><CheckCircle2 size={30} style={{ color: 'var(--ok)', marginBottom: 10 }} /><div style={{ fontWeight: 600, color: 'var(--text)' }}>No issues</div><div style={{ marginTop: 4 }}>Everything on the canvas is valid.</div></div>;
  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto', height: '100%', boxSizing: 'border-box' }}>
      {items.map((d, i) => {
        const n = nodes.find((x) => x.id === d.nodeId);
        const def = n && CATALOG[n.data.type];
        return (
          <button key={i} data-testid="issue" onClick={() => d.nodeId && go(d.nodeId)} style={{ all: 'unset', boxSizing: 'border-box', cursor: d.nodeId ? 'pointer' : 'default', display: 'flex', gap: 10, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--panel)' }}>
            <span style={{ color: d.severity === 'error' ? 'var(--err)' : 'var(--warn)', display: 'flex', paddingTop: 1 }}>{d.severity === 'error' ? <XCircle size={16} /> : <AlertTriangle size={16} />}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ lineHeight: 1.4 }}>{d.message}</div>
              {n && def && <div style={{ color: 'var(--muted)', fontSize: 11.5, marginTop: 3 }}>{def.label} · {String(n.data.properties.name)}</div>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function SidePanel({ result }: { result: CompileResult }) {
  const nodes = useStore((s) => s.nodes);
  const selected = useStore((s) => s.selected);
  const diagnostics = useStore((s) => s.diagnostics);
  const [tab, setTab] = useState<Tab>('list');
  const [detail, setDetail] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [width, setWidth] = useState(() => Number(localStorage.getItem('cc-panel-w')) || 440);

  const issues = diagnostics.filter((d) => d.severity !== 'info');
  const errors = issues.filter((d) => d.severity === 'error').length;
  const go = (id: string) => { useStore.getState().select(id); setDetail(id); setTab('list'); };
  const node = detail ? nodes.find((n) => n.id === detail) : undefined;

  // Selecting on the canvas: subnets have no card, so open their detail; an open detail follows the selection.
  useEffect(() => {
    if (!selected) return;
    const n = nodes.find((x) => x.id === selected);
    if (n && (detail !== null || n.data.type === 'aws.subnet')) setDetail(selected); // never yank the user off the tab they're on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // a deleted node can't stay open
  useEffect(() => { if (detail && !nodes.some((n) => n.id === detail)) setDetail(null); }, [nodes, detail]);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return [...nodes]
      .filter((n) => !CATALOG[n.data.type]?.container || n.data.type === 'aws.vpc')
      .filter((n) => !t || (String(n.data.properties.name) + CATALOG[n.data.type]?.label).toLowerCase().includes(t))
      .sort((a, b) => (CATALOG[a.data.type]?.category ?? '').localeCompare(CATALOG[b.data.type]?.category ?? '') || String(a.data.properties.name).localeCompare(String(b.data.properties.name)));
  }, [nodes, q]);
  const subnets = nodes.filter((n) => n.data.type === 'aws.subnet');

  const drag = (e: React.MouseEvent) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = width;
    const move = (m: MouseEvent) => setWidth(Math.min(860, Math.max(340, w0 + (x0 - m.clientX))));
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); setWidth((w) => { try { localStorage.setItem('cc-panel-w', String(w)); } catch { /* ignore */ } return w; }); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div className="panel" data-testid="side-panel" style={{ width, flex: 'none', display: 'flex', flexDirection: 'column', overflow: 'visible', position: 'relative', minWidth: 0 }}>
      <div className="resize-h" onMouseDown={drag} role="separator" aria-label="Resize panel" />
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden', borderRadius: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', gap: 2, background: 'var(--panel-2)', borderRadius: 10, padding: 3 }}>
            <button className={`tabbtn ${tab === 'list' ? 'on' : ''}`} data-testid="tab-list" aria-label="Resources" title="Resources" onClick={() => { setTab('list'); }}><LayoutList size={15} /></button>
            <button className={`tabbtn ${tab === 'code' ? 'on' : ''}`} data-testid="tab-code" aria-label="All code" title="All code" onClick={() => setTab('code')}><Code2 size={15} /></button>
          </div>
          <button className={`tabbtn ${tab === 'issues' ? 'on' : ''}`} data-testid="tab-issues" onClick={() => setTab('issues')}>
            {errors ? <XCircle size={14} style={{ color: 'var(--err)' }} /> : issues.length ? <AlertTriangle size={14} style={{ color: 'var(--warn)' }} /> : <CheckCircle2 size={14} style={{ color: 'var(--ok)' }} />}
            Issues{issues.length > 0 && <span style={{ fontSize: 11, padding: '0 6px', borderRadius: 8, background: errors ? 'var(--err)' : 'var(--warn)', color: '#fff' }}>{issues.length}</span>}
          </button>
          <div style={{ flex: 1 }} />
          {tab === 'list' && !node && (
            <div style={{ position: 'relative' }}>
              <Search size={13} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--muted)' }} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" style={{ width: 120, height: 30, padding: '0 8px 0 27px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--panel-2)', color: 'var(--text)', outline: 'none' }} />
            </div>
          )}
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {tab === 'issues' ? <Issues items={issues} go={go} />
            : tab === 'code' ? <CodeView result={result} onSelect={(id) => { useStore.getState().select(id); }} />
            : node ? <Detail key={node.id} node={node} result={result} onBack={() => setDetail(null)} go={go} />
            : (
              <div style={{ overflow: 'auto', height: '100%', padding: 12, display: 'flex', flexDirection: 'column', gap: 10, boxSizing: 'border-box' }}>
                {list.length === 0 && <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--muted)' }}>{nodes.length ? 'No resources match.' : 'Resources you add to the canvas appear here.'}</div>}
                {list.map((n) => <Card key={n.id} node={n} result={result} selected={selected === n.id} go={go} onOpen={() => setDetail(n.id)} />)}
                {!q && subnets.length > 0 && <div style={{ color: 'var(--muted)', fontSize: 11.5, textAlign: 'center', padding: '4px 0 8px' }}>{subnets.length} subnet{subnets.length === 1 ? '' : 's'} · click one on the canvas to edit it</div>}
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
