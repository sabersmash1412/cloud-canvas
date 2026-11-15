export type PropValue = string | number | boolean;
export type Props = Record<string, PropValue>;

export interface GraphNode {
  id: string;
  type: string;
  parentId?: string;
  position: { x: number; y: number };
  size?: { w: number; h: number };
  properties: Props;
  /** Terraform module label override (set by import so references to the module stay valid) */
  label?: string;
  /**
   * Module inputs imported from existing Terraform that the catalog form can't express.
   * Re-emitted verbatim (in hcl2json form: expressions are "${...}" strings); not editable on the canvas.
   */
  extras?: Record<string, unknown>;
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
  /** Blocks imported from Terraform that are not shown on the canvas; emitted verbatim in main.tf */
  passthrough?: { file: string; code: string }[];
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
  /** came from imported Terraform; not editable on the canvas */
  imported?: boolean;
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

export interface ModuleOutput {
  label: string;
  /** inputs generated from the catalog (before imported extras are merged in) */
  generated: Record<string, unknown>;
  /** the module is given `providers = { aws = aws.us_east_1 }` separately from its inputs */
  usEast1?: boolean;
  companions: { label: string; source: string; inputs: Record<string, unknown> }[];
  rawBlocks: string[];
}

export interface CompileResult {
  files: CompiledFile[];
  /** generated module calls per node; used by the importer to compare against existing code */
  modules: Record<string, ModuleOutput>;
  blocks: BlockRange[];
  details: Record<string, NodeDetail>;
  diagnostics: Diagnostic[];
  ok: boolean;
}
