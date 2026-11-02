/**
 * Host controller for preset-scoped recall companions.
 *
 * The bundle no longer registers `recall`, `search`, or `/recall` in the
 * Host-global layers. This row owns the durable target state (a volatile
 * `presets` list served as the `compaction-instant-preset-tools` settings
 * form) and reconciles it against the composition each live Agent actually
 * runs, using the existing Agent-scope registration APIs:
 *
 * - `ctx.agents.list()` / `get(id)` cover Agents that already existed before
 *   this row mounted, plus the target of a preset-selection event.
 * - `agentPresets.composedPreset(agent.ctx)` reads the preset an Agent is
 *   really bound to, never a display name or an event payload.
 * - `agent/created` / `agent/disposed` cover future Agents and their cleanup.
 * - `agent.ctx.tools.register()` and `agent.ctx.commands.register()` install
 *   the two model tools and the human command into the nearest Agent scope,
 *   which shadows the Host layer for that Agent only.
 *
 * The preset list is a target-state filter, not a preset edit: nothing here
 * writes a preset YAML document or changes a preset revision. Register and
 * unregister are synchronous registry mutations, so they change the next
 * schema assembly; they never rewrite an in-flight request and never cancel a
 * call that already started.
 * @module dsh-compaction-instant/preset-tools
 */
import z from "@deepseek-ai/schemastery";
import { defineRecallCommand, resolveConfig as resolveCommandConfig } from "./command.js";
import { defineRecallTool, defineSearchTool, resolveConfig as resolveToolConfig } from "./tool.js";

/** Plugin row name as the bundle patch declares it. */
export const name = "compaction-instant-preset-tools";

/** Services the controller needs before it can reconcile at all. */
export const inject = ["agents", "agentPresets", "tools", "commands"];

/** Settings form namespace serving the enabled-preset list (the composition row id). */
export const SETTINGS_NAMESPACE = "compaction-instant-preset-tools";

/**
 * Enabled preset ids. The schema is volatile, so DSH serves it as a settings
 * form and a saved edit persists into the profile patch. An absent field
 * resolves to the empty list: after an upgrade no Agent gains the companions
 * until a user selects its preset explicitly.
 */
export const Config = z.object({
  presets: z.array(z.string()).volatile()
});

/** Global symbol the shared volatile-reference protocol uses. */
const VOLATILE_WRITE = Symbol.for("cosmokit.volatile.write");

/**
 * Unwrap a volatile Config cell (and any nesting of them) into its plain
 * value. Schemastery turns a `volatile()` field into a live reference inside
 * the resolved composition config, while the settings plane already serves
 * plain values, so both sources pass through here.
 * @param value - raw config field, volatile reference, or plain value.
 * @returns the plain value, or undefined for a cyclic/absent reference.
 */
function plainValue(value) {
  let current = value;
  const seen = new Set();
  while (current !== null && typeof current === "object" && !Array.isArray(current) && VOLATILE_WRITE in current && typeof current.get === "function") {
    if (seen.has(current)) return undefined;
    seen.add(current);
    current = current.get();
  }
  return current;
}

/**
 * Validate and normalize the enabled-preset list.
 *
 * Duplicate ids collapse, and an empty id never matches a composition. Every
 * other id is kept verbatim: an id the roster no longer declares simply never
 * matches, and the stored configuration is never rewritten behind the user's
 * back.
 * @param config - resolved plugin configuration or the plain settings section.
 * @returns `{ presets }` with unique, non-empty preset ids.
 */
export function resolveConfig(config = {}) {
  const source = config === null || typeof config !== "object" ? {} : config;
  const raw = plainValue(source.presets);
  const presets = raw === undefined || raw === null ? [] : raw;
  if (!Array.isArray(presets)) throw new Error("PresetToolsConfig: presets must be an array of preset ids");
  const seen = new Set();
  const ids = [];
  for (const entry of presets) {
    if (typeof entry !== "string") throw new Error("PresetToolsConfig: presets must contain only preset ids");
    if (entry === "" || seen.has(entry)) continue;
    seen.add(entry);
    ids.push(entry);
  }
  return { presets: ids };
}

