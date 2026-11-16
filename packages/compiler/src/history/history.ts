import { importTerraform, type HclParser } from '../import';
import type { Graph } from '../types';
import { describeDiff, diffGraphs, type ArchDiff } from './diff';
import type { CachedImport, CommitInfo, HistoryCache, RepoProvider } from './types';

export interface HistoryEntry {
  commit: CommitInfo;
  /** the architecture at this commit; null when the Terraform could not be read */
  graph: Graph | null;
  coverage?: number;
  error?: string;
  /** change versus the previous readable version (null for the first, or when unreadable) */
  diff: ArchDiff | null;
  /** SHA of the version the diff was taken against */
  comparedTo?: string;
  summary: string[];
  /** the architecture differs from the previous version (false for e.g. a pipeline-only commit) */
  changed: boolean;
}

export interface HistoryOptions {
  provider: RepoProvider;
  /** folder holding the Terraform, e.g. "infra/dev" ("" = repo root) */
  path: string;
  branch?: string;
  /** most recent N commits (default 30) */
  limit?: number;
  parse: HclParser;
  /** fallback project name when the code does not say */
  name?: string;
  cache?: HistoryCache;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export function memoryCache(): HistoryCache {
  const m = new Map<string, CachedImport>();
  return { get: async (k) => m.get(k), set: async (k, v) => { m.set(k, v); } };
}

/** Import one commit's Terraform (cached by SHA). */
export async function loadVersion(o: Pick<HistoryOptions, 'provider' | 'path' | 'parse' | 'name' | 'cache'>, sha: string, fallback?: Graph | null): Promise<CachedImport> {
  const key = `${sha}|${o.path}`;
  const hit = await o.cache?.get(key);
  if (hit) return hit;
  let res: CachedImport;
  try {
    const files = await o.provider.readFilesAt(sha, o.path);
    if (!files.some((f) => f.path.endsWith('.tf'))) {
      res = { graph: { schemaVersion: '1.0.0', project: fallback?.project ?? { name: o.name ?? 'project', environment: 'dev', region: 'ap-southeast-1' }, nodes: [], edges: [] } };
    } else {
      const r = await importTerraform(files, { parse: o.parse, name: o.name });
      const err = r.report.notes.find((n) => n.severity === 'error');
      res = !r.graph.nodes.length && err ? { graph: null, error: err.message } : { graph: r.graph, report: r.report };
    }
  } catch (e) {
    // network / auth failures are not cached: they say nothing about the commit
    throw e;
  }
  await o.cache?.set(key, res);
  return res;
}

/** The architecture at each commit that touched the folder, oldest first, each with its diff from the one before. */
export async function loadHistory(o: HistoryOptions): Promise<HistoryEntry[]> {
  const commits = (await o.provider.listCommits({ path: o.path, branch: o.branch, limit: o.limit ?? 30 })).slice().reverse();
  const out: HistoryEntry[] = [];
  let prev: { sha: string; graph: Graph } | null = null;
  for (let i = 0; i < commits.length; i++) {
    if (o.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const commit = commits[i];
    const v = await loadVersion(o, commit.sha, prev?.graph);
    let entry: HistoryEntry;
    if (!v.graph) entry = { commit, graph: null, error: v.error, diff: null, summary: [v.error ? `Could not read Terraform: ${v.error}` : 'Could not read Terraform'], changed: false };
    else {
      const diff = diffGraphs(prev?.graph ?? null, v.graph);
      entry = { commit, graph: v.graph, coverage: v.report?.coverage, diff, ...(prev ? { comparedTo: prev.sha } : {}), summary: describeDiff(diff), changed: !diff.empty };
      prev = { sha: commit.sha, graph: v.graph };
    }
    out.push(entry);
    o.onProgress?.(i + 1, commits.length);
  }
  return out;
}
