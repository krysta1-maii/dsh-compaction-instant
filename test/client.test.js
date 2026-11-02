import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(createRequire(import.meta.url).resolve("dsh-compaction-instant/client"), "utf8");
const owner = "dsh-compaction-instant";
const ENGINE_NS = "compaction-instant";
const PRESET_NS = "compaction-instant-preset-tools";

function browserRequire(id) {
  if (id === "react") return {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } })
  };
  if (id === "@deepseek-ai/dsh-client-store") return {
    createSnapshotStore: (snapshot) => ({
      getSnapshot: () => snapshot,
      set: (next) => { snapshot = next; }
    })
  };
  throw new Error("unexpected browser require: " + id);
}

// Model alpha.5's strict registration and owner-scoped invalidation, rather
// than the old append-only registration collector that hid reload failures.
function createLoader() {
  const factories = new Map();
  const modules = new Map();
  const loader = {
    load: ({ id, factory }) => {
      if (factories.has(id)) throw new Error("duplicate factory registration for " + id);
      factories.set(id, factory);
    },
    require: (id) => {
      if (!modules.has(id)) modules.set(id, factories.get(id)(browserRequire));
      return modules.get(id);
    },
    invalidate: (id) => {
      factories.delete(id);
      modules.delete(id);
    },
    ids: () => Array.from(factories.keys())
  };
  const context = vm.createContext({ window: { __ModuleLoader__: loader } });
  return { ...loader, execute: () => vm.runInContext(source, context) };
}

/** One settings-namespace scope with a synchronous mirror and async writes. */
function createScopeState(options) {
  const base = { ...options.base };
  let snapshot = {
    status: options.status ?? "ready",
    writable: options.writable ?? true,
    revision: 7,
    base,
    user: options.user ?? {},
    value: { ...base, ...(options.user ?? {}) }
  };
  const listeners = new Set();
  const calls = [];
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    mutate: (ops, revision) => new Promise((resolve, reject) => {
      calls.push({ ops: JSON.parse(JSON.stringify(ops)), revision, resolve, reject });
    })
  };
  return {
    scope,
    calls,
    host: () => snapshot,
    settle(index = 0, outcome = true) {
      const call = calls[index];
      if (outcome instanceof Error) call.reject(outcome);
      else {
        if (outcome) {
          const user = { ...snapshot.user };
          for (const op of call.ops) {
            if (op.op === "unset") delete user[op.path[0]];
            else user[op.path[0]] = op.value;
          }
          snapshot = { ...snapshot, user, value: { ...base, ...user }, revision: snapshot.revision + 1 };
          for (const listener of listeners) listener();
        }
        call.resolve(outcome);
      }
      return Promise.resolve();
    }
  };
}

/**
 * Mount the browser half with both settings namespaces.
 * @param client - loaded client module.
 * @param options - engine user layer, preset user layer, served namespaces,
 *   read-only flag, roster result, and Remote availability.
 * @returns the captured actions, both stores, and write helpers.
 */
function mount(client, options = {}) {
  const engine = createScopeState({
    base: { thresholdRatio: 0.5, retainTurns: 1, checkpointCap: 65536 },
    user: options.user ?? {},
    writable: options.writable ?? true
  });
  const presets = createScopeState({
    base: {},
    user: options.presetUser ?? {},
    writable: options.writable ?? true,
    status: options.presetStatus ?? "ready"
  });
  const served = new Set(options.served ?? [ENGINE_NS, PRESET_NS]);
  const remoteCalls = [];
  const roster = options.roster ?? (() => Promise.resolve({ ok: true, value: { presets: [] } }));
  const remote = options.remote === "missing" ? undefined : {
    agentPresets: {
      list: () => {
        remoteCalls.push(remoteCalls.length + 1);
        return roster(remoteCalls.length);
      }
    }
  };
  let captured;
  const ctx = {
    effect: (factory) => factory(),
    locale: { register: () => () => {} },
    // The module resolves the roster through a child fiber that injects the
    // optional Remote namespace, the same path a shipped UI plugin uses.
    inject: (deps, callback) => {
      if (Array.isArray(deps) && deps.includes("remote.agentPresets") && remote !== undefined && remote.agentPresets !== undefined) callback({ remote });
      return () => {};
    },
    configForms: {
      get: (namespace) => {
        assert.ok(namespace === ENGINE_NS || namespace === PRESET_NS, "unexpected namespace: " + namespace);
        return namespace === ENGINE_NS ? engine.scope : presets.scope;
      },
      whileServed: (namespaces, register) => namespaces.some((namespace) => served.has(namespace)) ? register(served) : () => {}
    },
    slots: {
      inject: (_name, register) => register(),
      register: (registration, render) => {
        captured = { options: registration, render, actions: registration.inject() };
        return () => {};
      }
    }
  };
  client.apply(ctx);
  const state = () => captured.actions.hooks.compactionCard.getSnapshot();
  const presetState = () => captured.actions.hooks.presetTools.getSnapshot();
  return {
    actions: captured.actions,
    state,
    presetState,
    remoteCalls,
    engineCalls: engine.calls,
    presetCalls: presets.calls,
    key: captured.options.key,
    host: () => engine.host(),
    presetHost: () => presets.host(),
    render: () => captured.render({
          ...captured.actions,
          t: (key) => key,
          useCompactionCard: (select) => select(state()),
          usePresetTools: (select) => select(presetState())
        }),
    finish: (index = 0, outcome = true) => engine.settle(index, outcome),
    finishPreset: (index = 0, outcome = true) => presets.settle(index, outcome)
  };
}

