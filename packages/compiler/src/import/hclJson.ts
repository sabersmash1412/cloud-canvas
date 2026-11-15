import { Raw, raw, type HclValue } from '../hcl';
import { parseCidr } from '../cidr';

/** Collapse whitespace inside `${…}` expressions so formatting differences don't count as changes. */
export function normalize(v: unknown): unknown {
  if (typeof v === 'string') return v.includes('${') ? v.replace(/\s+/g, '') : v;
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, normalize(x)]));
  return v;
}
export const same = (a: unknown, b: unknown) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));

function balanced(s: string): boolean {
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth < 0) return false; }
  }
  return depth === 0 && !inStr;
}

/** printable HclValue -> the shape hcl2json produces (expressions become "${…}" strings). */
export function toJson(v: HclValue): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof Raw) {
    // a quoted template such as "${module.x.arn}/*" is a plain string value in hcl2json, not a ${…} expression
    const q = /^"((?:[^"\\]|\\.)*)"$/.exec(v.expr);
    if (q && q[1].includes('${')) return q[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    return '${' + v.expr + '}';
  }
  if (Array.isArray(v)) return v.map(toJson);
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toJson(x as HclValue)]));
}

/** hcl2json value (expressions are "${…}" strings) → printable HclValue. */
export function fromHclJson(v: unknown): HclValue {
  if (typeof v === 'string') {
    const m = /^\$\{([\s\S]*)\}$/.exec(v);
    if (m && balanced(m[1])) return raw(m[1]);
    if (v.includes('${') || v.includes('%{')) return raw('"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"');
    return v;
  }
  if (Array.isArray(v)) return v.map(fromHclJson);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, fromHclJson(x)]));
  return v as HclValue;
}

export interface Ref { label: string; attr: string; path: string[] }

/** Every `module.<label>` reference inside a value, with the key path it appears under. */
export function collectRefs(v: unknown, path: string[] = [], out: Ref[] = []): Ref[] {
  if (typeof v === 'string') {
    if (v.includes('${')) for (const m of v.matchAll(/module\.([A-Za-z_][\w-]*)(?:\.([A-Za-z_]\w*))?/g)) out.push({ label: m[1], attr: m[2] ?? '', path });
  } else if (Array.isArray(v)) v.forEach((x, i) => collectRefs(x, [...path, String(i)], out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) collectRefs(x, [...path, k], out);
  return out;
}

const ip = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');

/** Resolve a subnet CIDR list: a literal list, or `[for k in range(N) : cidrsubnet("cidr", bits, k + off)]`. */
export function evalCidrList(v: unknown): string[] | null {
  if (Array.isArray(v) && v.every((x) => typeof x === 'string' && !x.includes('${'))) return v as string[];
  if (typeof v !== 'string') return null;
  const m = /^\$\{\[for(\w+)inrange\((\d+)\):cidrsubnet\("([^"]+)",(\d+),\1\+(\d+)\)\]\}$/.exec(v.replace(/\s+/g, (s, i, all) => (/\w/.test(all[i - 1] ?? '') && /\w/.test(all[i + s.length] ?? '') ? ' ' : '')).replace(/for (\w+) in range/, 'for$1inrange').replace(/ ?: ?/, ':'));
  if (!m) return null;
  const base = parseCidr(m[3]);
  if (!base) return null;
  const bits = Number(m[4]);
  const newPrefix = base.prefix + bits;
  if (newPrefix > 32) return null;
  const size = 2 ** (32 - newPrefix);
  return Array.from({ length: Number(m[2]) }, (_, k) => `${ip(base.start + (k + Number(m[5])) * size)}/${newPrefix}`);
}

/** Zone letters from `azs`: ["ap-southeast-1a", …] or slice(data.aws_availability_zones.x.names, 0, N). */
export function evalZones(v: unknown): string[] | null {
  if (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string' && /[a-f]$/.test(x))) return (v as string[]).map((x) => x.slice(-1));
  if (typeof v === 'string') {
    const m = /^\$\{slice\(data\.aws_availability_zones\.\w+\.names,\s*0,\s*(\d+)\)\}$/.exec(v.trim());
    if (m) return 'abcdef'.slice(0, Number(m[1])).split('');
  }
  return null;
}
