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

export interface CompileResult {
  files: CompiledFile[];
  blocks: BlockRange[];
  diagnostics: Diagnostic[];
  ok: boolean;
}
