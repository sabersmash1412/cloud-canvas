import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Rule } from '@cloudcanvas/compiler';

export interface LoadedRules { rules: Rule[]; loaded: boolean; source: string }

const DEFAULT = fileURLToPath(new URL('../../compiler/private/rules/index.ts', import.meta.url));

/**
 * The compliance rules are private and live in a git-ignored folder. Load them when present;
 * otherwise say so plainly (callers must report "compliance not checked", never silently pass).
 * `CLOUD_CANVAS_RULES` can point at another rules module.
 */
export async function loadRules(path = process.env.CLOUD_CANVAS_RULES ?? DEFAULT): Promise<LoadedRules> {
  if (!existsSync(path)) return { rules: [], loaded: false, source: 'not found' };
  try {
    const mod = (await import(path)) as { RULES?: Rule[] };
    const rules = Array.isArray(mod.RULES) ? mod.RULES : [];
    return { rules, loaded: rules.length > 0, source: rules.length ? 'loaded' : 'module has no RULES' };
  } catch (e) {
    return { rules: [], loaded: false, source: `failed to load: ${(e as Error).message.split('\n')[0]}` };
  }
}
