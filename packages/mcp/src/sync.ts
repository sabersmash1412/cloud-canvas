import { watch, readdirSync, readFileSync, statSync, existsSync, type FSWatcher } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { importTerraform, type HclParser, type Graph, type TfFile } from '@cloudcanvas/compiler';

/** Read the .tf / .tfvars files directly inside a folder. Never follows into other folders. */
export function readTerraformFolder(dir: string): TfFile[] {
  const out: TfFile[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!/\.(tf|tfvars)$/.test(name)) continue;
    const p = join(dir, name);
    try { if (statSync(p).isFile()) out.push({ path: name, content: readFileSync(p, 'utf8') }); } catch { /* file vanished mid-read */ }
  }
  return out;
}

export interface SyncOutcome { graph: Graph | null; files: number; coverage: number; unmanaged: number; error?: string }

export async function importFolder(dir: string, parse: HclParser, name?: string): Promise<SyncOutcome> {
  let files: TfFile[];
  try { files = readTerraformFolder(dir); } catch (e) { return { graph: null, files: 0, coverage: 0, unmanaged: 0, error: `Cannot read ${dir}: ${(e as Error).message}` }; }
  if (!files.some((f) => f.path.endsWith('.tf'))) return { graph: null, files: files.length, coverage: 0, unmanaged: 0, error: `No .tf files found in ${dir}.` };
  const r = await importTerraform(files, { parse, name });
  const err = r.report.notes.find((n) => n.severity === 'error');
  if (!r.graph.nodes.length) return { graph: null, files: files.length, coverage: r.report.coverage, unmanaged: r.report.unmanaged.length, error: err?.message ?? 'Nothing in these files could be read as an architecture.' };
  return { graph: r.graph, files: files.length, coverage: r.report.coverage, unmanaged: r.report.unmanaged.length };
}

export const resolveFolder = (dir: string, base = process.cwd()) => {
  if (!dir || dir.includes('\0')) throw new Error('folder is empty or invalid.');
  const p = isAbsolute(dir) ? dir : resolve(base, dir);
  if (!existsSync(p) || !statSync(p).isDirectory()) throw new Error(`Folder not found: ${p}`);
  return p;
};

export interface Watch { folder: string; stop(): void }

/** Re-import the folder whenever a Terraform file changes (debounced so a multi-file write is one update). */
export function watchFolder(folder: string, onChange: () => void, debounceMs = 250): Watch {
  let timer: NodeJS.Timeout | undefined;
  let w: FSWatcher | undefined;
  try {
    w = watch(folder, { persistent: false }, (_e, file) => {
      if (file && !/\.(tf|tfvars)$/.test(String(file))) return;
      clearTimeout(timer);
      timer = setTimeout(onChange, debounceMs);
    });
    w.on('error', () => { /* folder removed: stop quietly */ });
  } catch { /* watching is best-effort; the tool still imports once */ }
  return { folder, stop: () => { clearTimeout(timer); w?.close(); } };
}
