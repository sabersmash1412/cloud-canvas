import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEMPLATES, compile, type Graph } from '@cloudcanvas/compiler';

const SERVER = fileURLToPath(new URL('../src/server.ts', import.meta.url));
const TSX = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));
const meta = { name: 'demo', environment: 'dev', region: 'ap-southeast-1' };
const tpl = (id: string): Graph => TEMPLATES.find((t) => t.id === id)!.build(meta);

let client: Client;
let cwd: string;
const PORT = 7790 + Math.floor(Math.random() * 40);

/** Parse the JSON text payload a tool returns. */
const call = async (name: string, args: Record<string, unknown>) => {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as { type: string; text: string }[])[0].text;
  return { isError: Boolean(r.isError), body: JSON.parse(text) as Record<string, any> };
};

beforeAll(async () => {
  cwd = mkdtempSync(join(tmpdir(), 'cc-mcp-'));
  const transport = new StdioClientTransport({ command: TSX, args: [SERVER], cwd, env: { ...(process.env as Record<string, string>), CLOUD_CANVAS_PORT: String(PORT) }, stderr: 'pipe' });
  client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(transport);
}, 60000);
afterAll(async () => { await client?.close(); });

describe('MCP server over real stdio', () => {
  it('advertises the four tools with instructions', async () => {
    const t = await client.listTools();
    expect(t.tools.map((x) => x.name).sort()).toEqual(['list_templates_and_blocks', 'show_on_canvas', 'sync_terraform_folder', 'validate_and_compile']);
    expect(client.getInstructions()).toContain('validate_and_compile');
    for (const tool of t.tools) expect(tool.description!.length).toBeGreaterThan(40);
  });

  it('list_templates_and_blocks returns 7 templates, 15 usable blocks and the connection rules', async () => {
    const { body, isError } = await call('list_templates_and_blocks', {});
    expect(isError).toBe(false);
    expect(body.counts).toMatchObject({ templates: 7, blocks: 15 });
    expect(body.blocks.map((b: any) => b.type)).not.toContain('aws.unmanaged');
    expect(body.connections.length).toBe(23);
    const ecs = body.blocks.find((b: any) => b.type === 'aws.ecs_fargate');
    expect(ecs.placement).toMatchObject({ parentType: 'aws.subnet', tier: ['private'] });
    expect(ecs.fields.map((f: any) => f.key)).toEqual(expect.arrayContaining(['image', 'containerPort', 'user', 'readonlyRoot']));
    expect(body.templates).toHaveLength(7);
    expect(body.templates.every((t: any) => t.resources.length > 0 && t.graph === undefined)).toBe(true);
    // the whole listing must stay small enough for Claude Code to read inline
    const size = JSON.stringify(body).length;
    expect(size, `listing is ${size} chars`).toBeLessThan(24000);
    expect(body.format.shape.schemaVersion).toContain('1.0.0');
  });

  it('asking for one template returns its full graph, and rejects an unknown id', async () => {
    const one = await call('list_templates_and_blocks', { template: 'serverless-api' });
    expect(one.body.templateGraph.nodes.length).toBeGreaterThan(2);
    const bad = await call('list_templates_and_blocks', { template: 'nope' });
    expect(bad.isError).toBe(true);
    expect(bad.body.available).toContain('ecs-cluster');
  });

  it('every template graph it hands out compiles through the same server', async () => {
    const list = (await call('list_templates_and_blocks', {})).body;
    for (const t of list.templates) {
      const graph = (await call('list_templates_and_blocks', { template: t.id })).body.templateGraph;
      const r = await call('validate_and_compile', { graph, publish: false });
      expect(r.isError, t.id).toBe(false);
      expect(r.body.files['main.tf'], t.id).toContain('module "');
    }
  });

  it('compiles a valid graph and returns exactly what the compiler produces', async () => {
    const g = tpl('ecs-cluster');
    const r = await call('validate_and_compile', { graph: g, publish: false });
    expect(r.isError).toBe(false);
    expect(['compiled', 'compiled_with_findings']).toContain(r.body.status);
    const direct = compile(g);
    for (const f of direct.files) expect(r.body.files[f.path], f.path).toBe(f.content);
    expect(JSON.parse(r.body.files['canvas.json']).nodes.length).toBe(g.nodes.length);
    expect(r.body.summary.resources['aws.ecs_fargate']).toBe(1);
  });

  it('accepts the graph as a JSON string too', async () => {
    const r = await call('validate_and_compile', { graph: JSON.stringify(tpl('static-website')), publish: false });
    expect(r.isError).toBe(false);
  });

  it('rejects an invalid graph with structured problems that name the node', async () => {
    const g = tpl('ecs-cluster');
    g.nodes.find((n) => n.id === 'db')!.parentId = 'vpc1-private-a'; // wrong tier
    g.edges.push({ id: 'bad', source: 'db', target: 'alb' }); // not an allowed connection
    const r = await call('validate_and_compile', { graph: g, publish: false });
    expect(r.isError).toBe(true);
    expect(r.body.status).toBe('rejected');
    expect(r.body.stage).toBe('topology');
    expect(r.body.problems.every((p: any) => p.kind === 'topology' && p.severity === 'error')).toBe(true);
    expect(r.body.problems.some((p: any) => p.nodeId === 'db' && /database subnet/.test(p.message))).toBe(true);
    expect(r.body.files).toBeUndefined();
    expect(r.body.next).toContain('call validate_and_compile again');
  });

  it('SELF-CORRECTION LOOP: a wrong graph, fixed only from the error text, then compiles', async () => {
    const g = tpl('ecs-cluster');
    g.nodes.find((n) => n.id === 'svc')!.properties.containerPort = 99999; // out of range
    g.nodes.find((n) => n.id === 'db')!.properties.dbName = '';           // required
    const first = await call('validate_and_compile', { graph: g, publish: false });
    expect(first.isError).toBe(true);
    const msgs = first.body.problems.map((p: any) => p.message).join(' | ');
    expect(msgs).toMatch(/Container port must be ≤ 65535/);
    expect(msgs).toMatch(/Database name is required/);
    // "agent" applies exactly what was asked
    g.nodes.find((n) => n.id === 'svc')!.properties.containerPort = 8080;
    g.nodes.find((n) => n.id === 'db')!.properties.dbName = 'app';
    const second = await call('validate_and_compile', { graph: g, publish: false });
    expect(second.isError).toBe(false);
    expect(second.body.files['main.tf']).toContain('module "api"');
  });

  it('omitted properties take the catalog defaults, and unknown ones are reported', async () => {
    const graph = {
      project: { name: 'mini', environment: 'dev', region: 'ap-southeast-1' },
      nodes: [
        { id: 'vpc1', type: 'aws.vpc', properties: { name: 'main' } },
        { id: 'a', type: 'aws.subnet', parentId: 'vpc1', properties: { name: 'private-a', tier: 'private', az: 'a', cidr: '10.20.10.0/24' } },
        { id: 'b', type: 'aws.subnet', parentId: 'vpc1', properties: { name: 'private-b', tier: 'private', az: 'b', cidr: '10.20.11.0/24' } },
        { id: 'svc', type: 'aws.ecs_fargate', parentId: 'a', properties: { name: 'api', colour: 'blue' } }, // no image, no port, no cpu
      ],
    };
    const r = await call('validate_and_compile', { graph, publish: false });
    expect(r.isError).toBe(false);
    const canvas = JSON.parse(r.body.files['canvas.json']);
    const svc = canvas.nodes.find((n: any) => n.id === 'svc');
    expect(svc.properties).toMatchObject({ image: 'public.ecr.aws/nginx/nginx:stable', containerPort: 8080, cpu: 512, user: '1000:1000', readonlyRoot: true });
    expect(r.body.warnings.some((w: any) => w.nodeId === 'svc' && /"colour" is not a property/.test(w.message))).toBe(true);
  });

  it('malformed input never crashes the server', async () => {
    for (const graph of ['{not json', '[]', { nodes: 'x' }, { project: { name: 'x' } }, JSON.stringify({ schemaVersion: '2.0.0' })]) {
      const r = await call('validate_and_compile', { graph, publish: false });
      expect(r.isError).toBe(true);
      expect(r.body.status).toBe('rejected');
      expect(r.body.problems.length).toBeGreaterThan(0);
    }
    expect((await call('list_templates_and_blocks', {})).isError).toBe(false); // still alive
  });

  it('writes the four files into outputDir and nowhere else', async () => {
    const r = await call('validate_and_compile', { graph: tpl('static-website'), outputDir: 'infra/site', publish: false });
    expect(r.isError).toBe(false);
    for (const f of ['main.tf', 'versions.tf', 'azure-pipelines.yml', 'canvas.json']) expect(existsSync(join(cwd, 'infra/site', f)), f).toBe(true);
    expect(readFileSync(join(cwd, 'infra/site/main.tf'), 'utf8')).toBe(r.body.files['main.tf']);
    expect(r.body.written).toHaveLength(4);
  });

  it('refuses an outputDir that climbs out with ..', async () => {
    const r = await call('validate_and_compile', { graph: tpl('static-website'), outputDir: '../escape', publish: false });
    expect(r.body.writeError).toMatch(/\.\./);
    expect(r.body.written).toBeUndefined();
    expect(existsSync(join(cwd, '..', 'escape'))).toBe(false);
  });

  it('reports compliance honestly: checked with findings when rules are loaded, or clearly not checked', async () => {
    const r = await call('validate_and_compile', { graph: tpl('ecs-cluster'), publish: false });
    if (r.body.complianceChecked) {
      expect(r.body.status).toBe('compiled_with_findings');
      expect(r.body.findings.length).toBeGreaterThan(0);
      for (const f of r.body.findings) { expect(f).toMatchObject({ kind: 'compliance' }); expect(f.nodeId).toBeTruthy(); expect(f.suggestion).toBeTruthy(); }
    } else {
      expect(r.body.complianceNote).toContain('NOT checked');
    }
  });
});

