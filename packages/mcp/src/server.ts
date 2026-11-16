import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { startBridge, type Bridge } from './bridge.js';
import { loadRules } from './rules.js';
import { graphInput, listTemplatesAndBlocks, makeSync, showOnCanvas, validateAndCompile, type Deps } from './tools.js';

const INSTRUCTIONS = [
  'Cloud Canvas builds AWS infrastructure from a deterministic, approved-module engine. Do not write Terraform by hand for supported resources.',
  'Workflow: (1) call list_templates_and_blocks once to learn the building blocks, connection rules and canvas.json format, and again with template=<id> to start from a ready-made graph; (2) build a canvas.json graph; (3) call validate_and_compile; if it is rejected, read the problems, correct the graph and call it again; (4) when it compiles, use the returned files.',
  'Compliance findings are advisory by default. Findings that carry a "fix" can be cleared by setting those properties. Findings without a fix need a decision from the user (for example a private image registry or a certificate), so ask rather than guess.',
  'A live view of the diagram may be open in the user\'s browser. show_on_canvas lets you update it while you are still designing.',
].join(' ');

export interface Started { server: McpServer; deps: Deps; stop(): Promise<void> }

export async function createServer(opts: { cwd?: string; port?: number; live?: boolean; log?: (s: string) => void } = {}): Promise<Started> {
  const log = opts.log ?? ((s: string) => process.stderr.write(`[cloud-canvas-mcp] ${s}\n`));
  const r = await loadRules();
  log(r.loaded ? `compliance rules: ${r.rules.length} loaded` : `compliance rules NOT loaded (${r.source}); results will say so`);
  const bridge: Bridge | null = opts.live === false ? null : await startBridge(opts.port, log);
  const deps: Deps = { rules: r.rules, rulesLoaded: r.loaded, rulesNote: r.loaded ? 'ok' : `no compliance rules are loaded on this machine (${r.source})`, bridge, cwd: opts.cwd ?? process.cwd() };
  const sync = makeSync(deps);

  const server = new McpServer({ name: 'cloud-canvas', version: '0.1.0' }, { instructions: INSTRUCTIONS });

  server.registerTool('list_templates_and_blocks', {
    title: 'List Cloud Canvas templates, building blocks and the canvas.json format',
    description: 'Returns the starter templates (id, description, resources), every supported AWS building block with its fields, defaults and placement rules, the allowed connections, and how to write a canvas.json. Call this first. Pass template=<id> to also get that template\'s complete ready-to-use graph.',
    inputSchema: { template: z.string().max(60).optional().describe('A template id from the list; adds that template\'s full graph as templateGraph.') },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, async (a) => listTemplatesAndBlocks(a));

  server.registerTool('validate_and_compile', {
    title: 'Validate a canvas.json graph, check compliance and compile it to Terraform',
    description: 'Validates the graph (topology), runs the compliance rules, and deterministically compiles main.tf, versions.tf, azure-pipelines.yml and a formatted canvas.json. If the graph is invalid it returns structured problems naming each node so you can correct the graph and call again. Set strict=true to also reject high-severity compliance findings. Pass outputDir to write the files to a folder.',
    inputSchema: {
      graph: graphInput,
      strict: z.boolean().optional().describe('Reject the graph when there are high-severity compliance findings. Default false: findings are returned alongside the code.'),
      outputDir: z.string().max(500).optional().describe('Write main.tf, versions.tf, azure-pipelines.yml and canvas.json into this folder (relative to the working directory).'),
      publish: z.boolean().optional().describe('Also show this graph on the live canvas in the browser. Default true.'),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  }, async (a) => validateAndCompile(deps, a));

  server.registerTool('show_on_canvas', {
    title: 'Show a graph on the live Cloud Canvas browser view',
    description: 'Pushes a work-in-progress canvas.json graph to the live diagram in the user\'s browser without compiling it. Use it to let the user watch the design take shape; problems are returned but do not block.',
    inputSchema: { graph: graphInput, note: z.string().max(200).optional().describe('A short caption shown with the diagram.') },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, async (a) => showOnCanvas(deps, a));

  server.registerTool('sync_terraform_folder', {
    title: 'Show an existing Terraform folder as a live diagram',
    description: 'Imports the .tf files in a folder (module-based Terraform becomes diagram nodes), shows the architecture on the live canvas, and keeps it updated as the files change. Use this when the repo already has Terraform or you are writing .tf files directly.',
    inputSchema: { folder: z.string().min(1).max(500).describe('Folder containing the Terraform, relative to the working directory or absolute.'), watch: z.boolean().optional().describe('Keep watching for changes. Default true.') },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  }, async (a) => sync.run(a));

  return { server, deps, stop: async () => { sync.stop(); await bridge?.close(); await server.close(); } };
}

async function main() {
  const live = process.env.CLOUD_CANVAS_LIVE !== '0';
  const port = process.env.CLOUD_CANVAS_PORT ? Number(process.env.CLOUD_CANVAS_PORT) : undefined;
  const { server, stop } = await createServer({ live, port });
  await server.connect(new StdioServerTransport());
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { void stop().finally(() => process.exit(0)); });
  process.stdin.on('close', () => { void stop().finally(() => process.exit(0)); });
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) main().catch((e) => { process.stderr.write(`[cloud-canvas-mcp] fatal: ${(e as Error).message}\n`); process.exit(1); });
