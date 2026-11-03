/**
 * Host controller fixtures for preset-scoped recall companions.
 *
 * These tests drive a real Cordis Context, ToolRuntime, CommandRuntime, agent
 * scopes, and this package's real tool/command definitions through fake
 * `agents` / `agentPresets` services. They never touch a profile, the GUI, or
 * a model. The bi-directional contract they pin: an Agent receives `recall`,
 * `search`, and `/recall` exactly while its composed preset is enabled, and
 * loses them as soon as it is not.
 * @module dsh-compaction-instant/test/preset-tools
 */
import assert from "node:assert/strict";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import { CommandRuntime } from "@deepseek-ai/dsh-commands";
import { ToolCallId, createAssistantMessage, createUserMessage } from "@deepseek-ai/dsh-llm";
import { PtcRuntime } from "@deepseek-ai/dsh-ptc-runtime";
import { createScope } from "@deepseek-ai/dsh-scope";
import { Session } from "@deepseek-ai/dsh-session";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import * as NativeToolExecutor from "@deepseek-ai/dsh-tool-executor-native";
import * as PtcToolExecutor from "@deepseek-ai/dsh-tool-executor-ptc";
import ToolRuntime, { RUN_CODE_NAME } from "@deepseek-ai/dsh-tools";
import * as presetTools from "../src/preset-tools.js";

/** Settings namespace the controller serves. */
const NS = presetTools.SETTINGS_NAMESPACE;

/** Let pending microtasks and one macrotask run, covering scope activation. */
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

/** Programmable in-process PTC runtime; never executes real code. */
class FakeRuntime extends PtcRuntime {
  constructor(ctx) {
    super(ctx);
    this.language = "typescript";
  }
  language;
  isolation = "fake";
  behavior = () => Promise.resolve({ logs: [] });
  resolve(request) {
    return { ...request, cwd: request.cwd ?? process.cwd(), timeoutMs: request.timeoutMs ?? 120_000 };
  }
  run(request) {
    return this.behavior(request);
  }
}

/**
 * Build one isolated Host graph with fake Agent and preset registries.
 * @param options - tools mode, composition config, and optional settings service.
 * @returns the context, fake registries, and helpers driving the lifecycle.
 */
async function fixture(options = {}) {
  const ctx = new Context();
  const live = [];
  const byId = new Map();
  const composed = new Map();
  const presetRows = new Map();
  const agents = {
    list: () => live.slice(),
    get: (id) => byId.get(id)
  };
  let presetFailure;
  const agentPresets = {
    composedPreset(agentCtx) {
      if (presetFailure !== undefined) throw presetFailure;
      return composed.get(agentCtx);
    }
  };
  ctx.provide("agents", agents);
  ctx.provide("agentPresets", agentPresets);
  ctx.provide("workingDirectory", { ensure: async () => process.cwd() });
  if (options.settings !== undefined) ctx.provide("settings", options.settings);
  await ctx.plugin(SystemPrompt, {});
  await ctx.plugin(ToolRuntime, {});
  await ctx.plugin(CommandRuntime);
  // DSH 0.2.2 selects execution through executor plugins; the PTC executor
  // activates only after the runtime it injects.
  if (options.mode === "ptc") {
    await ctx.plugin(FakeRuntime);
    await ctx.plugin(PtcToolExecutor);
  } else {
    await ctx.plugin(NativeToolExecutor);
  }
  // A loop-like owner that declares the services an Agent scope resolves
  // through. It injects only `tools`, matching dsh-agent-loop: the Agent scope
  // answers `agent.ctx.tools` but refuses `agent.ctx.commands`, so the
  // controller must register the command through a command-injected child.
  let owner;
  await ctx.plugin({ name: "test-agent-owner", inject: ["tools"], apply(once) { owner = once; } });

  let changeCount = 0;
  ctx.on("tools/change", () => { changeCount += 1; });

  const mount = async (config) => {
    const fiber = ctx.plugin(presetTools, config);
    await fiber;
    await settle();
    return fiber;
  };

  const createAgent = async (id, preset, activate = true) => {
    const agent = { id };
    const scope = createScope(owner, agent);
    agent.ctx = scope.ctx;
    composed.set(scope.ctx, preset);
    live.push(agent);
    byId.set(id, agent);
    presetRows.set(id, preset);
    if (activate) await settle();
    return { agent, scope };
  };

  const announce = async (agent, source = "startup") => {
    await ctx.serial(ctx, "agent/created", { agent, source });
  };

  const disposeAgent = async (agent, scope) => {
    await scope.dispose();
    const index = live.indexOf(agent);
    if (index >= 0) live.splice(index, 1);
    byId.delete(agent.id);
    await ctx.serial(ctx, "agent/disposed", { agent });
  };

  const compose = (agent, preset) => {
    composed.set(agent.ctx, preset);
  };

  const select = async (agent, preset) => {
    composed.set(agent.ctx, preset);
    ctx.emit("agent-preset/selected", agent.id, preset);
    await settle();
  };

  const toolNames = (agent) => ctx.tools.schemas(agent).map((schema) => schema.name).sort();
  const commandNames = (agent) => ctx.commands.list(agent).map((descriptor) => descriptor.name);

  return {
    ctx,
    agents,
    agentPresets,
    owner,
    mount,
    createAgent,
    announce,
    disposeAgent,
    compose,
    select,
    toolNames,
    commandNames,
    changes: () => changeCount,
    failPresetRead(error) { presetFailure = error; }
  };
}

