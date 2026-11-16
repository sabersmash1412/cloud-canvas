import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { afterAll, describe, expect, it } from 'vitest';
import { TEMPLATES, compile, type Graph } from '@cloudcanvas/compiler';
import { startBridge, type Bridge } from '../src/bridge.js';
import { createServer } from '../src/server.js';
import type { LiveMessage } from '../src/protocol.js';

const meta = { name: 'demo', environment: 'dev', region: 'ap-southeast-1' };
const tpl = (id: string): Graph => TEMPLATES.find((t) => t.id === id)!.build(meta);
const base = 7900 + Math.floor(Math.random() * 40);
const open: Bridge[] = [];
afterAll(async () => { for (const b of open) await b.close(); });

/** A minimal SSE client over node:http (what a browser EventSource does). */
function sse(port: number, origin?: string) {
  const got: LiveMessage[] = [];
  let status = 0;
  const req = request({ host: '127.0.0.1', port, path: '/events', headers: { ...(origin ? { Origin: origin } : {}), Accept: 'text/event-stream' } }, (res) => {
    status = res.statusCode ?? 0;
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (d: string) => { buf += d; let i; while ((i = buf.indexOf('\n\n')) >= 0) { const frame = buf.slice(0, i); buf = buf.slice(i + 2); const m = /^data: (.*)$/m.exec(frame); if (m) got.push(JSON.parse(m[1])); } });
  });
  req.on('error', () => {});
  req.end();
  return { got, status: () => status, close: () => req.destroy() };
}
const until = async (f: () => boolean, ms = 3000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 20)); } };
const get = (port: number, path: string, headers: Record<string, string> = {}, method = 'GET') => new Promise<{ status: number; body: string; headers: Record<string, any> }>((resolve) => {
  const r = request({ host: '127.0.0.1', port, path, method, headers }, (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode!, body: b, headers: res.headers })); });
  r.end();
});

