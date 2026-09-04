import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const readInstalledManifest = (name) => JSON.parse(readFileSync(require.resolve(name + "/package.json"), "utf8"));

test("release metadata targets the exact DSH 0.1.2-rc.1 development graph", () => {
  assert.equal(pkg.version, "0.1.5");
  assert.equal(pkg.engines.node, ">=22.12.0");
  assert.equal(pkg.packageManager, "npm@9.2.0");
  for (const [name, range] of Object.entries(pkg.peerDependencies)) {
    if (name.startsWith("@deepseek-ai/dsh-")) assert.equal(range, "^0.1.2-rc.1", name);
  }
  assert.equal(pkg.peerDependencies["@deepseek-ai/cordis"], "^4.0.2");
  assert.equal(pkg.dependencies["@deepseek-ai/dsh-util-values"], "^0.1.2-rc.1");
  assert.equal(pkg.dependencies["@deepseek-ai/schemastery"], "^3.18.2");
  assert.equal(pkg.peerDependenciesMeta["@deepseek-ai/dsh-settings"].optional, true);

  for (const name of Object.keys(pkg.devDependencies).filter((entry) => entry.startsWith("@deepseek-ai/dsh-"))) {
    assert.equal(readInstalledManifest(name).version, "0.1.2-rc.1", name);
  }
  assert.equal(readInstalledManifest("@deepseek-ai/cordis").version, "4.0.2");
  assert.equal(readInstalledManifest("@deepseek-ai/schemastery").version, "3.18.2");
});

test("client manifest and module factory use only rc.1 browser modules", () => {
  const injections = pkg.dsh.client.inject;
  assert.ok(injections.includes("@deepseek-ai/dsh-api-remotes"));
  assert.ok(!injections.includes("@deepseek-ai/dsh-client-runtime"));

  const source = readFileSync(new URL("../src/client.js", import.meta.url), "utf8");
  assert.match(source, /require\("@deepseek-ai\/dsh-client-store"\)/u);
  assert.doesNotMatch(source, /dsh-client-runtime/u);
  assert.match(source, /this\.scope\.mutate\(operations, expectedRevision\)/u);
  const definitions = [];
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (definition) => definitions.push(definition) } }
  });
  assert.deepEqual(definitions.map((definition) => definition.id), [
    "@deepseek-ai/dsh-compaction-basic",
    "dsh-compaction-instant"
  ]);
  for (const definition of definitions) {
    const requested = [];
    const exports = definition.factory((id) => {
      requested.push(id);
      if (id === "react") return {};
      if (id === "@deepseek-ai/dsh-client-store") return { createSnapshotStore: () => ({}) };
      throw new Error("unexpected browser require: " + id);
    });
    assert.deepEqual(requested, ["react", "@deepseek-ai/dsh-client-store"]);
    assert.equal(typeof exports.apply, "function");
  }
});

test("client saves cross-field settings in one atomic mutation", async () => {
  const source = readFileSync(new URL("../src/client.js", import.meta.url), "utf8");
  const definitions = [];
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (definition) => definitions.push(definition) } }
  });
  const module = definitions[0].factory((id) => {
    if (id === "react") return {};
    if (id === "@deepseek-ai/dsh-client-store") return { createSnapshotStore: () => ({ set() {} }) };
    throw new Error("unexpected browser require: " + id);
  });
  const listeners = new Set();
  const calls = [];
  let snapshot = {
    status: "ready",
    writable: true,
    mode: "host",
    revision: 7,
    base: { thresholdRatio: 0.5, retainRatio: 0.2 },
    user: {},
    value: { thresholdRatio: 0.5, retainRatio: 0.2 }
  };
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    mutate: async (ops, revision) => {
      calls.push({ ops, revision });
      const user = { ...snapshot.user };
      for (const op of ops) {
        const field = op.path[0];
        if (op.op === "set") user[field] = op.value;
        else delete user[field];
      }
      const value = { ...snapshot.base, ...user };
      if (!(value.retainRatio < value.thresholdRatio)) throw new Error("invalid retention ratio");
      snapshot = { ...snapshot, user, value, revision: snapshot.revision + 1 };
      for (const listener of listeners) listener();
    }
  };
  let actions;
  const ctx = {
    locale: { bind: () => (key) => key, register: () => () => {} },
    effect: (factory) => factory(),
    settingsScope: { bind: () => scope },
    slots: {
      inject: (_name, factory) => { Array.from(factory()); },
      register: (options) => {
        actions = options.inject();
        return () => {};
      }
    }
  };
  module.apply(ctx);
  actions.edit("thresholdRatio", "0.15");
  actions.edit("retainRatio", "0.1");
  actions.save();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{
    revision: 7,
    ops: [
      { op: "set", path: ["thresholdRatio"], value: 0.15 },
      { op: "set", path: ["retainRatio"], value: 0.1 }
    ]
  }]);
  assert.deepEqual(snapshot.user, { thresholdRatio: 0.15, retainRatio: 0.1 });
});

test("bundle installs recall companions but no unscoped host compactor", () => {
  const patch = readFileSync(new URL("../cordis.patch.yml", import.meta.url), "utf8");
  assert.match(patch, /dsh-compaction-instant\/tool/u);
  assert.match(patch, /dsh-compaction-instant\/command/u);
  assert.doesNotMatch(patch, /^\s*name:\s*dsh-compaction-instant\s*$/mu);
  assert.doesNotMatch(patch, /^\s*- id:\s*compaction-instant\s*$/mu);
});
