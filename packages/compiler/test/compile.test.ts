import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compile } from '../src';
import type { Graph } from '../src';

const load = () => JSON.parse(readFileSync(new URL('../../../examples/three-tier.canvas.json', import.meta.url), 'utf8')) as Graph;
const main = (g: Graph) => compile(g).files.find((f) => f.path === 'main.tf')!.content;

describe('compiler', () => {
  it('compiles the 3-tier example', () => {
    const r = compile(load());
    expect(r.ok).toBe(true);
    const m = main(load());
    expect(m).toContain('module "alb_web"'.replace('alb_web', 'web'));
    expect(m).toContain('module.main.private_subnets');
    expect(m).toContain('module.web.security_group_id');
    expect(m).toMatchSnapshot();
  });
  it('is deterministic regardless of node order', () => {
    const g = load();
    const rev = { ...g, nodes: [...g.nodes].reverse(), edges: [...g.edges].reverse() };
    expect(main(rev)).toBe(main(g));
  });
  it('rejects invalid connections and placement', () => {
    const g = load();
    g.edges.push({ id: 'bad', source: 'db1', target: 'alb1' });
    const r = compile(g);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.edgeId === 'bad')).toBe(true);
  });
  it('maps blocks to node line ranges', () => {
    const r = compile(load());
    const content = r.files[0].content.split('\n');
    for (const b of r.blocks.filter((x) => !x.nodeId.startsWith('vpc1-'))) expect(content[b.startLine - 1]).toBe(`# canvas:node id=${b.nodeId} type=${load().nodes.find((n) => n.id === b.nodeId)!.type}`);
  });
});
