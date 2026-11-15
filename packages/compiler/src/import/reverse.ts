/** Reverse mappers: module inputs (hcl2json form) -> catalog node properties. Each one inverts the matching build(). */
import type { Props } from '../types';

export interface RC {
  label: string;
  i: Record<string, any>; // module inputs as parsed by hcl2json
  prefix: string; // "<project>-<env>"
  vars: Record<string, unknown>;
  /** `data "aws_route53_zone"` blocks by name */
  zones: Record<string, any>;
}

const resolve = (c: RC, v: unknown): unknown => {
  if (typeof v === 'string') {
    const m = /^\$\{var\.([A-Za-z_][\w-]*)\}$/.exec(v);
    if (m && m[1] in c.vars) return c.vars[m[1]];
  }
  return v;
};
/** a literal value, or undefined when it is an unresolved expression */
const lit = (c: RC, v: unknown) => {
  const x = resolve(c, v);
  return typeof x === 'string' && x.includes('${') ? undefined : x;
};
export const str = (c: RC, v: unknown): string | undefined => {
  const x = lit(c, v);
  return typeof x === 'string' ? x : typeof x === 'number' ? String(x) : undefined;
};
export const num = (c: RC, v: unknown): number | undefined => {
  const x = lit(c, v);
  if (typeof x === 'number') return x;
  if (typeof x === 'string' && x.trim() !== '' && !Number.isNaN(Number(x))) return Number(x);
  return undefined;
};
export const bool = (c: RC, v: unknown): boolean | undefined => {
  const x = lit(c, v);
  return typeof x === 'boolean' ? x : x === 'true' ? true : x === 'false' ? false : undefined;
};

export const clean = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** "<project>-<env>-api" -> "api"; falls back to the module label */
const nameFrom = (c: RC, key: string): string => {
  const v = str(c, c.i[key]);
  if (v) {
    const p = c.prefix + '-';
    const n = clean(v.startsWith(p) ? v.slice(p.length) : v);
    if (n.length >= 2) return n;
  }
  const l = clean(c.label.replace(/_/g, '-'));
  return l.length >= 2 ? l : `${l}x`.slice(0, 2);
};
const labelName = (c: RC) => nameFrom(c, '__none__');

const first = (o: unknown): any => (o && typeof o === 'object' ? Object.values(o as object)[0] : undefined);
const items = (o: unknown): any[] => (o && typeof o === 'object' ? Object.values(o as object) : []);

const rds = (c: RC): Props => ({
  name: nameFrom(c, 'identifier'),
  engineVersion: str(c, c.i.engine_version),
  instanceClass: str(c, c.i.instance_class),
  storage: num(c, c.i.allocated_storage),
  dbName: str(c, c.i.db_name),
  multiAz: bool(c, c.i.multi_az),
  backupDays: num(c, c.i.backup_retention_period),
}) as Props;

export const REVERSE: Record<string, (c: RC) => Props> = {
  'aws.vpc': (c) => ({
    name: nameFrom(c, 'name'),
    cidr: str(c, c.i.cidr),
    nat: bool(c, c.i.one_nat_gateway_per_az) ? 'per-az' : 'single',
  }) as Props,

  'aws.alb': (c) => ({
    name: nameFrom(c, 'name'),
    internal: bool(c, c.i.internal),
    https: items(c.i.listeners).some((l) => String(l?.protocol).toUpperCase() === 'HTTPS'),
    idleTimeout: num(c, c.i.idle_timeout),
  }) as Props,

  'aws.acm': (c) => {
    const m = /data\.aws_route53_zone\.([\w-]+)/.exec(String(c.i.zone_id ?? ''));
    return { name: labelName(c), domainName: str(c, c.i.domain_name), hostedZone: (m && str(c, c.zones[m[1]]?.name)) || '' } as Props;
  },

  'aws.cloudfront': (c) => ({
    name: nameFrom(c, 'comment'),
    priceClass: str(c, c.i.price_class),
    rootObject: str(c, c.i.default_root_object),
  }) as Props,

  'aws.route53_record': (c) => ({
    name: labelName(c),
    zoneName: str(c, c.i.zone_name),
    recordName: str(c, first(c.i.records)?.name) ?? '',
  }) as Props,

  'aws.ecs_fargate': (c) => {
    const svcs = c.i.services ?? {};
    const sv = svcs[c.label] ?? first(svcs) ?? {};
    const cd = first(sv.container_definitions) ?? {};
    const pm = Array.isArray(cd.port_mappings) ? cd.port_mappings[0] : undefined;
    return {
      name: nameFrom(c, 'cluster_name'),
      image: str(c, cd.image),
      containerPort: num(c, pm?.containerPort ?? pm?.container_port),
      cpu: num(c, sv.cpu),
      memory: num(c, sv.memory),
      desiredCount: num(c, sv.desired_count),
    } as Props;
  },

  'aws.lambda': (c) => ({
    name: nameFrom(c, 'function_name'),
    runtime: str(c, c.i.runtime),
    handler: str(c, c.i.handler),
    sourcePath: str(c, c.i.source_path),
    memory: num(c, c.i.memory_size),
    timeout: num(c, c.i.timeout),
  }) as Props,

  'aws.rds_postgres': rds,
  'aws.rds_mysql': rds,

  'aws.dynamodb': (c) => ({
    name: nameFrom(c, 'name'),
    hashKey: str(c, c.i.hash_key),
    hashKeyType: str(c, Array.isArray(c.i.attributes) ? c.i.attributes[0]?.type : undefined),
    billing: str(c, c.i.billing_mode),
  }) as Props,

  'aws.s3': (c) => ({
    name: nameFrom(c, 'bucket'),
    versioning: bool(c, c.i.versioning?.enabled) ?? false,
    forceDestroy: bool(c, c.i.force_destroy) ?? false,
  }) as Props,

  'aws.apigw': (c) => ({ name: nameFrom(c, 'name'), route: Object.keys(c.i.routes ?? {})[0] }) as Props,

  'aws.sqs': (c) => ({
    name: nameFrom(c, 'name'),
    fifo: bool(c, c.i.fifo_queue),
    visibility: num(c, c.i.visibility_timeout_seconds),
    dlq: bool(c, c.i.create_dlq),
  }) as Props,

  'aws.sns': (c) => ({ name: nameFrom(c, 'name'), fifo: bool(c, c.i.fifo_topic) }) as Props,
};
