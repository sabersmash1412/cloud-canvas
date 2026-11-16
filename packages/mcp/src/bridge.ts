import { createServer, type Server, type ServerResponse } from 'node:http';
import type { Graph } from '@cloudcanvas/compiler';
import type { LiveMessage, Problem } from './protocol.js';

export const DEFAULT_PORT = 7777;
const PORT_RANGE = 10;

/** Browser origins allowed to read the live stream. Only the Cloud Canvas dev/preview servers. */
const ALLOWED = [/^http:\/\/(127\.0\.0\.1|localhost):(5173|4173)$/];
const allowedOrigin = (o: string | undefined) => (o && ALLOWED.some((r) => r.test(o)) ? o : null);

export interface Bridge {
  port: number;
  /** the latest published state (replayed to every newly connected browser) */
  latest(): LiveMessage | null;
  publish(m: Omit<LiveMessage, 'seq' | 'at'>): LiveMessage;
  clients(): number;
  close(): Promise<void>;
}

/**
 * A tiny read-only Server-Sent Events endpoint on 127.0.0.1. The MCP server publishes every graph it handles;
 * the Cloud Canvas browser app listens. It binds to loopback only, only allows the Cloud Canvas origins, and
 * only ever sends the architecture graph and problem list (never files, paths or secrets).
 */
export async function startBridge(preferred = DEFAULT_PORT, log: (s: string) => void = () => {}): Promise<Bridge | null> {
  const clients = new Set<ServerResponse>();
  let latest: LiveMessage | null = null;
  let seq = 0;

  const server: Server = createServer((req, res) => {
    const origin = allowedOrigin(req.headers.origin);
    const cors = origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
    // a browser tab from any other site must not be able to read this stream
    if (req.headers.origin && !origin) { res.writeHead(403).end(); return; }
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'content-type' }).end(); return; }
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/health') { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify({ service: 'cloud-canvas-mcp', version: 1, clients: clients.size, seq })); return; }
    if (url.pathname === '/events') {
      res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
      res.write('retry: 1500\n\n');
      if (latest) res.write(`id: ${latest.seq}\ndata: ${JSON.stringify(latest)}\n\n`);
      clients.add(res);
      const ka = setInterval(() => res.write(': keep-alive\n\n'), 15000);
      req.on('close', () => { clearInterval(ka); clients.delete(res); });
      return;
    }
    res.writeHead(404).end();
  });

  const bind = (port: number) => new Promise<boolean>((resolve) => {
    const onError = () => { server.off('listening', onOk); resolve(false); };
    const onOk = () => { server.off('error', onError); resolve(true); };
    server.once('error', onError);
    server.once('listening', onOk);
    server.listen(port, '127.0.0.1');
  });

  let port = 0;
  for (let i = 0; i < PORT_RANGE; i++) {
    if (await bind(preferred + i)) { port = preferred + i; break; }
  }
  if (!port) { log(`live view disabled: ports ${preferred}-${preferred + PORT_RANGE - 1} are all busy`); return null; }
  log(`live view listening on http://127.0.0.1:${port}`);

  return {
    port,
    latest: () => latest,
    clients: () => clients.size,
    publish(m) {
      latest = { ...m, seq: ++seq, at: new Date().toISOString() };
      const frame = `id: ${latest.seq}\ndata: ${JSON.stringify(latest)}\n\n`;
      for (const c of clients) c.write(frame);
      return latest;
    },
    close: () => new Promise<void>((r) => { for (const c of clients) c.end(); clients.clear(); server.close(() => r()); }),
  };
}

export type { Graph, Problem };
