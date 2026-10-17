/**
 * Settings bridge of dsh-compaction-instant: a top-level composition row whose
 * whole Config schema is volatile, so DSH 0.1.7's settings plane
 * (`@deepseek-ai/dsh-settings` SettingsForms) serves it as the
 * `compaction-instant` form namespace and persists user edits into the
 * profile patch without remounting this plugin.
 *
 * The bridge holds values only; it never reads its own config. Every mounted
 * instant engine watches the served form (settings/document-updated) and
 * overlays the user layer on its own composition entry — see
 * `InstantCompactionEngine` in `./index.js`. Fields left unset inherit the
 * engine/composition defaults, so a fresh row exposes an empty (all-inherit)
 * section.
 *
 * Field constraints mirror the engine's SETTINGS_SCHEMA exactly; the engine
 * revalidates every merged value and falls back to composition-only with a
 * warning when a stored section is incompatible with its preset entry.
 */
import z from "@deepseek-ai/schemastery";

/** Plugin row name as the bundle patch declares it. */
export const name = "compaction-instant-settings";

/** Settings form namespace serving the user layer (the composition row id). */
export const SETTINGS_NAMESPACE = "compaction-instant";

/**
 * User-editable instant-compaction preferences, all volatile so writes apply
 * live. Exactly one retention mode should be set; when a stored section
 * carries both, the engine-side merge prefers `retainRatio`.
 */
export const Config = z.object({
  /** Total compiler-token budget for one checkpoint (engine default 65536). */
  checkpointCap: z.number().step(1).min(1).volatile(),
  /** Automatic between-step compaction; off means manual /compact only. */
  auto: z.boolean().volatile(),
  /** Context-window fraction that triggers automatic compaction (default 0.5). */
  thresholdRatio: z.number().min(0).max(1).volatile(),
  /** Preferred complete recent turns kept verbatim (default 1). */
  retainTurns: z.number().step(1).min(1).volatile(),
  /** Ratio retention mode: derive the retained ceiling from the context window. */
  retainRatio: z.number().min(0).max(1).volatile(),
  /** Fixed retention mode: hard retained-region token ceiling (default 5120). */
  retainTokens: z.number().step(1).min(0).volatile()
});

/** The bridge only carries configuration; there is nothing to mount. */
export function apply() {}
