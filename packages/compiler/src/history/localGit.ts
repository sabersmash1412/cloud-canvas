/** Node-only: reads history from a local Git checkout. Used by tests, scripts and as an offline demo source. */
import { execFileSync } from 'node:child_process';
import type { TfFile } from '../import';
import type { CommitInfo, RepoProvider } from './types';

const SHA = /^[0-9a-f]{7,40}$/;
const clean = (p: string) => p.replace(/^\/+|\/+$/g, '');

export class LocalGitProvider implements RepoProvider {
  constructor(private dir: string) {}

  private git(args: string[]): string {
    return execFileSync('git', ['-C', this.dir, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  }

  async listCommits({ path, branch, limit = 30 }: { path: string; branch?: string; limit?: number }): Promise<CommitInfo[]> {
    const p = clean(path);
    const out = this.git(['log', '--format=%H%x1f%an%x1f%aI%x1f%s', '-n', String(limit), branch ?? 'HEAD', '--', ...(p ? [p] : [])]);
    return out.split('\n').filter(Boolean).map((l) => { const [sha, author, date, message] = l.split('\x1f'); return { sha, author, date, message }; });
  }

  /** file names (full paths) directly inside `dir` at `sha` */
  listDir(sha: string, dir: string): string[] {
    if (!SHA.test(sha)) throw new Error(`Not a commit id: ${sha}`);
    const d = clean(dir);
    return this.git(['ls-tree', '--name-only', sha, ...(d ? [`${d}/`] : [])]).split('\n').filter(Boolean);
  }

  readFile(sha: string, path: string): string {
    if (!SHA.test(sha)) throw new Error(`Not a commit id: ${sha}`);
    return this.git(['show', `${sha}:${clean(path)}`]);
  }

  async readFilesAt(sha: string, dir: string): Promise<TfFile[]> {
    return this.listDir(sha, dir).filter((f) => /\.(tf|tfvars)$/.test(f)).map((f) => ({ path: f.split('/').pop()!, content: this.readFile(sha, f) }));
  }
}
