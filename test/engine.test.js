/**
 * Engine-level test: the real `InstantCompactionEngine.compile` hook runs the
 * deterministic compiler over a real detached session without any model call.
 * @module dsh-compaction-instant/test/engine
 */
import assert from "node:assert/strict";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import { CONTEXT_WINDOW_EXCEEDED_CODE, createAssistantMessage, createSystemMessage, createToolResultMessage, createUserMessage } from "@deepseek-ai/dsh-llm";
import { Session } from "@deepseek-ai/dsh-session";
import { InstantCompactionEngine } from "../src/index.js";
import { compactSurfaceRegion } from "../src/region.js";

/** Build one detached session with a complete (idle) turn bracket. */
function makeIdleSession() {
  const user = createUserMessage({
    content: [{ type: "text", text: "please fix the bug" }],
    source: { kind: "user" }
  });
  const assistant = createAssistantMessage({
    content: [
      { type: "text", text: "on it" },
      { type: "tool-call", id: "call-1", name: "read", arguments: '{"file_path":"a.js"}' }
    ],
    source: { provider: "p", model: "m" }
  });
  const result = createToolResultMessage({
    callId: "call-1",
    content: [{ type: "text", text: "file content" }],
    isError: false
  });
  const assistant2 = createAssistantMessage({
    content: [{ type: "text", text: "done" }],
    source: { provider: "p", model: "m" }
  });
  const user2 = createUserMessage({
    content: [{ type: "text", text: "thank you" }],
    source: { kind: "user" }
  });
  const seed = [
    { type: "turn/start", seq: 0, time: 1, data: { turn: 1 } },
    { type: "user/message", seq: 1, time: 2, data: user, surfaceOp: "append" },
    { type: "assistant/message", seq: 2, time: 3, data: { turn: 1, step: 1, stream: [], message: assistant }, surfaceOp: "append" },
    { type: "tool/result", seq: 3, time: 4, data: { message: result }, surfaceOp: "append" },
    { type: "assistant/message", seq: 4, time: 5, data: { turn: 1, step: 2, stream: [], message: assistant2 }, surfaceOp: "append" },
    { type: "user/message", seq: 5, time: 6, data: user2, surfaceOp: "append" },
    { type: "turn/end", seq: 6, time: 7, data: { turn: 1 } }
  ];
  return Session.create("session-1", seed);
}

test("compile() compiles a real session deterministically with seq provenance", async () => {
  const session = makeIdleSession();
  const ctx = new Context();
  ctx.provide("tokenMeter", {
    measure: () => ({ nodes: session.surface.nodes.map((seq) => ({ seq, tokens: 100, heuristicTokens: 100 })) }),
    estimateMessage: () => 10
  });
  const engine = new InstantCompactionEngine(ctx, {
    auto: false,
    textTokens: 64,
    userTextTokens: 64,
    toolCallTokens: 32,
    toolResultExcerptTokens: 32,
    maxTokens: 512
  });
  const prepared = {
    shadowedSeqs: [1, 2, 3, 4],
    session,
    start: 1,
    end: 4,
    startIdx: 0,
    endIdx: 3,
    measurement: { nodes: [] },
    selectedNodes: [],
    shadowedTokenCount: 400
  };
  const result = await engine.compile(prepared, undefined, undefined);
  assert.equal(result.provider, "dsh-compaction-instant");
  assert.equal(result.model, "vcc-compiler");
  const text = result.entries.map((entry) => entry.text).join("\n");
  assert.match(text, /please fix the bug/);
  assert.match(text, /on it/);
  assert.match(text, /\* read "a\.js" \(seq 2 -> result 3\)/);
  assert.doesNotMatch(text, /-> read: ok/);
  assert.doesNotMatch(text, /file content/);
  assert.match(text, /done/);
  // Deterministic: compiling twice yields identical output.
  const again = await engine.compile(prepared, undefined, undefined);
  assert.deepEqual(result.entries, again.entries);
  assert.deepEqual(result.stats, again.stats);
});

