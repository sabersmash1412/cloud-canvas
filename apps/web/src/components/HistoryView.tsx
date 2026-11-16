import { AlertTriangle, ArrowRight, ExternalLink, GitCommitHorizontal, KeyRound, Loader2, RefreshCw } from 'lucide-react';
import { describeDiff, type HistoryEntry } from '@cloudcanvas/compiler';
import { commitUrl, type RepoCtl } from '../history';

const field: React.CSSProperties = { width: '100%', height: 34, padding: '0 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--panel-2)', color: 'var(--text)', outline: 'none', boxSizing: 'border-box' };

export const ago = (iso: string) => {
  const s = Math.max(1, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

const EMPTY = { added: [], removed: [], changed: [], edgesAdded: [], edgesRemoved: [], project: [], other: { added: [], removed: [], changed: [] }, empty: true };

/** The commit timeline of a repo-linked project. Clicking a commit shows that version on the canvas. */
export function HistoryView({ ctl, onToken }: { ctl: RepoCtl; onToken: (t: string) => void }) {
  const { source: src, entries, sync, viewSha, cmpSha } = ctl;
  const latestSha = entries?.find((e) => e.graph)?.commit.sha ?? null;
  const selSha = viewSha ?? latestSha;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
          <b>{src.owner}/{src.repo}</b> <span className="mono" style={{ color: 'var(--muted)' }}>{src.branch}{src.path ? ` · ${src.path}` : ''}</span>
        </div>
        <button className="btn icon" style={{ border: 0, width: 28, height: 28 }} title="Check for new commits" data-testid="history-refresh" onClick={ctl.reload}><RefreshCw size={14} className={sync.status === 'loading' ? 'spin' : ''} /></button>
      </div>

      {ctl.paused && <div data-testid="history-paused" style={{ margin: '10px 12px 0', padding: '8px 10px', borderRadius: 8, background: 'color-mix(in srgb, var(--warn) 16%, transparent)', fontSize: 12, lineHeight: 1.4 }}>Live updates are paused. {ctl.paused}</div>}

      {sync.status === 'loading' && !entries && (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)' }} data-testid="history-loading">
          <Loader2 size={24} className="spin" style={{ color: 'var(--accent)' }} />
          <div style={{ marginTop: 10 }}>{sync.total ? `Reading commit ${sync.done} of ${sync.total}…` : 'Fetching commits…'}</div>
        </div>
      )}

      {sync.status === 'error' && (
        <div style={{ padding: 18 }} data-testid="history-error">
          <div style={{ display: 'flex', gap: 10, padding: 12, borderRadius: 10, background: 'color-mix(in srgb, var(--err) 12%, transparent)', lineHeight: 1.45 }}>
            <AlertTriangle size={17} style={{ color: 'var(--err)', flex: 'none', marginTop: 1 }} /><div>{sync.message}</div>
          </div>
          {(sync.kind === 'rate-limit' || sync.kind === 'auth' || sync.kind === 'not-found') && <TokenBox onSubmit={onToken} />}
          <div style={{ marginTop: 14 }}><button className="btn primary" onClick={ctl.reload}>Try again</button></div>
        </div>
      )}

      {entries && sync.status !== 'error' && (entries.length === 0 ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)', lineHeight: 1.5 }} data-testid="history-empty">No commits touched <span className="mono">{src.path || '/'}</span> on <b>{src.branch}</b>.<br />Check the folder path.</div>
      ) : (
        <div style={{ overflow: 'auto', flex: 1, padding: '8px 12px 14px' }} data-testid="history-list">
          <div style={{ color: 'var(--muted)', fontSize: 11.5, padding: '2px 2px 8px' }}>{entries.length} version{entries.length === 1 ? '' : 's'} · click one to view it · <b>compare</b> two to see the change</div>
          {entries.map((e: HistoryEntry, i: number) => {
            const on = e.commit.sha === selSha;
            const isBase = e.commit.sha === cmpSha;
            const lines = describeDiff(e.diff ?? EMPTY);
            return (
              <div key={e.commit.sha} data-testid="history-item" data-sha={e.commit.sha}
                onClick={() => { if (!e.graph) return; ctl.view(e.commit.sha === latestSha ? null : e.commit.sha); if (isBase) ctl.compare(null); }}
                style={{ position: 'relative', margin: '0 0 8px', padding: '10px 12px 10px 30px', borderRadius: 11, border: `1.5px solid ${on ? 'var(--accent)' : isBase ? 'var(--warn)' : 'var(--line)'}`, background: on ? 'var(--accent-soft)' : 'var(--panel)', cursor: e.graph ? 'pointer' : 'default', opacity: e.graph ? 1 : 0.7 }}>
                <GitCommitHorizontal size={16} style={{ position: 'absolute', left: 8, top: 11, color: on ? 'var(--accent)' : 'var(--muted)' }} />
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <div style={{ flex: 1, fontWeight: 600, lineHeight: 1.35 }}>{e.commit.message}</div>
                  {i === 0 && <span className="kbd" style={{ color: 'var(--ok)', borderColor: 'var(--ok)' }}>latest</span>}
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 11.5, marginTop: 2, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span>{e.commit.author}</span><span>·</span><span>{ago(e.commit.date)}</span><span>·</span>
                  <a className="mono" href={e.commit.url ?? commitUrl(src, e.commit.sha)} target="_blank" rel="noreferrer" onClick={(x) => x.stopPropagation()} style={{ color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}>{e.commit.sha.slice(0, 7)}<ExternalLink size={10} /></a>
                </div>
                {e.graph && (
                  <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', fontSize: 12, lineHeight: 1.5 }}>
                    {e.changed ? lines.slice(0, 4).map((l, k) => <li key={k} style={{ color: l.startsWith('Added') || l.startsWith('Connected') ? 'var(--ok)' : l.startsWith('Removed') || l.startsWith('Disconnected') ? 'var(--err)' : 'var(--text)' }}>{l}</li>) : <li style={{ color: 'var(--muted)' }}>No architecture change</li>}
                    {e.changed && lines.length > 4 && <li style={{ color: 'var(--muted)' }}>+{lines.length - 4} more</li>}
                  </ul>
                )}
                {!e.graph && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--err)' }}>{e.summary[0]}</div>}
                {e.graph && !on && (
                  <button data-testid="compare-btn" className="tabbtn" style={{ marginTop: 6, padding: '2px 8px', fontSize: 11.5, ...(isBase ? { background: 'color-mix(in srgb, var(--warn) 18%, transparent)', color: 'var(--warn)' } : {}) }}
                    onClick={(x) => { x.stopPropagation(); ctl.compare(isBase ? null : e.commit.sha); }}>{isBase ? 'Comparing ✕' : 'Compare with selected'}</button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function TokenBox({ onSubmit }: { onSubmit: (t: string) => void }) {
  let v = '';
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (v) onSubmit(v); }} style={{ marginTop: 14 }}>
      <label style={{ display: 'block' }}>
        <span style={{ display: 'block', fontWeight: 500, marginBottom: 5, fontSize: 12 }}><KeyRound size={11} style={{ verticalAlign: -1 }} /> Access token</span>
        <input type="password" autoComplete="off" data-testid="history-token-retry" style={field} onChange={(e) => { v = e.target.value; }} placeholder="github_pat_…" />
      </label>
      <button className="btn" style={{ marginTop: 8 }} data-testid="history-token-apply">Use token</button>
    </form>
  );
}

/** Banner above the canvas of a repo-linked project. */
export function RepoBanner({ ctl, viewing, base }: { ctl: RepoCtl; viewing: HistoryEntry | null; base: HistoryEntry | null }) {
  const latest = ctl.entries?.find((e) => e.graph) ?? null;
  const older = viewing && viewing !== latest;
  return (
    <div data-testid="repo-banner" className="panel" style={{ position: 'absolute', top: 12, left: 0, right: 0, margin: '0 auto', width: 'max-content', zIndex: 20, padding: '7px 12px 7px 14px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, maxWidth: 'calc(100% - 24px)', boxSizing: 'border-box', whiteSpace: 'nowrap' }}>
      <GitCommitHorizontal size={15} style={{ color: older || base ? 'var(--warn)' : 'var(--ok)', flex: 'none' }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {base && viewing ? <>Comparing <b className="mono">{base.commit.sha.slice(0, 7)}</b> <span style={{ color: 'var(--muted)' }}>(older)</span> <ArrowRight size={11} style={{ verticalAlign: -1 }} /> <b className="mono">{viewing.commit.sha.slice(0, 7)}</b> <span style={{ color: 'var(--muted)' }}>(newer)</span></>
          : older && viewing ? <>Viewing an older version <b className="mono">{viewing.commit.sha.slice(0, 7)}</b> · {viewing.commit.message}</>
          : latest ? <>Latest · <b className="mono">{latest.commit.sha.slice(0, 7)}</b> · {latest.commit.message}</> : 'Loading…'}
      </span>
      <span style={{ color: 'var(--muted)', flex: 'none' }}>read-only</span>
      {(older || base) && <button className="btn" data-testid="history-exit" style={{ height: 26, padding: '0 10px', flex: 'none' }} onClick={() => { ctl.compare(null); ctl.view(null); }}>Return to latest</button>}
    </div>
  );
}
