import type { TfFile } from '../import';
import type { CommitInfo, RepoProvider } from './types';

export class GitHubError extends Error {
  constructor(message: string, public status: number, public kind: 'auth' | 'not-found' | 'rate-limit' | 'network' | 'other', public resetAt?: Date) {
    super(message);
    this.name = 'GitHubError';
  }
}

export interface GitHubOptions {
  owner: string;
  repo: string;
  /** fine-grained or classic token with read access; optional for public repos (60 requests/hour without one) */
  token?: string;
  fetch?: typeof fetch;
  apiBase?: string;
}

const clean = (p: string) => p.replace(/^\/+|\/+$/g, '');
const enc = (p: string) => clean(p).split('/').map(encodeURIComponent).join('/');
const SHA = /^[0-9a-f]{7,40}$/i;

export class GitHubProvider implements RepoProvider {
  private f: typeof fetch;
  private base: string;
  /** requests left in the current window, as last reported by GitHub */
  remaining: number | null = null;

  constructor(private o: GitHubOptions) {
    this.f = o.fetch ?? ((...a) => fetch(...a));
    this.base = (o.apiBase ?? 'https://api.github.com').replace(/\/$/, '');
  }

  private url(path: string, params: Record<string, string | number | undefined> = {}) {
    const q = Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
    return `${this.base}/repos/${encodeURIComponent(this.o.owner)}/${encodeURIComponent(this.o.repo)}${path}${q ? '?' + q : ''}`;
  }

  private async get(url: string, accept: string): Promise<Response> {
    let res: Response;
    try {
      res = await this.f(url, { headers: { Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', ...(this.o.token ? { Authorization: `Bearer ${this.o.token}` } : {}) } });
    } catch {
      throw new GitHubError('Could not reach GitHub. Check your connection.', 0, 'network');
    }
    const rem = res.headers.get('x-ratelimit-remaining');
    if (rem !== null) this.remaining = Number(rem);
    if (res.ok) return res;
    const reset = res.headers.get('x-ratelimit-reset');
    const resetAt = reset ? new Date(Number(reset) * 1000) : undefined;
    let msg = '';
    try { msg = ((await res.json()) as { message?: string }).message ?? ''; } catch { /* not json */ }
    if ((res.status === 403 || res.status === 429) && (rem === '0' || /rate limit/i.test(msg)))
      throw new GitHubError(`GitHub rate limit reached${resetAt ? `; resets at ${resetAt.toLocaleTimeString()}` : ''}.${this.o.token ? '' : ' Add a token to raise the limit from 60 to 5,000 requests per hour.'}`, res.status, 'rate-limit', resetAt);
    if (res.status === 401) throw new GitHubError('GitHub rejected the token. Check that it is valid and not expired.', 401, 'auth');
    if (res.status === 403) throw new GitHubError(`GitHub denied access${msg ? `: ${msg}` : ''}. The token may lack read access to this repository.`, 403, 'auth');
    if (res.status === 404) throw new GitHubError(this.o.token ? 'Not found. Check the owner, repo, branch and folder, and that the token can read this repository.' : 'Not found. If the repository is private, add a token.', 404, 'not-found');
    throw new GitHubError(`GitHub returned ${res.status}${msg ? `: ${msg}` : ''}.`, res.status, 'other');
  }

  async listCommits({ path, branch, limit = 30 }: { path: string; branch?: string; limit?: number }): Promise<CommitInfo[]> {
    const out: CommitInfo[] = [];
    for (let page = 1; out.length < limit && page <= 10; page++) {
      const per = Math.min(100, limit - out.length);
      const res = await this.get(this.url('/commits', { sha: branch, path: clean(path) || undefined, per_page: per, page }), 'application/vnd.github+json');
      const rows = (await res.json()) as { sha: string; html_url?: string; commit: { message: string; author?: { name?: string; date?: string } }; author?: { login?: string } | null }[];
      for (const r of rows) out.push({ sha: r.sha, message: r.commit.message.split('\n')[0], author: r.commit.author?.name ?? r.author?.login ?? 'unknown', date: r.commit.author?.date ?? '', url: r.html_url });
      if (rows.length < per) break;
    }
    return out.slice(0, limit);
  }

  async readFilesAt(sha: string, dir: string): Promise<TfFile[]> {
    if (!SHA.test(sha)) throw new GitHubError(`Not a commit id: ${sha}`, 0, 'other');
    const d = enc(dir);
    let listing: { name: string; type: string }[];
    try {
      const res = await this.get(this.url(`/contents${d ? '/' + d : ''}`, { ref: sha }), 'application/vnd.github+json');
      const j = await res.json();
      listing = Array.isArray(j) ? j : [];
    } catch (e) {
      // the folder did not exist at this commit yet
      if (e instanceof GitHubError && e.kind === 'not-found') return [];
      throw e;
    }
    const wanted = listing.filter((x) => x.type === 'file' && /\.(tf|tfvars)$/.test(x.name));
    const files: TfFile[] = [];
    for (const f of wanted) {
      const res = await this.get(this.url(`/contents/${d ? d + '/' : ''}${encodeURIComponent(f.name)}`, { ref: sha }), 'application/vnd.github.raw+json');
      files.push({ path: f.name, content: await res.text() });
    }
    return files;
  }
}
