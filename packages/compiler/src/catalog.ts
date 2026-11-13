import { HclValue, raw, Raw } from './hcl';
import type { FieldDef, GraphNode, Props, ProjectMeta, Tier } from './types';

export const snake = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, '_$1') || 'node';

export interface Resolved {
  node: GraphNode;
  label: string; // terraform module label
  def: NodeDef;
  p: Props;
}

export interface Ctx {
  self: Resolved;
  project: ProjectMeta;
  vpc?: Resolved;
  /** nodes with an edge pointing AT this node, filtered by type */
  incoming: (type: string) => Resolved[];
  /** nodes this node points TO, filtered by type */
  outgoing: (type: string) => Resolved[];
  /** nodes nested directly inside this one */
  children: (type: string) => Resolved[];
  ref: (r: Resolved, attr: string) => Raw;
  warn: (msg: string) => void;
}

export interface ExtraModule {
  label: string;
  source: string;
  version: string;
  inputs: Record<string, HclValue>;
}

export interface BuildResult {
  inputs: Record<string, HclValue>;
  /** needs the aws.us_east_1 provider alias (e.g. CloudFront certificates) */
  usEast1?: boolean;
  extraModules?: ExtraModule[];
  rawBlocks?: string[];
}

export interface NodeDef {
  type: string;
  label: string;
  category: 'Networking' | 'Compute' | 'Database' | 'Storage' | 'Integration' | 'Edge & Security';
  description: string;
  icon: string; // file name (without .svg) in public/aws-icons
  color: string;
  container?: boolean;
  /** required parent node type, if any */
  parent?: string;
  /** parent is allowed but not required (node can live outside the VPC) */
  optionalParent?: boolean;
  tier?: Tier;
  /** tiers this node may sit in, when it depends on its properties (e.g. internal ALB) */
  tiersFor?: (p: Props) => Tier[];
  /** minimum distinct availability zones the chosen tier must span */
  minAzs?: number;
  /** structural node: no module of its own, folded into its parent's module */
  virtual?: boolean;
  module: { source: string; version: string };
  fields: FieldDef[];
  /** output names this node exposes to others (docs/UI only) */
  outputs: string[];
  build: (c: Ctx) => BuildResult;
}

export const tiersOf = (d: NodeDef, p: Props): Tier[] => (d.tiersFor ? d.tiersFor(p) : d.tier ? [d.tier] : []);

export interface EdgeRule {
  source: string;
  target: string;
  label: string;
}

const s = (key: string, label: string, def: string, extra: Partial<FieldDef> = {}): FieldDef => ({
  key, label, type: 'string', default: def, ...extra,
});
const n = (key: string, label: string, def: number, extra: Partial<FieldDef> = {}): FieldDef => ({
  key, label, type: 'number', default: def, ...extra,
});
const b = (key: string, label: string, def: boolean, extra: Partial<FieldDef> = {}): FieldDef => ({
  key, label, type: 'boolean', default: def, ...extra,
});
const sel = (key: string, label: string, def: string | number, options: (string | number)[], extra: Partial<FieldDef> = {}): FieldDef => ({
  key, label, type: 'select', default: def, options, ...extra,
});

const NAME_PATTERN = '^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$';
const nameField = (def: string): FieldDef =>
  s('name', 'Name', def, {
    required: true,
    pattern: NAME_PATTERN,
    help: 'Lowercase letters, digits and hyphens (2–40 chars). Used for the AWS resource name.',
  });

const prefix = (c: Ctx) => `${c.project.name}-${c.project.environment}`;
const isProd = (c: Ctx) => c.project.environment === 'prod';

/** IAM statements a compute node needs for each data service it points at */
function grants(c: Ctx): { actions: string[]; resources: HclValue[] }[] {
  const out: { actions: string[]; resources: HclValue[] }[] = [];
  for (const t of c.outgoing('aws.s3'))
    out.push({
      actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:ListBucket'],
      resources: [c.ref(t, 's3_bucket_arn'), raw(`"\${${c.ref(t, 's3_bucket_arn').expr}}/*"`)],
    });
  for (const t of c.outgoing('aws.sqs'))
    out.push({
      actions: ['sqs:SendMessage', 'sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'],
      resources: [c.ref(t, 'queue_arn')],
    });
  for (const t of c.outgoing('aws.sns'))
    out.push({ actions: ['sns:Publish'], resources: [c.ref(t, 'topic_arn')] });
  for (const t of c.outgoing('aws.dynamodb'))
    out.push({
      actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:Query', 'dynamodb:Scan'],
      resources: [c.ref(t, 'dynamodb_table_arn'), raw(`"\${${c.ref(t, 'dynamodb_table_arn').expr}}/index/*"`)],
    });
  return out;
}

