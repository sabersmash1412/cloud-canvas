import { z } from 'zod';
import { CATALOG, compile, defaultProps, runRules, type CompileResult, type Finding, type Graph, type Rule } from '@cloudcanvas/compiler';
import type { Problem } from './protocol.js';

const MAX_NODES = 300;
const MAX_EDGES = 600;
export const MAX_BYTES = 2_000_000;

const Prop = z.union([z.string(), z.number(), z.boolean()]);
const Node = z.object({
  id: z.string().min(1).max(80),
  type: z.string().min(1).max(60),
  parentId: z.string().max(80).optional(),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }).default({ x: 0, y: 0 }),
  size: z.object({ w: z.number().finite(), h: z.number().finite() }).optional(),
  properties: z.record(Prop).default({}),
  label: z.string().max(80).optional(),
  extras: z.record(z.unknown()).optional(),
  notInSource: z.array(z.string()).optional(),
});
const Edge = z.object({ id: z.string().min(1).max(120), source: z.string().min(1).max(80), target: z.string().min(1).max(80) });

export const GraphSchema = z.object({
  schemaVersion: z.literal('1.0.0').default('1.0.0'),
  project: z.object({ name: z.string().min(1).max(60), environment: z.string().min(1).max(20), region: z.string().min(3).max(30), squad: z.string().max(60).optional() }),
  nodes: z.array(Node).max(MAX_NODES),
  edges: z.array(Edge).max(MAX_EDGES).default([]),
  passthrough: z.array(z.object({ file: z.string(), code: z.string() })).optional(),
});

/** Parse untrusted input (an object, or a JSON string) into a Graph, with errors an agent can act on. */
export function parseGraph(input: unknown): { graph: Graph } | { problems: Problem[] } {
  let value = input;
  if (typeof input === 'string') {
    if (input.length > MAX_BYTES) return { problems: [{ kind: 'topology', severity: 'error', message: `The graph is larger than ${MAX_BYTES} bytes.` }] };
    try { value = JSON.parse(input); } catch (e) { return { problems: [{ kind: 'topology', severity: 'error', message: `The graph is not valid JSON: ${(e as Error).message}`, suggestion: 'Pass a JSON object (or a JSON string of one) with schemaVersion, project, nodes and edges.' }] }; }
  }
  const r = GraphSchema.safeParse(value);
  if (!r.success)
    return { problems: r.error.issues.slice(0, 20).map((i) => ({ kind: 'topology' as const, severity: 'error' as const, message: `${i.path.join('.') || 'graph'}: ${i.message}`, suggestion: 'Match the canvas.json format returned by list_templates_and_blocks.' })) };
  // Omitted properties take the catalog defaults, as the format notes promise (the compiler's validator checks
  // the properties exactly as given, so the defaults are filled in here, before validation).
  const graph = r.data as Graph;
  graph.nodes = graph.nodes.map((n) => (CATALOG[n.type] ? { ...n, properties: { ...defaultProps(n.type), ...n.properties } } : n));
  return { graph };
}

/** Property keys the catalog does not define for a node: they would be silently ignored, so tell the agent. */
export function unknownProperties(g: Graph): Problem[] {
  const out: Problem[] = [];
  for (const n of g.nodes) {
    const def = CATALOG[n.type];
    if (!def) continue;
    const known = new Set(def.fields.map((f) => f.key));
    for (const k of Object.keys(n.properties)) if (!known.has(k)) out.push({ kind: 'topology', severity: 'warning', nodeId: n.id, message: `"${k}" is not a property of ${def.label} and was ignored.`, suggestion: `Valid properties: ${[...known].join(', ')}.` });
  }
  return out;
}

export const findingToProblem = (f: Finding): Problem => ({ kind: 'compliance', severity: f.severity, nodeId: f.nodeId, rule: f.rule, message: `${f.title}: ${f.message}`, suggestion: f.suggestion, ...(f.fix ? { fix: f.fix } : {}) });

export interface Evaluation {
  graph: Graph;
  result: CompileResult;
  /** topology errors/warnings from validation */
  topology: Problem[];
  /** compliance findings */
  compliance: Problem[];
  /** compile produced code (no topology errors) */
  ok: boolean;
  complianceChecked: boolean;
}

/** Validate, compile, and check compliance. Pure and deterministic. */
export function evaluate(graph: Graph, rules: Rule[], rulesLoaded: boolean): Evaluation {
  const result = compile(graph);
  const topology: Problem[] = [
    ...result.diagnostics.filter((d) => d.severity !== 'info').map((d) => ({ kind: 'topology' as const, severity: d.severity === 'error' ? ('error' as const) : ('warning' as const), nodeId: d.nodeId, message: d.message })),
    ...unknownProperties(graph),
  ];
  const ok = result.ok;
  const compliance = ok && rulesLoaded ? runRules(graph, result, rules).map(findingToProblem) : [];
  return { graph, result, topology, compliance, ok, complianceChecked: ok && rulesLoaded };
}

/** The formatted canvas.json that goes back to the agent and to disk. */
export const formatGraph = (g: Graph) => JSON.stringify(g, null, 2) + '\n';