test("compile() aborts on a cancelled signal", async () => {
  const session = makeIdleSession();
  const ctx = new Context();
  ctx.provide("tokenMeter", {
    measure: () => ({ nodes: [] }),
    estimateMessage: () => 10
  });
  const engine = new InstantCompactionEngine(ctx, { auto: false });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => engine.compile({ shadowedSeqs: [], session }, undefined, controller.signal),
    (error) => error.name === "AbortError"
  );
});

test("compile() caps the checkpoint at checkpointCap", async () => {
  const session = makeIdleSession();
  const ctx = new Context();
  ctx.provide("tokenMeter", {
    measure: () => ({ nodes: [] }),
    estimateMessage: () => 10
  });
  // The total budget for one checkpoint is exactly `checkpointCap` — no
  // proportional scaling, no floor — so a small span compiles near-losslessly
  // under the cap and a huge span elides down to it.
  const engine = new InstantCompactionEngine(ctx, {
    auto: false,
    checkpointCap: 4096,
    textTokens: 512,
    userTextTokens: 1024,
    toolCallTokens: 128,
    toolResultExcerptTokens: 256
  });
  const long = `long text ${"word ".repeat(300)}`;
  const seeded = Session.create("session-2", [
    { type: "turn/start", seq: 0, time: 1, data: { turn: 1 } },
    { type: "user/message", seq: 1, time: 2, data: createUserMessage({ content: [{ type: "text", text: long }], source: { kind: "user" } }), surfaceOp: "append" },
    { type: "assistant/message", seq: 2, time: 3, data: { turn: 1, step: 1, stream: [], message: createAssistantMessage({ content: [{ type: "text", text: "ok" }], source: { provider: "p", model: "m" } }) }, surfaceOp: "append" },
    { type: "turn/end", seq: 3, time: 4, data: { turn: 1 } }
  ]);
  const prepared = {
    shadowedSeqs: [1, 2],
    session: seeded,
    start: 1,
    end: 2,
    startIdx: 0,
    endIdx: 1,
    measurement: { nodes: [] },
    selectedNodes: [],
    shadowedTokenCount: 2000
  };
  // The budget is the cap regardless of the shadowed span size.
  assert.equal(engine.effectiveMaxTokens(2000), 4096);
  assert.equal(engine.effectiveMaxTokens(1_000_000), 4096);
  const result = await engine.compile(prepared, undefined, undefined);
  // 2000 priced tokens fit under the 4096 cap, so the long user text survives
  // untruncated.
  const text = result.entries.map((entry) => entry.text).join("\n");
  assert.match(text, /word word word/);
  assert.ok(text.length > 400, `long text survived (${text.length} chars)`);
  assert.equal(result.capped, false);
});

test("compactNow resolves retainRatio against the routed model context", async () => {
  const session = makeIdleSession();
  const ctx = new Context();
  let resolvedRoute;
  let flushes = 0;
  ctx.provide("llm", {
    resolveModelInfo: async (provider, model) => {
      resolvedRoute = { provider, model };
      session.append(
        "user/message",
        createUserMessage({ content: [{ type: "text", text: "queued context" }], source: { kind: "user" } }),
        { surfaceOp: "append" }
      );
      return { provider, model, context: { contextWindow: 500 } };
    }
  });
  ctx.provide("tokenMeter", {
    measure: (target) => ({
      logRevision: 0,
      baseline: { kind: "none", tokens: 0 },
      surfaceDeltaTokens: 0,
      totalTokens: target.surface.nodes.length * 100,
      surfaceTokens: target.surface.nodes.length * 100,
      nodes: target.surface.nodes.map((seq) => ({ seq, tokens: 100, heuristicTokens: 100 }))
    }),
    estimateMessage: () => 10
  });
  ctx.provide("sessions", {
    flush: async () => {
      flushes += 1;
    }
  });
  const engine = new InstantCompactionEngine(ctx, {
    auto: false,
    retainTokens: 200,
    modelPolicies: [{ provider: "p", model: "m", retainRatio: 0.2 }],
    textTokens: 64,
    userTextTokens: 64,
    toolCallTokens: 32
  });
  const agent = {
    session,
    options: { provider: "p", model: "m" },
    runMaintenance: (task) => task(new AbortController().signal)
  };
  const result = await engine.compactNow(agent, new AbortController().signal);
  assert.deepEqual(resolvedRoute, { provider: "p", model: "m" });
  assert.ok(result !== null);
  assert.equal(flushes, 1);
  assert.deepEqual(result.shadowedSeqs, [1, 2, 3, 4, 5]);
});

