import { CATALOG, tiersOf } from './catalog';
import type { Graph, GraphNode, Tier } from './types';

/** Geometry of the default subnet grid inside a VPC (shared by the editor, templates and previews). */
export const SUB = { w: 400, h: 160, gap: 16, padX: 16, top: 56 };
export const AZ_LETTERS = ['a', 'b', 'c'] as const;
export const TIER_ORDER: Tier[] = ['public', 'private', 'database'];
const TIER_OFFSET: Record<Tier, number> = { public: 0, private: 10, database: 20 };

export const vpcSize = (azCount: number) => ({
  w: SUB.padX * 2 + azCount * SUB.w + (azCount - 1) * SUB.gap,
  h: SUB.top + TIER_ORDER.length * SUB.h + (TIER_ORDER.length - 1) * SUB.gap + SUB.padX,
});

export const subnetCell = (row: number, col: number) => ({ x: SUB.padX + col * (SUB.w + SUB.gap), y: SUB.top + row * (SUB.h + SUB.gap) });

export function suggestCidr(vpcCidr: string, tier: Tier, azIndex: number): string {
  const [a, b] = vpcCidr.split('.');
  return `${a}.${b}.${TIER_OFFSET[tier] + azIndex}.0/24`;
}

export const subnetId = (vpcId: string, tier: Tier, az: string) => `${vpcId}-${tier}-${az}`;

export function subnetNode(vpcId: string, vpcCidr: string, tier: Tier, azIndex: number): GraphNode {
  const az = AZ_LETTERS[azIndex];
  return {
    id: subnetId(vpcId, tier, az),
    type: 'aws.subnet',
    parentId: vpcId,
    position: subnetCell(TIER_ORDER.indexOf(tier), azIndex),
    size: { w: SUB.w, h: SUB.h },
    properties: { name: `${tier}-${az}`, tier, az, cidr: suggestCidr(vpcCidr, tier, azIndex) },
  };
}

export function subnetNodes(vpcId: string, vpcCidr: string, azCount: number, tiers: Tier[] = TIER_ORDER): GraphNode[] {
  const out: GraphNode[] = [];
  for (const tier of TIER_ORDER) if (tiers.includes(tier)) for (let i = 0; i < azCount; i++) out.push(subnetNode(vpcId, vpcCidr, tier, i));
  return out;
}

/** Where a service sits by default inside a subnet (relative to the subnet). */
export const inSubnetPos = (k = 0) => ({ x: (SUB.w - 96) / 2 + k * 0, y: 38 });

/**
 * Upgrade graphs saved before subnets were real nodes: VPCs get a default subnet grid and
 * services that were parented to the VPC move into the subnet of their tier. Idempotent.
 */
export function migrateGraph(g: Graph): Graph {
  const needs = g.nodes.filter((n) => n.type === 'aws.vpc' && !g.nodes.some((x) => x.type === 'aws.subnet' && x.parentId === n.id));
  if (!needs.length) return g;
  const out = structuredClone(g);
  for (const v of out.nodes.filter((n) => needs.some((x) => x.id === n.id))) {
    const azCount = Math.min(3, Math.max(1, Number(v.properties.azCount ?? 2)));
    delete v.properties.azCount;
    v.size = vpcSize(azCount);
    const placed: Record<string, number> = {};
    for (const n of out.nodes) {
      if (n.parentId !== v.id || n.type === 'aws.subnet') continue;
      const def = CATALOG[n.type];
      const tier: Tier = (def && tiersOf(def, n.properties)[0]) || 'private';
      const k = (placed[tier] = (placed[tier] ?? -1) + 1);
      n.parentId = subnetId(v.id, tier, 'a');
      n.position = { x: 24 + k * 120, y: 38 };
    }
    out.nodes.push(...subnetNodes(v.id, String(v.properties.cidr ?? '10.0.0.0/16'), azCount));
  }
  return out;
}
