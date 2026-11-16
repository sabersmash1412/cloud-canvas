import { CATALOG, CATALOG_LIST, defaultProps, edgeRule, snake } from '../catalog';
import { compile } from '../compile';
import { AZ_LETTERS, TIER_ORDER, inSubnetPos, subnetCell, subnetId, subnetNode, vpcSize } from '../layout';
import type { Diagnostic, Graph, GraphEdge, GraphNode, ProjectMeta, Props, Tier } from '../types';
import { splitBlocks, type SrcBlock } from './blocks';
import { collectRefs, evalCidrList, evalZones, normalize, same, toJson } from './hclJson';
import { REVERSE, clean, str, type RC } from './reverse';

export type HclParser = (file: string, text: string) => Promise<any>;
export interface ImportOptions {
  parse: HclParser;
  /** fallback project name (e.g. the folder name) when it can't be read from the code */
  name?: string;
}
export interface TfFile { path: string; content: string }

export interface ImportReport {
  /** top-level module/resource blocks found */
  total: number;
  /** blocks that became (or were folded into) catalog nodes */
  mapped: number;
  coverage: number;
  mappedNodes: { nodeId: string; label: string; source: string; type: string }[];
  unmanaged: { label: string; source: string; reason: string }[];
  /** non-module blocks kept verbatim in main.tf */
  passthrough: number;
  /** inputs the importer keeps exactly as written, per node */
  preserved: { nodeId: string; keys: string[] }[];
  /** inputs Cloud Canvas would add when regenerating (a change versus the original code) */
  additions: { nodeId: string; keys: string[] }[];
  notes: Diagnostic[];
}
export interface ImportResult { graph: Graph; report: ImportReport }

const ENVS = ['dev', 'uat', 'prod', 'stg', 'staging', 'test'];
const SG_SOURCE = 'terraform-aws-modules/security-group/aws';
const stripSource = (s: string) => s.replace(/^(?:[\w.-]+\.\w+\/)?/, (m) => (m.includes('.') && m.endsWith('/') && !m.startsWith('terraform-aws-modules') ? '' : m));
const first = <T,>(v: T | T[] | undefined): T | undefined => (Array.isArray(v) ? v[0] : v);

interface ModBlock { label: string; inputs: Record<string, any>; src: SrcBlock; source: string; version?: string }

/** "<project>-<env>-<name>": find the environment token in a resource name and take everything before it */
function prefixFromEnvToken(mods: ModBlock[]): string[] {
  for (const m of mods) {
    const v = str({ vars: {} } as RC, m.inputs.name ?? m.inputs.identifier ?? m.inputs.cluster_name ?? m.inputs.bucket ?? m.inputs.function_name ?? m.inputs.comment);
    if (!v || v.includes('${')) continue;
    const parts = v.split('-');
    const i = parts.findIndex((p, k) => k >= 1 && k < parts.length - 1 && ENVS.includes(p));
    if (i > 0) return parts.slice(0, i + 1);
  }
  return [];
}

function inferPrefix(mods: ModBlock[]): string[] {
  const names = mods
    .map((m) => str({ vars: {} } as RC, m.inputs.name ?? m.inputs.identifier ?? m.inputs.cluster_name ?? m.inputs.bucket ?? m.inputs.function_name))
    .filter((x): x is string => !!x && !x.includes('${'))
    .map((x) => x.split('-'));
  if (names.length < 2) return [];
  let p = names[0].slice(0, -1);
  for (const n of names.slice(1)) { let i = 0; while (i < p.length && i < n.length - 1 && p[i] === n[i]) i++; p = p.slice(0, i); }
  return p;
}