test("the default empty list leaves every Agent without companions", async () => {
  const fx = await fixture();
  try {
    await fx.mount({ presets: [] });
    const { agent } = await fx.createAgent("s-empty", "ptc");
    await fx.announce(agent);
    assert.deepEqual(fx.toolNames(agent), []);
    assert.deepEqual(fx.commandNames(agent), []);
    assert.equal(fx.ctx.tools.get("recall", agent), undefined);
    assert.equal(fx.ctx.tools.get("search", agent), undefined);
    assert.equal(fx.ctx.commands.find(agent, "recall"), undefined);
    // The Host-global layers stay untouched by this row.
    assert.equal(fx.ctx.tools.get("recall"), undefined);
    assert.deepEqual(fx.ctx.tools.schemas().map((schema) => schema.name), []);
  } finally {
    await fx.ctx.fiber.dispose();
  }
});

test("enabling one preset registers exactly on that Agent", async () => {
  const fx = await fixture();
  try {
    await fx.mount({ presets: ["ptc"] });
    const { agent: target } = await fx.createAgent("s-target", "ptc");
    const { agent: control } = await fx.createAgent("s-control", "standard");
    await fx.announce(target);
    await fx.announce(control);
    assert.deepEqual(fx.toolNames(target), ["recall", "search"]);
    assert.deepEqual(fx.commandNames(target), ["recall"]);
    assert.deepEqual(fx.toolNames(control), []);
    assert.deepEqual(fx.commandNames(control), []);
    // A preset id that is enabled but not composed by any Agent registers nothing.
    assert.deepEqual(fx.ctx.tools.schemas().map((schema) => schema.name), []);
  } finally {
    await fx.ctx.fiber.dispose();
  }
});

test("startup covers Agents that already existed, and newly created ones follow", async () => {
  const fx = await fixture();
  try {
    const { agent: existing } = await fx.createAgent("s-existing", "ptc");
    await fx.mount({ presets: ["ptc"] });
    assert.deepEqual(fx.toolNames(existing), ["recall", "search"], "startup reconcile covers live Agents");
    assert.deepEqual(fx.commandNames(existing), ["recall"]);
    const { agent: future } = await fx.createAgent("s-future", "ptc");
    assert.deepEqual(fx.toolNames(future), [], "a created scope stays empty until agent/created");
    await fx.announce(future);
    assert.deepEqual(fx.toolNames(future), ["recall", "search"]);
  } finally {
    await fx.ctx.fiber.dispose();
  }
});

test("a scope that is still activating is reconciled when it commits", async () => {
  const fx = await fixture();
  try {
    await fx.mount({ presets: ["ptc"] });
    const { agent } = await fx.createAgent("s-window", "ptc", false);
    assert.deepEqual(fx.toolNames(agent), [], "a mounting scope holds nothing before the notification");
    await fx.announce(agent);
    await settle();
    assert.deepEqual(fx.toolNames(agent), ["recall", "search"], "the deferred retry registers after activation");
    assert.deepEqual(fx.commandNames(agent), ["recall"]);
  } finally {
    await fx.ctx.fiber.dispose();
  }
});

test("the served section is authoritative and disabling releases the live Agent", async () => {
  const settings = {
    value: { presets: ["ptc"] },
    describe() {
      return [{ ns: NS, value: this.value }];
    }
  };
  const fx = await fixture({ settings });
  try {
    // The composition declares nothing; the served section enables the preset.
    await fx.mount({ presets: [] });
    const { agent } = await fx.createAgent("s-live", "ptc");
    await fx.announce(agent);
    assert.deepEqual(fx.toolNames(agent), ["recall", "search"], "the served section wins over the composition");
    assert.deepEqual(fx.commandNames(agent), ["recall"]);

    settings.value = { presets: [] };
    fx.ctx.emit("settings/document-updated", NS, 2);
    await settle();
    assert.deepEqual(fx.toolNames(agent), [], "disabling releases the registration");
    assert.deepEqual(fx.commandNames(agent), []);
    assert.equal(fx.ctx.tools.get("search", agent), undefined, "lookup sees the released tool as absent");
    const releasedBatch = await fx.ctx.tools.execute({
      signal: new AbortController().signal,
      calls: [{
        type: "tool-call",
        id: ToolCallId("released-call"),
        name: "recall",
        arguments: JSON.stringify({ type: "seq", id: "0" })
      }],
      agent
    });
    const refused = releasedBatch.results[0].result;
    assert.equal(refused.isError, true, "execution is refused after release");
    assert.equal(refused.error?.info?.code ?? refused.error?.code, "UNKNOWN_TOOL");
  } finally {
    await fx.ctx.fiber.dispose();
  }
});

