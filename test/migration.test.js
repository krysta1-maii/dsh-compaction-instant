import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { createAssistantMessage, createUserMessage } from "@deepseek-ai/dsh-llm";
import { Session } from "@deepseek-ai/dsh-session";

const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const readInstalledManifest = (name) => JSON.parse(readFileSync(require.resolve(name + "/package.json"), "utf8"));

test("release metadata targets the exact DSH 0.2.0 development graph", () => {
  assert.equal(pkg.version, "0.2.0");
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version);
  for (const field of ["name", "version", "dependencies", "devDependencies", "peerDependencies", "peerDependenciesMeta", "engines"]) {
    assert.deepEqual(lock.packages[""][field], pkg[field], "lockfile root " + field);
  }
  assert.equal(pkg.engines.node, ">=22.12.0");
  assert.equal(pkg.engines.dsh, "^0.2.0-rc.1 || ^0.2.1-0");
  assert.equal(pkg.packageManager, "npm@9.2.0");
  for (const [name, range] of Object.entries(pkg.peerDependencies)) {
    if (name.startsWith("@deepseek-ai/dsh-")) assert.equal(range, "^0.2.0-rc.1 || ^0.2.1-0", name);
  }
  assert.equal(pkg.peerDependencies["@deepseek-ai/cordis"], "^4.0.4 || ^4.0.5-0");
  assert.equal(pkg.dependencies["@deepseek-ai/dsh-util-values"], "^0.2.0-rc.1 || ^0.2.1-0");
  assert.equal(pkg.dependencies["@deepseek-ai/schemastery"], "^3.18.4 || ^3.18.5-0");
  assert.equal(pkg.peerDependenciesMeta["@deepseek-ai/dsh-settings"].optional, true);

  for (const name of Object.keys(pkg.devDependencies).filter((entry) => entry.startsWith("@deepseek-ai/dsh-"))) {
    assert.equal(pkg.devDependencies[name], "0.2.0-rc.2", name);
    assert.equal(readInstalledManifest(name).version, "0.2.0-rc.2", name);
  }
  assert.equal(readInstalledManifest("@deepseek-ai/cordis").version, "4.0.4");
  assert.equal(readInstalledManifest("@deepseek-ai/schemastery").version, "3.18.4");
});

test("0.2.0 Session rejects obsolete assistant settlements and replacement fields", () => {
  const message = createAssistantMessage({
    content: [{ type: "text", text: "settled" }],
    source: { provider: "p", model: "m" }
  });
  const event = {
    type: "assistant/message", seq: 0, time: 1,
    data: { turn: 1, step: 1, stream: [], message }, surfaceOp: "append"
  };
  assert.deepEqual(Session.create("valid-settlement", [event]).surface.nodes, [0]);
  for (const field of ["turn", "step", "stream"]) {
    const data = { ...event.data };
    delete data[field];
    assert.throws(() => Session.create("invalid-settlement", [{ ...event, data }]), /invalid settlement fields/);
  }
  assert.throws(() => Session.create("invalid-provenance", [{ ...event, sourceEventSeqs: [0] }]), /cannot carry sourceEventSeqs/);

  const user = createUserMessage({ content: [{ type: "text", text: "replacement" }], source: { kind: "user" } });
  const session = Session.create("replacement-shape", [event]);
  const before = session.seq;
  assert.throws(() => session.append("user/message", user, {
    surfaceOp: { replace: [0] }
  }), /invalid replace surfaceOp/);
  assert.throws(() => session.append("user/message", user, {
    surfaceOp: { op: "replace", start: 0, end: 0 }
  }), /invalid replace surfaceOp/);
  assert.equal(session.seq, before, "rejected legacy operation must not alter the log");
  assert.deepEqual(session.surface.nodes, [0]);
  const replacement = session.append("user/message", user, {
    surfaceOp: { op: "replace", startSeq: 0, endSeq: 0 }, sourceEventSeqs: [0]
  });
  assert.deepEqual(session.surface.nodes, [replacement.seq]);
});

test("client manifest and module factory use only 0.2.0 browser modules", () => {
  const injections = pkg.dsh.client.inject;
  assert.ok(injections.includes("@deepseek-ai/dsh-client-locale"));
  assert.ok(injections.includes("@deepseek-ai/dsh-client-ui-settings"));
  assert.ok(injections.includes("@deepseek-ai/dsh-client-ui-plugin-manager"));
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
      return true;
    }
  };
  let actions;
  const ctx = {
    locale: { bind: () => (key) => key, register: () => () => {} },
    effect: (factory) => factory(),
    configForms: {
      get: () => scope,
      whileServed: (_namespaces, register) => register()
    },
    slots: {
      inject: (_name, factory) => { factory(); },
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

test("bundle installs recall companions, the settings bridge and the inert client carrier", () => {
  const patch = readFileSync(new URL("../cordis.patch.yml", import.meta.url), "utf8");
  assert.match(patch, /dsh-compaction-instant\/tool/u);
  assert.match(patch, /dsh-compaction-instant\/command/u);
  assert.match(patch, /dsh-compaction-instant\/settings/u);
  // The bridge row ids the served settings namespace.
  assert.match(patch, /^\s*- id:\s*compaction-instant\s*$/mu);
  // The client-carrier row names the bare package — dsh-client-modules binds
  // the browser half to exactly that specifier — but stays inert, so no
  // profile-level engine races the preset-owned backend.
  assert.match(patch, /^\s*- id:\s*compaction-instant-client\s*$/mu);
  assert.match(patch, /^\s*name:\s*dsh-compaction-instant\s*$/mu);
  assert.match(patch, /^\s*carrier:\s*true\s*$/mu);
  // The bare-module row is the only engine-specifier row, and it is the carrier.
  const bareRows = patch.match(/^\s*name:\s*dsh-compaction-instant\s*$/gmu) ?? [];
  assert.equal(bareRows.length, 1);
});

test("root module dispatches: carrier rows stay inert, engine rows mount the engine", async () => {
  const { default: plugin, InstantCompactionEngine } = await import("../src/index.js");
  assert.equal(plugin.Config, InstantCompactionEngine.Config);
  const mount = async (config, child = { await: () => Promise.resolve() }) => {
    const calls = [];
    await plugin.apply({ plugin: (engine, forwarded) => { calls.push([engine, forwarded]); return child; } }, config);
    return calls;
  };
  // The client-carrier row mounts nothing: no profile-level engine.
  assert.deepEqual(await mount({ carrier: true }), []);
  // Ordinary composition rows mount the engine with the carrier key stripped.
  const [mounted] = await mount({ auto: false, thresholdRatio: 0.3 });
  assert.equal(mounted[0], InstantCompactionEngine);
  assert.deepEqual(mounted[1], { auto: false, thresholdRatio: 0.3 });
  const [explicit] = await mount({ carrier: false });
  assert.equal(explicit[0], InstantCompactionEngine);
  assert.deepEqual(explicit[1], {});
  // Engine fiber failures propagate onto the row exactly like a direct mount.
  const failed = { await: () => Promise.reject(new Error("engine exploded")) };
  await assert.rejects(mount({}, failed), /engine exploded/u);
  // A malformed flag fails the row loudly instead of silently no-oping.
  await assert.rejects(mount({ carrier: "yes" }), /carrier must be a boolean/u);
});
