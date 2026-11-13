import { useEffect, useMemo } from 'react';
import { compile, type CompileResult } from '@cloudcanvas/compiler';
import { toGraph, useStore } from './store';

/** Compile once per graph change (pure + deterministic) and share diagnostics via the store. */
export function useCompile(): CompileResult {
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const project = useStore((s) => s.project);
  const setDiagnostics = useStore((s) => s.setDiagnostics);
  const result = useMemo(() => compile(toGraph(nodes, edges, project)), [nodes, edges, project]);
  useEffect(() => setDiagnostics(result.diagnostics), [result, setDiagnostics]);
  return result;
}
