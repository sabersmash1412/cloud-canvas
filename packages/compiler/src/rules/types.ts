import type { CompileResult, Graph, GraphNode } from '../types';

export type Severity = 'high' | 'medium' | 'low';

/** A proposed change to one node, expressed as the catalog fields it would set. */
export interface FixPatch {
  nodeId: string;
  /** catalog property key -> new value */
  set: Record<string, string | number | boolean>;
}

export interface Finding {
  /** rule id (a short control reference) */
  rule: string;
  title: string;
  severity: Severity;
  nodeId: string;
  /** one-line statement of what is wrong, specific to this node */
  message: string;
  /** what to change, in plain words */
  suggestion: string;
  /** property edits that fix it, when a field can express the fix; absent means "change it in Terraform" */
  fix?: FixPatch;
  /** Terraform-level detail used to build a precise prompt (module input names and the desired values) */
  terraform?: string;
}

export interface RuleContext {
  graph: Graph;
  result: CompileResult;
  node: (id: string) => GraphNode | undefined;
  /** nodes of a type */
  ofType: (type: string) => GraphNode[];
  /** the module inputs this node really emits (generated inputs overridden by imported ones) */
  inputs: (id: string) => Record<string, unknown>;
  /** nodes connected out of / into `id` */
  out: (id: string, type?: string) => GraphNode[];
  into: (id: string, type?: string) => GraphNode[];
  /** the services of an ECS module's `services` input */
  services: (id: string) => Record<string, any>;
  /** the parent subnet of a node */
  tierOf: (id: string) => string | undefined;
}

export interface Rule {
  id: string;
  title: string;
  severity: Severity;
  check: (ctx: RuleContext) => Omit<Finding, 'rule' | 'title' | 'severity'>[];
}
