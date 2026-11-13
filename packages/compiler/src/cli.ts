import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from './compile';
import type { Graph } from './types';

const [, , input, flag, out = 'out'] = process.argv;
if (!input) { console.error('usage: cli <canvas.json> [-o dir]'); process.exit(2); }
const res = compile(JSON.parse(readFileSync(input, 'utf8')) as Graph);
for (const d of res.diagnostics) console.error(`${d.severity.toUpperCase()} ${d.nodeId ?? ''} ${d.message}`);
if (!res.ok) process.exit(1);
if (flag === '-o') {
  mkdirSync(out, { recursive: true });
  for (const f of res.files) writeFileSync(join(out, f.path), f.content);
  console.log(`wrote ${res.files.length} files to ${out}`);
} else for (const f of res.files) console.log(`# ── ${f.path}\n${f.content}`);
