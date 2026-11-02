/**
 * Host controller for preset-scoped recall companions: a volatile enabled
 * preset list served as the `compaction-instant-preset-tools` settings form,
 * reconciled onto each live Agent's own scope.
 * @module dsh-compaction-instant/preset-tools
 */
import type { Context } from "@deepseek-ai/cordis";
import type z from "@deepseek-ai/schemastery";

/** Plugin row name as the bundle patch declares it. */
export const name: "compaction-instant-preset-tools";

/** Services the controller needs before it can reconcile at all. */
export declare const inject: string[];

/** Settings form namespace serving the enabled-preset list (the composition row id). */
export const SETTINGS_NAMESPACE: "compaction-instant-preset-tools";

/** Enabled preset ids as a live settings-form section. */
export interface PresetToolsConfig {
  /** Presets whose live Agents receive `recall`, `search`, and `/recall`. Default empty. */
  presets?: string[];
}

/**
 * Volatile form schema: `presets` is the whole served section, and an absent
 * field resolves to the empty list.
 */
export const Config: z<{ presets?: unknown }>;

/** Validate and normalize the enabled-preset list (unique, non-empty ids). */
export declare function resolveConfig(config?: PresetToolsConfig | Record<string, unknown>): { presets: string[] };

/** Read the served section off the settings plane, or undefined when it is not served. */
export declare function readServedPresets(settings: unknown): string[] | undefined;

/** Mount the bidirectional preset controller. */
export declare function apply(ctx: Context, config?: PresetToolsConfig | Record<string, unknown>): void;