/** Let the roster promise chain and the store projection settle. */
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function loadClient() {
  const loader = createLoader();
  loader.execute();
  return loader.require(owner);
}

function card(user) {
  return mount(loadClient(), { user });
}

function renderSection(page) {
  const element = page.props.children.find((child) => typeof child?.type === "function" && child.props?.state !== undefined);
  return element === undefined ? undefined : element.type(element.props);
}

function findFooter(page, suffix) {
  return page.props.children.find((child) => typeof child?.props?.className === "string" && (suffix === undefined ? child.props.className === "dsci_footer" : child.props.className.includes(suffix)));
}

test("real package factory loads, invalidates and reloads without an alias registration", () => {
  const loader = createLoader();
  loader.execute();
  assert.deepEqual(loader.ids(), [owner]);
  const first = loader.require(owner);
  assert.equal(mount(first).key, owner);
  assert.throws(loader.execute, /duplicate factory registration/);
  loader.invalidate(owner);
  loader.execute();
  const second = loader.require(owner);
  assert.notEqual(second, first, "reload must instantiate the new factory");
  assert.equal(mount(second).key, owner);
  assert.deepEqual(loader.ids(), [owner]);
});

test("pending save retains newer and newly staged fields for the next atomic mutation", async () => {
  const c = card();
  c.actions.edit("thresholdRatio", "0.7");
  c.actions.edit("retainTurns", "2");
  c.actions.save();
  assert.equal(c.state().saving, true);
  const page = c.render();
  const input = page.props.children.find((child) => child?.props?.id === "plugin-config-instant-threshold");
  assert.equal(input.props.disabled, false, "fields remain editable while saving");
  const footer = findFooter(page);
  assert.equal(footer.props.children.find((child) => child?.props?.className === "dsci_save").props.disabled, true);
  c.actions.edit("thresholdRatio", "0.8");
  c.actions.edit("checkpointCap", "70000");
  c.actions.save();
  assert.equal(c.engineCalls.length, 1, "a second save must not race the pending mutation");
  await c.finish();
  assert.equal(c.host().user.thresholdRatio, 0.7);
  assert.equal(c.state().thresholdRatio.text, "0.8");
  assert.equal(c.state().checkpointCap.text, "70000");
  assert.equal(c.state().retainTurns.text, "2");
  assert.equal(c.state().dirty, true);
  assert.equal(c.state().saving, false);
  assert.equal(c.state().failed, false);
  c.actions.save();
  assert.deepEqual(c.engineCalls[1].ops, [
    { op: "set", path: ["thresholdRatio"], value: 0.8 },
    { op: "set", path: ["checkpointCap"], value: 70000 }
  ]);
  assert.equal(c.engineCalls[1].revision, 8);
  await c.finish(1);
  assert.equal(c.state().dirty, false);
});