export const EDGE_RULES: EdgeRule[] = [
  { source: 'aws.alb', target: 'aws.ecs_fargate', label: 'routes to' },
  { source: 'aws.ecs_fargate', target: 'aws.rds_postgres', label: 'connects to' },
  { source: 'aws.ecs_fargate', target: 'aws.rds_mysql', label: 'connects to' },
  { source: 'aws.lambda', target: 'aws.rds_postgres', label: 'connects to' },
  { source: 'aws.lambda', target: 'aws.rds_mysql', label: 'connects to' },
  { source: 'aws.route53_record', target: 'aws.cloudfront', label: 'aliases to' },
  { source: 'aws.route53_record', target: 'aws.alb', label: 'aliases to' },
  { source: 'aws.ecs_fargate', target: 'aws.s3', label: 'reads/writes' },
  { source: 'aws.ecs_fargate', target: 'aws.sqs', label: 'sends/receives' },
  { source: 'aws.ecs_fargate', target: 'aws.sns', label: 'publishes' },
  { source: 'aws.ecs_fargate', target: 'aws.dynamodb', label: 'reads/writes' },
  { source: 'aws.lambda', target: 'aws.s3', label: 'reads/writes' },
  { source: 'aws.lambda', target: 'aws.sqs', label: 'sends/receives' },
  { source: 'aws.lambda', target: 'aws.sns', label: 'publishes' },
  { source: 'aws.lambda', target: 'aws.dynamodb', label: 'reads/writes' },
  { source: 'aws.apigw', target: 'aws.lambda', label: 'invokes' },
  { source: 'aws.sqs', target: 'aws.lambda', label: 'triggers' },
  { source: 'aws.sns', target: 'aws.sqs', label: 'fans out to' },
  { source: 'aws.cloudfront', target: 'aws.alb', label: 'origin' },
  { source: 'aws.cloudfront', target: 'aws.s3', label: 'origin' },
  { source: 'aws.acm', target: 'aws.alb', label: 'certificate for' },
  { source: 'aws.acm', target: 'aws.cloudfront', label: 'certificate for' },
];

export const edgeRule = (source: string, target: string) =>
  EDGE_RULES.find((r) => r.source === source && r.target === target);

function rdsDef(engine: 'postgres' | 'mysql'): NodeDef {
  const pg = engine === 'postgres';
  const port = pg ? 5432 : 3306;
  const pretty = pg ? 'PostgreSQL' : 'MySQL';
  return {
    type: pg ? 'aws.rds_postgres' : 'aws.rds_mysql',
    label: `RDS ${pretty}`,
    category: 'Database',
    description: `Managed ${pretty} in database subnets with encryption, Secrets Manager credentials and a locked-down security group.`,
    icon: 'amazon-rds',
    color: '#3b48cc',
    parent: 'aws.subnet',
    tier: 'database',
    minAzs: 2,
    module: { source: 'terraform-aws-modules/rds/aws', version: '~> 6.10' },
    outputs: ['db_instance_endpoint', 'db_instance_master_user_secret_arn'],
    fields: [
      nameField('db'),
      sel('engineVersion', 'Engine version', pg ? '16.4' : '8.0.40', pg ? ['14.13', '15.8', '16.4', '17.2'] : ['8.0.40', '8.4.3']),
      sel('instanceClass', 'Instance class', 'db.t4g.medium', ['db.t4g.micro', 'db.t4g.medium', 'db.r6g.large', 'db.r6g.xlarge']),
      n('storage', 'Storage (GiB)', 50, { min: 20, max: 65536 }),
      s('dbName', 'Database name', 'app', { required: true, pattern: pg ? '^[a-zA-Z][a-zA-Z0-9_]{0,62}$' : '^[a-zA-Z][a-zA-Z0-9_]{0,63}$' }),
      b('multiAz', 'Multi-AZ', true),
      n('backupDays', 'Backup retention (days)', 7, { min: 1, max: 35 }),
    ],
    build(c) {
      const v = c.vpc!;
      const p = c.self.p;
      const parts = String(p.engineVersion).split('.');
      const major = pg ? parts[0] : parts.slice(0, 2).join('.');
      const clients = [...c.incoming('aws.ecs_fargate'), ...c.incoming('aws.lambda')].sort((x, y) => x.label.localeCompare(y.label));
      const sgLabel = `${c.self.label}_sg`;
      if (!clients.length) c.warn('No application connected: the database security group will have no ingress rules.');
      return {
        extraModules: [
          {
            label: sgLabel,
            source: 'terraform-aws-modules/security-group/aws',
            version: '~> 5.2',
            inputs: {
              name: `${prefix(c)}-${p.name}-sg`,
              description: `${pretty} access for ${p.name}`,
              vpc_id: c.ref(v, 'vpc_id'),
              ingress_with_source_security_group_id: clients.map((cl) => ({
                from_port: port,
                to_port: port,
                protocol: 'tcp',
                description: `From ${cl.p.name}`,
                source_security_group_id:
                  cl.node.type === 'aws.lambda'
                    ? raw(`module.${cl.label}_sg.security_group_id`)
                    : raw(`${c.ref(cl, 'services').expr}["${cl.label}"].security_group_id`),
              })),
            },
          },
        ],
        inputs: {
          identifier: `${prefix(c)}-${p.name}`,
          engine: engine,
          engine_version: String(p.engineVersion),
          family: `${engine}${major}`,
          major_engine_version: major,
          instance_class: String(p.instanceClass),
          allocated_storage: Number(p.storage),
          db_name: String(p.dbName),
          username: 'app_admin',
          port,
          manage_master_user_password: true,
          multi_az: Boolean(p.multiAz),
          storage_encrypted: true,
          create_db_subnet_group: false,
          db_subnet_group_name: c.ref(v, 'database_subnet_group_name'),
          vpc_security_group_ids: [raw(`module.${sgLabel}.security_group_id`)],
          backup_retention_period: Number(p.backupDays),
          deletion_protection: isProd(c),
          skip_final_snapshot: !isProd(c),
          performance_insights_enabled: true,
        },
      };
    },
  };
}

