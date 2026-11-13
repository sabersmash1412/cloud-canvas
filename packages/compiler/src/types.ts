export type PropValue = string | number | boolean;
export type Props = Record<string, PropValue>;

export interface GraphNode {
  id: string;
  type: string;
  parentId?: string;
  position: { x: number; y: number };
  size?: { w: number; h: number };
  properties: Props;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
}

export interface ProjectMeta {
  name: string;
  squad?: string;
  environment: string;
  region: string;
}

export interface Graph {
  schemaVersion: '1.0.0';
  project: ProjectMeta;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type Tier = 'public' | 'private' | 'database';

export interface FieldDef {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  default: PropValue;
  options?: (string | number)[];
  help?: string;
  required?: boolean;
  min?: number;
  max?: number;
  pattern?: string;
  placeholder?: string;
}

export interface Diagnostic {
  severity: 'error' | 'warning' | 'info';
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface CompiledFile {
  path: string;
  language: 'hcl' | 'yaml' | 'json';
  content: string;
}

export interface BlockRange {
  nodeId: string;
  file: string;
  startLine: number;
  endLine: number;
}

export interface DetailRef {
  nodeId: string;
  /** terraform module label, e.g. "main" */
  label: string;
  /** referenced output, e.g. "vpc_id" */
  attr: string;
}

export interface DetailInput {
  key: string;
  kind: 'string' | 'number' | 'boolean' | 'null' | 'ref' | 'expr' | 'object' | 'list';
  /** display text (multi-line HCL for object/list) */
  text: string;
  /** other canvas nodes this value points at */
  refs: DetailRef[];
}

/** Structured view of one node's generated module call, for the editor panel. */
export interface NodeDetail {
  moduleLabel: string;
  source: string;
  version: string;
  inputs: DetailInput[];
  /** extra modules generated alongside (e.g. the database security group) */
  companions: { label: string; source: string }[];
  /** structural node (subnet): configuration lives in its parent's module */
  virtual?: boolean;
}

export interface CompileResult {
  files: CompiledFile[];
  blocks: BlockRange[];
  details: Record<string, NodeDetail>;
  diagnostics: Diagnostic[];
  ok: boolean;
}