/**
 * Read the enabled-preset list off the settings plane.
 *
 * The served section is authoritative while the row exists: a write persists
 * first and remounts this row afterwards, so the section is never staler than
 * the composition entry. Nothing is served when the row is disabled or the
 * deployment has no settings service; the caller then keeps the composition
 * config.
 * @param settings - optional settings service.
 * @returns the normalized list, or undefined when this row serves no section.
 */
export function readServedPresets(settings) {
  if (settings === null || typeof settings !== "object" || typeof settings.describe !== "function") return undefined;
  let rows;
  try {
    rows = settings.describe();
  } catch {
    return undefined;
  }
  if (!Array.isArray(rows)) return undefined;
  const row = rows.find((entry) => entry !== null && typeof entry === "object" && entry.ns === SETTINGS_NAMESPACE);
  if (row === undefined) return undefined;
  const value = row.value;
  const section = value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
  try {
    return resolveConfig({ presets: section.presets }).presets;
  } catch {
    return undefined;
  }
}

/** Cordis fiber state of a fully activated, registration-accepting context. */
const FIBER_ACTIVE = 2;

/**
 * Mount the bidirectional preset controller.
 *
 * Reconciliation is a pure function of the enabled list and each Agent's
 * composed preset: identical inputs are a no-op, so repeated events, repeated
 * selection notifications, and settings writes that concern other namespaces
 * cannot churn the tool catalog.
 * @param ctx - Host context carrying agents, agentPresets, tools, and commands.
 * @param config - composition config (a volatile `presets` cell when the row declares one).
 */
