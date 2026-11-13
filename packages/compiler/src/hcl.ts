/** Tiny deterministic HCL value model + printer (terraform-fmt style). */

export class Raw {
  constructor(public readonly expr: string) {}
}
export const raw = (expr: string) => new Raw(expr);

export type HclValue = string | number | boolean | null | Raw | HclValue[] | { [k: string]: HclValue };

const IDENT = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export function quote(s: string): string {
  return (
    '"' +
    s
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\$\{/g, '$${')
      .replace(/%\{/g, '%%{') +
    '"'
  );
}

const isScalar = (v: HclValue) => v === null || typeof v !== 'object' || v instanceof Raw;

function fmt(v: HclValue, indent: string): string {
  if (v === null) return 'null';
  if (v instanceof Raw) return v.expr;
  if (typeof v === 'string') return quote(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    if (v.every(isScalar)) {
      const inline = '[' + v.map((x) => fmt(x, indent)).join(', ') + ']';
      if (inline.length <= 80) return inline;
    }
    const inner = indent + '  ';
    return '[\n' + v.map((x) => inner + fmt(x, inner) + ',').join('\n') + '\n' + indent + ']';
  }
  const entries = Object.entries(v);
  if (entries.length === 0) return '{}';
  return '{\n' + body(entries, indent + '  ') + '\n' + indent + '}';
}

const key = (k: string) => (IDENT.test(k) ? k : quote(k));

/** Print attributes, aligning '=' across consecutive single-line values like `terraform fmt`. */
export function body(entries: [string, HclValue][], indent: string): string {
  const rendered = entries.map(([k, v]) => ({ k: key(k), s: fmt(v, indent) }));
  const out: string[] = [];
  let i = 0;
  while (i < rendered.length) {
    if (rendered[i].s.includes('\n')) {
      out.push(`${indent}${rendered[i].k} = ${rendered[i].s}`);
      i++;
      continue;
    }
    let j = i;
    while (j < rendered.length && !rendered[j].s.includes('\n')) j++;
    const width = Math.max(...rendered.slice(i, j).map((r) => r.k.length));
    for (let n = i; n < j; n++) out.push(`${indent}${rendered[n].k.padEnd(width)} = ${rendered[n].s}`);
    i = j;
  }
  return out.join('\n');
}

export interface ModuleBlock {
  name: string;
  source: string;
  version: string;
  inputs: Record<string, HclValue>;
  providers?: Record<string, HclValue>;
}

export function printModule(m: ModuleBlock): string {
  const head = body(
    [
      ['source', m.source],
      ['version', m.version],
    ],
    '  ',
  );
  const prov = m.providers ? `\n\n${body([['providers', m.providers]], '  ')}` : '';
  const rest = Object.entries(m.inputs).filter(([, v]) => v !== undefined) as [string, HclValue][];
  return `module ${quote(m.name)} {\n${head}${prov}${rest.length ? '\n\n' + body(rest, '  ') : ''}\n}`;
}

export function printBlock(type: string, labels: string[], attrs: Record<string, HclValue>): string {
  const l = labels.map(quote).join(' ');
  return `${type}${l ? ' ' + l : ''} {\n${body(Object.entries(attrs), '  ')}\n}`;
}
