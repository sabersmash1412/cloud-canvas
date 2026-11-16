import { AlertTriangle, CheckCircle2, Terminal } from 'lucide-react';
import type { useLive } from '../live';

const SOURCE: Record<string, string> = { validate_and_compile: 'compiled', show_on_canvas: 'sketching', sync_terraform_folder: 'synced from a Terraform folder' };

/** What Claude Code last did, shown over the live canvas. */
export function LiveBanner({ feed }: { feed: ReturnType<typeof useLive> }) {
  const m = feed.msg;
  if (!m) return null;
  const errors = m.problems.filter((p) => p.severity === 'error').length;
  const findings = m.problems.filter((p) => p.kind === 'compliance').length;
  return (
    <div data-testid="live-banner" className="panel" style={{ position: 'absolute', top: 12, left: 0, right: 0, margin: '0 auto', width: 'max-content', maxWidth: 'calc(100% - 24px)', zIndex: 20, padding: '7px 14px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, boxSizing: 'border-box', whiteSpace: 'nowrap' }}>
      <Terminal size={14} style={{ color: 'var(--ok)', flex: 'none' }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>Claude Code {SOURCE[m.source] ?? 'updated'}{m.note ? ` · ${m.note}` : ''}</span>
      {errors > 0 ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--err)', flex: 'none' }} data-testid="live-has-errors"><AlertTriangle size={13} />{errors} error{errors === 1 ? '' : 's'}, fixing…</span>
        : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--ok)', flex: 'none' }}><CheckCircle2 size={13} />valid</span>}
      {findings > 0 && <span style={{ color: 'var(--warn)', flex: 'none' }}>{findings} finding{findings === 1 ? '' : 's'}</span>}
      <span style={{ color: 'var(--muted)', flex: 'none' }}>read-only</span>
    </div>
  );
}
