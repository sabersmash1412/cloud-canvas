import { GitBranch, KeyRound } from 'lucide-react';

export interface RepoFields { owner: string; repo: string; branch: string; path: string; token: string }
export const emptyRepo: RepoFields = { owner: '', repo: '', branch: 'main', path: '', token: '' };

const field: React.CSSProperties = { width: '100%', height: 36, padding: '0 12px', borderRadius: 9, border: '1px solid var(--line)', background: 'var(--panel-2)', color: 'var(--text)', outline: 'none', fontSize: 13, boxSizing: 'border-box' };
const lab: React.CSSProperties = { display: 'block', fontWeight: 500, marginBottom: 6 };

/** Accepts "owner/repo" or a pasted github.com URL (including /tree/<branch>/<folder>) in the repo field. */
export function parseRepoInput(v: string): Partial<RepoFields> | null {
  const t = v.trim().replace(/\.git$/, '');
  const url = /^(?:https?:\/\/)?github\.com\/([^/\s]+)\/([^/\s]+)(?:\/tree\/([^/\s]+)(?:\/(.+))?)?\/?$/i.exec(t);
  if (url) return { owner: url[1], repo: url[2], ...(url[3] ? { branch: url[3] } : {}), ...(url[4] ? { path: url[4].replace(/\/$/, '') } : {}) };
  const slash = /^([\w.-]+)\/([\w.-]+)$/.exec(t);
  return slash ? { owner: slash[1], repo: slash[2] } : null;
}

export function RepoForm({ value, onChange }: { value: RepoFields; onChange: (v: RepoFields) => void }) {
  const set = (k: keyof RepoFields, v: string) => onChange({ ...value, [k]: v });
  return (
    <div>
      <label style={{ display: 'block', marginBottom: 14 }}>
        <span style={lab}><GitBranch size={12} style={{ verticalAlign: -1 }} /> Repository <span style={{ color: 'var(--err)' }}>*</span></span>
        <input data-testid="repo-input" style={field} value={value.owner && value.repo ? `${value.owner}/${value.repo}` : value.owner} placeholder="owner/repo or a github.com link"
          onChange={(e) => { const p = parseRepoInput(e.target.value); if (p) onChange({ ...value, ...p }); else onChange({ ...value, owner: e.target.value, repo: '' }); }} />
      </label>
      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        <label style={{ flex: 1 }}><span style={lab}>Branch</span><input data-testid="repo-branch" style={field} value={value.branch} onChange={(e) => set('branch', e.target.value)} placeholder="main" /></label>
        <label style={{ flex: 1.3 }}><span style={lab}>Terraform folder</span><input data-testid="repo-path" className="mono" style={field} value={value.path} onChange={(e) => set('path', e.target.value)} placeholder="infra/dev  (blank = repo root)" /></label>
      </div>
      <label style={{ display: 'block' }}>
        <span style={lab}><KeyRound size={12} style={{ verticalAlign: -1 }} /> Access token <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(only for private repos)</span></span>
        <input data-testid="repo-token" type="password" autoComplete="off" style={field} value={value.token} onChange={(e) => set('token', e.target.value)} placeholder="github_pat_…" />
      </label>
      <div style={{ color: 'var(--muted)', fontSize: 11.5, lineHeight: 1.5, marginTop: 8 }}>Read-only access is enough: a fine-grained token with <b>Contents: read</b> on this one repository. It is kept in memory only, never saved, so a private repo asks again after a reload.</div>
    </div>
  );
}

export const repoValid = (v: RepoFields) => !!v.owner.trim() && !!v.repo.trim();
