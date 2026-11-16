import { mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, normalize, resolve, sep } from 'node:path';

export const OUTPUT_FILES = ['main.tf', 'versions.tf', 'azure-pipelines.yml', 'canvas.json'] as const;

/**
 * Write the four generated files into `dir`. The only filenames ever written are fixed, `..` is refused,
 * and nothing outside the target folder is touched. Returns the absolute paths written.
 */
export function writeOutputs(dir: string, files: Record<string, string>, base = process.cwd()): string[] {
  if (typeof dir !== 'string' || !dir.trim()) throw new Error('outputDir is empty.');
  if (dir.includes('\0')) throw new Error('outputDir contains an invalid character.');
  if (normalize(dir).split(sep).includes('..') || dir.split('/').includes('..')) throw new Error('outputDir must not contain "..".');
  const target = isAbsolute(dir) ? normalize(dir) : resolve(base, dir);
  mkdirSync(target, { recursive: true });
  const written: string[] = [];
  for (const name of OUTPUT_FILES) {
    const content = files[name];
    if (content === undefined) continue;
    const p = join(target, name);
    writeFileSync(p, content);
    written.push(p);
  }
  return written;
}
