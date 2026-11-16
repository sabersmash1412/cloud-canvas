import type { Graph } from '../types';
import type { ImportReport, TfFile } from '../import';

export interface CommitInfo {
  sha: string;
  /** first line of the commit message */
  message: string;
  author: string;
  /** ISO 8601 */
  date: string;
  /** link to the commit on the host, when it has one */
  url?: string;
}

/** Where Terraform history comes from. GitHub and a local checkout implement it; Azure Repos can later. */
export interface RepoProvider {
  /** commits that touched `path`, newest first */
  listCommits(opts: { path: string; branch?: string; limit?: number }): Promise<CommitInfo[]>;
  /** the .tf / .tfvars files directly inside `dir` as they were at `sha` (empty when the folder did not exist yet) */
  readFilesAt(sha: string, dir: string): Promise<TfFile[]>;
}

export interface CachedImport {
  graph: Graph | null;
  report?: ImportReport;
  error?: string;
}

/** Commits never change, so an import result can be cached against its SHA forever. */
export interface HistoryCache {
  get(key: string): Promise<CachedImport | undefined>;
  set(key: string, value: CachedImport): Promise<void>;
}