test("a preset switch follows the composed preset, not the event payload", async () => {
  const fx = await fixture();
  try {
    await fx.mount({ presets: ["ptc"] });
    const { agent } = await fx.createAgent("s-switch", "ptc");
    await fx.announce(agent);
    assert.deepEqual(fx.toolNames(agent), ["recall", "search"]);

    // Leave the enabled preset while the event payload claims otherwise.
    await fx.select(agent, "standard");
    assert.deepEqual(fx.toolNames(agent), [], "the composed preset wins over the payload");
    assert.deepEqual(fx.commandNames(agent), []);

    // Enter it again; the payload lies in the other direction.
    fx.compose(agent, "ptc");
    fx.ctx.emit("agent-preset/selected", agent.id, "standard");
    await settle();
    assert.deepEqual(fx.toolNames(agent), ["recall", "search"]);
  } finally {
    await fx.ctx.fiber.dispose();
  }
});

test("unrelated settings writes and repeated events keep the catalog identical", async () => {
  const fx = await fixture();
  try {
    await fx.mount({ presets: ["ptc"] });
    const { agent } = await fx.createAgent("s-idempotent", "ptc");
    await fx.announce(agent);
    const recall = fx.ctx.tools.get("recall", agent);
    const search = fx.ctx.tools.get("search", agent);
    const command = fx.ctx.commands.find(agent, "recall");
    const changes = fx.changes();
    assert.equal(changes, 2, "one tools/change per tool registration");

    fx.ctx.emit("settings/document-updated", "another-namespace", 9);
    await settle();
    await fx.announce(agent);
    await fx.announce(agent, "resume");
    await fx.select(agent, "ptc");
    assert.equal(fx.changes(), changes, "no re-registration on no-op reconciles");
    assert.equal(fx.ctx.tools.get("recall", agent), recall, "definition identity is stable");
    assert.equal(fx.ctx.tools.get("search", agent), search);
    assert.equal(fx.ctx.commands.find(agent, "recall"), command);
  } finally {
    await fx.ctx.fiber.dispose();
  }
});

test("a partial registration failure rolls back and never blocks Agent creation", async () => {
  const fx = await fixture();
  try {
    await fx.mount({ presets: ["ptc"] });
    const { agent } = await fx.createAgent("s-conflict", "ptc");
    // A statically composed /recall already owns the command name in this
    // Agent scope, so the third registration fails after two succeeded.
    agent.ctx.plugin({
      name: "static-recall",
      inject: ["commands"],
      apply(ctx) {
        ctx.commands.register({ name: "recall", description: "static", handler: () => ({ kind: "success", text: "ok" }) });
      }
    });
    await settle();
    await fx.announce(agent);
    assert.deepEqual(fx.toolNames(agent), [], "the two created tools were rolled back");
    assert.deepEqual(fx.commandNames(agent), ["recall"], "the pre-existing command survives");
  } finally {
    await fx.ctx.fiber.dispose();
  }
});

test("an Agent disposal drops the record and its registrations", async () => {
  const fx = await fixture();
  try {
    await fx.mount({ presets: ["ptc"] });
    const { agent, scope } = await fx.createAgent("s-dispose", "ptc");
    await fx.announce(agent);
    assert.deepEqual(fx.toolNames(agent), ["recall", "search"]);
    await fx.disposeAgent(agent, scope);
    assert.deepEqual(fx.ctx.tools.schemas(agent), [], "scope unwind removes the registrations");
    // A second disposal notification is idempotent.
    await fx.ctx.serial(fx.ctx, "agent/disposed", { agent });
  } finally {
    await fx.ctx.fiber.dispose();
  }
});

test("controller unload releases every live Agent and stops responding", async () => {
  const fx = await fixture();
  try {
    const fiber = await fx.mount({ presets: ["ptc"] });
    const { agent } = await fx.createAgent("s-unload", "ptc");
    await fx.announce(agent);
    assert.deepEqual(fx.toolNames(agent), ["recall", "search"]);
    await fiber.dispose();
    assert.deepEqual(fx.toolNames(agent), [], "the Agent keeps living without its companions");
    assert.deepEqual(fx.commandNames(agent), []);
    const { agent: late } = await fx.createAgent("s-late", "ptc");
    await fx.announce(late);
    assert.deepEqual(fx.toolNames(late), [], "no listener survives the unload");
  } finally {
    await fx.ctx.fiber.dispose();
  }
});

