import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { parse } from '@cdktf/hcl2json';
import { beforeAll, describe, expect, it } from 'vitest';
import { describeDiff, diffGraphs, loadHistory, memoryCache, TEMPLATES, type Graph, type HistoryEntry } from '../src';
import { LocalGitProvider } from '../src/history/localGit';

const REPO = '/tmp/cc-history-test-repo';
const meta = { name: 'demo', environment: 'dev', region: 'ap-southeast-1' };

let entries: HistoryEntry[] = [];
const msgs = () => entries.map((e) => e.commit.message);
const by = (needle: string) => entries.find((e) => e.commit.message.includes(needle))!;

beforeAll(async () => {
  execFileSync('npx', ['tsx', 'scripts/make-demo-repo.ts', REPO], { cwd: new URL('..', import.meta.url).pathname, stdio: 'pipe' });
  expect(existsSync(REPO + '/.git')).toBe(true);
  entries = await loadHistory({ provider: new LocalGitProvider(REPO), path: 'infra/dev', parse, name: 'demo' });
}, 120000);

describe('history from a git repo', () => {
  it('lists only commits that touched the Terraform folder, oldest first', () => {
    expect(entries).toHaveLength(10); // the README-only commit is excluded
    expect(msgs()[0]).toContain('Initial infrastructure');
    expect(msgs().at(-1)).toContain('Retire the jobs queue');
    expect(msgs().some((m) => m === 'Add README')).toBe(false);
  });

  it('every commit imports with full coverage and no unmanaged blocks', () => {
    for (const e of entries) { expect(e.graph, e.commit.message).not.toBeNull(); expect(e.coverage).toBe(100); }
  });

  it('first commit: everything is added', () => {
    const d = entries[0].diff!;
    expect(d.removed).toEqual([]);
    expect(d.added.map((n) => n.label)).toEqual(expect.arrayContaining(['VPC', 'Application Load Balancer', 'ECS Fargate Service', 'RDS PostgreSQL']));
    expect(d.edgesAdded).toHaveLength(2);
  });

  it('adding a queue shows the node and its connection, nothing else', () => {
    const d = by('jobs queue').diff!;
    expect(d.added.map((n) => n.name)).toEqual(['jobs']);
    expect(d.edgesAdded.map((e) => `${e.source.name}>${e.target.name}`)).toEqual(['api>jobs']);
    expect(d.removed).toEqual([]);
    expect(d.changed).toEqual([]);
  });

  it('scaling the service reports exactly the three property changes', () => {
    const d = by('Scale the API').diff!;
    expect(d.added).toEqual([]);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].node.name).toBe('api');
    const c = Object.fromEntries(d.changed[0].changes.map((x) => [x.key, [x.from, x.to]]));
    expect(c).toEqual({ cpu: [512, 1024], memory: [1024, 2048], desiredCount: [2, 4] });
  });

  it('turning on TLS adds a certificate, flips https and connects them', () => {
    const d = by('Terminate TLS').diff!;
    expect(d.added.map((n) => n.label)).toEqual(['ACM Certificate']);
    expect(d.changed.find((c) => c.node.name === 'web')!.changes).toEqual([expect.objectContaining({ key: 'https', from: false, to: true })]);
    expect(d.edgesAdded.map((e) => `${e.source.name}>${e.target.name}`)).toEqual(['cert>web']);
  });

  it('the cost-saving commit reports Multi-AZ on → off and the smaller instance', () => {
    const lines = describeDiff(by('drop Multi-AZ').diff!).join('\n');
    expect(lines).toContain('Multi-AZ true → false');
    expect(lines).toContain('db.t4g.medium → db.t4g.micro');
  });

  it('a new availability zone adds exactly three subnets and nothing else', () => {
    const d = by('third availability zone').diff!;
    expect(d.added.filter((n) => n.type === 'aws.subnet')).toHaveLength(3);
    expect(d.added).toHaveLength(3);
    expect(describeDiff(d)).toEqual(['Added 3 subnets']);
  });

  it('making the ALB internal is flagged as a change to the load balancer', () => {
    const d = by('internal').diff!;
    const alb = d.changed.find((c) => c.node.name === 'web')!;
    expect(alb.changes.find((x) => x.key === 'internal')).toMatchObject({ from: false, to: true });
  });

  it('the last commit reverses the cost-saving change', () => {
    const d = by('Multi-AZ back on').diff!;
    const c = Object.fromEntries(d.changed[0].changes.map((x) => [x.key, [x.from, x.to]]));
    expect(c).toEqual({ instanceClass: ['db.t4g.micro', 'db.t4g.medium'], multiAz: [false, true] });
  });

  it('retiring the queue shows the removal and the dropped connection', () => {
    const d = by('Retire the jobs queue').diff!;
    expect(d.removed.map((n) => n.name)).toEqual(['jobs']);
    expect(d.edgesRemoved.map((e) => `${e.source.name}>${e.target.name}`)).toEqual(['api>jobs']);
    expect(d.added).toEqual([]);
    expect(d.changed).toEqual([]);
    expect(describeDiff(d)).toEqual(['Removed SQS Queue “jobs”', 'Disconnected “api” → “jobs”']);
  });

  it('an unchanged architecture produces an empty diff', () => {
    const g = TEMPLATES[0].build(meta);
    expect(diffGraphs(g, structuredClone(g)).empty).toBe(true);
  });

  it('ignores layout: moving nodes is not an architecture change', () => {
    const g = TEMPLATES.find((t) => t.id === 'ecs-cluster')!.build(meta);
    const moved: Graph = structuredClone(g);
    for (const n of moved.nodes) n.position = { x: n.position.x + 50, y: n.position.y + 9 };
    expect(diffGraphs(g, moved).empty).toBe(true);
  });

  it('caches by commit: a second run reads no files', async () => {
    const cache = memoryCache();
    const inner = new LocalGitProvider(REPO);
    let reads = 0;
    const counting = { listCommits: inner.listCommits.bind(inner), readFilesAt: async (s: string, d: string) => { reads++; return inner.readFilesAt(s, d); } };
    await loadHistory({ provider: counting, path: 'infra/dev', parse, cache });
    const first = reads;
    await loadHistory({ provider: counting, path: 'infra/dev', parse, cache });
    expect(first).toBe(10);
    expect(reads).toBe(first);
  });

  it('a folder that did not exist yet is an empty architecture, not an error', async () => {
    const e = await loadHistory({ provider: new LocalGitProvider(REPO), path: 'infra', parse });
    expect(e.length).toBeGreaterThan(0);
  });

  it('an unreadable commit is reported and the history carries on', async () => {
    const inner = new LocalGitProvider(REPO);
    const calls: string[] = [];
    const flaky = {
      listCommits: inner.listCommits.bind(inner),
      readFilesAt: async (sha: string, dir: string) => {
        calls.push(sha);
        const files = await inner.readFilesAt(sha, dir);
        return calls.length === 3 ? files.map((f) => ({ ...f, content: 'module "x" {' })) : files;
      },
    };
    const e = await loadHistory({ provider: flaky, path: 'infra/dev', parse });
    expect(e[2].graph).toBeNull();
    expect(e[2].summary[0]).toContain('Could not read Terraform');
    expect(e[3].graph).not.toBeNull();
    expect(e[3].comparedTo).toBe(e[1].commit.sha); // compared with the last readable version
  });
});
