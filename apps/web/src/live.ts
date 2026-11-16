import { useEffect, useRef, useState } from 'react';
import type { LiveMessage } from '@cloudcanvas/mcp/protocol';

export type LiveStatus = 'searching' | 'connected' | 'lost';
const FIRST_PORT = 7777;
const PORT_COUNT = 10;

const timeout = (ms: number) => (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(ms) : undefined);

/** Find the Cloud Canvas MCP server Claude Code started: it listens on the first free port from 7777. */
export async function findBridge(): Promise<number | null> {
  for (let i = 0; i < PORT_COUNT; i++) {
    const p = FIRST_PORT + i;
    try {
      const r = await fetch(`http://127.0.0.1:${p}/health`, { signal: timeout(700) });
      if (r.ok && (await r.json()).service === 'cloud-canvas-mcp') return p;
    } catch { /* nothing on this port */ }
  }
  return null;
}

/**
 * Follow the graph Claude Code is building. Finds the local server, subscribes, and reconnects by itself
 * if Claude Code restarts. `prev` is the graph before the latest update, for highlighting what just changed.
 */
export function useLive(enabled: boolean) {
  const [status, setStatus] = useState<LiveStatus>('searching');
  const [msg, setMsg] = useState<LiveMessage | null>(null);
  const [prev, setPrev] = useState<LiveMessage | null>(null);
  const [port, setPort] = useState<number | null>(null);
  const last = useRef<LiveMessage | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = async () => {
      if (stopped) return;
      const p = await findBridge();
      if (stopped) return;
      if (p == null) { setStatus((s) => (s === 'connected' ? 'lost' : s)); timer = setTimeout(connect, 2000); return; }
      setPort(p);
      es = new EventSource(`http://127.0.0.1:${p}/events`);
      es.onopen = () => setStatus('connected');
      es.onmessage = (e) => {
        let m: LiveMessage;
        try { m = JSON.parse(e.data) as LiveMessage; } catch { return; }
        if (last.current && m.seq === last.current.seq) return; // replay after a reconnect
        setPrev(last.current);
        last.current = m;
        setMsg(m);
      };
      es.onerror = () => { es?.close(); es = null; setStatus('lost'); timer = setTimeout(connect, 1500); };
    };
    connect();
    return () => { stopped = true; clearTimeout(timer); es?.close(); };
  }, [enabled]);

  return { status, msg, prev, port };
}
