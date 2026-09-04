/**
 * Settings-namespace integration tests for the instant compaction engine.
 * @module dsh-compaction-instant/test/settings
 */
import assert from "node:assert/strict";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import { SettingsProvider } from "@deepseek-ai/dsh-settings";
import { InstantCompactionEngine } from "../src/index.js";

class MemorySettings extends SettingsProvider {
  writable = true;
  document = {};
  async load() {
    return this.document;
  }
  async persist(namespace, section) {
    this.document = { ...this.document, [namespace]: section };
  }
}

const settleCordis = () => new Promise((resolve) => setImmediate(resolve));

function provideEngineServices(ctx) {
  ctx.provide("llm", {});
  ctx.provide("tokenMeter", {});
  ctx.provide("sessions", {});
}

test("SETTINGS_SCHEMA accepts partial values while engine defaults stay authoritative", () => {
  const schema = InstantCompactionEngine.SETTINGS_SCHEMA;
  assert.deepEqual(schema({}), {});
  const engine = new InstantCompactionEngine(new Context(), { auto: false });
  assert.equal(engine.config.checkpointCap, 65536);
  assert.equal(engine.config.auto, false);
  assert.equal(engine.config.thresholdRatio, 0.5);
  assert.equal(engine.config.retainTurns, 1);
  assert.equal(engine.config.retainTokens, 5120);
});

test("SETTINGS_SCHEMA validates user overrides and rejects malformed values", () => {
  const schema = InstantCompactionEngine.SETTINGS_SCHEMA;
  assert.equal(schema({ checkpointCap: 131072 }).checkpointCap, 131072);
  assert.equal(schema({ auto: false }).auto, false);
  assert.equal(schema({ thresholdRatio: 0.25 }).thresholdRatio, 0.25);
  assert.equal(schema({ retainTurns: 3 }).retainTurns, 3);
  assert.equal(schema({ retainRatio: 0.2 }).retainRatio, 0.2);
  assert.equal(schema({ retainTokens: 50000 }).retainTokens, 50000);
  assert.throws(() => schema({ checkpointCap: -1 }));
  assert.throws(() => schema({ checkpointCap: 1.5 }));
  assert.throws(() => schema({ thresholdRatio: 1.5 }));
  assert.throws(() => schema({ thresholdRatio: -0.1 }));
  assert.throws(() => schema({ retainTurns: 0 }));
  assert.throws(() => schema({ retainTurns: 1.5 }));
  assert.throws(() => schema({ retainRatio: -0.1 }));
  assert.throws(() => schema({ retainTokens: -1 }));
  assert.throws(() => schema({ auto: "yes" }));
});

test("rc.1 SettingsProvider installSection drives updates and is shared by later engines", async () => {
  const ctx = new Context();
  provideEngineServices(ctx);
  const provider = ctx.plugin(MemorySettings);
  await provider;
  const firstCtx = ctx.isolate(["compaction"]);
  const secondCtx = ctx.isolate(["compaction"]);
  const firstFiber = firstCtx.plugin(InstantCompactionEngine, { auto: false, checkpointCap: 32768 });
  const secondFiber = secondCtx.plugin(InstantCompactionEngine, { auto: false, retainRatio: 0.2 });
  await Promise.all([firstFiber, secondFiber]);
  const first = firstCtx.compaction;
  const second = secondCtx.compaction;
  await settleCordis();
  assert.deepEqual(ctx.settings.get("compaction-instant"), {
    checkpointCap: 32768,
    auto: false,
    thresholdRatio: 0.5,
    retainTurns: 1,
    retainTokens: 5120
  });

  await ctx.settings.update("compaction-instant", { checkpointCap: 131072 });
  await settleCordis();
  assert.equal(first.config.checkpointCap, 131072);
  await assert.rejects(
    ctx.settings.update("compaction-instant", { retainRatio: 0.2 }),
    /mutually exclusive/
  );

  assert.equal(second.config.checkpointCap, 131072);
  assert.equal(second.config.retainRatio, undefined);
  assert.equal(second.config.retainTokens, 5120);
  await ctx.settings.update("compaction-instant", { retainTokens: 4096 });
  await settleCordis();
  assert.equal(first.config.retainTokens, 4096);
  assert.equal(second.config.retainTokens, 4096);

  await firstFiber.dispose();
  await settleCordis();
  await settleCordis();
  assert.equal(ctx.settings.get("compaction-instant").retainTokens, 4096);
  assert.equal(second.config.checkpointCap, 131072);
  assert.equal(second.config.retainTokens, 4096);

  await ctx.settings.replace("compaction-instant", {});
  await settleCordis();
  assert.equal(ctx.settings.get("compaction-instant").checkpointCap, 32768);
  assert.equal(ctx.settings.get("compaction-instant").retainTokens, 5120);
  assert.equal(second.config.checkpointCap, 32768);
  assert.equal(second.config.retainTokens, 5120);

  await provider.dispose();
  await settleCordis();
  assert.equal(second.config.checkpointCap, 65536);
  assert.equal(second.config.retainRatio, 0.2);
  await secondFiber.dispose();
});

test("an incompatible follower falls back composition-only without leaking settings membership", async () => {
  const ctx = new Context();
  provideEngineServices(ctx);
  const provider = ctx.plugin(MemorySettings);
  await provider;
  const ownerCtx = ctx.isolate(["compaction"]);
  const ownerFiber = ownerCtx.plugin(InstantCompactionEngine, { auto: false, thresholdRatio: 0.3 });
  await ownerFiber;
  await settleCordis();

  const followerCtx = ctx.isolate(["compaction"]);
  const followerFiber = followerCtx.plugin(InstantCompactionEngine, {
    auto: false,
    thresholdRatio: 0.5,
    modelPolicies: [{ provider: "p", model: "m", retainRatio: 0.4 }]
  });
  await followerFiber;
  await settleCordis();
  assert.equal(followerCtx.compaction.config.thresholdRatio, 0.5);
  assert.equal(followerCtx.compaction.config.modelPolicies[0].retainRatio, 0.4);

  await ctx.settings.update("compaction-instant", { checkpointCap: 12345 });
  assert.equal(ownerCtx.compaction.config.checkpointCap, 12345);
  assert.equal(followerCtx.compaction.config.checkpointCap, 65536);
  await followerFiber.dispose();
  await ownerFiber.dispose();
  await settleCordis();
  assert.equal(ctx.settings.get("compaction-instant"), undefined);
  await provider.dispose();
});

test("ratio-based composition stays ratio-based through the settings layer", async () => {
  const ctx = new Context();
  const provider = ctx.plugin(MemorySettings);
  await provider;
  const engine = new InstantCompactionEngine(ctx, { auto: false, retainRatio: 0.2 });
  await settleCordis();
  const section = ctx.settings.get("compaction-instant");
  assert.equal(section.retainRatio, 0.2);
  assert.equal(section.retainTokens, undefined);

  await ctx.settings.update("compaction-instant", { checkpointCap: 32768, retainRatio: 0.1 });
  await settleCordis();
  assert.equal(engine.config.checkpointCap, 32768);
  assert.equal(engine.config.retainRatio, 0.1);
  assert.equal(engine.config.retainTokens, undefined);
  await assert.rejects(
    ctx.settings.update("compaction-instant", { retainTokens: 2048 }),
    /mutually exclusive/
  );

  await provider.dispose();
});