const pendingEdits = [
  { name: "return to the pre-submit value", edit: (a) => a.edit("thresholdRatio", "0.5"), text: "0.5", op: "set", value: 0.5 },
  { name: "reset an initially unoverridden field", edit: (a) => a.resetField("thresholdRatio"), text: "0.5", op: "unset" },
  { name: "delete with empty text", edit: (a) => a.edit("thresholdRatio", ""), text: "", op: "unset" },
  { name: "reset then edit", edit: (a) => { a.resetField("thresholdRatio"); a.edit("thresholdRatio", "0.9"); }, text: "0.9", op: "set", value: 0.9 },
  { name: "repeated edits", edit: (a) => { a.edit("thresholdRatio", "0.8"); a.edit("thresholdRatio", "0.9"); }, text: "0.9", op: "set", value: 0.9 },
  { name: "same parsed value with newer text", edit: (a) => a.edit("thresholdRatio", "0.700"), text: "0.700", op: "set", value: 0.7 }
];
for (const scenario of pendingEdits) {
  test("pending save preserves " + scenario.name, async () => {
    const c = card();
    c.actions.edit("thresholdRatio", "0.7");
    c.actions.save();
    scenario.edit(c.actions);
    await c.finish();
    assert.equal(c.state().thresholdRatio.text, scenario.text);
    assert.equal(c.state().dirty, true);
    c.actions.save();
    const op = { op: scenario.op, path: ["thresholdRatio"] };
    if (scenario.op === "set") op.value = scenario.value;
    assert.deepEqual(c.engineCalls[1].ops, [op]);
    await c.finish(1);
    assert.equal(c.state().dirty, false);
  });
}

test("an in-flight unset does not erase a later replacement", async () => {
  const c = card({ thresholdRatio: 0.7 });
  c.actions.resetField("thresholdRatio");
  c.actions.save();
  assert.deepEqual(c.engineCalls[0].ops, [{ op: "unset", path: ["thresholdRatio"] }]);
  c.actions.edit("thresholdRatio", "0.8");
  await c.finish();
  assert.equal(c.host().user.thresholdRatio, undefined);
  assert.equal(c.state().thresholdRatio.text, "0.8");
  assert.equal(c.state().dirty, true);
});

test("discard during save does not resurrect old drafts or erase edits after discard", async () => {
  for (const editAfterDiscard of [false, true]) {
    const c = card();
    c.actions.edit("thresholdRatio", "0.7");
    c.actions.save();
    c.actions.edit("checkpointCap", "70000");
    c.actions.discard();
    if (editAfterDiscard) c.actions.edit("thresholdRatio", "0.8");
    await c.finish();
    assert.equal(c.state().checkpointCap.text, "65536");
    assert.equal(c.state().thresholdRatio.text, editAfterDiscard ? "0.8" : "0.7");
    assert.equal(c.state().dirty, editAfterDiscard);
  }
});

test("failed or refused pending mutations keep the latest drafts", async () => {
  for (const outcome of [false, new Error("write rejected")]) {
    const c = card();
    c.actions.edit("thresholdRatio", "0.7");
    c.actions.save();
    c.actions.edit("thresholdRatio", "0.8");
    await c.finish(0, outcome);
    assert.equal(c.state().thresholdRatio.text, "0.8");
    assert.equal(c.state().dirty, true);
    assert.equal(c.state().saving, false);
    assert.equal(c.state().failed, true);
  }
});

test("the roster loads on page mount and renders names, defaults, and broken reasons", async () => {
  const roster = () => Promise.resolve({ ok: true, value: { presets: [
    { id: "ptc", name: "PTC", isDefault: true },
    { id: "standard", name: "Standard", isDefault: false },
    { id: "broken", broken: "missing row" }
  ] } });
  const c = mount(loadClient(), { roster });
  await flush();
  const state = c.presetState();
  assert.equal(state.rosterStatus, "ready");
  assert.equal(state.available, true);
  assert.deepEqual(Array.from(state.rows).map((row) => row.id), ["ptc", "standard", "broken"]);
  assert.equal(state.rows[0].name, "PTC");
  assert.equal(state.rows[0].isDefault, true);
  assert.equal(state.rows[1].name, "Standard");
  assert.equal(state.rows[2].name, undefined, "a nameless preset falls back to its id");
  assert.equal(state.rows[2].broken, "missing row");
  assert.equal(state.rows[2].locked, true, "a broken preset cannot be newly enabled");
  assert.equal(c.remoteCalls.length, 1, "one roster read on mount");
});

test("a nameless shipped preset renders its localized name, not the bare id", async () => {
  const roster = () => Promise.resolve({ ok: true, value: { presets: [{ id: "standard" }, { id: "ptc" }, { id: "craft" }] } });
  const c = mount(loadClient(), { roster });
  await flush();
  const state = c.presetState();
  assert.equal(state.rows[0].name, undefined, "the controller keeps the roster payload as served");
  const page = c.render();
  const section = renderSection(page);
  const list = section.props.children.find((child) => child?.props?.className === "dsci_presets");
  assert.equal(list.props.children[0].props.row.name, "presetsBuiltinStandard");
  assert.equal(list.props.children[1].props.row.name, "presetsBuiltinPtc");
  assert.equal(list.props.children[2].props.row.name, undefined, "an unknown nameless id keeps its id fallback");
});