test("empty and unknown ids neither register nor throw", async () => {
  const fx = await fixture();
  try {
    assert.deepEqual(presetTools.resolveConfig({ presets: ["", "ptc", "ptc", "ghost"] }), { presets: ["ptc", "ghost"] });
    assert.deepEqual(presetTools.resolveConfig({}), { presets: [] });
    assert.throws(() => presetTools.resolveConfig({ presets: "ptc" }), /must be an array/u);
    assert.throws(() => presetTools.resolveConfig({ presets: [1] }), /only preset ids/u);
    // The composition config arrives as a schemastery volatile cell; the
    // settings plane serves the same list as a plain array.
    const write = Symbol.for("cosmokit.volatile.write");
    const cell = { get: () => ["ptc", "ptc"], [write]: () => {} };
    assert.deepEqual(presetTools.resolveConfig({ presets: cell }), { presets: ["ptc"] });
    const served = { describe: () => [{ ns: NS, value: { presets: ["ptc", "standard"] } }] };
    assert.deepEqual(presetTools.readServedPresets(served), ["ptc", "standard"]);
    assert.equal(presetTools.readServedPresets({ describe: () => [] }), undefined, "an unserved row falls back to the composition");
    assert.equal(presetTools.readServedPresets(undefined), undefined);
    assert.equal(presetTools.readServedPresets({ describe: () => { throw new Error("offline"); } }), undefined);
    await fx.mount({ presets: ["", "ghost"] });
    const { agent } = await fx.createAgent("s-ghost", "ptc");
    await fx.announce(agent);
    assert.deepEqual(fx.toolNames(agent), []);
    // A failing preset read is contained and registers nothing.
    fx.failPresetRead(new Error("registry unavailable"));
    const { agent: failing } = await fx.createAgent("s-failing", "ptc");
    await fx.announce(failing);
    assert.deepEqual(fx.toolNames(failing), []);
  } finally {
    await fx.ctx.fiber.dispose();
  }
});

test("a PTC target scope binds search and recall into run_code", async () => {
  const fx = await fixture({ mode: "ptc" });
  try {
    await fx.mount({ presets: ["ptc"] });
    const { agent } = await fx.createAgent("s-ptc", "ptc");
    const { agent: control } = await fx.createAgent("s-ptc-control", "standard");
    const session = Session.create("ptc-session", []);
    agent.session = session;
    control.session = Session.create("ptc-control-session", []);
    session.append("user/message", createUserMessage({
      content: [{ type: "text", text: "alpha marker content" }],
      source: { kind: "user" }
    }), { surfaceOp: "append" });
    await fx.announce(agent);
    await fx.announce(control);

    // The registry reports registered capabilities only; run_code is owned by
    // the executor and shows up in the assembled model tool list instead.
    const names = fx.ctx.tools.schemas(agent).map((schema) => schema.name).sort();
    assert.deepEqual(names, ["recall", "search"]);
    assert.deepEqual(fx.ctx.tools.schemas(control).map((schema) => schema.name), [], "the control Agent registers no companion tools");

    const code = [
      "const found = await tools.search({ pattern: 'alpha marker' });",
      "const hit = found.hits[0];",
      "if (!hit) throw new Error('missing hit');",
      "const restored = await tools.recall({ type: 'seq', id: String(hit.seq) });",
      "return { seq: hit.seq, restoredSeqs: restored.seqs };"
    ].join("\n");
    fx.ctx.ptcRuntime.behavior = async (request) => {
      const [binding] = request.bindings;
      const found = await binding.functions.search({ pattern: "alpha marker" });
      const hit = found.hits[0];
      const restored = await binding.functions.recall({ type: "seq", id: String(hit.seq) });
      return { logs: [], value: { seq: hit.seq, restoredSeqs: restored.seqs } };
    };
    const settled = await fx.ctx.tools.execute({
      signal: new AbortController().signal,
      calls: [{
        type: "tool-call",
        id: ToolCallId("ptc-call"),
        name: RUN_CODE_NAME,
        arguments: JSON.stringify({ code, description: "Search and restore" })
      }],
      agent
    });
    const executed = settled.results[0].result;
    assert.equal(executed.isError, false, executed.error?.message);
    assert.deepEqual(executed.value.result.restoredSeqs, [executed.value.result.seq]);
  } finally {
    await fx.ctx.fiber.dispose();
  }
});
