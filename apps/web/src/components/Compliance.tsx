import { useState } from 'react';
import { Check, ClipboardCopy, ShieldAlert, ShieldCheck, Wrench } from 'lucide-react';
import { CATALOG, findingPrompt, type Finding } from '@cloudcanvas/compiler';
import { useStore } from '../store';
import { RULES_LOADED } from '../rules';
import type { RepoCtl } from '../history';

const sevColor = { high: 'var(--err)', medium: 'var(--warn)', low: 'var(--muted)' } as const;

function Item({ f, repo }: { f: Finding; repo: RepoCtl | null }) {
  const node = useStore((s) => s.nodes.find((n) => n.id === f.nodeId));
  const readOnly = useStore((s) => s.readOnly);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const def = node && CATALOG[node.data.type];
  const prompt = findingPrompt(f, { nodeName: String(node?.data.properties.name ?? f.nodeId), nodeLabel: def?.label ?? 'Resource', folder: repo?.source.path || undefined, repo: repo ? `${repo.source.owner}/${repo.source.repo}` : undefined });
  const copy = async () => { try { await navigator.clipboard.writeText(prompt); } catch { /* ignore */ } setCopied(true); setTimeout(() => setCopied(false), 1800); };
  return (
    <div data-testid="finding" data-rule={f.rule} className="rcard" style={{ padding: 12, borderLeft: `3px solid ${sevColor[f.severity]}`, cursor: 'pointer' }} onClick={() => useStore.getState().select(f.nodeId)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="kbd mono" style={{ color: sevColor[f.severity], borderColor: sevColor[f.severity] }}>{f.rule}</span>
        <b style={{ flex: 1, minWidth: 0 }}>{f.title}</b>
        <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', color: sevColor[f.severity] }}>{f.severity.toUpperCase()}</span>
      </div>
      {node && def && <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, color: 'var(--muted)', fontSize: 11.5 }}><img src={`/aws-icons/${def.icon}.svg`} width={14} height={14} style={{ borderRadius: 3 }} alt="" />{def.label} · {String(node.data.properties.name)}</div>}
      <div style={{ marginTop: 8, lineHeight: 1.45 }}>{f.message}</div>
      <div style={{ marginTop: 6, lineHeight: 1.45, color: 'var(--muted)' }}><b style={{ color: 'var(--text)', fontWeight: 600 }}>Suggested change:</b> {f.suggestion}</div>
      {open && (
        <pre data-testid="finding-prompt" className="mono" style={{ margin: '10px 0 0', padding: '10px 12px', borderRadius: 8, background: 'var(--panel-2)', fontSize: 11.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }} onClick={(e) => e.stopPropagation()}>{prompt}</pre>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
        {f.fix && !readOnly && <button className="btn primary" data-testid="apply-fix" style={{ height: 28 }} onClick={() => useStore.getState().applyFix(f)}><Wrench size={13} /> Apply fix</button>}
        <button className="btn" data-testid="copy-prompt" style={{ height: 28 }} onClick={copy}>{copied ? <><Check size={13} /> Copied</> : <><ClipboardCopy size={13} /> Copy as prompt</>}</button>
        <button className="tabbtn" style={{ padding: '2px 8px', fontSize: 11.5 }} onClick={() => setOpen(!open)}>{open ? 'Hide prompt' : 'Show prompt'}</button>
      </div>
      {readOnly && <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--muted)' }}>This project follows a repository, so changes are made in the Terraform. Paste the prompt into Claude Code.</div>}
    </div>
  );
}

/** Compliance findings for the architecture on screen. */
export function ComplianceView({ repo }: { repo: RepoCtl | null }) {
  const findings = useStore((s) => s.findings);
  const hasNodes = useStore((s) => s.nodes.length > 0);
  if (!RULES_LOADED)
    return <div style={{ padding: '44px 22px', textAlign: 'center', color: 'var(--muted)', lineHeight: 1.5 }}><ShieldAlert size={28} style={{ marginBottom: 10 }} /><div style={{ fontWeight: 600, color: 'var(--text)' }}>No compliance rules loaded</div><div style={{ marginTop: 4 }}>Rules are kept private and are not part of the shared code. Add them on this machine to see findings here.</div></div>;
  if (!hasNodes) return <div style={{ padding: '44px 22px', textAlign: 'center', color: 'var(--muted)' }}>Add resources to the canvas to check them.</div>;
  if (!findings.length)
    return <div data-testid="compliance-clear" style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--muted)' }}><ShieldCheck size={30} style={{ color: 'var(--ok)', marginBottom: 10 }} /><div style={{ fontWeight: 600, color: 'var(--text)' }}>No findings</div><div style={{ marginTop: 4 }}>Everything on the canvas passes the loaded checks.</div></div>;
  const n = (s: string) => findings.filter((f) => f.severity === s).length;
  return (
    <div style={{ overflow: 'auto', height: '100%', padding: 12, display: 'flex', flexDirection: 'column', gap: 10, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', gap: 14, padding: '2px 4px 4px', fontSize: 12 }} data-testid="compliance-summary">
        <b>{findings.length} finding{findings.length === 1 ? '' : 's'}</b>
        {n('high') > 0 && <span style={{ color: 'var(--err)' }}>{n('high')} high</span>}
        {n('medium') > 0 && <span style={{ color: 'var(--warn)' }}>{n('medium')} medium</span>}
        {n('low') > 0 && <span style={{ color: 'var(--muted)' }}>{n('low')} low</span>}
      </div>
      {findings.map((f, i) => <Item key={`${f.rule}-${f.nodeId}-${i}`} f={f} repo={repo} />)}
    </div>
  );
}
