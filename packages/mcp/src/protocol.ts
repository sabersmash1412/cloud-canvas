/** Shapes shared by the MCP tools and the live canvas bridge. Plain data only: safe to import in the browser. */
import type { Graph } from '@cloudcanvas/compiler';

export interface Problem {
  kind: 'topology' | 'compliance';
  severity: 'error' | 'high' | 'medium' | 'low' | 'warning';
  nodeId?: string;
  rule?: string;
  message: string;
  /** what to change, in words */
  suggestion?: string;
  /** exact catalog property edits that clear it, when a field can express the fix */
  fix?: { nodeId: string; set: Record<string, string | number | boolean> };
}

export interface LiveMessage {
  /** monotonically increasing per server run */
  seq: number;
  /** what produced this graph */
  source: 'validate_and_compile' | 'show_on_canvas' | 'sync_terraform_folder';
  at: string;
  graph: Graph;
  /** the graph compiled without topology errors */
  ok: boolean;
  /** problems found (topology errors, compliance findings); present even when ok */
  problems: Problem[];
  note?: string;
  /** terraform folder being watched, for sync_terraform_folder */
  folder?: string;
}
