import { readFileSync, readdirSync } from 'node:fs';
import { parse } from '@cdktf/hcl2json';
import { describe, expect, it } from 'vitest';
import { compile, importTerraform, migrateGraph, TEMPLATES } from '../src';
import type { Graph, GraphNode } from '../src';

const meta = { name: 'demo', environment: 'dev', region: 'ap-southeast-1' };
const read = (u: string) => JSON.parse(readFileSync(new URL(u, import.meta.url), 'utf8')) as Graph;
const files = (g: Graph) => compile(g).files.filter((f) => f.path.endsWith('.tf')).map((f) => ({ path: f.path, content: f.content }));
const run = (g: Graph) => importTerraform(files(g), { parse, name: g.project.name });

/** architecture only: what is on the canvas and how it is wired (no coordinates) */
function shape(g: Graph) {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const key = (n: GraphNode) => `${n.type}:${n.type === 'aws.subnet' ? byId.get(n.parentId!)?.properties.name + '/' : ''}${n.properties.name}`;
  const nodes = g.nodes.map((n) => ({ k: key(n), parent: n.parentId ? key(byId.get(n.parentId)!) : null, props: n.properties })).sort((a, b) => a.k.localeCompare(b.k));
  const edges = g.edges.map((e) => `${key(byId.get(e.source)!)}>${key(byId.get(e.target)!)}`).sort();
  return { nodes, edges };
}

const graphs: [string, Graph][] = [
  ...TEMPLATES.map((t) => [`template ${t.id}`, t.build(meta)] as [string, Graph]),
  ['example three-tier', migrateGraph(read('../../../examples/three-tier.canvas.json'))],
  ['example kitchen-sink', migrateGraph(read('../../../examples/kitchen-sink.canvas.json'))],
];

describe('import: round trip (compile -> import -> compile)', () => {
  for (const [name, g] of graphs) {
    it(`${name}: same architecture and identical code`, async () => {
      const first = compile(g);
      expect(first.ok, 'source graph must compile').toBe(true);
      const { graph, report } = await run(g);
      expect(report.unmanaged, 'nothing should fall out as unmanaged').toEqual([]);
      expect(report.coverage).toBe(100);
      expect(shape(graph)).toEqual(shape(g));
      const again = compile(graph);
      expect(again.ok).toBe(true);
      for (const f of first.files.filter((x) => x.path.endsWith('.tf'))) expect(again.files.find((x) => x.path === f.path)!.content, f.path).toBe(f.content);
      expect(graph.project).toMatchObject({ name: g.project.name, environment: g.project.environment, region: g.project.region });
    });
  }
});

describe('import: appcentral sample (exported from Cloud Canvas)', () => {
  const dir = new URL('./fixtures/appcentral-dev/', import.meta.url);
  const load = (p: string) => readFileSync(new URL(p, dir), 'utf8');
  const tf = () => ['main.tf', 'versions.tf'].map((p) => ({ path: p, content: load(p) }));

  it('rebuilds the architecture that was exported', async () => {
    const { graph, report } = await importTerraform(tf(), { parse, name: 'appcentral' });
    const original = migrateGraph(JSON.parse(load('canvas.json')));
    expect(report.coverage).toBe(100);
    expect(report.unmanaged).toEqual([]);
    expect(shape(graph)).toEqual(shape(original));
    expect(graph.project).toMatchObject({ name: 'appcentral', environment: 'dev', region: 'ap-southeast-1' });
    // node ids come back from the # canvas:node markers
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(expect.arrayContaining(['vpc1', 'alb', 'svc', 'db', 'q']));
  });

  it('is stable: importing its own output again changes nothing', async () => {
    const a = (await importTerraform(tf(), { parse, name: 'appcentral' })).graph;
    const b = (await importTerraform(files(a), { parse, name: 'appcentral' })).graph;
    expect(shape(b)).toEqual(shape(a));
    expect(compile(b).files[0].content).toBe(compile(a).files[0].content);
  });

  it('regenerating only adds settings; it never changes what the original code said', async () => {
    const { graph, report } = await importTerraform(tf(), { parse, name: 'appcentral' });
    const out = compile(graph).files[0].content.split('\n');
    const old = load('main.tf').split('\n');
    const changed = out.filter((l) => !old.includes(l)).map((l) => l.trim()).filter(Boolean);
    // every changed line is either VPC subnet spelling or a newly added compliant setting
    const ALLOWED = /^(azs|name|cidr|(public|private|database)_subnets|(public|private|database)_subnet_names|create_database_subnet_group|enable_\w+|single_nat_gateway|one_nat_gateway_per_az|create_flow_log_\w+|flow_log_\w+|parameters|enabled_cloudwatch_logs_exports|create_cloudwatch_log_group|cloudwatch_log_group_retention_in_days|name|value|\]|\{|\},|assign_public_ip|memory|subnet_ids)\b/;
    for (const l of changed) expect(l, l).toMatch(ALLOWED);
    // the ECS service is the clearest case: its original (writable root, open egress) settings are kept as written
    expect(out.join('\n')).toContain('egress_all');
    expect(report.preserved.some((p) => p.keys.includes('services'))).toBe(true);
    expect(report.additions.length).toBeGreaterThan(0);
  });
});

