/**
 * Settings-plane integration tests for the instant compaction engine: the
 * bundle's volatile bridge row (src/settings.js) serves the
 * `compaction-instant` form namespace on DSH 0.2.0, and every mounted engine
 * overlays that sparse user layer on its own composition entry.
 * @module dsh-compaction-instant/test/settings
 */
import assert from "node:assert/strict";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import { InstantCompactionEngine } from "../src/index.js";
import { Config as BridgeConfig, SETTINGS_NAMESPACE } from "../src/settings.js";

/** Minimal stand-in for the 0.2.0 settings plane the engine consumes. */
class FakeSettingsPlane {
  constructor(ctx) {
    this.ctx = ctx;
    this.sections = new Map();
    this.revision = 0;
  }
  describe() {
    return Array.from(this.sections, ([ns, value]) => ({ ns, value }));
  }
  /** Serve, replace, or remove (undefined) one namespace's section. */
  setSection(ns, value) {
    if (value === undefined) this.sections.delete(ns);
    else this.sections.set(ns, value);
    this.revision += 1;
    this.ctx.emit("settings/document-updated", ns, this.revision);
  }
}

const settleCordis = () => new Promise((resolve) => setImmediate(resolve));

function provideEngineServices(ctx) {
  ctx.provide("llm", {});
  ctx.provide("tokenMeter", {});
  ctx.provide("sessions", {});
}

function mount(ctx, config) {
  provideEngineServices(ctx);
  const plane = new FakeSettingsPlane(ctx);
  ctx.provide("settings", plane);
  return plane;
}

test("bridge schema serves a sparse section and keeps engine defaults authoritative", () => {
  const empty = BridgeConfig({});
  for (const field of ["checkpointCap", "auto", "thresholdRatio", "retainTurns", "retainRatio", "retainTokens"]) {
    assert.equal(empty[field].get(), undefined, field);
  }
  assert.equal(SETTINGS_NAMESPACE, "compaction-instant");
  assert.equal(InstantCompactionEngine.SETTINGS_NAMESPACE, SETTINGS_NAMESPACE);
  const engine = new InstantCompactionEngine(new Context(), { auto: false });
  assert.equal(engine.config.checkpointCap, 65536);
  assert.equal(engine.config.auto, false);
  assert.equal(engine.config.thresholdRatio, 0.5);
  assert.equal(engine.config.retainTurns, 1);
  assert.equal(engine.config.retainTokens, 5120);
});

test("bridge schema validates user overrides and rejects malformed values", () => {
  assert.equal(BridgeConfig({ checkpointCap: 131072 }).checkpointCap.get(), 131072);
  assert.equal(BridgeConfig({ auto: false }).auto.get(), false);
  assert.equal(BridgeConfig({ thresholdRatio: 0.25 }).thresholdRatio.get(), 0.25);
  assert.equal(BridgeConfig({ retainTurns: 3 }).retainTurns.get(), 3);
  assert.equal(BridgeConfig({ retainRatio: 0.2 }).retainRatio.get(), 0.2);
  assert.equal(BridgeConfig({ retainTokens: 50000 }).retainTokens.get(), 50000);
  assert.throws(() => BridgeConfig({ checkpointCap: -1 }));
  assert.throws(() => BridgeConfig({ checkpointCap: 1.5 }));
  assert.throws(() => BridgeConfig({ thresholdRatio: 1.5 }));
  assert.throws(() => BridgeConfig({ thresholdRatio: -0.1 }));
  assert.throws(() => BridgeConfig({ retainTurns: 0 }));
  assert.throws(() => BridgeConfig({ retainTurns: 1.5 }));
  assert.throws(() => BridgeConfig({ retainRatio: -0.1 }));
  assert.throws(() => BridgeConfig({ retainTokens: -1 }));
  assert.throws(() => BridgeConfig({ auto: "yes" }));
});

