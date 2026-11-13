import { describe, expect, it } from 'vitest';
import { compile, migrateGraph, subnetId, TEMPLATES } from '../src';
import type { Graph } from '../src';

const meta = { name: 'demo', environment: 'dev', region: 'ap-southeast-1' };
const tpl = (id: string): Graph => TEMPLATES.find((t) => t.id === id)!.build(meta);
const errors = (g: Graph) => compile(g).diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);
const main = (g: Graph) => compile(g).files[0].content;

describe('subnets as nodes', () => {
  it('all starter templates compile without errors', () => {
    for (const t of TEMPLATES) expect(errors(t.build(meta)), t.id).toEqual([]);
  });

  it('VPC subnet lists come from the subnet nodes', () => {
    const m = main(tpl('ecs-cluster'));
    expect(m).toMatch(/azs\s+= \["ap-southeast-1a", "ap-southeast-1b"\]/);
    expect(m).toMatch(/public_subnets\s+= \["10\.20\.0\.0\/24", "10\.20\.1\.0\/24"\]/);
    expect(m).toMatch(/database_subnets\s+= \["10\.20\.20\.0\/24", "10\.20\.21\.0\/24"\]/);
    expect(m).toMatch(/private_subnet_names\s+= \["private-a", "private-b"\]/);
  });

  it('editing a subnet CIDR changes the generated code', () => {
    const g = tpl('ecs-cluster');
    g.nodes.find((n) => n.id === subnetId('vpc1', 'private', 'a'))!.properties.cidr = '10.20.50.0/24';
    expect(main(g)).toContain('"10.20.50.0/24"');
  });

  it('removing a tier drops it from the module and disables NAT', () => {
    const g = tpl('rds-postgres-secure');
    g.nodes = g.nodes.filter((n) => !(n.type === 'aws.subnet' && n.properties.tier === 'public'));
    const m = main(g);
    expect(m).not.toContain('public_subnets');
    expect(m).toMatch(/enable_nat_gateway\s+= false/);
  });

  it('rejects overlapping, out-of-range and duplicate-cell subnets', () => {
    const g = tpl('ecs-cluster');
    const a = g.nodes.find((n) => n.id === subnetId('vpc1', 'private', 'a'))!;
    a.properties.cidr = '10.20.0.0/24'; // overlaps public-a
    expect(errors(g).some((m) => m.includes('overlaps'))).toBe(true);
    a.properties.cidr = '192.168.0.0/24';
    expect(errors(g).some((m) => m.includes('outside the VPC range'))).toBe(true);
    const g2 = tpl('ecs-cluster');
    g2.nodes.push({ ...structuredClone(g2.nodes.find((n) => n.id === subnetId('vpc1', 'private', 'a'))!), id: 'dup', properties: { name: 'private-a2', tier: 'private', az: 'a', cidr: '10.20.99.0/24' } });
    expect(errors(g2).some((m) => m.includes('one per tier per zone'))).toBe(true);
  });

  it('lets tiers span different numbers of zones, but not leave gaps', () => {
    const g = tpl('ecs-cluster');
    g.nodes = g.nodes.filter((n) => n.id !== subnetId('vpc1', 'private', 'b')); // private: a only; public/database: a,b
    expect(errors(g)).toEqual([]);
    const g2 = tpl('ecs-cluster');
    g2.nodes = g2.nodes.filter((n) => n.id !== subnetId('vpc1', 'private', 'a')); // private: b only -> would land in zone a
    expect(errors(g2).some((m) => m.includes('must start at zone a'))).toBe(true);
  });

  it('enforces tier placement and multi-AZ for RDS', () => {
    const g = tpl('ecs-cluster');
    g.nodes.find((n) => n.id === 'db')!.parentId = subnetId('vpc1', 'private', 'a');
    expect(errors(g).some((m) => m.includes('database subnet'))).toBe(true);
    const g2 = tpl('rds-postgres-secure');
    g2.nodes = g2.nodes.filter((n) => n.id !== subnetId('vpc1', 'database', 'b') && n.id !== subnetId('vpc1', 'private', 'b') && n.id !== subnetId('vpc1', 'public', 'b'));
    expect(errors(g2).some((m) => m.includes('at least 2 availability zones'))).toBe(true);
  });

  it('internal ALB belongs in a private subnet', () => {
    const g = tpl('ecs-cluster');
    g.nodes.find((n) => n.id === 'alb')!.properties.internal = true;
    expect(errors(g).some((m) => m.includes('private subnet'))).toBe(true);
  });

  it('selecting a subnet highlights its VPC block', () => {
    const r = compile(tpl('ecs-cluster'));
    const vpc = r.blocks.find((b) => b.nodeId === 'vpc1')!;
    expect(r.blocks.find((b) => b.nodeId === subnetId('vpc1', 'private', 'a'))).toMatchObject({ startLine: vpc.startLine, endLine: vpc.endLine });
  });

  it('migrates old graphs (services parented to the VPC) idempotently', () => {
    const old: Graph = {
      schemaVersion: '1.0.0', project: meta,
      nodes: [
        { id: 'vpc1', type: 'aws.vpc', position: { x: 0, y: 0 }, size: { w: 880, h: 540 }, properties: { name: 'main', cidr: '10.20.0.0/16', azCount: 2, nat: 'single' } },
        { id: 'alb1', type: 'aws.alb', parentId: 'vpc1', position: { x: 0, y: 0 }, properties: { name: 'web', internal: false, https: false, idleTimeout: 60 } },
        { id: 'db1', type: 'aws.rds_postgres', parentId: 'vpc1', position: { x: 0, y: 0 }, properties: { name: 'db', engineVersion: '16.4', instanceClass: 'db.t4g.medium', storage: 50, dbName: 'app', multiAz: true, backupDays: 7 } },
      ],
      edges: [],
    };
    const m = migrateGraph(old);
    expect(m.nodes.find((n) => n.id === 'alb1')!.parentId).toBe(subnetId('vpc1', 'public', 'a'));
    expect(m.nodes.find((n) => n.id === 'db1')!.parentId).toBe(subnetId('vpc1', 'database', 'a'));
    expect(m.nodes.filter((n) => n.type === 'aws.subnet')).toHaveLength(6);
    expect(errors(m)).toEqual([]);
    expect(migrateGraph(m)).toBe(m);
  });
});