test("checking a preset only stages a draft; save writes one sorted array", async () => {
  const c = mount(loadClient(), {
    roster: () => Promise.resolve({ ok: true, value: { presets: [
      { id: "standard", name: "Standard" },
      { id: "ptc", name: "PTC" }
    ] } })
  });
  await flush();
  c.actions.togglePreset("ptc", true);
  assert.equal(c.presetCalls.length, 0, "checking writes nothing");
  assert.equal(c.presetState().dirty, true);
  assert.deepEqual(Array.from(c.presetState().rows).filter((row) => row.checked).map((row) => row.id), ["ptc"]);
  c.actions.togglePreset("standard", true);
  c.actions.savePresets();
  assert.deepEqual(c.presetCalls[0].ops, [{ op: "set", path: ["presets"], value: ["ptc", "standard"] }]);
  await c.finishPreset();
  assert.deepEqual(c.presetHost().user.presets, ["ptc", "standard"]);
  assert.equal(c.presetState().dirty, false);
  c.actions.togglePreset("standard", false);
  c.actions.discardPresets();
  assert.equal(c.presetState().dirty, false);
  assert.deepEqual(Array.from(c.presetState().rows).filter((row) => row.checked).map((row) => row.id), ["standard", "ptc"]);
});

test("deselecting an enabled preset stages removal and release", async () => {
  const c = mount(loadClient(), {
    presetUser: { presets: ["ptc"] },
    roster: () => Promise.resolve({ ok: true, value: { presets: [{ id: "ptc", name: "PTC" }] } })
  });
  await flush();
  assert.deepEqual(Array.from(c.presetState().rows).map((row) => row.checked), [true]);
  c.actions.togglePreset("ptc", false);
  assert.equal(c.presetState().dirty, true);
  c.actions.savePresets();
  assert.deepEqual(c.presetCalls[0].ops, [{ op: "set", path: ["presets"], value: [] }]);
  await c.finishPreset();
  assert.deepEqual(c.presetHost().user.presets, []);
});

test("reset clears the stored field back to the schema default", async () => {
  const c = mount(loadClient(), { presetUser: { presets: ["ptc", "standard"] } });
  await flush();
  assert.deepEqual(Array.from(c.presetState().rows).map((row) => row.id), ["ptc", "standard"]);
  c.actions.resetPresets();
  assert.deepEqual(c.presetCalls[0].ops, [{ op: "unset", path: ["presets"] }]);
  await c.finishPreset();
  assert.equal(c.presetHost().user.presets, undefined);
  assert.deepEqual(Array.from(c.presetState().rows), []);
  assert.equal(c.presetState().resettable, false);
});

test("a failed roster read keeps the saved configuration and its draft", async () => {
  let attempt = 0;
  const c = mount(loadClient(), {
    presetUser: { presets: ["ptc"] },
    roster: () => {
      attempt += 1;
      return attempt === 1
        ? Promise.resolve({ ok: false, error: { code: "gateway/unavailable", message: "roster offline" } })
        : Promise.resolve({ ok: true, value: { presets: [{ id: "ptc", name: "PTC" }] } });
    }
  });
  await flush();
  let state = c.presetState();
  assert.equal(state.rosterStatus, "error");
  assert.equal(state.rosterError, "roster offline");
  assert.deepEqual(Array.from(state.rows).map((row) => row.id), ["ptc"], "the saved id survives a failed read");
  assert.equal(state.rows[0].missing, false, "an unread roster never claims the id is gone");
  c.actions.togglePreset("ptc", false);
  assert.equal(c.presetState().dirty, true);
  c.actions.refreshPresets();
  await flush();
  assert.equal(c.remoteCalls.length, 2, "refresh retries the read");
  state = c.presetState();
  assert.equal(state.rosterStatus, "ready");
  assert.equal(state.rows[0].name, "PTC");
  assert.equal(state.dirty, true, "the draft survives the retry");
});

test("a saved preset that left the roster stays visible and removable", async () => {
  const c = mount(loadClient(), {
    presetUser: { presets: ["gone"] },
    roster: () => Promise.resolve({ ok: true, value: { presets: [{ id: "ptc", name: "PTC" }] } })
  });
  await flush();
  const rows = Array.from(c.presetState().rows);
  assert.deepEqual(rows.map((row) => row.id), ["ptc", "gone"]);
  const gone = rows.find((row) => row.id === "gone");
  assert.equal(gone.missing, true);
  assert.equal(gone.checked, true);
  c.actions.togglePreset("gone", false);
  c.actions.savePresets();
  assert.deepEqual(c.presetCalls[0].ops, [{ op: "set", path: ["presets"], value: [] }]);
});

