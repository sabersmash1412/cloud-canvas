export interface Cidr { start: number; end: number; prefix: number }

export function parseCidr(s: unknown): Cidr | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(String(s ?? ''));
  if (!m) return null;
  const o = m.slice(1, 5).map(Number);
  const prefix = Number(m[5]);
  if (o.some((x) => x > 255) || prefix > 32) return null;
  const ip = ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
  const size = 2 ** (32 - prefix);
  const start = Math.floor(ip / size) * size;
  return { start, end: start + size - 1, prefix };
}

export const overlaps = (a: Cidr, b: Cidr) => a.start <= b.end && b.start <= a.end;
export const contains = (outer: Cidr, inner: Cidr) => inner.start >= outer.start && inner.end <= outer.end;
