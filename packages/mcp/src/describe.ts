import { CATALOG_LIST, EDGE_RULES, SUB, TEMPLATES, tiersOf, type NodeDef } from '@cloudcanvas/compiler';

const META = { name: 'my-service', squad: 'platform', environment: 'dev', region: 'ap-southeast-1' };

/** The canvas.json format, written for an agent. Generated facts (types, fields, rules) come from the live catalog. */
export const FORMAT = {
  description: 'A canvas.json is one JSON object. Build it, then pass it to validate_and_compile.',
  shape: {
    schemaVersion: '"1.0.0" (always)',
    project: '{ name: lowercase-hyphen string, environment: "dev"|"uat"|"prod", region: AWS region, squad?: string }',
    nodes: 'array of { id, type, parentId?, position:{x,y}, size?:{w,h}, properties:{...} }',
    edges: 'array of { id, source, target } (source/target are node ids)',
  },
  rules: [
    'Every node id must be unique. Use short stable ids such as "vpc1", "alb", "svc", "db".',
    'Always start with one aws.vpc node (no parentId). It only needs properties name, cidr, nat.',
    'Subnets are nodes of type aws.subnet with parentId = the VPC id. One subnet per tier (public, private, database) per zone (a, b, c). Give each a distinct CIDR inside the VPC range.',
    'A node whose block says "lives in a subnet" must set parentId to the id of a subnet of the right tier, and the VPC must have subnets of that tier in at least minAzs zones where stated.',
    'Nodes that need no VPC (S3, SQS, SNS, DynamoDB, API Gateway, CloudFront, ACM, Route 53) have no parentId.',
    'Edges describe relationships and drive IAM, security groups, target groups and policies. Only the connections listed under "connections" are allowed.',
    'properties must only use the keys listed for that type. Omitted properties take the listed defaults (the compiled canvas.json returned to you shows the values that were used).',
    'position is layout only: any numbers are fine. Subnet size is { w: ' + SUB.w + ', h: ' + SUB.h + ' } by default.',
    'Do not invent Terraform: output is generated deterministically from this graph by approved modules.',
  ],
  exampleSubnet: { id: 'vpc1-private-a', type: 'aws.subnet', parentId: 'vpc1', position: { x: 16, y: 216 }, size: { w: SUB.w, h: SUB.h }, properties: { name: 'private-a', tier: 'private', az: 'a', cidr: '10.20.10.0/24' } },
};

function blockOf(d: NodeDef) {
  const tiers = d.tiersFor ? ['depends on properties'] : d.tier ? [d.tier] : [];
  return {
    type: d.type,
    label: d.label,
    category: d.category,
    description: d.description,
    placement: d.parent
      ? { livesIn: d.parent === 'aws.subnet' ? 'a subnet' : 'a VPC', parentType: d.parent, tier: tiers, optional: Boolean(d.optionalParent), minAvailabilityZones: d.minAzs ?? null, note: d.tiersFor ? 'public subnet normally; a private subnet when internal=true' : undefined }
      : { livesIn: 'nowhere (free-standing, no parentId)' },
    fields: d.fields.map((f) => ({ key: f.key, type: f.type, default: f.default, required: Boolean(f.required), ...(f.options ? { options: f.options } : {}), ...(f.min !== undefined ? { min: f.min } : {}), ...(f.max !== undefined ? { max: f.max } : {}), ...(f.pattern ? { pattern: f.pattern } : {}), ...(f.help ? { help: f.help } : {}) })),
    outputs: d.outputs,
  };
}

/** The agent-facing description of everything the engine supports. Never includes hidden (import-only) types. */
export function describeEngine(opts: { template?: string } = {}) {
  const blocks = CATALOG_LIST.filter((d) => !d.hidden).map(blockOf);
  const label = new Map(CATALOG_LIST.map((d) => [d.type, d.label]));
  return {
    format: FORMAT,
    blocks,
    connections: EDGE_RULES.map((r) => ({ source: r.source, target: r.target, meaning: `${label.get(r.source)} ${r.label} ${label.get(r.target)}` })),
    // graphs are large: the list carries only what is needed to choose; ask for one graph by id
    templates: TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, recommended: Boolean(t.recommended), resources: t.build(META).nodes.filter((n) => n.type !== 'aws.subnet' && n.type !== 'aws.vpc').map((n) => n.type) })),
    ...(opts.template ? { templateGraph: TEMPLATES.find((t) => t.id === opts.template)?.build(META) ?? null } : {}),
    counts: { blocks: blocks.length, templates: TEMPLATES.length, connections: EDGE_RULES.length },
  };
}

export { tiersOf };
