import { describe, expect, it } from 'vitest';
import { GitHubError, GitHubProvider } from '../src';

type Call = { url: string; headers: Record<string, string> };
function fake(routes: (url: string) => { status?: number; body?: unknown; text?: string; headers?: Record<string, string> } | 'throw') {
  const calls: Call[] = [];
  const f = (async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, headers: init?.headers ?? {} });
    const r = routes(url);
    if (r === 'throw') throw new TypeError('network down');
    const status = r.status ?? 200;
    const raw = r.text ?? JSON.stringify(r.body ?? {});
    return new Response(raw, { status, headers: { 'x-ratelimit-remaining': '4990', ...(r.headers ?? {}) } });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const commit = (sha: string, msg: string) => ({ sha, html_url: `https://github.com/o/r/commit/${sha}`, commit: { message: msg + '\n\nbody', author: { name: 'Ana', date: '2026-11-02T09:30:00Z' } }, author: { login: 'ana' } });

describe('GitHubProvider', () => {
  it('lists commits for a folder and branch, with the right request', async () => {
    const { f, calls } = fake(() => ({ body: [commit('a'.repeat(40), 'Add queue'), commit('b'.repeat(40), 'Init')] }));
    const p = new GitHubProvider({ owner: 'o', repo: 'r', token: 'tok', fetch: f });
    const out = await p.listCommits({ path: '/infra/dev/', branch: 'main', limit: 30 });
    expect(out.map((c) => c.message)).toEqual(['Add queue', 'Init']);
    expect(out[0]).toMatchObject({ author: 'Ana', date: '2026-11-02T09:30:00Z', url: expect.stringContaining('/commit/') });
    expect(calls[0].url).toBe('https://api.github.com/repos/o/r/commits?sha=main&path=infra%2Fdev&per_page=30&page=1');
    expect(calls[0].headers.Authorization).toBe('Bearer tok');
    expect(calls[0].headers['X-GitHub-Api-Version']).toBeTruthy();
    expect(p.remaining).toBe(4990);
  });

  it('sends no Authorization header without a token', async () => {
    const { f, calls } = fake(() => ({ body: [] }));
    await new GitHubProvider({ owner: 'o', repo: 'r', fetch: f }).listCommits({ path: '' });
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(calls[0].url).not.toContain('path=');
  });

  it('pages through long histories', async () => {
    const mk = (n: number, off: number) => Array.from({ length: n }, (_, i) => commit((i + off).toString(16).padStart(40, '0'), `c${i + off}`));
    const { f, calls } = fake((u) => ({ body: u.includes('page=1') ? mk(100, 0) : mk(20, 100) }));
    const out = await new GitHubProvider({ owner: 'o', repo: 'r', fetch: f }).listCommits({ path: 'x', limit: 120 });
    expect(out).toHaveLength(120);
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain('per_page=20&page=2');
  });

  it('reads .tf files at a commit using the raw media type, ignoring other files', async () => {
    const sha = 'c'.repeat(40);
    const { f, calls } = fake((u) => {
      if (u.includes('/contents/infra/dev?')) return { body: [{ name: 'main.tf', type: 'file' }, { name: 'versions.tf', type: 'file' }, { name: 'README.md', type: 'file' }, { name: 'modules', type: 'dir' }] };
      if (u.includes('main.tf')) return { text: 'module "a" {}' };
      if (u.includes('versions.tf')) return { text: 'terraform {}' };
      return { status: 500 };
    });
    const files = await new GitHubProvider({ owner: 'o', repo: 'r', token: 't', fetch: f }).readFilesAt(sha, 'infra/dev');
    expect(files).toEqual([{ path: 'main.tf', content: 'module "a" {}' }, { path: 'versions.tf', content: 'terraform {}' }]);
    expect(calls[0].url).toBe(`https://api.github.com/repos/o/r/contents/infra/dev?ref=${sha}`);
    expect(calls[1].headers.Accept).toBe('application/vnd.github.raw+json');
    expect(calls).toHaveLength(3);
  });

  it('a folder that does not exist at that commit yields no files', async () => {
    const { f } = fake(() => ({ status: 404, body: { message: 'Not Found' } }));
    expect(await new GitHubProvider({ owner: 'o', repo: 'r', token: 't', fetch: f }).readFilesAt('d'.repeat(40), 'infra/dev')).toEqual([]);
  });

  it('refuses anything that is not a commit id', async () => {
    const { f, calls } = fake(() => ({ body: [] }));
    await expect(new GitHubProvider({ owner: 'o', repo: 'r', fetch: f }).readFilesAt('main/../../x', 'a')).rejects.toBeInstanceOf(GitHubError);
    expect(calls).toHaveLength(0);
  });

  it('turns failures into clear, typed errors', async () => {
    const run = async (r: ReturnType<Parameters<typeof fake>[0]>) => {
      const { f } = fake(() => r);
      return new GitHubProvider({ owner: 'o', repo: 'r', token: r === 'throw' ? 't' : undefined, fetch: f }).listCommits({ path: '' }).catch((e) => e as GitHubError);
    };
    expect(await run({ status: 401, body: { message: 'Bad credentials' } })).toMatchObject({ kind: 'auth', status: 401 });
    expect(await run({ status: 404, body: {} })).toMatchObject({ kind: 'not-found', message: expect.stringContaining('private') });
    const rl = (await run({ status: 403, body: { message: 'API rate limit exceeded' }, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1893456000' } })) as GitHubError;
    expect(rl.kind).toBe('rate-limit');
    expect(rl.message).toContain('Add a token');
    expect(rl.resetAt?.getTime()).toBe(1893456000000);
    expect(await run({ status: 403, body: { message: 'Resource not accessible' }, headers: { 'x-ratelimit-remaining': '10' } })).toMatchObject({ kind: 'auth' });
    expect(await run('throw')).toMatchObject({ kind: 'network' });
    expect(await run({ status: 500, body: {} })).toMatchObject({ kind: 'other' });
  });

  it('never puts the token in an error message', async () => {
    const { f } = fake(() => ({ status: 401, body: { message: 'Bad credentials' } }));
    const e = (await new GitHubProvider({ owner: 'o', repo: 'r', token: 'ghp_SECRET123', fetch: f }).listCommits({ path: '' }).catch((x) => x)) as Error;
    expect(e.message).not.toContain('ghp_SECRET123');
  });
});