test("engine regionDependencies drive a real manual transaction end-to-end", async () => {
  const session = makeIdleSession();
  const ctx = new Context();
  ctx.provide("tokenMeter", {
    measure: (target) => ({
      logRevision: 0,
      baseline: { kind: "none", tokens: 0 },
      surfaceDeltaTokens: 0,
      totalTokens: 0,
      surfaceTokens: 0,
      nodes: target.surface.nodes.map((seq) => ({ seq, tokens: 100, heuristicTokens: 100 }))
    }),
    estimateMessage: (message) => message.content.reduce((total, block) => total + Math.ceil((block.text?.length ?? 0) / 4), 0)
  });
  const engine = new InstantCompactionEngine(ctx, {
    auto: false,
    textTokens: 64,
    userTextTokens: 64,
    toolCallTokens: 32,
    toolResultExcerptTokens: 32,
    maxTokens: 512
  });
  const result = await compactSurfaceRegion(engine.regionDependencies(), session, 1, 4, undefined, {
    owner: null,
    stability: "selected-span"
  }, undefined);
  assert.deepEqual(result.shadowedSeqs, [1, 2, 3, 4]);
  const summaryEvent = session.eventAt(result.summarySeq);
  assert.equal(summaryEvent.data.provider, "dsh-compaction-instant");
  assert.equal(summaryEvent.data.model, "vcc-compiler");
  const checkpoint = session.eventAt(result.summarySeq + 1);
  assert.equal(checkpoint.data.source.kind, "compact-checkpoint");
  assert.equal(checkpoint.data.source.sourceCommandId, undefined);
  const text = checkpoint.data.content.map((block) => block.text).join("\n");
  assert.match(text, /<compacted-checkpoint>/);
  assert.match(text, /自动压缩: 将 4 个节点 \/ ~400 tokens 编译为 \d+ 条目 \/ ~\d+ tokens/);
  assert.match(text, /## Compiled checkpoint: 4 nodes \(seqs 1-4/);
  assert.match(text, /尾部原文保留: 1 节点 \/ ~100 tokens/);
  assert.match(text, /RECALL: /);
  assert.match(text, /recall/);
  assert.match(text, /search/);
  assert.match(text, /\* read "a\.js" \(seq 2 -> result 3\)/);
  assert.doesNotMatch(text, /-> read: ok/);
  assert.deepEqual(session.surface.nodes, [checkpoint.seq, 5]);
});

for (const trigger of ["manual", "pressure", "context-overflow"]) {
  test("0.2.0 " + trigger + " compaction preserves the system head and replays", async () => {
    const original = makeIdleSession();
    const system = createSystemMessage("Keep the system policy verbatim.", "test-policy");
    const seed = [
      { type: "system/message", seq: 0, time: 0, data: { message: system }, surfaceOp: "append" },
      ...Array.from({ length: original.seq }, (_, seq) => ({ ...original.eventAt(seq), seq: seq + 1 }))
    ];
    const session = Session.create("system-" + trigger, seed);
    session.append("turn/start", { turn: 2 });
    const tail = session.append("user/message", createUserMessage({
      content: [{ type: "text", text: "latest turn stays raw" }], source: { kind: "user" }
    }), { surfaceOp: "append" });
    session.append("turn/end", { turn: 2, reason: { kind: "completed" } });
    session.append("request/header", { header: { config: { provider: "p", model: "m" } }, reason: "initial" });
    if (trigger !== "manual") session.append("turn/start", { turn: 3 });
    const ctx = new Context();
    let resolutions = 0;
    let flushes = 0;
    ctx.provide("llm", { resolveModelInfo: async () => {
      resolutions += 1;
      return { context: { contextWindow: 10000 } };
    } });
    ctx.provide("sessions", { flush: async () => { flushes += 1; } });
    ctx.provide("tokenMeter", {
      measure: (target) => ({
        totalTokens: trigger === "context-overflow" ? 100 : target.surface.nodes.length * 1000,
        nodes: target.surface.nodes.map((seq) => ({ seq, tokens: 1000, heuristicTokens: 1000 }))
      }),
      estimateMessage: () => 10
    });
    const engine = new InstantCompactionEngine(ctx, {
      auto: false,
      // Overflow must ignore the generous configured retention and low pressure.
      retainTokens: trigger === "context-overflow" ? 100000 : 1000
    });
    const agent = { session, runMaintenance: (task) => task(new AbortController().signal) };
    const signal = new AbortController().signal;
    const result = trigger === "manual"
      ? await engine.compactNow(agent, signal)
      : await engine.compactIfNeeded(agent, trigger, signal);
    assert.ok(result);
    assert.deepEqual(result.shadowedSeqs, [2, 3, 4, 5, 6]);
    assert.deepEqual(session.surface.nodes, [0, result.summarySeq + 1, tail.seq]);
    assert.deepEqual(session.deriveMessages()[0], system);
    assert.equal(flushes, trigger === "manual" ? 1 : 0);
    assert.equal(resolutions, trigger === "pressure" ? 1 : 0);
    const log = Array.from({ length: session.seq }, (_, seq) => session.eventAt(seq));
    const replayed = Session.create("replayed-system-" + trigger, JSON.parse(JSON.stringify(log)));
    assert.deepEqual(replayed.surface.nodes, session.surface.nodes);
    assert.deepEqual(replayed.deriveMessages(), session.deriveMessages());
  });
}

test("overflow hook requires durable progress, respects cancellation and bounds retries", async () => {
  const ctx = new Context();
  const engine = new InstantCompactionEngine(ctx, { auto: true, maxOverflowRetries: 2 });
  const session = makeIdleSession();
  session.append("request/header", { header: { config: { provider: "p", model: "m" } }, reason: "initial" });
  const agent = { session };
  const controller = new AbortController();
  const fallback = { kind: "unhandled" };
  let calls = 0;
  let mode = "no-progress";
  // Isolate hook policy, but advance progress only via real validated Session
  // replacement commits, never by mutating/mocking replaceGeneration.
  engine.compactIfNeeded = async (owner, trigger) => {
    assert.equal(owner, agent);
    assert.equal(trigger, "context-overflow");
    calls += 1;
    if (mode === "no-progress") return null;
    const seq = session.surface.nodes[0];
    session.append("user/message", createUserMessage({
      content: [{ type: "text", text: "recovery checkpoint " + calls }],
      source: { kind: "plugin", plugin: "compact" }
    }), { surfaceOp: { op: "replace", startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] });
    if (mode === "cancel") controller.abort();
    return null;
  };
  const dispatch = (signal = new AbortController().signal) => ctx.waterfall("agent/request-error", {
    agent, failure: { code: CONTEXT_WINDOW_EXCEEDED_CODE, message: "context exceeded" }, signal
  }, () => fallback);
  assert.equal(await dispatch(), fallback, "no replacement means no retry");
  assert.equal(calls, 1);
  assert.equal(await dispatch(AbortSignal.abort()), fallback);
  assert.equal(calls, 1, "pre-cancelled requests never compact");
  mode = "progress";
  assert.deepEqual(await dispatch(), { kind: "retry" });
  assert.deepEqual(await dispatch(), { kind: "retry" });
  assert.equal(await dispatch(), fallback, "third recovery exceeds maxOverflowRetries");
  assert.equal(calls, 3);
  ctx.emit("agent/status", { agent, status: "idle" });
  mode = "cancel";
  assert.equal(await dispatch(controller.signal), fallback, "cancellation after progress still prevents retry");
  assert.equal(calls, 4, "idle reset admitted another recovery");
});