const ALL: NodeDef[] = [
  // ───────────────────────── Networking ─────────────────────────
  {
    type: 'aws.vpc',
    label: 'VPC',
    category: 'Networking',
    description: 'Isolated virtual network. Add Subnet nodes (public, private, database) per availability zone; they become the module\'s subnet lists. Includes NAT and flow logs.',
    icon: 'virtual-private-cloud-vpc',
    color: '#8c4fff',
    container: true,
    module: { source: 'terraform-aws-modules/vpc/aws', version: '~> 5.13' },
    outputs: ['vpc_id', 'public_subnets', 'private_subnets', 'database_subnets'],
    fields: [
      nameField('main'),
      s('cidr', 'CIDR block', '10.20.0.0/16', {
        required: true,
        pattern: '^\\d{1,3}\\.\\d{1,3}\\.0\\.0/16$',
        help: 'Must be a /16. Subnets are carved out as /24s per tier.',
      }),
      sel('nat', 'NAT gateways', 'single', ['single', 'per-az'], { help: 'Per-AZ is more resilient but costs more.' }),
    ],
    build(c) {
      const cidr = String(c.self.p.cidr);
      const subs = c.children('aws.subnet');
      const tier = (t: string) => subs.filter((x) => x.p.tier === t).sort((x, y) => String(x.p.az).localeCompare(String(y.p.az)));
      const letters = [...new Set(subs.map((x) => String(x.p.az)))].sort();
      if (!subs.length) c.warn('Add subnets to this VPC: drag a Subnet from the palette.');
      const inputs: Record<string, HclValue> = {
        name: `${prefix(c)}-${c.self.p.name}`,
        cidr,
        azs: (letters.length ? letters : ['a']).map((l) => `${c.project.region}${l}`),
      };
      for (const t of ['public', 'private', 'database'] as const) {
        const list = tier(t);
        if (!list.length) continue;
        inputs[`${t}_subnets`] = list.map((x) => String(x.p.cidr));
        inputs[`${t}_subnet_names`] = list.map((x) => String(x.p.name));
      }
      const nat = tier('public').length > 0 && tier('private').length > 0;
      Object.assign(inputs, {
        create_database_subnet_group: tier('database').length > 0,
        enable_nat_gateway: nat,
        single_nat_gateway: nat && c.self.p.nat === 'single',
        one_nat_gateway_per_az: nat && c.self.p.nat === 'per-az',
        enable_dns_hostnames: true,
        enable_flow_log: true,
        create_flow_log_cloudwatch_log_group: true,
        create_flow_log_cloudwatch_iam_role: true,
        flow_log_max_aggregation_interval: 60,
      });
      return { inputs };
    },
  },

  // ───────────────────────── Edge & Security ─────────────────────────
  {
    type: 'aws.subnet',
    label: 'Subnet',
    category: 'Networking',
    description: 'A subnet in one availability zone. Services dropped into a subnet use every subnet of the same tier in the VPC. One subnet per tier per zone.',
    icon: 'private-subnet',
    color: '#00a4a6',
    container: true,
    parent: 'aws.vpc',
    virtual: true,
    module: { source: 'terraform-aws-modules/vpc/aws', version: '~> 5.13' },
    outputs: [],
    fields: [
      nameField('private-a'),
      sel('tier', 'Tier', 'private', ['public', 'private', 'database'], { help: 'Public subnets route to the internet gateway; private subnets use NAT; database subnets have no route out.' }),
      sel('az', 'Availability zone', 'a', ['a', 'b', 'c']),
      s('cidr', 'CIDR block', '10.20.10.0/24', { required: true, pattern: '^\\d{1,3}(\\.\\d{1,3}){3}/\\d{1,2}$', help: 'Between /16 and /28, inside the VPC range, not overlapping another subnet.' }),
    ],
    build: () => ({ inputs: {} }),
  },

  {
    type: 'aws.alb',
    label: 'Application Load Balancer',
    category: 'Networking',
    description: 'Layer 7 load balancer. Place it in a public subnet (or a private one when internal). Connect it to ECS services to create target groups and listeners automatically.',
    icon: 'elastic-load-balancing',
    color: '#8c4fff',
    parent: 'aws.subnet',
    tier: 'public',
    tiersFor: (p) => (p.internal ? ['private'] : ['public']),
    minAzs: 2,
    module: { source: 'terraform-aws-modules/alb/aws', version: '~> 9.11' },
    outputs: ['arn', 'dns_name', 'security_group_id', 'target_groups'],
    fields: [
      nameField('web'),
      b('internal', 'Internal', false, { help: 'Internal ALBs sit in private subnets and are not internet-facing.' }),
      b('https', 'HTTPS listener', false, { help: 'Needs an ACM certificate node connected to it.' }),
      n('idleTimeout', 'Idle timeout (s)', 60, { min: 1, max: 4000 }),
    ],
    build(c) {
      const v = c.vpc!;
      const internal = Boolean(c.self.p.internal);
      const targets = c.outgoing('aws.ecs_fargate');
      const cert = c.incoming('aws.acm')[0];
      const https = Boolean(c.self.p.https) && !!cert;
      if (c.self.p.https && !cert) c.warn('HTTPS is enabled but no ACM certificate is connected; falling back to HTTP.');
      if (targets.length > 1) c.warn('Multiple targets: the first is the default action. Path-based rules are not generated yet.');

      const tgs: Record<string, HclValue> = {};
      for (const t of targets) {
        tgs[t.label] = {
          name: `${prefix(c)}-${t.p.name}`.slice(0, 32),
          protocol: 'HTTP',
          port: Number(t.p.containerPort),
          target_type: 'ip',
          deregistration_delay: 10,
          create_attachment: false,
          health_check: {
            enabled: true,
            path: String(t.p.healthCheckPath),
            matcher: '200-399',
            interval: 30,
          },
        };
      }
      const forward: HclValue = targets.length
        ? { forward: { target_group_key: targets[0].label } }
        : { fixed_response: { content_type: 'text/plain', message_body: 'No targets connected', status_code: '503' } };

      const listeners: Record<string, HclValue> = https
        ? {
            http_redirect: { port: 80, protocol: 'HTTP', redirect: { port: '443', protocol: 'HTTPS', status_code: 'HTTP_301' } },
            https: { port: 443, protocol: 'HTTPS', ssl_policy: 'ELBSecurityPolicy-TLS13-1-2-2021-06', certificate_arn: c.ref(cert, 'acm_certificate_arn'), ...(forward as object) },
          }
        : { http: { port: 80, protocol: 'HTTP', ...(forward as object) } };

      const src = internal ? c.ref(v, 'vpc_cidr_block') : '0.0.0.0/0';
      const ingress: Record<string, HclValue> = {
        http: { from_port: 80, to_port: 80, ip_protocol: 'tcp', description: 'HTTP', ...(typeof src === 'string' ? { cidr_ipv4: src } : { cidr_ipv4: src }) },
      };
      if (https) ingress.https = { from_port: 443, to_port: 443, ip_protocol: 'tcp', description: 'HTTPS', cidr_ipv4: src };

      return {
        inputs: {
          name: `${prefix(c)}-${c.self.p.name}`.slice(0, 32),
          load_balancer_type: 'application',
          internal,
          vpc_id: c.ref(v, 'vpc_id'),
          subnets: c.ref(v, internal ? 'private_subnets' : 'public_subnets'),
          idle_timeout: Number(c.self.p.idleTimeout),
          enable_deletion_protection: isProd(c),
          drop_invalid_header_fields: true,
          security_group_ingress_rules: ingress,
          security_group_egress_rules: { all: { ip_protocol: '-1', cidr_ipv4: c.ref(v, 'vpc_cidr_block') } },
          listeners,
          target_groups: tgs,
        },
      };
    },
  },

  {
    type: 'aws.route53_record',
    label: 'Route 53 Record',
    category: 'Networking',
    description: 'DNS alias record in an existing public hosted zone. Connect it to CloudFront or an ALB.',
    icon: 'amazon-route-53',
    color: '#8c4fff',
    module: { source: 'terraform-aws-modules/route53/aws//modules/records', version: '~> 4.1' },
    outputs: ['route53_record_fqdn'],
    fields: [
      nameField('dns'),
      s('zoneName', 'Hosted zone', 'example.gov.sg', { required: true, pattern: '^[a-z0-9][a-z0-9.-]+\\.[a-z]{2,}$', help: 'Name of an existing public Route 53 zone.' }),
      s('recordName', 'Record name', 'www', { help: 'Leave empty for the zone apex.' }),
    ],
    build(c) {
      const cf = c.outgoing('aws.cloudfront')[0];
      const alb = c.outgoing('aws.alb')[0];
      if (!cf && !alb) c.warn('Connect a CloudFront distribution or an ALB as the alias target.');
      const rn = String(c.self.p.recordName ?? '');
      const rec = (type: string, alias: HclValue) => ({ name: rn, type, alias });
      const records: Record<string, HclValue> = cf
        ? {
            a: rec('A', { name: c.ref(cf, 'cloudfront_distribution_domain_name'), zone_id: c.ref(cf, 'cloudfront_distribution_hosted_zone_id') }),
            aaaa: rec('AAAA', { name: c.ref(cf, 'cloudfront_distribution_domain_name'), zone_id: c.ref(cf, 'cloudfront_distribution_hosted_zone_id') }),
          }
        : alb
          ? { a: rec('A', { name: c.ref(alb, 'dns_name'), zone_id: c.ref(alb, 'zone_id'), evaluate_target_health: true }) }
          : {};
      return { inputs: { zone_name: String(c.self.p.zoneName), private_zone: false, records } };
    },
  },

  {
    type: 'aws.acm',
    label: 'ACM Certificate',
    category: 'Edge & Security',
    description: 'TLS certificate from AWS Certificate Manager, validated through DNS. Connect it to an ALB or CloudFront.',
    icon: 'aws-certificate-manager',
    color: '#dd344c',
    module: { source: 'terraform-aws-modules/acm/aws', version: '~> 5.1' },
    outputs: ['acm_certificate_arn'],
    fields: [
      nameField('cert'),
      s('domainName', 'Domain name', 'app.example.gov.sg', { required: true, pattern: '^[a-z0-9*][a-z0-9.*-]+\\.[a-z]{2,}$' }),
      s('hostedZone', 'Route 53 hosted zone', '', { help: 'Optional zone name (e.g. example.gov.sg). When set, DNS validation records are created automatically.' }),
    ],
    build(c) {
      const zone = String(c.self.p.hostedZone ?? '');
      const dl = `${c.self.label}_zone`;
      const forCdn = c.outgoing('aws.cloudfront').length > 0;
      if (forCdn && c.outgoing('aws.alb').length) c.warn('A certificate used by CloudFront must live in us-east-1, so it cannot also serve a regional ALB. Use two certificates.');
      return {
        usEast1: forCdn && c.project.region !== 'us-east-1',
        inputs: {
          domain_name: String(c.self.p.domainName),
          validation_method: 'DNS',
          ...(zone ? { zone_id: raw(`data.aws_route53_zone.${dl}.zone_id`), wait_for_validation: true } : { create_route53_records: false, validate_certificate: false }),
        },
        ...(zone ? { rawBlocks: [`data "aws_route53_zone" "${dl}" {\n  name         = ${JSON.stringify(zone)}\n  private_zone = false\n}`] } : {}),
      };
    },
  },

  {
    type: 'aws.cloudfront',
    label: 'CloudFront',
    category: 'Edge & Security',
    description: 'Global CDN. Connect to an ALB or S3 bucket to use it as the origin (S3 uses Origin Access Control).',
    icon: 'amazon-cloud-front',
    color: '#8c4fff',
    module: { source: 'terraform-aws-modules/cloudfront/aws', version: '~> 3.4' },
    outputs: ['cloudfront_distribution_arn', 'cloudfront_distribution_domain_name'],
    fields: [
      nameField('cdn'),
      sel('priceClass', 'Price class', 'PriceClass_200', ['PriceClass_100', 'PriceClass_200', 'PriceClass_All']),
      s('rootObject', 'Default root object', 'index.html'),
    ],
    build(c) {
      const albs = c.outgoing('aws.alb');
      const buckets = c.outgoing('aws.s3');
      const cert = c.incoming('aws.acm')[0];
      const origin: Record<string, HclValue> = {};
      for (const a of albs)
        origin[a.label] = {
          domain_name: c.ref(a, 'dns_name'),
          custom_origin_config: { http_port: 80, https_port: 443, origin_protocol_policy: a.p.https ? 'https-only' : 'http-only', origin_ssl_protocols: ['TLSv1.2'] },
        };
      for (const t of buckets)
        origin[t.label] = { domain_name: c.ref(t, 's3_bucket_bucket_regional_domain_name'), origin_access_control: t.label };
      const first = albs[0] ?? buckets[0];
      if (!first) c.warn('Connect an ALB or S3 bucket as the origin.');
      const isAlb = !!albs[0];
      return {
        inputs: {
          comment: `${prefix(c)}-${c.self.p.name}`,
          enabled: true,
          is_ipv6_enabled: true,
          price_class: String(c.self.p.priceClass),
          http_version: 'http2and3',
          default_root_object: String(c.self.p.rootObject),
          ...(buckets.length
            ? {
                create_origin_access_control: true,
                origin_access_control: Object.fromEntries(
                  buckets.map((t) => [t.label, { description: `OAC for ${t.p.name}`, origin_type: 's3', signing_behavior: 'always', signing_protocol: 'sigv4' }]),
                ),
              }
            : {}),
          origin,
          default_cache_behavior: {
            target_origin_id: first?.label ?? 'origin',
            viewer_protocol_policy: 'redirect-to-https',
            allowed_methods: isAlb ? ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'] : ['GET', 'HEAD', 'OPTIONS'],
            cached_methods: ['GET', 'HEAD'],
            compress: true,
            use_forwarded_values: false,
            // AWS managed policies: CachingDisabled for dynamic origins, CachingOptimized for S3
            cache_policy_id: isAlb ? '4135ea2d-6df8-44a3-9df3-4b5a84be39ad' : '658327ea-f89d-4fab-a63d-7e88639e58f6',
            ...(isAlb ? { origin_request_policy_id: '216adef6-5c7f-47e4-b989-5492eafa07d3' } : {}),
          },
          ...(cert
            ? {
                aliases: [String(cert.p.domainName)],
                viewer_certificate: { acm_certificate_arn: c.ref(cert, 'acm_certificate_arn'), ssl_support_method: 'sni-only', minimum_protocol_version: 'TLSv1.2_2021' },
              }
            : {}),
        },
      };
    },
  },

  // ───────────────────────── Compute ─────────────────────────
  {
    type: 'aws.ecs_fargate',
    label: 'ECS Fargate Service',
    category: 'Compute',
    description: 'Serverless container service: an ECS cluster plus one Fargate service in private subnets.',
    icon: 'aws-fargate',
    color: '#ed7100',
    parent: 'aws.subnet',
    tier: 'private',
    module: { source: 'terraform-aws-modules/ecs/aws', version: '~> 5.11' },
    outputs: ['cluster_arn', 'services'],
    fields: [
      nameField('api'),
      s('image', 'Container image', 'public.ecr.aws/nginx/nginx:stable', { required: true }),
      n('containerPort', 'Container port', 8080, { required: true, min: 1, max: 65535 }),
      sel('cpu', 'CPU units', 512, [256, 512, 1024, 2048, 4096]),
      sel('memory', 'Memory (MiB)', 1024, [512, 1024, 2048, 4096, 8192]),
      n('desiredCount', 'Desired count', 2, { min: 1, max: 100 }),
      s('healthCheckPath', 'Health check path', '/health', { help: 'Used by the ALB target group.' }),
    ],
    build(c) {
      const v = c.vpc!;
      const p = c.self.p;
      const key = c.self.label;
      const alb = c.incoming('aws.alb')[0];
      const rules: Record<string, HclValue> = {};
      if (alb)
        rules.alb_ingress = {
          type: 'ingress',
          from_port: Number(p.containerPort),
          to_port: Number(p.containerPort),
          protocol: 'tcp',
          description: 'From load balancer',
          source_security_group_id: c.ref(alb, 'security_group_id'),
        };
      rules.egress_all = { type: 'egress', from_port: 0, to_port: 0, protocol: '-1', cidr_blocks: ['0.0.0.0/0'] };

      const g = grants(c);
      const svc: Record<string, HclValue> = {
        cpu: Number(p.cpu),
        memory: Number(p.memory),
        desired_count: Number(p.desiredCount),
        subnet_ids: c.ref(v, 'private_subnets'),
        assign_public_ip: false,
        enable_execute_command: false,
        container_definitions: {
          [key]: {
            image: String(p.image),
            essential: true,
            port_mappings: [{ name: key, containerPort: Number(p.containerPort), hostPort: Number(p.containerPort), protocol: 'tcp' }],
            readonly_root_filesystem: false,
          },
        },
        security_group_rules: rules,
      };
      if (alb)
        svc.load_balancer = {
          service: {
            target_group_arn: raw(`${c.ref(alb, 'target_groups').expr}["${key}"].arn`),
            container_name: key,
            container_port: Number(p.containerPort),
          },
        };
      if (g.length) svc.tasks_iam_role_statements = g.map((x) => ({ actions: x.actions, resources: x.resources }));

      return {
        inputs: {
          cluster_name: `${prefix(c)}-${p.name}`,
          fargate_capacity_providers: { FARGATE: { default_capacity_provider_strategy: { weight: 100 } } },
          services: { [key]: svc },
        },
      };
    },
  },

  {
    type: 'aws.lambda',
    label: 'Lambda Function',
    category: 'Compute',
    description: 'Serverless function. Wire it to API Gateway, SQS triggers and data stores; IAM permissions are generated from the edges. Drop it inside a private subnet to attach it to your VPC (required to reach RDS).',
    icon: 'aws-lambda',
    color: '#ed7100',
    parent: 'aws.subnet',
    optionalParent: true,
    tier: 'private',
    module: { source: 'terraform-aws-modules/lambda/aws', version: '~> 7.14' },
    outputs: ['lambda_function_arn', 'lambda_function_name'],
    fields: [
      nameField('handler'),
      sel('runtime', 'Runtime', 'nodejs20.x', ['nodejs20.x', 'nodejs22.x', 'python3.12', 'python3.13', 'java21']),
      s('handler', 'Handler', 'index.handler', { required: true }),
      s('sourcePath', 'Source path', './src/handler', { required: true, help: 'Directory (relative to this Terraform root) that is zipped and deployed.' }),
      sel('memory', 'Memory (MB)', 256, [128, 256, 512, 1024, 2048]),
      n('timeout', 'Timeout (s)', 10, { min: 1, max: 900 }),
    ],
    build(c) {
      const p = c.self.p;
      const gs = grants(c);
      const sqsIn = c.incoming('aws.sqs');
      const apigw = c.incoming('aws.apigw');
      const stmts: Record<string, HclValue> = {};
      gs.forEach((g, i) => (stmts[`stmt_${i + 1}`] = { effect: 'Allow', actions: g.actions, resources: g.resources }));
      for (const q of sqsIn)
        stmts[`consume_${q.label}`] = {
          effect: 'Allow',
          actions: ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'],
          resources: [c.ref(q, 'queue_arn')],
        };
      const v = c.vpc;
      const sgLabel = `${c.self.label}_sg`;
      return {
        ...(v
          ? {
              extraModules: [
                {
                  label: sgLabel,
                  source: 'terraform-aws-modules/security-group/aws',
                  version: '~> 5.2',
                  inputs: {
                    name: `${prefix(c)}-${p.name}-sg`,
                    description: `Egress for ${p.name} Lambda`,
                    vpc_id: c.ref(v, 'vpc_id'),
                    egress_rules: ['all-all'],
                  },
                },
              ],
            }
          : {}),
        inputs: {
          function_name: `${prefix(c)}-${p.name}`,
          handler: String(p.handler),
          runtime: String(p.runtime),
          memory_size: Number(p.memory),
          timeout: Number(p.timeout),
          source_path: String(p.sourcePath),
          tracing_mode: 'Active',
          ...(v
            ? {
                vpc_subnet_ids: c.ref(v, 'private_subnets'),
                vpc_security_group_ids: [raw(`module.${sgLabel}.security_group_id`)],
                attach_network_policy: true,
              }
            : {}),
          ...(Object.keys(stmts).length ? { attach_policy_statements: true, policy_statements: stmts } : {}),
          ...(sqsIn.length
            ? { event_source_mapping: Object.fromEntries(sqsIn.map((q) => [q.label, { event_source_arn: c.ref(q, 'queue_arn'), batch_size: 10 }])) }
            : {}),
          ...(apigw.length
            ? {
                allowed_triggers: Object.fromEntries(
                  apigw.map((a) => [a.label, { service: 'apigateway', source_arn: raw(`"\${${c.ref(a, 'api_execution_arn').expr}}/*/*"`) }]),
                ),
              }
            : {}),
        },
      };
    },
  },

  // ───────────────────────── Database ─────────────────────────
  rdsDef('postgres'),
  rdsDef('mysql'),

  {
    type: 'aws.dynamodb',
    label: 'DynamoDB Table',
    category: 'Database',
    description: 'Serverless key-value / document table with point-in-time recovery and encryption on by default.',
    icon: 'amazon-dynamo-db',
    color: '#3b48cc',
    module: { source: 'terraform-aws-modules/dynamodb-table/aws', version: '~> 4.2' },
    outputs: ['dynamodb_table_arn'],
    fields: [
      nameField('items'),
      s('hashKey', 'Partition key', 'id', { required: true, pattern: '^[A-Za-z][A-Za-z0-9_]*$' }),
      sel('hashKeyType', 'Key type', 'S', ['S', 'N', 'B']),
      sel('billing', 'Billing mode', 'PAY_PER_REQUEST', ['PAY_PER_REQUEST', 'PROVISIONED']),
    ],
    build(c) {
      const p = c.self.p;
      return {
        inputs: {
          name: `${prefix(c)}-${p.name}`,
          hash_key: String(p.hashKey),
          attributes: [{ name: String(p.hashKey), type: String(p.hashKeyType) }],
          billing_mode: String(p.billing),
          point_in_time_recovery_enabled: true,
          server_side_encryption_enabled: true,
        },
      };
    },
  },

  // ───────────────────────── Storage ─────────────────────────
  {
    type: 'aws.s3',
    label: 'S3 Bucket',
    category: 'Storage',
    description: 'Object storage, private by default with encryption, ownership enforcement and optional versioning.',
    icon: 'amazon-simple-storage-service',
    color: '#7aa116',
    module: { source: 'terraform-aws-modules/s3-bucket/aws', version: '~> 4.2' },
    outputs: ['s3_bucket_arn', 's3_bucket_id', 's3_bucket_bucket_regional_domain_name'],
    fields: [nameField('assets'), b('versioning', 'Versioning', true), b('forceDestroy', 'Force destroy', false, { help: 'Allow deleting a non-empty bucket. Keep off in production.' })],
    build(c) {
      const cf = c.incoming('aws.cloudfront')[0];
      const base: Record<string, HclValue> = {
        bucket: `${prefix(c)}-${c.self.p.name}`,
        force_destroy: Boolean(c.self.p.forceDestroy),
        control_object_ownership: true,
        object_ownership: 'BucketOwnerEnforced',
        block_public_acls: true,
        block_public_policy: true,
        ignore_public_acls: true,
        restrict_public_buckets: true,
        versioning: { enabled: Boolean(c.self.p.versioning) },
        server_side_encryption_configuration: { rule: { apply_server_side_encryption_by_default: { sse_algorithm: 'AES256' } } },
      };
      if (!cf) return { inputs: base };
      const dl = `${c.self.label}_cloudfront`;
      return {
        inputs: { ...base, attach_policy: true, policy: raw(`data.aws_iam_policy_document.${dl}.json`) },
        rawBlocks: [
          `data "aws_iam_policy_document" "${dl}" {\n  statement {\n    sid       = "AllowCloudFrontRead"\n    actions   = ["s3:GetObject"]\n    resources = ["\${${c.ref(c.self, 's3_bucket_arn').expr}}/*"]\n\n    principals {\n      type        = "Service"\n      identifiers = ["cloudfront.amazonaws.com"]\n    }\n\n    condition {\n      test     = "StringEquals"\n      variable = "AWS:SourceArn"\n      values   = [${c.ref(cf, 'cloudfront_distribution_arn').expr}]\n    }\n  }\n}`,
        ],
      };
    },
  },

  // ───────────────────────── Integration ─────────────────────────
  {
    type: 'aws.apigw',
    label: 'API Gateway (HTTP)',
    category: 'Integration',
    description: 'HTTP API front door. Connect it to Lambda functions to create proxy routes and invoke permissions.',
    icon: 'amazon-api-gateway',
    color: '#e7157b',
    module: { source: 'terraform-aws-modules/apigateway-v2/aws', version: '~> 5.2' },
    outputs: ['api_endpoint', 'api_execution_arn'],
    fields: [nameField('api-gw'), s('route', 'Route key', 'ANY /{proxy+}', { required: true, help: 'e.g. "GET /items" or "ANY /{proxy+}"' })],
    build(c) {
      const fns = c.outgoing('aws.lambda');
      if (!fns.length) c.warn('Connect a Lambda function to create a route.');
      if (fns.length > 1) c.warn('Multiple Lambda targets: all routes use the same route key; only the first is wired.');
      return {
        inputs: {
          name: `${prefix(c)}-${c.self.p.name}`,
          protocol_type: 'HTTP',
          create_domain_name: false,
          ...(fns.length
            ? {
                routes: {
                  [String(c.self.p.route)]: {
                    integration: { uri: c.ref(fns[0], 'lambda_function_arn'), payload_format_version: '2.0', timeout_milliseconds: 12000 },
                  },
                },
              }
            : {}),
        },
      };
    },
  },

  {
    type: 'aws.sqs',
    label: 'SQS Queue',
    category: 'Integration',
    description: 'Message queue with an optional dead-letter queue. Lambda consumers and SNS fan-out are wired from edges.',
    icon: 'amazon-simple-queue-service',
    color: '#e7157b',
    module: { source: 'terraform-aws-modules/sqs/aws', version: '~> 4.2' },
    outputs: ['queue_arn', 'queue_url'],
    fields: [nameField('jobs'), b('fifo', 'FIFO', false), n('visibility', 'Visibility timeout (s)', 30, { min: 0, max: 43200 }), b('dlq', 'Dead-letter queue', true)],
    build(c) {
      const topics = c.incoming('aws.sns');
      return {
        inputs: {
          name: `${prefix(c)}-${c.self.p.name}`,
          fifo_queue: Boolean(c.self.p.fifo),
          visibility_timeout_seconds: Number(c.self.p.visibility),
          create_dlq: Boolean(c.self.p.dlq),
          ...(c.self.p.dlq ? { redrive_policy: { maxReceiveCount: 5 } } : {}),
          ...(topics.length
            ? {
                queue_policy_statements: Object.fromEntries(
                  topics.map((t) => [
                    `sns_${t.label}`,
                    {
                      sid: `AllowSNS${t.label.replace(/_/g, '')}`,
                      actions: ['sqs:SendMessage'],
                      principals: [{ type: 'Service', identifiers: ['sns.amazonaws.com'] }],
                      conditions: [{ test: 'ArnEquals', variable: 'aws:SourceArn', values: [c.ref(t, 'topic_arn')] }],
                    },
                  ]),
                ),
              }
            : {}),
        },
      };
    },
  },

  {
    type: 'aws.sns',
    label: 'SNS Topic',
    category: 'Integration',
    description: 'Pub/sub topic. Connect to SQS queues to fan messages out.',
    icon: 'amazon-simple-notification-service',
    color: '#e7157b',
    module: { source: 'terraform-aws-modules/sns/aws', version: '~> 6.1' },
    outputs: ['topic_arn'],
    fields: [nameField('events'), b('fifo', 'FIFO', false)],
    build(c) {
      const qs = c.outgoing('aws.sqs');
      return {
        inputs: {
          name: `${prefix(c)}-${c.self.p.name}`,
          fifo_topic: Boolean(c.self.p.fifo),
          ...(qs.length
            ? { subscriptions: Object.fromEntries(qs.map((q) => [q.label, { protocol: 'sqs', endpoint: c.ref(q, 'queue_arn') }])) }
            : {}),
        },
      };
    },
  },
];

export const CATALOG: Record<string, NodeDef> = Object.fromEntries(ALL.map((d) => [d.type, d]));
export const CATALOG_LIST = ALL;
export const CATEGORIES = ['Networking', 'Compute', 'Database', 'Storage', 'Integration', 'Edge & Security'] as const;

export function defaultProps(type: string): Props {
  const d = CATALOG[type];
  return d ? Object.fromEntries(d.fields.map((f) => [f.key, f.default])) : {};
}