test("the served form drives updates and is shared by every mounted engine", async () => {
  const ctx = new Context();
  const plane = mount(ctx);
  plane.setSection(SETTINGS_NAMESPACE, { checkpointCap: 32768 });
  const firstCtx = ctx.isolate(["compaction"]);
  const secondCtx = ctx.isolate(["compaction"]);
  const firstFiber = firstCtx.plugin(InstantCompactionEngine, { auto: false, checkpointCap: 16384 });
  const secondFiber = secondCtx.plugin(InstantCompactionEngine, { auto: false, retainRatio: 0.2 });
  await Promise.all([firstFiber, secondFiber]);
  const first = firstCtx.compaction;
  const second = secondCtx.compaction;
  await settleCordis();

  // Sparse overlay: checkpointCap follows the section, everything else inherits.
  assert.equal(first.config.checkpointCap, 32768);
  assert.equal(first.config.auto, false);
  assert.equal(first.config.retainTokens, 5120);
  assert.equal(second.config.checkpointCap, 32768);
  assert.equal(second.config.retainRatio, 0.2);

  plane.setSection(SETTINGS_NAMESPACE, { checkpointCap: 131072, retainTokens: 4096 });
  await settleCordis();
  assert.equal(first.config.checkpointCap, 131072);
  assert.equal(first.config.retainTokens, 4096);
  assert.equal(second.config.checkpointCap, 131072);
  // A served retainTokens mode clears the entry's ratio mode.
  assert.equal(second.config.retainRatio, undefined);
  assert.equal(second.config.retainTokens, 4096);

  // A section carrying both retention modes resolves to ratio mode engine-side.
  plane.setSection(SETTINGS_NAMESPACE, { retainRatio: 0.3, retainTokens: 4096 });
  await settleCordis();
  assert.equal(first.config.retainRatio, 0.3);
  assert.equal(first.config.retainTokens, undefined);
  assert.equal(second.config.retainRatio, 0.3);

  // The bridge row leaving the served set returns engines to composition-only.
  plane.setSection(SETTINGS_NAMESPACE, undefined);
  await settleCordis();
  assert.equal(first.config.checkpointCap, 16384);
  assert.equal(first.config.retainTokens, 5120);
  assert.equal(second.config.checkpointCap, 65536);
  assert.equal(second.config.retainRatio, 0.2);

  await firstFiber.dispose();
  await secondFiber.dispose();
});

test("an incompatible section falls back composition-only until it becomes valid", async () => {
  const ctx = new Context();
  const plane = mount(ctx);
  plane.setSection(SETTINGS_NAMESPACE, { checkpointCap: 12345 });
  const ownerCtx = ctx.isolate(["compaction"]);
  const followerCtx = ctx.isolate(["compaction"]);
  const ownerFiber = ownerCtx.plugin(InstantCompactionEngine, { auto: false, thresholdRatio: 0.3 });
  const followerFiber = followerCtx.plugin(InstantCompactionEngine, {
    auto: false,
    thresholdRatio: 0.5,
    modelPolicies: [{ provider: "p", model: "m", retainRatio: 0.4 }]
  });
  await Promise.all([ownerFiber, followerFiber]);
  const owner = ownerCtx.compaction;
  const follower = followerCtx.compaction;
  await settleCordis();
  assert.equal(owner.config.checkpointCap, 12345);
  assert.equal(follower.config.checkpointCap, 12345);

  // retainRatio 0.35 breaks the owner (threshold 0.3) but not the follower
  // (threshold 0.5); the owner alone falls back, and both recover together.
  plane.setSection(SETTINGS_NAMESPACE, { retainRatio: 0.35 });
  await settleCordis();
  assert.equal(owner.config.retainRatio, undefined);
  assert.equal(owner.config.thresholdRatio, 0.3);
  assert.equal(follower.config.retainRatio, 0.35);
  assert.equal(follower.config.modelPolicies[0].retainRatio, 0.4);

  plane.setSection(SETTINGS_NAMESPACE, { retainRatio: 0.2 });
  await settleCordis();
  assert.equal(owner.config.retainRatio, 0.2);
  assert.equal(follower.config.retainRatio, 0.2);

  await followerFiber.dispose();
  await ownerFiber.dispose();
});

test("ratio-based composition stays ratio-based through the settings layer", async () => {
  const ctx = new Context();
  const plane = mount(ctx);
  plane.setSection(SETTINGS_NAMESPACE, { retainRatio: 0.1 });
  const engine = new InstantCompactionEngine(ctx, { auto: false, retainRatio: 0.2 });
  await settleCordis();
  assert.equal(engine.config.retainRatio, 0.1);
  assert.equal(engine.config.retainTokens, undefined);

  plane.setSection(SETTINGS_NAMESPACE, { checkpointCap: 32768 });
  await settleCordis();
  assert.equal(engine.config.checkpointCap, 32768);
  // No retention field in the section: the entry's ratio mode survives.
  assert.equal(engine.config.retainRatio, 0.2);
  assert.equal(engine.config.retainTokens, undefined);
});