describe('strict mode and the compliance loop (needs the private rules on this machine)', () => {
  it('strict rejects high-severity findings with exact fixes, and applying them compiles', async () => {
    const probe = await call('validate_and_compile', { graph: tpl('ecs-cluster'), publish: false });
    if (!probe.body.complianceChecked) return; // rules not present: nothing to assert
    const g = tpl('ecs-cluster');
    const svc = g.nodes.find((n) => n.id === 'svc')!;
    Object.assign(svc.properties, { readonlyRoot: false, user: '' }); // medium findings; add a high one:
    g.nodes.find((n) => n.id === 'alb')!.properties.https = false;
    const strict = await call('validate_and_compile', { graph: g, strict: true, publish: false });
    expect(strict.isError).toBe(true);
    expect(strict.body.stage).toBe('compliance');
    expect(strict.body.problems.every((p: any) => p.severity === 'high')).toBe(true);
    expect(strict.body.problems.some((p: any) => p.rule === 'ns-6')).toBe(true);
    // not strict: the same graph compiles and carries the findings, including ones with an exact fix
    const lax = await call('validate_and_compile', { graph: g, publish: false });
    expect(lax.isError).toBe(false);
    const withFix = lax.body.findings.filter((f: any) => f.fix);
    expect(withFix.length).toBeGreaterThan(0);
    for (const f of withFix) Object.assign(g.nodes.find((n) => n.id === f.fix.nodeId)!.properties, f.fix.set);
    const after = await call('validate_and_compile', { graph: g, publish: false });
    expect(after.body.findings.some((f: any) => f.rule === 'cs-6')).toBe(false);
    expect(after.body.findings.some((f: any) => f.rule === 'cs-4')).toBe(false);
  });
});

describe('sync_terraform_folder', () => {
  it('imports a folder of Terraform and reports coverage', async () => {
    const dir = join(cwd, 'tf');
    mkdirSync(dir, { recursive: true });
    for (const f of compile(tpl('ecs-cluster')).files.filter((x) => x.path.endsWith('.tf'))) writeFileSync(join(dir, f.path), f.content);
    const r = await call('sync_terraform_folder', { folder: 'tf', watch: false });
    expect(r.isError).toBe(false);
    expect(r.body).toMatchObject({ status: 'synced', coveragePercent: 100, unmanagedBlocks: 0, watching: false });
    expect(r.body.nodes).toBe(5);
  });
  it('rejects a missing folder and a folder with no Terraform', async () => {
    expect((await call('sync_terraform_folder', { folder: 'nope' })).isError).toBe(true);
    mkdirSync(join(cwd, 'empty'), { recursive: true });
    const r = await call('sync_terraform_folder', { folder: 'empty', watch: false });
    expect(r.isError).toBe(true);
    expect(r.body.message).toContain('No .tf files');
  });
});
