import { useMemo } from 'react';
import { runRules, type CompileResult, type Finding } from '@cloudcanvas/compiler';
import { toGraph, useStore } from './store';
import { RULES } from './rules';

/** Compliance findings for what is on the canvas. Pure and deterministic, recomputed whenever the architecture changes. */
export function useFindings(result: CompileResult): Finding[] {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const project = useStore((s) => s.project);
  const passthrough = useStore((s) => s.passthrough);
  return useMemo(() => (RULES.length && nodes.length ? runRules(toGraph(nodes, edges, project, passthrough), result, RULES) : []), [nodes, edges, project, passthrough, result]);
}
