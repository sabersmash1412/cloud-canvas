import { useCallback, useEffect, useRef, useState } from 'react';
import { GitHubError, GitHubProvider, loadHistory, type CachedImport, type HistoryCache, type HistoryEntry } from '@cloudcanvas/compiler';
import { parseHcl } from './hclParser';
import type { RepoSource } from './projects';

export type RepoRef = Pick<RepoSource, 'owner' | 'repo' | 'branch' | 'path'>;

/** Access tokens live in memory only (never localStorage): a token stored in the page is readable by any script on it. */
const tokens = new Map<string, string>();
export const getToken = (key: string) => tokens.get(key) ?? '';
export const setToken = (key: string, v: string) => { v ? tokens.set(key, v) : tokens.delete(key); };

export function makeProvider(c: RepoRef, token: string) {
  // dev/test only: point the provider at a local GitHub-shaped server
  const dev = import.meta.env.DEV ? new URLSearchParams(location.search) : null;
  return new GitHubProvider({ owner: c.owner, repo: c.repo, token: token || undefined, apiBase: dev?.get('ghapi') ?? undefined });
}

/** Parsed versions are cached against the commit id, which never changes. Survives reloads. */
const CACHE_PREFIX = 'cc-hist-cache-v1:';
const memory = new Map<string, CachedImport>();
export const storageCache: HistoryCache = {
  async get(key) {
    if (memory.has(key)) return memory.get(key);
    try { const raw = localStorage.getItem(CACHE_PREFIX + key); if (raw) { const v = JSON.parse(raw); memory.set(key, v); return v; } } catch { /* ignore */ }
    return undefined;
  },
  async set(key, value) {
    memory.set(key, value);
    try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value)); }
    catch {
      // storage full: drop the oldest cached versions and try once more
      try { Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX)).slice(0, 20).forEach((k) => localStorage.removeItem(k)); localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value)); } catch { /* keep in memory only */ }
    }
  },
};

export const commitUrl = (c: RepoRef, sha: string) => `https://github.com/${c.owner}/${c.repo}/commit/${sha}`;
export const folderUrl = (c: RepoRef, sha: string) => `https://github.com/${c.owner}/${c.repo}/tree/${sha}${c.path ? '/' + c.path : ''}`;

export interface Synced { entries: HistoryEntry[]; latest: HistoryEntry | null; remaining: number | null }

/** Read a repo's Terraform history (newest first) and import every version. */
export async function syncRepo(c: RepoRef, token: string, name?: string, onProgress?: (done: number, total: number) => void): Promise<Synced> {
  const gh = makeProvider(c, token);
  const asc = await loadHistory({ provider: gh, path: c.path, branch: c.branch || undefined, limit: 40, parse: parseHcl, name, cache: storageCache, onProgress });
  const entries = asc.slice().reverse();
  return { entries, latest: entries.find((e) => e.graph) ?? null, remaining: gh.remaining };
}

export const headOf = (e: HistoryEntry) => ({ sha: e.commit.sha, message: e.commit.message, author: e.commit.author, date: e.commit.date });

export const describeError = (e: unknown) => ({ message: (e as Error)?.message || 'Could not reach GitHub.', kind: e instanceof GitHubError ? e.kind : 'other' });

export type Sync = { status: 'loading'; done: number; total: number } | { status: 'ready' } | { status: 'error'; message: string; kind: string };

/** Everything the editor and panel need to show a repo-linked project. */
export interface RepoCtl {
  source: RepoSource;
  entries: HistoryEntry[] | null;
  sync: Sync;
  syncedAt: number | null;
  /** background sync is paused (rate limit) */
  paused: string | null;
  /** the commit being viewed (null = latest) */
  viewSha: string | null;
  /** the commit being compared against the viewed one */
  cmpSha: string | null;
  view: (sha: string | null) => void;
  compare: (sha: string | null) => void;
  reload: () => void;
  setToken: (t: string) => void;
}

export interface RepoSyncOptions {
  /** display name, used as a fallback project name by the importer */
  name: string;
  /** every successful sync, with the freshly imported history */
  onSynced?: (s: Synced) => void;
  /** a commit newer than the last one seen has appeared */
  onNew?: (latest: HistoryEntry) => void;
}

/**
 * Keeps a repo-linked project in step with GitHub: loads the history, then checks for new commits
 * every 2 minutes (30 s with a token) and whenever the browser tab regains focus.
 * One cheap request per check; the full import only runs when the newest commit actually changed.
 */
export function useRepoSync(projectId: string, src: RepoSource | undefined, opts: RepoSyncOptions) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [sync, setSync] = useState<Sync>({ status: 'loading', done: 0, total: 0 });
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [paused, setPaused] = useState<string | null>(null);
  const [tokenVersion, setTokenVersion] = useState(0);
  const headRef = useRef<string | undefined>(src?.head?.sha);
  const run = useRef(0);
  const pausedUntil = useRef(0);
  const cb = useRef(opts);
  cb.current = opts;
  const key = src ? `${src.owner}/${src.repo}@${src.branch}:${src.path}` : '';

  const reload = useCallback(async (background = false) => {
    if (!src) return;
    const my = ++run.current;
    if (!background) setSync({ status: 'loading', done: 0, total: 0 });
    try {
      const r = await syncRepo(src, getToken(projectId), cb.current.name, background ? undefined : (done, total) => { if (my === run.current) setSync({ status: 'loading', done, total }); });
      if (my !== run.current) return;
      const prev = headRef.current;
      const head = r.entries[0]?.commit.sha;
      headRef.current = head;
      setEntries(r.entries);
      setSync({ status: 'ready' });
      setSyncedAt(Date.now());
      setPaused(null);
      cb.current.onSynced?.(r);
      if (prev && head && head !== prev && r.latest) cb.current.onNew?.(r.latest);
    } catch (e) {
      if (my !== run.current) return;
      const d = describeError(e);
      if (e instanceof GitHubError && e.kind === 'rate-limit') {
        pausedUntil.current = e.resetAt?.getTime() ?? Date.now() + 5 * 60_000;
        if (background) { setPaused(d.message); return; }
      }
      if (background) return; // a failed background check keeps what is already on screen
      setSync({ status: 'error', ...d });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, projectId]);

  useEffect(() => { reload(); return () => { run.current++; }; }, [reload]);

  useEffect(() => {
    if (!src) return;
    const dev = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('poll')) : 0;
    const every = dev || (getToken(projectId) ? 30_000 : 120_000);
    const check = async () => {
      if (document.hidden || Date.now() < pausedUntil.current) return;
      try {
        const [c] = await makeProvider(src, getToken(projectId)).listCommits({ path: src.path, branch: src.branch, limit: 1 });
        if (c && c.sha !== headRef.current) await reload(true);
      } catch (e) {
        if (e instanceof GitHubError && e.kind === 'rate-limit') { pausedUntil.current = e.resetAt?.getTime() ?? Date.now() + 5 * 60_000; setPaused(e.message); }
      }
    };
    const id = setInterval(check, every);
    const vis = () => { if (!document.hidden) check(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', vis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, projectId, tokenVersion, reload]);

  return {
    entries, sync, syncedAt, paused,
    reload: () => reload(false),
    setToken: (t: string) => { setToken(projectId, t); setTokenVersion((v) => v + 1); setTimeout(() => reload(false), 0); },
  };
}
