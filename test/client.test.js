import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(createRequire(import.meta.url).resolve("dsh-compaction-instant/client"), "utf8");
const owner = "dsh-compaction-instant";

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

function mount(client, user = {}) {
  const base = { thresholdRatio: 0.5, retainTurns: 1, checkpointCap: 65536 };
  let snapshot = { status: "ready", writable: true, revision: 7, base, user, value: { ...base, ...user } };
  const listeners = new Set();
  const calls = [];
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    mutate: (ops, revision) => new Promise((resolve, reject) => {
      calls.push({ ops: JSON.parse(JSON.stringify(ops)), revision, resolve, reject });
    })
  };
  let actions;
  let component;
  let key;
  client.apply({
    effect: (factory) => factory(),
    locale: { register: () => () => {} },
    configForms: {
      get: (namespace) => { assert.equal(namespace, "compaction-instant"); return scope; },
      whileServed: (_namespaces, register) => register()
    },
    slots: {
      inject: (_name, register) => register(),
      register: (options, render) => {
        key = options.key;
        actions = options.inject();
        component = render;
        return () => {};
      }
    }
  });
  const state = () => actions.hooks.compactionCard.getSnapshot();
  return {
    actions, calls, state, key,
    host: () => snapshot,
    render: () => component({ ...actions, t: (key) => key, useCompactionCard: (select) => select(state()) }),
    finish: async (index = 0, outcome = true) => {
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
      await Promise.resolve();
    }
  };
}

function card(user) {
  const loader = createLoader();
  loader.execute();
  return mount(loader.require(owner), user);
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
  const footer = page.props.children.find((child) => child?.props?.className === "dsci_footer");
  assert.equal(footer.props.children.find((child) => child?.props?.className === "dsci_save").props.disabled, true);
  c.actions.edit("thresholdRatio", "0.8");
  c.actions.edit("checkpointCap", "70000");
  c.actions.save();
  assert.equal(c.calls.length, 1, "a second save must not race the pending mutation");
  await c.finish();
  assert.equal(c.host().user.thresholdRatio, 0.7);
  assert.equal(c.state().thresholdRatio.text, "0.8");
  assert.equal(c.state().checkpointCap.text, "70000");
  assert.equal(c.state().retainTurns.text, "2");
  assert.equal(c.state().dirty, true);
  assert.equal(c.state().saving, false);
  assert.equal(c.state().failed, false);
  c.actions.save();
  assert.deepEqual(c.calls[1].ops, [
    { op: "set", path: ["thresholdRatio"], value: 0.8 },
    { op: "set", path: ["checkpointCap"], value: 70000 }
  ]);
  assert.equal(c.calls[1].revision, 8);
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
    assert.deepEqual(c.calls[1].ops, [op]);
    await c.finish(1);
    assert.equal(c.state().dirty, false);
  });
}

test("an in-flight unset does not erase a later replacement", async () => {
  const c = card({ thresholdRatio: 0.7 });
  c.actions.resetField("thresholdRatio");
  c.actions.save();
  assert.deepEqual(c.calls[0].ops, [{ op: "unset", path: ["thresholdRatio"] }]);
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