test("read-only connections show both areas with every write disabled", async () => {
  const c = mount(loadClient(), { writable: false, presetUser: { presets: ["ptc"] } });
  await flush();
  const state = c.presetState();
  assert.equal(state.available, true);
  assert.equal(state.writable, false);
  const page = c.render();
  assert.ok(page.props.children.some((child) => child?.props?.role === "status" && child.props.className === "dsci_readOnly"));
  const section = renderSection(page);
  const rows = section.props.children.find((child) => child?.props?.className === "dsci_presets");
  assert.equal(rows.props.children[0].props.disabled, true, "the checkbox is disabled");
  const footer = section.props.children.find((child) => child?.props?.className?.includes("dsci_presetFooter"));
  assert.deepEqual(footer.props.children.filter((child) => child?.type === "button").map((child) => child.props.disabled), [false, true, true, true]);
  c.actions.togglePreset("ptc", false);
  c.actions.savePresets();
  c.actions.resetPresets();
  assert.equal(c.presetCalls.length, 0);
});

test("a missing preset namespace hides only the companion area", async () => {
  const c = mount(loadClient(), { served: [ENGINE_NS] });
  const page = c.render();
  assert.ok(page, "the engine section still renders");
  assert.equal(page.props.children.some((child) => child?.props?.className === "dsci_section"), false);
  assert.ok(page.props.children.some((child) => child?.props?.id === "plugin-config-instant-threshold"));
  c.actions.edit("thresholdRatio", "0.7");
  c.actions.save();
  assert.deepEqual(c.engineCalls[0].ops, [{ op: "set", path: ["thresholdRatio"], value: 0.7 }]);
});

test("an unavailable Remote hides the roster but keeps saved ids removable", async () => {
  const c = mount(loadClient(), { presetUser: { presets: ["ptc"] }, remote: "missing" });
  await flush();
  const state = c.presetState();
  assert.equal(state.rosterStatus, "unavailable");
  assert.deepEqual(Array.from(state.rows).map((row) => row.id), ["ptc"]);
  assert.equal(state.rows[0].missing, false, "an absent roster service cannot prove the id is gone");
  const page = c.render();
  const section = renderSection(page);
  const note = section.props.children.find((child) => child?.props?.role === "status");
  assert.equal(note.props.children[0], "presetsUnavailable");
  c.actions.togglePreset("ptc", false);
  c.actions.savePresets();
  assert.deepEqual(c.presetCalls[0].ops, [{ op: "set", path: ["presets"], value: [] }]);
});

test("engine and preset forms keep independent drafts and writes", async () => {
  const c = mount(loadClient(), {
    presetUser: { presets: ["ptc"] },
    roster: () => Promise.resolve({ ok: true, value: { presets: [{ id: "ptc", name: "PTC" }, { id: "standard", name: "Standard" }] } })
  });
  await flush();
  c.actions.edit("thresholdRatio", "0.7");
  c.actions.togglePreset("standard", true);
  assert.equal(c.state().dirty, true);
  assert.equal(c.presetState().dirty, true);
  c.actions.savePresets();
  assert.equal(c.engineCalls.length, 0, "the preset save leaves the engine namespace alone");
  assert.deepEqual(c.presetCalls[0].ops, [{ op: "set", path: ["presets"], value: ["ptc", "standard"] }]);
  await c.finishPreset();
  assert.equal(c.host().user.thresholdRatio, undefined, "the engine draft is untouched");
  assert.equal(c.state().thresholdRatio.text, "0.7");
  c.actions.save();
  assert.deepEqual(c.engineCalls[0].ops, [{ op: "set", path: ["thresholdRatio"], value: 0.7 }]);
  assert.equal(c.presetCalls.length, 1, "the engine save leaves the preset namespace alone");
  await c.finish();
  assert.deepEqual(c.presetHost().user.presets, ["ptc", "standard"]);
});

test("a refused preset write keeps the draft and reports failure", async () => {
  const c = mount(loadClient(), { roster: () => Promise.resolve({ ok: true, value: { presets: [{ id: "ptc", name: "PTC" }] } }) });
  await flush();
  c.actions.togglePreset("ptc", true);
  c.actions.savePresets();
  await c.finishPreset(0, false);
  assert.equal(c.presetState().failed, true);
  assert.equal(c.presetState().dirty, true);
  assert.equal(c.presetState().saving, false);
  c.actions.savePresets();
  assert.deepEqual(c.presetCalls[1].ops, [{ op: "set", path: ["presets"], value: ["ptc"] }]);
});
