import type { Rule } from '@cloudcanvas/compiler';

/**
 * Compliance rules are private and loaded only if present on this machine.
 * Without them the app works normally and the Compliance tab explains that no rules are loaded.
 */
const mods = import.meta.glob('../../../packages/compiler/private/rules/index.ts', { eager: true }) as Record<string, { RULES?: Rule[] }>;
export const RULES: Rule[] = Object.values(mods).flatMap((m) => m.RULES ?? []);
export const RULES_LOADED = RULES.length > 0;
