import { z } from 'zod';
import { parse as hclParse } from '@cdktf/hcl2json';
import { TEMPLATES, compile, runRules, type Rule } from '@cloudcanvas/compiler';
import type { Bridge } from './bridge.js';
import { describeEngine } from './describe.js';
import { evaluate, findingToProblem, formatGraph, parseGraph, type Evaluation } from './engine.js';
import { writeOutputs } from './files.js';
import type { Problem } from './protocol.js';
import { importFolder, resolveFolder, watchFolder, type Watch } from './sync.js';

export interface Deps {
  rules: Rule[];
  rulesLoaded: boolean;
  rulesNote: string;
  bridge: Bridge | null;
  /** working directory for relative paths (the folder Claude Code was started in) */
  cwd: string;
}

/** Compact JSON: Claude Code will not inline very large tool results, and indentation roughly doubles the size. */
const text = (o: unknown) => JSON.stringify(o);
const respond = (o: Record<string, unknown>, isError = false) => ({ content: [{ type: 'text' as const, text: text(o) }], ...(isError ? { isError: true } : {}) });

const SEVERITY_RANK = { error: 0, high: 1, medium: 2, low: 3, warning: 4 } as const;
const sortProblems = (p: Problem[]) => [...p].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (a.rule ?? '').localeCompare(b.rule ?? '') || (a.nodeId ?? '').localeCompare(b.nodeId ?? ''));

export const graphInput = z.union([z.record(z.unknown()), z.string()]).describe('The canvas.json graph, as an object (preferred) or a JSON string.');

export function listTemplatesAndBlocks(a: { template?: string } = {}) {
  if (a.template && !TEMPLATES.some((t) => t.id === a.template))
    return respond({ status: 'rejected', message: `Unknown template "${a.template}".`, available: TEMPLATES.map((t) => t.id) }, true);
  return respond({ ...describeEngine({ template: a.template }), nextStep: a.template ? 'Edit this graph if needed, then call validate_and_compile.' : 'Pick a template and call this tool again with template=<id> to get its ready-made graph, or build a canvas.json from the blocks. Then call validate_and_compile.' });
}

export interface CompileArgs { graph: unknown; strict?: boolean; outputDir?: string; publish?: boolean }

export function validateAndCompile(d: Deps, a: CompileArgs) {
  const parsed = parseGraph(a.graph);
  if ('problems' in parsed) {
    return respond({ status: 'rejected', stage: 'input', problems: parsed.problems, next: 'Fix the graph so it matches the format from list_templates_and_blocks, then call validate_and_compile again.' }, true);
  }
  const ev = evaluate(parsed.graph, d.rules, d.rulesLoaded);
  const problems = sortProblems([...ev.topology, ...ev.compliance]);
  const topologyErrors = ev.topology.filter((p) => p.severity === 'error');
  const blocking = a.strict ? ev.compliance.filter((p) => p.severity === 'high') : [];

  if (a.publish !== false && d.bridge) d.bridge.publish({ source: 'validate_and_compile', graph: parsed.graph, ok: ev.ok, problems });

  if (topologyErrors.length) {
    return respond({
      status: 'rejected', stage: 'topology', complianceChecked: false,
      problems: topologyErrors,
      warnings: ev.topology.filter((p) => p.severity !== 'error'),
      next: 'Fix every topology problem below (each names the node), then call validate_and_compile again. No Terraform was generated.',
    }, true);
  }
  if (blocking.length) {
    return respond({
      status: 'rejected', stage: 'compliance', complianceChecked: true, strict: true,
      problems: blocking,
      otherFindings: ev.compliance.filter((p) => !blocking.includes(p)),
      next: 'Strict mode blocks high-severity findings. Apply each suggestion (use "fix" where given: set those properties on that node), then call validate_and_compile again.',
    }, true);
  }

  const files: Record<string, string> = Object.fromEntries(ev.result.files.map((f) => [f.path, f.content]));
  files['canvas.json'] = formatGraph(parsed.graph);
  let written: string[] | undefined;
  let writeError: string | undefined;
  if (a.outputDir) {
    try { written = writeOutputs(a.outputDir, files, d.cwd); } catch (e) { writeError = (e as Error).message; }
  }
  return respond({
    status: ev.compliance.length ? 'compiled_with_findings' : 'compiled',
    complianceChecked: ev.complianceChecked,
    ...(ev.complianceChecked ? {} : { complianceNote: `Compliance was NOT checked: ${d.rulesNote}.` }),
    summary: summarise(ev),
    findings: ev.compliance,
    warnings: ev.topology.filter((p) => p.severity !== 'error'),
    ...(ev.compliance.length ? { next: 'The Terraform below is valid. To clear the findings, change the listed properties (use "fix" where given) and call validate_and_compile again. Findings with no "fix" need a decision from the user, such as a private image or a certificate.' } : {}),
    files,
    ...(written ? { written } : {}),
    ...(writeError ? { writeError } : {}),
    ...(d.bridge ? { liveView: `http://127.0.0.1:${d.bridge.port}` } : {}),
  });
}