describe('live bridge', () => {
  it('pushes every published graph to a connected browser, in order', async () => {
    const b = (await startBridge(base))!; open.push(b);
    const c = sse(b.port, 'http://127.0.0.1:5173');
    await until(() => b.clients() === 1);
    b.publish({ source: 'show_on_canvas', graph: tpl('static-website'), ok: true, problems: [] });
    b.publish({ source: 'validate_and_compile', graph: tpl('ecs-cluster'), ok: true, problems: [] });
    await until(() => c.got.length === 2);
    expect(c.got.map((m) => m.seq)).toEqual([1, 2]);
    expect(c.got[1].graph.nodes.length).toBe(tpl('ecs-cluster').nodes.length);
    c.close();
  });

  it('replays the latest state to a browser that connects late (or reconnects)', async () => {
    const b = (await startBridge(base + 1))!; open.push(b);
    b.publish({ source: 'show_on_canvas', graph: tpl('serverless-api'), ok: true, problems: [], note: 'hello' });
    const c = sse(b.port, 'http://localhost:5173');
    await until(() => c.got.length === 1);
    expect(c.got[0].note).toBe('hello');
    c.close();
  });

  it('only answers Cloud Canvas origins; another website cannot read the stream', async () => {
    const b = (await startBridge(base + 2))!; open.push(b);
    b.publish({ source: 'show_on_canvas', graph: tpl('static-website'), ok: true, problems: [] });
    const evil = await get(b.port, '/events', { Origin: 'https://evil.example' });
    expect(evil.status).toBe(403);
    expect(evil.body).toBe('');
    const good = sse(b.port, 'http://127.0.0.1:5173');
    await until(() => good.got.length === 1);
    const pre = await get(b.port, '/events', { Origin: 'http://127.0.0.1:5173', 'Access-Control-Request-Method': 'GET' }, 'OPTIONS');
    expect(pre.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173');
    expect((await get(b.port, '/events', { Origin: 'http://127.0.0.1:9999' })).status).toBe(403);
    expect((await get(b.port, '/events', {}, 'POST')).status).toBe(405);
    expect((await get(b.port, '/nope')).status).toBe(404);
    good.close();
  });

  it('binds to loopback only', async () => {
    const b = (await startBridge(base + 3))!; open.push(b);
    const { networkInterfaces } = await import('node:os');
    const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
    if (!lan) return;
    const r = await new Promise<string>((resolve) => { const q = request({ host: lan, port: b.port, path: '/health', timeout: 800 }, () => resolve('reachable')); q.on('error', () => resolve('refused')); q.on('timeout', () => { q.destroy(); resolve('refused'); }); q.end(); });
    expect(r).toBe('refused');
  });

  it('exposes /health and never leaks anything but the graph and problems', async () => {
    const b = (await startBridge(base + 4))!; open.push(b);
    const h = JSON.parse((await get(b.port, '/health')).body);
    expect(h).toMatchObject({ service: 'cloud-canvas-mcp', version: 1 });
    const m = b.publish({ source: 'show_on_canvas', graph: tpl('static-website'), ok: true, problems: [] });
    expect(Object.keys(m).sort()).toEqual(['at', 'graph', 'ok', 'problems', 'seq', 'source']);
  });

  it('falls back to the next free port when the preferred one is busy, and gives up gracefully', async () => {
    const a = (await startBridge(base + 10))!; open.push(a);
    const b = (await startBridge(base + 10))!; open.push(b);
    expect(b.port).toBe(a.port + 1);
    const taken: Bridge[] = [];
    for (let i = 0; i < 8; i++) taken.push((await startBridge(base + 10))!);
    taken.forEach((t) => open.push(t));
    expect(await startBridge(base + 10)).toBeNull(); // all 10 ports busy: disabled, no crash
  });

  it('survives a browser disconnecting mid-stream', async () => {
    const b = (await startBridge(base + 25))!; open.push(b);
    const c1 = sse(b.port, 'http://127.0.0.1:5173'); const c2 = sse(b.port, 'http://127.0.0.1:5173');
    await until(() => b.clients() === 2);
    c1.close();
    await until(() => b.clients() === 1);
    b.publish({ source: 'show_on_canvas', graph: tpl('static-website'), ok: true, problems: [] });
    await until(() => c2.got.length === 1);
    c2.close();
  });
});

describe('MCP tools publish to the bridge', () => {
  it('validate_and_compile, show_on_canvas and sync_terraform_folder all reach a connected browser', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'cc-live-'));
    const s = await createServer({ cwd, port: base + 30, log: () => {} });
    const port = s.deps.bridge!.port;
    const c = sse(port, 'http://127.0.0.1:5173');
    await until(() => s.deps.bridge!.clients() === 1);
    const { validateAndCompile, showOnCanvas, makeSync } = await import('../src/tools.js');

    showOnCanvas(s.deps, { graph: tpl('static-website'), note: 'sketching' });
    await until(() => c.got.length === 1);
    expect(c.got[0]).toMatchObject({ source: 'show_on_canvas', note: 'sketching', ok: true });

    validateAndCompile(s.deps, { graph: tpl('ecs-cluster') });
    await until(() => c.got.length === 2);
    expect(c.got[1]).toMatchObject({ source: 'validate_and_compile', ok: true });
    if (s.deps.rulesLoaded) expect(c.got[1].problems.some((p) => p.kind === 'compliance')).toBe(true);

    // a broken graph is shown too, flagged as having errors, so you can watch the agent fix it
    const broken = tpl('ecs-cluster'); broken.nodes.find((n) => n.id === 'db')!.parentId = 'vpc1-private-a';
    validateAndCompile(s.deps, { graph: broken });
    await until(() => c.got.length === 3);
    expect(c.got[2].ok).toBe(false);
    expect(c.got[2].problems.some((p) => p.severity === 'error' && p.nodeId === 'db')).toBe(true);

    // a folder: live-updates when a file changes
    const dir = join(cwd, 'tf'); mkdirSync(dir);
    for (const f of compile(tpl('ecs-cluster')).files.filter((x) => x.path.endsWith('.tf'))) writeFileSync(join(dir, f.path), f.content);
    const sync = makeSync(s.deps);
    await sync.run({ folder: 'tf', watch: true });
    await until(() => c.got.some((m) => m.source === 'sync_terraform_folder'));
    const before = c.got.filter((m) => m.source === 'sync_terraform_folder').at(-1)!;
    expect(before.folder).toBe(dir);
    const nBefore = before.graph.nodes.filter((n) => n.type !== 'aws.subnet').length;
    appendFileSync(join(dir, 'main.tf'), '\nmodule "events" {\n  source  = "terraform-aws-modules/sns/aws"\n  version = "~> 6.1"\n\n  name = "demo-dev-events"\n}\n');
    await until(() => (c.got.filter((m) => m.source === 'sync_terraform_folder').at(-1)!.graph.nodes.filter((n) => n.type !== 'aws.subnet').length) === nBefore + 1, 5000);
    // a half-written file must not blank the diagram
    const count = c.got.length;
    writeFileSync(join(dir, 'main.tf'), 'module "x" {');
    await new Promise((r) => setTimeout(r, 700));
    expect(c.got.length).toBe(count);
    sync.stop(); c.close(); await s.stop();
  }, 30000);
});
