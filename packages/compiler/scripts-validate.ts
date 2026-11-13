// Compile every starter template and run `terraform init/validate` on it.
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile, TEMPLATES } from './src';

const only = process.argv[2];
let failed = 0;
for (const t of TEMPLATES.filter((x) => !only || x.id === only)) {
  const dir = join('/tmp/cc-validate', t.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const r = compile(t.build({ name: 'demo', squad: 'platform', environment: 'dev', region: 'ap-southeast-1' }));
  const errs = r.diagnostics.filter((d) => d.severity === 'error');
  if (errs.length) { console.log(`✗ ${t.id}: compile errors`, errs.map((d) => d.message)); failed++; continue; }
  for (const f of r.files) writeFileSync(join(dir, f.path), f.content);
  try {
    execSync('terraform init -backend=false -input=false -no-color && terraform validate -no-color && terraform fmt -check -no-color', { cwd: dir, stdio: 'pipe' });
    const w = r.diagnostics.filter((d) => d.severity === 'warning').map((d) => d.message);
    console.log(`✓ ${t.id}${w.length ? '  (warnings: ' + w.join('; ') + ')' : ''}`);
  } catch (e) {
    failed++;
    const err = e as { stdout?: Buffer; stderr?: Buffer };
    console.log(`✗ ${t.id}\n${err.stdout?.toString() ?? ''}${err.stderr?.toString() ?? ''}`);
  }
}
process.exit(failed ? 1 : 0);
