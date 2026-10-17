/**
 * Settings bridge of dsh-compaction-instant: a top-level composition row whose
 * volatile Config schema DSH 0.1.7's settings plane serves as the
 * `compaction-instant` form namespace. The bridge carries the user layer
 * only; mounted engines overlay it on their composition entries.
 * @module dsh-compaction-instant/settings
 */
import type { Context } from "@deepseek-ai/cordis";
import type z from "@deepseek-ai/schemastery";

/** Plugin row name as the bundle patch declares it. */
export const name: "compaction-instant-settings";

/** Settings form namespace serving the user layer (the composition row id). */
export const SETTINGS_NAMESPACE: "compaction-instant";

/** User-editable instant-compaction preferences, all volatile. */
export interface InstantCompactionSettingsSection {
  /** Total compiler-token budget for one checkpoint (engine default 65536). */
  checkpointCap?: number;
  /** Automatic between-step compaction; off means manual /compact only. */
  auto?: boolean;
  /** Context-window fraction that triggers automatic compaction (default 0.5). */
  thresholdRatio?: number;
  /** Preferred complete recent turns kept verbatim (default 1). */
  retainTurns?: number;
  /** Ratio retention mode: derive the retained ceiling from the context window. */
  retainRatio?: number;
  /** Fixed retention mode: hard retained-region token ceiling (default 5120). */
  retainTokens?: number;
}

/** Sparse user overrides as served by the settings plane (Volatile cells Host-side). */
export type InstantCompactionSettingsConfig = {
  [K in keyof InstantCompactionSettingsSection]: unknown;
};

/**
 * Volatile form schema: field constraints mirror the engine's SETTINGS_SCHEMA
 * exactly; unset fields inherit engine/composition defaults.
 */
export const Config: z<InstantCompactionSettingsConfig>;

/** The bridge only carries configuration; there is nothing to mount. */
export function apply(ctx: Context, config: InstantCompactionSettingsConfig): void;