export async function importTerraform(files: TfFile[], opts: ImportOptions): Promise<ImportResult> {
  const notes: Diagnostic[] = [];
  const note = (severity: Diagnostic['severity'], message: string, nodeId?: string) => notes.push({ severity, message, ...(nodeId ? { nodeId } : {}) });

  // ── 1. parse every file (structure from hcl2json, verbatim text from our splitter)
  const vars: Record<string, unknown> = {};
  const zones: Record<string, any> = {};
  const mods: ModBlock[] = [];
  const others: { kind: string; labels: string[]; src: SrcBlock; json: any }[] = [];
  let region: string | undefined;
  let tags: Record<string, unknown> | undefined;
  let total = 0;

  for (const f of files.filter((x) => /\.tf$/.test(x.path))) {
    let json: any;
    try { json = await opts.parse(f.path, f.content); } catch (e) { note('error', `Could not parse ${f.path}: ${(e as Error).message}`); continue; }
    const blocks = splitBlocks(f.content, f.path);
    const find = (kind: string, labels: string[]) => blocks.find((b) => b.kind === kind && b.labels.join('\0') === labels.join('\0'));
    for (const [label, arr] of Object.entries<any>(json.module ?? {})) {
      const inputs = first(arr) ?? {};
      const src = find('module', [label]);
      if (!src) continue;
      const { source, version, ...rest } = inputs;
      mods.push({ label, inputs: rest, src, source: String(source ?? ''), version: typeof version === 'string' ? version : undefined });
      total++;
    }
    for (const [name, arr] of Object.entries<any>(json.variable ?? {})) { const d = first(arr)?.default; if (d !== undefined) vars[name] = d; }
    for (const [name, v] of Object.entries<any>(json.data?.aws_route53_zone ?? {})) zones[name] = first(v);
    const prov = first(json.provider?.aws) as any;
    if (prov && !prov.alias) { if (typeof prov.region === 'string' && !prov.region.includes('${')) region = prov.region; }
    for (const l of json.locals ?? []) if (l?.mandatory_tags && typeof l.mandatory_tags === 'object') tags = l.mandatory_tags;
    for (const kind of ['resource', 'data', 'variable', 'output', 'locals', 'terraform', 'provider']) {
      const group = json[kind];
      if (!group) continue;
      if (kind === 'locals' || kind === 'terraform') { const src = blocks.find((b) => b.kind === kind); if (src && !others.some((o) => o.src === src)) others.push({ kind, labels: [], src, json: group }); continue; }
      for (const [a, v] of Object.entries<any>(group)) {
        const second = kind === 'resource' || kind === 'data' ? Object.entries<any>(v) : [[undefined, v]];
        for (const [b2, vv] of second) {
          const labels = b2 === undefined ? [a] : [a, b2];
          const src = find(kind, labels) ?? (kind === 'provider' ? blocks.find((x) => x.kind === 'provider') : undefined);
          if (src && !others.some((o) => o.src === src)) others.push({ kind, labels, src, json: vv });
        }
      }
    }
  }
  for (const f of files.filter((x) => /\.tfvars$/.test(x.path))) {
    try { Object.assign(vars, await opts.parse(f.path, f.content)); } catch { /* ignore */ }
  }
  // some terraform.tfvars values come back wrapped
  for (const [k, v] of Object.entries(vars)) if (Array.isArray(v) && v.length === 1 && typeof v[0] === 'string') vars[k] = v[0];

  // ── 2. project metadata
  const pre = inferPrefix(mods).length ? inferPrefix(mods) : prefixFromEnvToken(mods);
  const tagStr = (k: string) => (typeof tags?.[k] === 'string' ? (tags![k] as string) : undefined);
  let envName = tagStr('Environment') ?? (ENVS.includes(pre.at(-1) ?? '') ? pre.at(-1)! : 'dev');
  let projName = tagStr('Project') ?? (pre.length ? pre.filter((x, i) => !(i === pre.length - 1 && ENVS.includes(x))).join('-') : '') ?? '';
  if (!projName) projName = clean(opts.name ?? 'imported-project') || 'imported-project';
  projName = clean(projName) || 'imported-project';
  const project: ProjectMeta = { name: projName, environment: envName, region: region ?? 'ap-southeast-1', ...(tagStr('Squad') ? { squad: tagStr('Squad') } : {}) };
  if (!region) note('warning', 'No AWS provider region found; defaulting to ap-southeast-1.');
  const prefix = `${project.name}-${project.environment}`;

  // ── 3. classify modules
  const bySource = new Map<string, typeof CATALOG_LIST>();
  for (const d of CATALOG_LIST) if (!d.virtual && !d.verbatim && d.module.source) bySource.set(d.module.source, [...(bySource.get(d.module.source) ?? []), d]);
  const claimed = new Map<string, { type: string; mod: ModBlock }>(); // label -> catalog match
  const companionOf = new Map<string, string>(); // companion module label -> owner label
  const sgLabels = new Set(mods.filter((m) => stripSource(m.source) === SG_SOURCE).map((m) => m.label));
  for (const m of mods) {
    const defs = bySource.get(stripSource(m.source));
    const def = defs?.find((d) => !d.matches || d.matches(m.inputs)) ?? defs?.[0];
    if (def) claimed.set(m.label, { type: def.type, mod: m });
  }
  // security-group modules named "<module>_sg" belong to the module that owns them
  for (const l of sgLabels) {
    const owner = l.endsWith('_sg') ? l.slice(0, -3) : '';
    if (owner && claimed.has(owner) && ['aws.rds_postgres', 'aws.rds_mysql', 'aws.lambda'].includes(claimed.get(owner)!.type)) companionOf.set(l, owner);
  }

  // ── 4. nodes
  const nodes: GraphNode[] = [];
  const idOf = new Map<string, string>(); // module label -> node id
  const used = new Set<string>();
  const uid = (want: string) => { let id = want, i = 2; while (used.has(id)) id = `${want}${i++}`; used.add(id); return id; };
  const mappedNodes: ImportReport['mappedNodes'] = [];
  const unmanaged: ImportReport['unmanaged'] = [];
  const rawProps = new Map<string, Props>();

  // VPC first (subnets depend on it)
  const vpcMods = [...claimed.values()].filter((c) => c.type === 'aws.vpc');
  const vpcIdByLabel = new Map<string, string>();
  for (const { mod } of vpcMods) {
    const rc: RC = { label: mod.label, i: mod.inputs, prefix, vars, zones };
    const props = { ...defaultProps('aws.vpc'), ...strip(REVERSE['aws.vpc'](rc)) };
    const id = uid(mod.src.marker?.type === 'aws.vpc' ? mod.src.marker.id : 'vpc1');
    idOf.set(mod.label, id);
    vpcIdByLabel.set(mod.label, id);
    const zs = evalZones(mod.inputs.azs) ?? AZ_LETTERS.slice(0, 2).slice();
    if (!evalZones(mod.inputs.azs)) note('warning', `Could not read availability zones from "${mod.label}"; assuming a and b.`, id);
    const cell = (t: Tier) => evalCidrList(mod.inputs[`${t}_subnets`]);
    const present = TIER_ORDER.filter((t) => mod.inputs[`${t}_subnets`] !== undefined);
    const azCount = Math.max(1, zs.length);
    nodes.push({ id, type: 'aws.vpc', position: { x: 0, y: 0 }, size: vpcSize(azCount), properties: props, ...(derivedLabel(props, mod.label) ? {} : { label: mod.label }) });
    for (const t of present) {
      const cidrs = cell(t);
      const names = Array.isArray(mod.inputs[`${t}_subnet_names`]) ? mod.inputs[`${t}_subnet_names`] : [];
      if (!cidrs) { note('warning', `${t} subnets of "${mod.label}" are not literal CIDRs; showing default subnets (original inputs are kept).`, id); }
      zs.forEach((z, i) => {
        const azi = AZ_LETTERS.indexOf(z as 'a');
        if (azi < 0) return;
        const sn = subnetNode(id, String(props.cidr), t, azi);
        if (cidrs?.[i]) sn.properties.cidr = cidrs[i];
        if (typeof names[i] === 'string' && !String(names[i]).includes('${')) sn.properties.name = clean(names[i]) || sn.properties.name;
        nodes.push(sn);
      });
    }
    mappedNodes.push({ nodeId: id, label: mod.label, source: mod.source, type: 'aws.vpc' });
  }

  const subnetFor = (vpcId: string, tier: Tier, k: number) => {
    const zs = nodes.filter((n) => n.type === 'aws.subnet' && n.parentId === vpcId && n.properties.tier === tier).sort((a, b) => String(a.properties.az).localeCompare(String(b.properties.az)));
    return zs[k % Math.max(1, zs.length)];
  };

  let freeY = 0;
  const vpcRight = nodes.filter((n) => n.type === 'aws.vpc').reduce((m, v) => Math.max(m, (v.size?.w ?? 0) + 60), 0);

  for (const { type, mod } of claimed.values()) {
    if (type === 'aws.vpc') continue;
    const def = CATALOG[type];
    const rc: RC = { label: mod.label, i: mod.inputs, prefix, vars, zones };
    const props = { ...defaultProps(type), ...strip(REVERSE[type](rc)) };
    const id = uid(mod.src.marker && mod.src.marker.type === type ? mod.src.marker.id : `${type.split('.')[1].slice(0, 3)}_${snake(mod.label)}`);
    idOf.set(mod.label, id);
    const node: GraphNode = { id, type, position: { x: 0, y: 0 }, properties: props, ...(derivedLabel(props, mod.label) ? {} : { label: mod.label }) };

    if (def.parent === 'aws.subnet') {
      // which VPC / tier does it reference?
      const refs = collectRefs([mod.inputs, ...[...companionOf.entries()].filter(([, o]) => o === mod.label).map(([l]) => mods.find((x) => x.label === l)?.inputs)], [], []);
      const toVpc = refs.find((r) => vpcIdByLabel.has(r.label));
      const vpcId = toVpc ? vpcIdByLabel.get(toVpc.label)! : !def.optionalParent && vpcIdByLabel.size === 1 ? [...vpcIdByLabel.values()][0] : undefined;
      const tierAttr = refs.find((r) => vpcIdByLabel.has(r.label) && /^(public|private|database)_subnets$|^database_subnet_group_name$/.test(r.attr));
      const tier: Tier | undefined = tierAttr ? (tierAttr.attr.startsWith('public') ? 'public' : tierAttr.attr.startsWith('database') ? 'database' : 'private') : def.tier;
      if (vpcId && tier) {
        const sn = subnetFor(vpcId, tier, 0);
        if (sn) {
          // services in the same subnet sit side by side, left to right
          const kids = nodes.filter((n) => n.parentId === sn.id).length;
          node.parentId = sn.id;
          node.position = { x: 16 + kids * 112, y: inSubnetPos().y };
        }
      }
      if (!node.parentId) {
        if (def.optionalParent) { node.position = { x: vpcRight, y: freeY }; freeY += 150; }
        else { note('warning', `Could not tell which subnet "${mod.label}" belongs to; it is left outside the VPC and needs placing.`, id); node.position = { x: vpcRight, y: freeY }; freeY += 150; }
      }
    } else {
      node.position = { x: vpcRight, y: freeY };
      freeY += 150;
    }
    nodes.push(node);
    rawProps.set(id, props);
    mappedNodes.push({ nodeId: id, label: mod.label, source: mod.source, type });
  }

  // modules we don't model -> unmanaged, code kept verbatim
  for (const m of mods) {
    if (claimed.has(m.label) || companionOf.has(m.label)) continue;
    const id = uid(`unm_${snake(m.label)}`);
    idOf.set(m.label, id);
    const reason = sgLabels.has(m.label) ? 'Security group module that is not attached to a database or Lambda' : m.source ? `No catalog entry for module source "${m.source}"` : 'Module without a source';
    unmanaged.push({ label: m.label, source: m.source, reason });
    nodes.push({ id, type: 'aws.unmanaged', position: { x: vpcRight, y: freeY }, label: m.label, properties: { name: clean(m.label.replace(/_/g, '-')) || 'module', source: m.source || 'unknown', code: m.src.text } });
    freeY += 150;
  }

  // ── 5. edges from references
  const edges: GraphEdge[] = [];
  const addEdge = (s: string, t: string) => { if (s !== t && !edges.some((e) => e.source === s && e.target === t)) edges.push({ id: `${s}-${t}`, source: s, target: t }); };
  const ownerLabel = (l: string) => companionOf.get(l) ?? l;
  for (const m of mods) {
    const a = idOf.get(ownerLabel(m.label));
    const an = nodes.find((n) => n.id === a);
    if (!a || !an || an.type === 'aws.unmanaged' || an.type === 'aws.vpc') continue;
    for (const r of collectRefs(m.inputs)) {
      const b = idOf.get(ownerLabel(r.label));
      const bn = nodes.find((n) => n.id === b);
      if (!b || !bn || b === a || bn.type === 'aws.vpc' || bn.type === 'aws.unmanaged') continue;
      if (an.type === 'aws.lambda' && bn.type === 'aws.sqs') {
        // consuming a queue (event source) vs. writing to it (IAM grant)
        if (r.path[0] === 'event_source_mapping') addEdge(b, a);
        else if (r.path[0] === 'policy_statements' && !String(r.path[1]).startsWith('consume_')) addEdge(a, b);
        continue;
      }
      if (edgeRule(an.type, bn.type)) addEdge(a, b);
      else if (edgeRule(bn.type, an.type)) addEdge(b, a);
    }
  }

  // ── 6. everything that isn't a module
  const regenerated = (o: (typeof others)[number]) => {
    if (o.kind === 'terraform') return true;
    if (o.kind === 'provider') return o.labels[0] === 'aws' && (!o.json?.alias || o.json.alias === 'us_east_1' || (Array.isArray(o.json) && o.json.every((x: any) => !x.alias || x.alias === 'us_east_1')));
    if (o.kind === 'data') return o.labels[0] === 'aws_availability_zones';
    if (o.kind === 'locals') return Array.isArray(o.json) ? o.json.every((l: any) => Object.keys(l).every((k) => k === 'mandatory_tags')) : false;
    return false;
  };
  const candidates: { file: string; code: string; kind: string; labels: string[] }[] = [];
  let rawResources = 0;
  for (const o of others) {
    if (regenerated(o)) continue;
    candidates.push({ file: o.src.file, code: o.src.text, kind: o.kind, labels: o.labels });
    if (o.kind === 'resource') { rawResources++; total++; }
  }
  if (rawResources) note('info', `${rawResources} raw resource block${rawResources === 1 ? '' : 's'} kept as-is. Resource-level import is not supported yet, so they do not appear on the canvas.`);

  const graph: Graph = { schemaVersion: '1.0.0', project, nodes, edges };

  // ── 7. keep every imported input the catalog doesn't produce, and record what regenerating would add
  const preserved: ImportReport['preserved'] = [];
  const additions: ImportReport['additions'] = [];
  const first1 = compile(graph, { lenient: true });
  // blocks Cloud Canvas regenerates itself (e.g. the CloudFront bucket policy) must not also be kept verbatim
  const generatedHeads = new Set<string>();
  for (const m of Object.values(first1.modules)) for (const rb of m.rawBlocks) { const h = /^(data|resource)\s+"([^"]+)"\s+"([^"]+)"/.exec(rb.trim()); if (h) generatedHeads.add(`${h[1]}.${h[2]}.${h[3]}`); }
  const passthrough: { file: string; code: string }[] = [];
  for (const c of candidates) {
    if (c.kind === 'data' && c.labels.length === 2 && generatedHeads.has(`data.${c.labels[0]}.${c.labels[1]}`)) continue;
    if (c.kind === 'data' && c.labels[0] === 'aws_route53_zone' && nodes.some((n) => n.type === 'aws.acm')) continue;
    passthrough.push({ file: c.file, code: c.code });
  }
  if (passthrough.length) graph.passthrough = passthrough;
  const modByNode = new Map<string, ModBlock>();
  for (const [label, id] of idOf) { const m = mods.find((x) => x.label === label); if (m && !modByNode.has(id)) modByNode.set(id, m); }
  for (const n of nodes) {
    const m = modByNode.get(n.id);
    const out = first1.modules[n.id];
    if (!m || !out || CATALOG[n.type]?.verbatim) continue;
    const extras: Record<string, unknown> = {};
    const gen = toJson(out.generated as never) as Record<string, unknown>;
    for (const [k, v] of Object.entries(m.inputs)) {
      if (k === 'providers' && out.usEast1) continue; // emitted by the compiler itself
      if (!(k in gen)) extras[k] = v;
      else if (!equivalent(k, gen[k], v)) { extras[k] = v; note('info', `"${k}" is kept as imported; the form value for it no longer changes the generated code.`, n.id); }
    }
    const def = CATALOG[n.type];
    if (m.version && m.version !== def.module.version) extras.version = m.version;
    const added = Object.keys(gen).filter((k) => !(k in m.inputs));
    if (Object.keys(extras).length) { n.extras = extras; preserved.push({ nodeId: n.id, keys: Object.keys(extras) }); }
    if (added.length) additions.push({ nodeId: n.id, keys: added });
    // companion modules we regenerate: say so when they differ from the imported ones
    for (const c of out.companions) {
      const imported = mods.find((x) => x.label === c.label);
      if (!imported) { note('info', `Cloud Canvas adds the companion module "${c.label}" (not in your code).`, n.id); continue; }
      const { source: _s, version: _v, ...ci } = imported.inputs as any;
      const gi = toJson(c.inputs as never) as Record<string, unknown>;
      if (!same(Object.fromEntries(Object.entries(ci).filter(([k]) => k in gi)), Object.fromEntries(Object.entries(gi).filter(([k]) => k in ci)))) note('warning', `Companion module "${c.label}" differs from the generated one and will be regenerated.`, n.id);
    }
  }

  // ── 8. report
  const mapped = mappedNodes.length + companionOf.size;
  const report: ImportReport = {
    total: Math.max(total, mapped + unmanaged.length),
    mapped,
    coverage: total ? Math.round((mapped / Math.max(total, mapped + unmanaged.length)) * 100) : 100,
    mappedNodes,
    unmanaged,
    passthrough: passthrough.length,
    preserved,
    additions,
    notes,
  };
  return { graph, report };
}

/** drop keys whose value couldn't be read, so defaults fill in */
function strip(p: Props): Props {
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && !(typeof v === 'number' && Number.isNaN(v)))) as Props;
}

/** true when the node's name alone would reproduce the module label (no label override needed) */
function derivedLabel(props: Props, label: string) {
  return snake(String(props.name)) === label;
}

/** generated vs imported value for one input, tolerating equivalent spellings (expressions that evaluate the same) */
function equivalent(key: string, gen: unknown, imp: unknown): boolean {
  if (same(gen, imp)) return true;
  if (Array.isArray(gen) && /_subnets$/.test(key)) {
    const e = evalCidrList(imp);
    return !!e && JSON.stringify(e) === JSON.stringify(gen);
  }
  if (key === 'azs' && Array.isArray(gen)) {
    const z = evalZones(imp);
    return !!z && JSON.stringify(z) === JSON.stringify((gen as string[]).map((x) => x.slice(-1)));
  }
  return JSON.stringify(normalize(gen)) === JSON.stringify(normalize(imp));
}
