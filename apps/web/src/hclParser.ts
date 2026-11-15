import type { HclParser } from '@cloudcanvas/compiler';

/**
 * Browser loader for the HCL parser (HashiCorp's Go parser compiled to WebAssembly, via @cdktf/hcl2json).
 * The npm package's own loader needs Node's fs, so we fetch the same .wasm and drive its Go runtime ourselves.
 */
let ready: Promise<Record<string, (...a: unknown[]) => void>> | null = null;

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
}

async function boot() {
  await loadScript('/wasm/wasm_exec.js');
  const res = await fetch('/wasm/hcl2json.wasm.bin');
  if (!res.ok) throw new Error('Could not download the Terraform parser');
  let bytes = new Uint8Array(await res.arrayBuffer());
  // The file is stored gzipped (1.7 MB instead of 6.5 MB). Some servers also decompress it in transit, so check the magic bytes.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  const g = globalThis as unknown as Record<string, any>;
  g.global ??= globalThis; // the Go module looks its callback object up through Node's `global`
  const go = new g.Go();
  const root: Record<string, (...a: unknown[]) => void> = {};
  g.__parse_terraform_config_wasm__ = root;
  const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
  void go.run(instance);
  // the Go side registers `parse` shortly after it starts running
  for (let i = 0; i < 200 && typeof root.parse !== 'function'; i++) await new Promise((r) => setTimeout(r, 10));
  if (typeof root.parse !== 'function') throw new Error('The Terraform parser did not start');
  return root;
}

export const parseHcl: HclParser = async (file, text) => {
  ready ??= boot().catch((e) => { ready = null; throw e; });
  const root = await ready;
  const out: string = await new Promise((resolve, reject) => root.parse(file, text, (err: unknown, msg: string) => (err ? reject(new Error(String(err))) : resolve(msg))));
  return JSON.parse(out);
};