export function apply(ctx, config) {
  const composition = resolveConfig(config);
  const toolConfig = resolveToolConfig({});
  const commandConfig = resolveCommandConfig({});
  /** Agents whose companions this controller currently owns. */
  const records = new Map();
  /** Agents whose deferred activation retry is in flight. */
  const pending = new Set();
  /** Whether this controller instance has been torn down. */
  let disposed = false;
  /** Live settings service, when the deployment composes one. */
  let settings;
  /** Re-entrancy guard: settings reads may themselves notify document updates. */
  let coordinating = false;

  const warn = (message) => {
    try {
      ctx.logger.warn(message);
    } catch {
      // Logging must never fail a lifecycle listener.
    }
  };

  const contextOf = (agent) => agent !== null && typeof agent === "object" ? agent.ctx : undefined;

  /** Read the preset an Agent is actually composed from. */
  const presetOf = (agent) => {
    const agentCtx = contextOf(agent);
    if (agentCtx === undefined) return null;
    try {
      const preset = ctx.agentPresets.composedPreset(agentCtx);
      return typeof preset === "string" && preset !== "" ? preset : null;
    } catch (error) {
      warn(`compaction-instant: cannot read the preset of a live agent: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };

  const currentPresets = () => {
    const served = readServedPresets(settings);
    return served === undefined ? composition.presets : served;
  };

  /**
   * Whether an Agent scope can accept durable registrations right now.
   * Cordis fiber state 2 is an active scope; anything else is still mounting
   * or already unloading.
   */
  const isAgentScopeActive = (agentCtx) => {
    const fiber = agentCtx === null || typeof agentCtx !== "object" ? undefined : agentCtx.fiber;
    return fiber === undefined || fiber.state === FIBER_ACTIVE;
  };

  /** Retry one Agent once its scope fiber settles, without registering twice. */
  const deferUntilActive = (agent, agentCtx) => {
    if (pending.has(agent)) return;
    pending.add(agent);
    const fiber = agentCtx.fiber;
    const settled = fiber !== undefined && typeof fiber.await === "function" ? fiber.await() : Promise.resolve();
    Promise.resolve(settled).then(() => {
      pending.delete(agent);
      if (disposed) return;
      try {
        reconcileAgent(agent);
      } catch (error) {
        warn(`compaction-instant: deferred preset reconciliation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, (error) => {
      pending.delete(agent);
      warn(`compaction-instant: agent scope did not activate: ${error instanceof Error ? error.message : String(error)}`);
    });
  };

  /** Release every remainder even when one disposer throws. */
  const releaseDisposers = (disposers) => {
    for (let index = disposers.length - 1; index >= 0; index -= 1) {
      try {
        disposers[index]();
      } catch (error) {
        warn(`compaction-instant: a recall companion disposer failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };

  /** Drop one Agent's record and every registration it owns. */
  const release = (agent) => {
    const record = records.get(agent);
    if (record === undefined) return false;
    records.delete(agent);
    releaseDisposers(record.disposers);
    return true;
  };

  /** Register the three companions transactionally in the Agent scope. */
  const register = (agent, presetId) => {
    const agentCtx = contextOf(agent);
    if (agentCtx === undefined) return false;
    // A scope fiber that is still mounting accepts effects into a
    // pre-activation epoch and drops them when it commits, so defer this one
    // Agent instead of silently claiming a registration that cannot hold.
    if (!isAgentScopeActive(agentCtx)) {
      deferUntilActive(agent, agentCtx);
      return false;
    }
    const disposers = [];
    try {
      disposers.push(agentCtx.tools.register(defineRecallTool(toolConfig)));
      disposers.push(agentCtx.tools.register(defineSearchTool(toolConfig)));
      disposers.push(agentCtx.commands.register(defineRecallCommand(commandConfig)));
    } catch (error) {
      releaseDisposers(disposers);
      warn(`compaction-instant: could not register recall companions on preset "${presetId}" (session ${String(agent.id)}): ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
    records.set(agent, { presetId, registered: true, disposers });
    return true;
  };

  /** Bring one Agent's registration in line with the enabled list. */
  const reconcileAgent = (agent, presets = currentPresets()) => {
    if (agent === null || typeof agent !== "object") return;
    // A deferred activation retry owns this Agent until it settles.
    if (pending.has(agent)) return;
    const presetId = presetOf(agent);
    const desired = presetId !== null && presets.includes(presetId);
    const record = records.get(agent);
    if (!desired) {
      if (record !== undefined) release(agent);
      return;
    }
    if (record !== undefined) {
      record.presetId = presetId;
      return;
    }
    register(agent, presetId);
  };

  /** Reconcile every live Agent and drop records for Agents that left. */
  const reconcileAll = () => {
    if (coordinating) return;
    coordinating = true;
    try {
      const presets = currentPresets();
      let live;
      try {
        live = new Set(ctx.agents.list());
      } catch (error) {
        warn(`compaction-instant: cannot enumerate live agents: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      for (const agent of Array.from(records.keys())) {
        if (!live.has(agent)) release(agent);
      }
      for (const agent of live) {
        try {
          reconcileAgent(agent, presets);
        } catch (error) {
          warn(`compaction-instant: preset reconciliation failed for one agent: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } finally {
      coordinating = false;
    }
  };

  const releaseAll = () => {
    pending.clear();
    for (const agent of Array.from(records.keys())) release(agent);
  };

  // Lifecycle listeners. Every failure is contained: a companion problem must
  // never fail an Agent creation, a preset switch, or an unrelated settings
  // write.
  const stopCreated = ctx.on("agent/created", ({ agent }) => {
    try {
      reconcileAgent(agent);
    } catch (error) {
      warn(`compaction-instant: agent/created reconciliation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  const stopDisposed = ctx.on("agent/disposed", ({ agent }) => {
    try {
      release(agent);
    } catch (error) {
      warn(`compaction-instant: agent/disposed cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  const stopSelected = ctx.on("agent-preset/selected", (sessionId) => {
    try {
      const agent = ctx.agents.get(sessionId);
      if (agent !== undefined) reconcileAgent(agent);
    } catch (error) {
      warn(`compaction-instant: preset selection reconciliation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  // Settings follow is optional: without a settings service the composition
  // config above remains the whole target state.
  ctx.inject(["settings"], (scoped) => {
    settings = scoped.settings;
    const stopSettings = scoped.on("settings/document-updated", (namespace) => {
      if (namespace !== SETTINGS_NAMESPACE) return;
      try {
        reconcileAll();
      } catch (error) {
        warn(`compaction-instant: settings reconciliation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    scoped.effect(() => () => {
      stopSettings();
      settings = undefined;
    }, "compaction-instant: preset tools settings follow");
  });

  // Startup covers Agents that existed before this row mounted (cold sessions
  // resumed by the Host, or a reload that kept them alive); teardown releases
  // every registration this instance still holds, because a controller unload
  // can happen while its Agents live on.
  ctx.effect(() => {
    reconcileAll();
    return () => {
      disposed = true;
      stopCreated();
      stopDisposed();
      stopSelected();
      releaseAll();
    };
  }, "compaction-instant: preset companion registrations");
}