function summarise(ev: Evaluation) {
  const byType = new Map<string, number>();
  for (const n of ev.graph.nodes) if (n.type !== 'aws.subnet') byType.set(n.type, (byType.get(n.type) ?? 0) + 1);
  return { project: ev.graph.project, resources: Object.fromEntries(byType), subnets: ev.graph.nodes.filter((n) => n.type === 'aws.subnet').length, connections: ev.graph.edges.length, files: ev.result.files.map((f) => f.path), findingCount: ev.compliance.length };
}

/** Show a work-in-progress graph on the live canvas without compiling it. */
export function showOnCanvas(d: Deps, a: { graph: unknown; note?: string }) {
  const parsed = parseGraph(a.graph);
  if ('problems' in parsed) return respond({ status: 'rejected', problems: parsed.problems }, true);
  const ev = evaluate(parsed.graph, d.rules, d.rulesLoaded);
  const problems = sortProblems([...ev.topology, ...ev.compliance]);
  if (!d.bridge) return respond({ status: 'no_live_view', message: 'The live canvas server could not start (all ports busy). The graph was checked but not shown.', problems });
  const m = d.bridge.publish({ source: 'show_on_canvas', graph: parsed.graph, ok: ev.ok, problems, ...(a.note ? { note: a.note.slice(0, 200) } : {}) });
  return respond({ status: 'shown', seq: m.seq, browsersConnected: d.bridge.clients(), liveView: `http://127.0.0.1:${d.bridge.port}`, problems });
}

/** Import an existing Terraform folder, show it live, and keep it in step as files change. */
export function makeSync(d: Deps) {
  let active: Watch | null = null;
  return {
    stop: () => { active?.stop(); active = null; },
    async run(a: { folder: string; watch?: boolean }) {
      let folder: string;
      try { folder = resolveFolder(a.folder, d.cwd); } catch (e) { return respond({ status: 'rejected', message: (e as Error).message }, true); }
      const push = async () => {
        const o = await importFolder(folder, hclParse as never);
        if (!o.graph) return o; // keep the last good diagram on screen while the files are mid-edit
        const imported = o.graph;
        // imported Terraform is shown as it is: lenient compile, then the compliance rules on what it really says
        const res = compile(imported, { lenient: true });
        const topology: Problem[] = res.diagnostics.filter((x) => x.severity !== 'info').map((x) => ({ kind: 'topology' as const, severity: x.severity === 'error' ? ('error' as const) : ('warning' as const), nodeId: x.nodeId, message: x.message }));
        const compliance: Problem[] = d.rulesLoaded ? runRules(imported, res, d.rules).map(findingToProblem) : [];
        d.bridge?.publish({ source: 'sync_terraform_folder', graph: imported, ok: true, problems: sortProblems([...topology, ...compliance]), folder, note: `Imported ${o.files} file${o.files === 1 ? '' : 's'} (${o.coverage}% mapped)` });
        return o;
      };
      const first = await push();
      active?.stop();
      active = null;
      if (a.watch !== false && first.graph) active = watchFolder(folder, () => { void push(); });
      if (!first.graph) return respond({ status: 'rejected', message: first.error }, true);
      return respond({
        status: 'synced', folder, filesRead: first.files, coveragePercent: first.coverage, unmanagedBlocks: first.unmanaged,
        watching: Boolean(active), nodes: first.graph.nodes.filter((n) => n.type !== 'aws.subnet').length,
        note: 'Only module-based Terraform becomes diagram nodes; other blocks are kept but not drawn.',
        ...(d.bridge ? { liveView: `http://127.0.0.1:${d.bridge.port}`, browsersConnected: d.bridge.clients() } : { liveView: 'unavailable' }),
      });
    },
  };
}