describe('import: things the catalog does not model', () => {
  const base = (extra: string) => [{ path: 'main.tf', content: `module "q" {\n  source  = "terraform-aws-modules/sqs/aws"\n  version = "~> 4.2"\n\n  name = "x-dev-jobs"\n${extra}\n}\n` }];

  it('keeps inputs the form cannot express and re-emits them verbatim', async () => {
    const { graph, report } = await importTerraform(base('  kms_master_key_id = "alias/aws/sqs"\n  message_retention_seconds = 86400'), { parse });
    const q = graph.nodes.find((n) => n.type === 'aws.sqs')!;
    expect(q.extras).toMatchObject({ kms_master_key_id: 'alias/aws/sqs', message_retention_seconds: 86400 });
    expect(report.preserved[0].keys).toEqual(expect.arrayContaining(['kms_master_key_id', 'message_retention_seconds']));
    const out = compile(graph).files[0].content;
    expect(out).toContain('kms_master_key_id');
    expect(out).toContain('"alias/aws/sqs"');
    expect(out).toContain('86400');
  });

  it('turns unknown modules into unmanaged nodes with their code intact', async () => {
    const src = 'module "wafx" {\n  source = "acme/waf/aws"\n  rules  = ["a", "b"]\n}\n';
    const { graph, report } = await importTerraform([{ path: 'main.tf', content: src }], { parse });
    expect(report.unmanaged).toHaveLength(1);
    expect(report.coverage).toBeLessThan(100);
    const u = graph.nodes.find((n) => n.type === 'aws.unmanaged')!;
    expect(u.properties.code).toContain('acme/waf/aws');
    expect(compile(graph).files[0].content).toContain('source = "acme/waf/aws"');
  });

  it('keeps non-module blocks (variables, outputs, raw resources) in main.tf', async () => {
    const src = 'variable "x" {\n  default = 1\n}\n\nresource "aws_sns_topic" "t" {\n  name = "t"\n}\n\noutput "o" {\n  value = 1\n}\n';
    const { graph, report } = await importTerraform([{ path: 'main.tf', content: src }], { parse });
    const out = compile(graph).files[0].content;
    for (const s of ['variable "x"', 'resource "aws_sns_topic" "t"', 'output "o"']) expect(out).toContain(s);
    expect(report.passthrough).toBe(3);
  });

  it('reads simple variables from defaults and tfvars', async () => {
    const files = [
      { path: 'main.tf', content: 'module "s" {\n  source = "terraform-aws-modules/s3-bucket/aws"\n  bucket = "demo-dev-data"\n  force_destroy = var.fd\n}\n' },
      { path: 'terraform.tfvars', content: 'fd = true\n' },
    ];
    const { graph } = await importTerraform(files, { parse });
    expect(graph.nodes.find((n) => n.type === 'aws.s3')!.properties.forceDestroy).toBe(true);
  });

  it('reports an unparseable file instead of throwing', async () => {
    const { report } = await importTerraform([{ path: 'bad.tf', content: 'module "x" {' }], { parse });
    expect(report.notes.some((n) => n.severity === 'error')).toBe(true);
  });
});

describe('import: project name and prefix', () => {
  it('finds "<project>-<env>-" from a single resource name', async () => {
    const src = 'module "q" {\n  source = "terraform-aws-modules/sqs/aws"\n  name   = "shop-dev-orders"\n}\n';
    const { graph, report } = await importTerraform([{ path: 'main.tf', content: src }], { parse });
    expect(graph.project).toMatchObject({ name: 'shop', environment: 'dev' });
    expect(graph.nodes.find((n) => n.type === 'aws.sqs')!.properties.name).toBe('orders');
    expect(graph.nodes.find((n) => n.type === 'aws.sqs')!.extras).toBeUndefined();
    expect(report.notes.some((n) => n.message.includes('"name" is kept'))).toBe(false);
  });
  it('falls back to the given name when nothing in the code says', async () => {
    const src = 'module "q" {\n  source = "terraform-aws-modules/sqs/aws"\n  name   = "orders"\n}\n';
    const { graph } = await importTerraform([{ path: 'main.tf', content: src }], { parse, name: 'my-infra' });
    expect(graph.project.name).toBe('my-infra');
    // a name that doesn't follow our convention is preserved exactly
    expect(compile(graph).files[0].content).toContain('name                       = "orders"');
  });
});

describe('import: layout', () => {
  it('services that share a subnet are placed side by side, never on top of each other', async () => {
    const g = TEMPLATES.find((t) => t.id === 'ecs-cluster')!.build(meta);
    // an internal ALB lives in the private subnet with the service
    g.nodes.find((n) => n.id === 'alb')!.properties.internal = true;
    g.nodes.find((n) => n.id === 'alb')!.parentId = 'vpc1-private-a';
    expect(compile(g).ok).toBe(true);
    const { graph } = await importTerraform(files(g), { parse });
    const inSub = graph.nodes.filter((n) => n.parentId === 'vpc1-private-a');
    expect(inSub.length).toBeGreaterThanOrEqual(2);
    const xs = inSub.map((n) => n.position.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(100); // a node is 96px wide
    // and they still fit inside a default-width subnet (400px)
    expect(Math.max(...xs) + 96).toBeLessThanOrEqual(400);
  });
});
