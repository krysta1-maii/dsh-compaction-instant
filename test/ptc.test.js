/**
 * PTC bridge fixtures for dsh-compaction-instant.
 *
 * These tests drive a real Context, SystemPrompt, ToolRuntime(mode: "ptc"),
 * Session, and the plugin's recall/search definitions through a programmable
 * FakeRuntime. They do not call a model, the network, the GUI, or a host
 * profile. The two baselines below must keep passing: nested dispatch stays
 * out of deriveMessages, and the outer run_code/result pairing survives replay.
 * @module dsh-compaction-instant/test/ptc
 */
import assert from "node:assert/strict";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import { ToolCallId, createAssistantMessage, createToolResultMessage, createUserMessage } from "@deepseek-ai/dsh-llm";
import { PtcRuntime } from "@deepseek-ai/dsh-ptc-runtime";
import { Session, TOOL_NOT_STARTED, TOOL_OUTCOME_UNKNOWN } from "@deepseek-ai/dsh-session";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime, { RUN_CODE_NAME, defineTool } from "@deepseek-ai/dsh-tools";
import { MAX_RECALL_ENTRIES, compileNodes, compileRegion } from "../src/compiler.js";
import { InstantCompactionEngine } from "../src/index.js";
import { expandSelections, parseSeqSpec, resolveRecallReference } from "../src/recall.js";
import { compactSurfaceRegion } from "../src/region.js";
import { searchSession } from "../src/search.js";
import * as recallTools from "../src/tool.js";

// Internal module with no package subpath: load the file shipped in the same
// package so the isolated tarball check exercises the installed copy too.
const { buildPtcDispatchIndex } = await import(new URL("./src/ptc.js", import.meta.resolve("dsh-compaction-instant/package.json")));

/** Programmable in-process runtime. Tests set `behavior` to drive `request.bindings`. */
class FakeRuntime extends PtcRuntime {
  /**
   * @param ctx - owning context.
   * @param config - optional language override.
   */
  constructor(ctx, config = {}) {
    super(ctx);
    this.language = config.language ?? "typescript";
  }

  /** @type {string} */
  language;
  isolation = "fake";
  /** @type {(request: object) => Promise<object>} */
  behavior = () => Promise.resolve({ logs: [] });
  /** @type {object | undefined} */
  lastRequest;

  /** Fill provider defaults without executing. */
  resolve(request) {
    return {
      ...request,
      cwd: request.cwd ?? process.cwd(),
      timeoutMs: request.timeoutMs ?? 120_000
    };
  }

  /** Record the request and hand it to the test-owned behavior. */
  run(request) {
    this.lastRequest = request;
    return this.behavior(request);
  }
}

let sessionSerial = 0;

/**
 * Install the PTC presentation stack and this plugin's recall/search tools.
 * @param options - optional mode, runtime, and tool-order overrides.
 * @returns the live context, registry, prompt, and fake runtime.
 */
async function setupPtc(options = {}) {
  const ctx = new Context();
  ctx.provide("workingDirectory", {
    ensure: async () => process.cwd()
  });
  await ctx.plugin(SystemPrompt, options.toolOrder ? { toolOrder: options.toolOrder } : {});
  await ctx.plugin(ToolRuntime, {
    mode: options.mode ?? "ptc",
    ...(options.maxParallelSubCalls !== undefined ? { maxParallelSubCalls: options.maxParallelSubCalls } : {})
  });
  let runtime;
  if (options.runtime !== false) {
    await ctx.plugin(FakeRuntime, options.runtime ?? {});
    runtime = ctx.ptcRuntime;
  }
  await ctx.plugin(recallTools);
  return { ctx, tools: ctx.tools, systemPrompt: ctx.systemPrompt, runtime };
}

/** Create one detached session. Construction appends the inherited end-seed marker. */
function makePtcSession(id = `ptc-${++sessionSerial}`) {
  return Session.create(id, []);
}

/**
 * Execute one outer run_code against a real session. Dispatch logging uses
 * `agent.session.append`; pass `signal` to observe cancellation.
 * @param ctx - context whose tools registry owns run_code.
 * @param session - session that receives dispatch events.
 * @param code - program text stored on the outer call.
 * @param extras - description, call id, signal, or agent override.
 * @returns the canonical run_code result.
 */
function runCode(ctx, session, code, extras = {}) {
  return ctx.tools.execute({
    signal: extras.signal ?? new AbortController().signal,
    callId: ToolCallId(extras.callId ?? "call-1"),
    name: RUN_CODE_NAME,
    arguments: {
      code,
      description: extras.description ?? "Run the test program",
      ...(extras.timeoutMs !== undefined ? { timeoutMs: extras.timeoutMs } : {})
    },
    agent: extras.agent ?? { id: session.id, session, ctx }
  });
}

/** Read settled and start dispatch events in log order. */
function readDispatch(session) {
  return session.snapshotEvents().filter((event) => event.type === "tool/ptc-dispatch" || event.type === "tool/ptc-dispatch-start");
}

/** Project current surface nodes the way the compiler consumes them. */
function surfaceNodes(session) {
  return session.surface.nodes.map((seq) => ({
    seq,
    message: session.deriveEventMessage(session.eventAt(seq))
  }));
}

const PAIR_CONFIG = {
  maxTokens: 8192,
  textTokens: 512,
  userTextTokens: 1024,
  toolCallTokens: 128,
  toolResultExcerptTokens: 256,
  includeReasoning: false,
  stripNoiseXml: true,
  noisePatterns: [],
  toolKeyFields: {},
  toolArgTools: [],
  hideTools: []
};

/**
 * Record one completed outer turn whose program performs a nested read.
 * The returned session already contains drained start/settle events.
 */
async function recordNestedRead() {
  const setup = await setupPtc();
  setup.ctx.tools.register(defineTool({
    name: "read",
    description: "Read a file.",
    parameters: { file_path: { type: "string", required: true } },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: value }]
    },
    execute: (args) => Promise.resolve(`contents of ${args.file_path}`)
  }));
  const session = makePtcSession();
  session.append("turn/start", { turn: 1 });
  const user = session.append("user/message", createUserMessage({
    content: [{ type: "text", text: "inspect a.js" }],
    source: { kind: "user" }
  }), { surfaceOp: "append" });
  const code = "await tools.read({ file_path: 'a.js' })";
  const description = "Inspect a.js";
  const assistant = session.append("assistant/message", {
    turn: 1,
    step: 1,
    stream: [],
    message: createAssistantMessage({
      content: [{
        type: "tool-call",
        id: "call-1",
        name: RUN_CODE_NAME,
        arguments: JSON.stringify({ code, description })
      }],
      source: { provider: "p", model: "m" }
    })
  }, { surfaceOp: "append" });
  setup.runtime.behavior = async (request) => {
    const value = await request.bindings[0].functions.read({ file_path: "a.js" });
    return { logs: [`saw ${value}`], value };
  };
  const executed = await runCode(setup.ctx, session, code, { description });
  const toolResult = session.append("tool/result", {
    message: createToolResultMessage({
      callId: "call-1",
      content: executed.content,
      isError: executed.isError
    })
  }, { surfaceOp: "append" });
  session.append("turn/end", { turn: 1 });
  return { ...setup, session, executed, user, assistant, toolResult, code, description };
}

test("nested PTC dispatch stays out of deriveMessages", async () => {
  const { ctx, systemPrompt, session, executed } = await recordNestedRead();
  try {
    const assembly = await systemPrompt.assemble();
    assert.deepEqual(assembly.tools.map((tool) => tool.name), [RUN_CODE_NAME]);
    const sdk = assembly.sections.find((section) => section.name === "tools:sdk");
    assert.match(sdk?.text ?? "", /recall:/);
    assert.match(sdk?.text ?? "", /search:/);
    assert.equal(executed.isError, false);
    assert.deepEqual(executed.value, { logs: ["saw contents of a.js"], result: "contents of a.js" });

    const dispatch = readDispatch(session);
    assert.deepEqual(dispatch.map((event) => event.type), ["tool/ptc-dispatch-start", "tool/ptc-dispatch"]);
    assert.equal(dispatch[1].data.name, "read");
    assert.deepEqual(dispatch[1].data.arguments, { file_path: "a.js" });
    assert.equal(dispatch[1].data.isError, false);
    assert.deepEqual(dispatch[1].data.content, [{ type: "text", text: "contents of a.js" }]);
    for (const event of dispatch) {
      assert.equal(session.deriveEventMessage(event), null);
      assert.equal(session.surface.nodes.includes(event.seq), false);
    }
    const messages = session.deriveMessages();
    assert.deepEqual(messages.map((message) => message.role), ["user", "assistant", "tool"]);
    assert.equal(JSON.stringify(messages).includes("tool/ptc-dispatch"), false);
  } finally {
    await ctx.fiber.dispose();
  }
});

test("outer run_code result pairing survives replay", async () => {
  const { ctx, session, assistant, toolResult } = await recordNestedRead();
  try {
    const messages = session.deriveMessages();
    const call = messages[1].content.find((block) => block.type === "tool-call");
    assert.equal(call.name, RUN_CODE_NAME);
    assert.equal(call.id, "call-1");
    assert.equal(messages[2].role, "tool");
    assert.equal(messages[2].toolCallId, call.id);
    const compiled = compileNodes(surfaceNodes(session), PAIR_CONFIG);
    assert.equal(compiled.stats.toolCalls, 1);
    assert.equal(compiled.stats.toolResults, 1);
    assert.match(compiled.entries.map((entry) => entry.text).join("\n"), new RegExp(`\\(seq ${assistant.seq} -> result ${toolResult.seq}\\)`));
    assert.equal(compiled.entries.some((entry) => readDispatch(session).some((event) => event.seq === entry.seq && event.type === "tool/ptc-dispatch")), false);

    const snapshot = session.snapshotEvents();
    const replayed = Session.create(`${session.id}-replay`, JSON.parse(JSON.stringify(snapshot)));
    assert.deepEqual(replayed.surface.nodes, session.surface.nodes);
    assert.deepEqual(replayed.deriveMessages(), session.deriveMessages());
    assert.deepEqual(readDispatch(replayed).map((event) => ({
      seq: event.seq,
      type: event.type,
      data: event.data
    })), readDispatch(session).map((event) => ({
      seq: event.seq,
      type: event.type,
      data: event.data
    })));
    assert.equal(replayed.deriveEventMessage(replayed.eventAt(readDispatch(replayed)[1].seq)), null);
  } finally {
    await ctx.fiber.dispose();
  }
});

/** Build one log-only dispatch start/settle pair for the outer call-1. */
function makeDispatch(subCall, details = {}) {
  const data = {
    rootCallId: details.rootCallId ?? "call-1",
    parentCallId: details.parentCallId ?? "call-1",
    subCallId: details.subCallId ?? `call-1:ptc:${subCall}`,
    name: details.name ?? "read",
    arguments: details.arguments ?? { file_path: "a.js" }
  };
  return {
    start: { type: "tool/ptc-dispatch-start", data },
    settle: {
      type: "tool/ptc-dispatch",
      data: {
        ...data,
        isError: details.isError ?? false,
        content: [{ type: "text", text: `outcome ${subCall}` }]
      }
    }
  };
}

/**
 * Build one idle session whose outer run_code call has the supplied dispatch
 * history. `resultError` classifies the outer result for recovery handling.
 */
function makePtcHistory({ dispatches = [], resultError, finalText } = {}) {
  const session = Session.create(`ptc-history-${++sessionSerial}`, []);
  session.append("turn/start", { turn: 1 });
  const user = session.append("user/message", createUserMessage({
    content: [{ type: "text", text: "run it" }],
    source: { kind: "user" }
  }), { surfaceOp: "append" });
  const code = "await tools.read({ file_path: 'a.js' })";
  const assistant = session.append("assistant/message", {
    turn: 1,
    step: 1,
    stream: [],
    message: createAssistantMessage({
      content: [{
        type: "tool-call",
        id: "call-1",
        name: RUN_CODE_NAME,
        arguments: JSON.stringify({ code, description: "Inspect a.js" })
      }],
      source: { provider: "p", model: "m" }
    })
  }, { surfaceOp: "append" });
  for (const event of dispatches) session.append(event.type, event.data);
  const result = session.append("tool/result", {
    message: createToolResultMessage({
      callId: "call-1",
      content: [{ type: "text", text: "outer outcome" }],
      isError: resultError !== undefined
    }),
    ...resultError === undefined ? {} : { error: resultError }
  }, { surfaceOp: "append" });
  if (finalText !== undefined) {
    session.append("assistant/message", {
      turn: 1,
      step: 2,
      stream: [],
      message: createAssistantMessage({
        content: [{ type: "text", text: finalText }],
        source: { provider: "p", model: "m" }
      })
    }, { surfaceOp: "append" });
  }
  session.append("turn/end", { turn: 1 });
  return { session, user, assistant, result };
}

/** Create an engine whose meter prices every surface node at 100 tokens. */
function makeEngine(config = {}) {
  const ctx = new Context();
  ctx.provide("tokenMeter", {
    measure: (target) => {
      const nodes = target.surface.nodes.map((seq) => ({ seq, tokens: 100, heuristicTokens: 100 }));
      return {
        logRevision: 0,
        baseline: { kind: "none", tokens: 0 },
        surfaceDeltaTokens: 0,
        totalTokens: nodes.length * 100,
        surfaceTokens: nodes.length * 100,
        nodes
      };
    },
    estimateMessage: () => 10
  });
  const engine = new InstantCompactionEngine(ctx, {
    auto: false,
    textTokens: 64,
    userTextTokens: 64,
    toolCallTokens: 32,
    toolResultExcerptTokens: 32,
    ...config
  });
  return { ctx, engine };
}

test("PTC dispatch index pairs nested calls and makes their settle recoverable", async () => {
  const { ctx, session, assistant, toolResult } = await recordNestedRead();
  try {
    const nodes = surfaceNodes(session);
    const index = buildPtcDispatchIndex(session, nodes);
    const dispatch = readDispatch(session);
    assert.deepEqual(index.referencedSeqs, dispatch.map((event) => event.seq));
    const pairs = index.byOuterCallId.get("call-1");
    assert.equal(pairs.length, 1);
    const pair = pairs[0];
    assert.equal(pair.name, "read");
    assert.deepEqual(pair.arguments, { file_path: "a.js" });
    assert.equal(pair.startSeq, dispatch[0].seq);
    assert.equal(pair.settleSeq, dispatch[1].seq);
    assert.equal(pair.isError, false);

    const compiled = compileRegion(nodes, PAIR_CONFIG, index);
    const text = compiled.entries.map((entry) => entry.text).join("\n");
    assert.match(text, new RegExp(`\\* run_code "Inspect a\\.js" \\(seq ${assistant.seq} -> result ${toolResult.seq}\\)`));
    assert.match(text, new RegExp(`\\* read "a\\.js" \\(seq ${pair.startSeq} -> result ${pair.settleSeq}\\)`));
    assert.match(text, /RECALL|run_code/, "compiled entries remain model-facing rows");

    const resolved = resolveRecallReference(session, "result", String(pair.settleSeq));
    assert.deepEqual(resolved, { selections: [{ start: pair.settleSeq, end: pair.settleSeq }], errors: [] });
    const tool = recallTools.defineRecallTool(recallTools.resolveConfig({}));
    const value = await tool.execute({ type: "result", id: String(pair.settleSeq) }, { agent: { session } });
    assert.match(value.text, new RegExp(`\\[seq ${pair.settleSeq}: tool\\/ptc-dispatch\\]`));
    assert.match(value.text, /"name":"read"/);
    assert.match(value.text, /"file_path":"a\.js"/);
    assert.match(value.text, /contents of a\.js/);
    assert.match(value.text, /"isError":false/);
    const start = resolveRecallReference(session, "result", String(pair.startSeq));
    assert.match(start.errors[0], /not a tool result/);
  } finally {
    await ctx.fiber.dispose();
  }
});

test("interrupted outer results mix settled and start-only dispatches", async () => {
  const settled = makeDispatch(1);
  const unknownDispatch = makeDispatch(2);
  const { session } = makePtcHistory({
    dispatches: [settled.start, settled.settle, unknownDispatch.start],
    resultError: { name: "ToolOutcomeUnknownError", code: TOOL_OUTCOME_UNKNOWN }
  });
  const index = buildPtcDispatchIndex(session, surfaceNodes(session));
  const dispatch = readDispatch(session);
  const pairs = index.byOuterCallId.get("call-1");
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].settleSeq, dispatch.find((event) => event.type === "tool/ptc-dispatch").seq);
  assert.equal("settleSeq" in pairs[1], false);
  const compiled = compileRegion(surfaceNodes(session), PAIR_CONFIG, index);
  const nested = compiled.entries.filter((entry) => entry.kind === "tool" && entry.text.includes("read"));
  assert.equal(nested.length, 2);
  assert.match(nested[0].text, /\(seq \d+ -> result \d+\)$/);
  assert.match(nested[1].text, /\(seq \d+\)$/);
  assert.equal(nested[1].recoverySeqs.length, 1);
});

test("dispatch pairing rejects normal start-only, duplicate, orphan, and identity mismatch", async () => {
  const normal = makeDispatch(1);
  const normalHistory = makePtcHistory({ dispatches: [normal.start] });
  assert.throws(() => buildPtcDispatchIndex(normalHistory.session, surfaceNodes(normalHistory.session)), /has no settle/);

  const duplicate = makeDispatch(2);
  const duplicateHistory = makePtcHistory({ dispatches: [duplicate.start, duplicate.start] });
  assert.throws(() => buildPtcDispatchIndex(duplicateHistory.session, surfaceNodes(duplicateHistory.session)), /duplicate/);

  const orphan = makeDispatch(3);
  const orphanHistory = makePtcHistory({ dispatches: [orphan.settle] });
  assert.throws(() => buildPtcDispatchIndex(orphanHistory.session, surfaceNodes(orphanHistory.session)), /has no start/);

  const mismatch = makeDispatch(4);
  const mismatchSettle = {
    ...mismatch.settle,
    data: { ...mismatch.settle.data, arguments: { file_path: "b.js" } }
  };
  const mismatchHistory = makePtcHistory({ dispatches: [mismatch.start, mismatchSettle] });
  assert.throws(() => buildPtcDispatchIndex(mismatchHistory.session, surfaceNodes(mismatchHistory.session)), /identity mismatch/);

  const rootMismatch = makeDispatch(5);
  const rootSettle = {
    ...rootMismatch.settle,
    data: { ...rootMismatch.settle.data, rootCallId: "other-root" }
  };
  const rootHistory = makePtcHistory({ dispatches: [rootMismatch.start, rootSettle] });
  assert.throws(() => buildPtcDispatchIndex(rootHistory.session, surfaceNodes(rootHistory.session)), /identity mismatch/);

  const notStarted = makeDispatch(6);
  const notStartedHistory = makePtcHistory({
    dispatches: [notStarted.start, notStarted.settle],
    resultError: { name: "ToolNotStartedError", code: TOOL_NOT_STARTED }
  });
  assert.throws(() => buildPtcDispatchIndex(notStartedHistory.session, surfaceNodes(notStartedHistory.session)), /TOOL_NOT_STARTED/);

  const failed = makeDispatch(7);
  const failedHistory = makePtcHistory({
    dispatches: [failed.start],
    resultError: { name: "CodeRunFailedError", code: "CODE_RUN_FAILED" }
  });
  assert.throws(() => buildPtcDispatchIndex(failedHistory.session, surfaceNodes(failedHistory.session)), /has no settle/);
});

test("compaction cites dispatch sources without shadowing them and replays", async () => {
  const setup = await recordNestedRead();
  const { ctx: ptcCtx, session, user, toolResult } = setup;
  const { ctx: engineCtx, engine } = makeEngine();
  try {
    const dispatchSeqs = readDispatch(session).map((event) => event.seq);
    const compaction = await compactSurfaceRegion(engine.regionDependencies(), session, user.seq, toolResult.seq, undefined, {
      owner: null,
      stability: "selected-span"
    }, undefined);
    const checkpoint = session.eventAt(compaction.summarySeq + 1);
    assert.deepEqual(compaction.shadowedSeqs, [user.seq, setup.assistant.seq, toolResult.seq]);
    assert.equal(compaction.shadowedSeqs.some((seq) => dispatchSeqs.includes(seq)), false);
    assert.deepEqual(checkpoint.sourceEventSeqs, [
      compaction.startSeq,
      compaction.summarySeq,
      user.seq,
      setup.assistant.seq,
      toolResult.seq,
      ...dispatchSeqs
    ]);
    const text = checkpoint.data.content.map((block) => block.text).join("\n");
    assert.match(text, /run_code "Inspect a\.js"/);
    assert.match(text, new RegExp(`\\* read "a\\.js" \\(seq ${dispatchSeqs[0]} -> result ${dispatchSeqs[1]}\\)`));
    const recalled = await recallTools.defineRecallTool(recallTools.resolveConfig({})).execute({
      type: "result",
      id: String(dispatchSeqs[1])
    }, { agent: { session } });
    assert.match(recalled.text, /contents of a\.js/);
    const replayed = Session.create(`${session.id}-compaction-replay`, JSON.parse(JSON.stringify(session.snapshotEvents())));
    assert.deepEqual(replayed.surface.nodes, session.surface.nodes);
    assert.deepEqual(replayed.deriveMessages(), session.deriveMessages());
    assert.deepEqual(replayed.eventAt(checkpoint.seq).sourceEventSeqs, checkpoint.sourceEventSeqs);
    assert.equal(replayed.deriveEventMessage(replayed.eventAt(dispatchSeqs[0])), null, "dispatch stays log-only after replay");
  } finally {
    await ptcCtx.fiber.dispose();
    await engineCtx.fiber.dispose();
  }
});

test("elision markers still recover native results and nested settles", async () => {
  const pair = makeDispatch(1);
  const { session, user } = makePtcHistory({
    dispatches: [pair.start, pair.settle],
    finalText: "latest answer survives"
  });
  const { ctx, engine } = makeEngine({ checkpointCap: 16, textTokens: 8, userTextTokens: 8, toolCallTokens: 8 });
  try {
    const end = session.surface.nodes.at(-1);
    const compaction = await compactSurfaceRegion(engine.regionDependencies(), session, user.seq, end, undefined, {
      owner: null,
      stability: "selected-span"
    }, undefined);
    const checkpoint = session.eventAt(compaction.summarySeq + 1);
    const text = checkpoint.data.content.map((block) => block.text).join("\n");
    const selections = [...text.matchAll(/entries elided: (seqs? [^\]]+)/g)].map((match) => match[1]);
    assert.ok(selections.length > 0, "cap elision produced markers");
    const recovered = [];
    for (const selection of selections) {
      const parsed = parseSeqSpec(selection);
      assert.deepEqual(parsed.errors, [], selection);
      recovered.push(...expandSelections(parsed.selections));
    }
    const dispatchEvents = readDispatch(session);
    const settleSeq = dispatchEvents.find((event) => event.type === "tool/ptc-dispatch").seq;
    const recoveredSet = new Set(recovered);
    assert.ok(recoveredSet.has(settleSeq), "nested settle is reachable through a marker");
    const outerResultSeq = compaction.shadowedSeqs.find((seq) => session.eventAt(seq).type === "tool/result");
    assert.ok(recoveredSet.has(outerResultSeq), "outer result recovery seq appears in a marker");
    const restoredNested = await recallTools.defineRecallTool(recallTools.resolveConfig({})).execute({
      type: "seq",
      id: String(settleSeq)
    }, { agent: { session } });
    assert.match(restoredNested.text, /outcome 1/);
    const restoredOuter = await recallTools.defineRecallTool(recallTools.resolveConfig({})).execute({
      type: "result",
      id: String(outerResultSeq)
    }, { agent: { session } });
    assert.match(restoredOuter.text, /outer outcome/);
    assert.match(text, /latest answer survives/, "the newest text row survives elision");
  } finally {
    await ctx.fiber.dispose();
  }
});

test("a PTC program completes search -> recall through structured fields", async () => {
  const setup = await recordNestedRead();
  const { ctx, session, runtime } = setup;
  try {
    session.append("turn/start", { turn: 2 });
    session.append("user/message", createUserMessage({
      content: [{ type: "text", text: "find the nested result" }],
      source: { kind: "user" }
    }), { surfaceOp: "append" });
    const code = [
      "const found = await tools.search({ pattern: 'contents of a[.]js' });",
      "const hit = found.hits.find((candidate) => candidate.kind === 'tool/ptc-dispatch');",
      "if (!hit) throw new Error('missing nested dispatch');",
      "const restored = await tools.recall({ type: 'seq', id: String(hit.seq) });",
      "return { hit, restoredSeqs: restored.seqs, restoredEntrySeqs: restored.entries.map((entry) => entry.seq) };"
    ].join("\n");
    session.append("assistant/message", {
      turn: 2,
      step: 1,
      stream: [],
      message: createAssistantMessage({
        content: [{
          type: "tool-call",
          id: "call-2",
          name: RUN_CODE_NAME,
          arguments: JSON.stringify({ code, description: "Find nested result" })
        }],
        source: { provider: "p", model: "m" }
      })
    }, { surfaceOp: "append" });
    runtime.behavior = async (request) => {
      const [binding] = request.bindings;
      const found = await binding.functions.search({ pattern: "contents of a[.]js" });
      if (!Array.isArray(found.hits)) throw new Error("search hits missing from canonical value");
      const hit = found.hits.find((candidate) => candidate.kind === "tool/ptc-dispatch");
      if (hit === undefined) throw new Error("missing nested dispatch");
      const restored = await binding.functions.recall({ type: "seq", id: String(hit.seq) });
      return {
        logs: [],
        value: {
          hit,
          restoredSeqs: restored.seqs,
          restoredEntrySeqs: restored.entries.map((entry) => entry.seq)
        }
      };
    };
    const executed = await runCode(ctx, session, code, { callId: "call-2", description: "Find nested result" });
    assert.equal(executed.isError, false, executed.error?.message);
    const programResult = executed.value.result;
    assert.equal(programResult.hit.kind, "tool/ptc-dispatch");
    assert.match(programResult.hit.text, /contents of a\.js/);
    assert.deepEqual(programResult.restoredSeqs, [programResult.hit.seq]);
    assert.deepEqual(programResult.restoredEntrySeqs, [programResult.hit.seq]);
    assert.doesNotMatch(code, /\.text\.match|JSON\.parse\(restored/);
    session.append("tool/result", {
      message: createToolResultMessage({
        callId: "call-2",
        content: executed.content,
        isError: executed.isError
      })
    }, { surfaceOp: "append" });
    session.append("turn/end", { turn: 2 });
    assert.deepEqual(session.deriveMessages().slice(-2).map((message) => message.role), ["assistant", "tool"]);
  } finally {
    await ctx.fiber.dispose();
  }
});

test("corrupt dispatch pairing aborts compaction inside an error bracket", async () => {
  const orphan = makeDispatch(1);
  const { session, user, result } = makePtcHistory({ dispatches: [orphan.settle] });
  const { ctx, engine } = makeEngine();
  try {
    const surfaceBefore = [...session.surface.nodes];
    await assert.rejects(
      () => compactSurfaceRegion(engine.regionDependencies(), session, user.seq, result.seq, undefined, {
        owner: null,
        stability: "selected-span"
      }, undefined),
      (error) => error.cause?.message?.includes("has no start") === true
    );
    const markers = session.snapshotEvents().filter((event) => event.type.startsWith("compaction/"));
    assert.deepEqual(markers.map((event) => event.type), ["compaction/start", "compaction/end"]);
    assert.ok(markers[1].data.error.length > 0);
    assert.deepEqual(session.surface.nodes, surfaceBefore);
  } finally {
    await ctx.fiber.dispose();
  }
});

test("spill-policy previews stay visible and are not called the full original", async () => {
  const setup = await setupPtc();
  try {
    setup.ctx.tools.register(defineTool({
      name: "read",
      description: "Read a file.",
      parameters: { file_path: { type: "string", required: true } },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }]
      },
      execute: (args) => Promise.resolve(`FULL CANONICAL PAYLOAD for ${args.file_path}`)
    }));
    setup.ctx.on("tools/ptc-dispatch-log", async (dispatch, next) => {
      const content = await next();
      if (dispatch.name !== "read") return content;
      return [{ type: "text", text: "PREVIEW: full payload was spilled; locator: spill://opaque-handle" }];
    });
    const session = makePtcSession();
    session.append("turn/start", { turn: 1 });
    session.append("user/message", createUserMessage({
      content: [{ type: "text", text: "inspect" }], source: { kind: "user" }
    }), { surfaceOp: "append" });
    const code = "await tools.read({ file_path: 'a.js' })";
    session.append("assistant/message", {
      turn: 1,
      step: 1,
      stream: [],
      message: createAssistantMessage({
        content: [{ type: "tool-call", id: "spill-call", name: RUN_CODE_NAME, arguments: JSON.stringify({ code, description: "Inspect a.js" }) }],
        source: { provider: "p", model: "m" }
      })
    }, { surfaceOp: "append" });
    setup.runtime.behavior = async (request) => {
      const value = await request.bindings[0].functions.read({ file_path: "a.js" });
      return { logs: [], value };
    };
    const executed = await runCode(setup.ctx, session, code, { callId: "spill-call", description: "Inspect a.js" });
    assert.equal(executed.isError, false);
    assert.match(executed.value.result, /FULL CANONICAL PAYLOAD/);
    const settle = readDispatch(session).find((event) => event.type === "tool/ptc-dispatch");
    assert.match(settle.data.content[0].text, /PREVIEW/);
    assert.match(settle.data.content[0].text, /spill:\/\/opaque-handle/);
    const tool = recallTools.defineRecallTool(recallTools.resolveConfig({}));
    const recalled = await tool.execute({ type: "result", id: String(settle.seq) }, { agent: { session } });
    assert.match(recalled.text, /PREVIEW/);
    assert.match(recalled.text, /spill:\/\/opaque-handle/);
    assert.doesNotMatch(recalled.text, /FULL CANONICAL PAYLOAD/);
    const found = await recallTools.defineSearchTool(recallTools.resolveConfig({})).execute({
      pattern: "spill://"
    }, { agent: { session } });
    assert.ok(found.hits.some((hit) => hit.seq === settle.seq));
    await setup.ctx.fiber.dispose();
  } catch (error) {
    await setup.ctx.fiber.dispose();
    throw error;
  }
});

test("dispatch logs can land after the canonical value returns", async () => {
  const setup = await setupPtc();
  try {
    setup.ctx.tools.register(defineTool({
      name: "read",
      description: "Read a file.",
      parameters: { file_path: { type: "string", required: true } },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }]
      },
      execute: () => Promise.resolve("TIMING_SENTINEL")
    }));
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    setup.ctx.on("tools/ptc-dispatch-log", async (dispatch, next) => {
      const content = await next();
      if (dispatch.name === "read") await gate;
      return content;
    });
    const session = makePtcSession();
    session.append("turn/start", { turn: 1 });
    session.append("user/message", createUserMessage({
      content: [{ type: "text", text: "inspect" }], source: { kind: "user" }
    }), { surfaceOp: "append" });
    const code = [
      "const value = await tools.read({ file_path: 'a.js' });",
      "const found = await tools.search({ pattern: 'TIMING_SENTIN[E]L' });",
      "return { value, immediateMatches: found.totalMatches };"
    ].join("\n");
    session.append("assistant/message", {
      turn: 1,
      step: 1,
      stream: [],
      message: createAssistantMessage({
        content: [{ type: "tool-call", id: "timing-call", name: RUN_CODE_NAME, arguments: JSON.stringify({ code, description: "Time the log" }) }],
        source: { provider: "p", model: "m" }
      })
    }, { surfaceOp: "append" });
    let markSearched;
    const searched = new Promise((resolve) => {
      markSearched = resolve;
    });
    setup.runtime.behavior = async (request) => {
      const value = await request.bindings[0].functions.read({ file_path: "a.js" });
      const found = await request.bindings[0].functions.search({ pattern: "TIMING_SENTIN[E]L" });
      markSearched();
      return { logs: [], value: { value, immediateMatches: found.totalMatches } };
    };
    const running = runCode(setup.ctx, session, code, { callId: "timing-call", description: "Time the log" });
    await searched;
    const immediate = searchSession(session, "TIMING_SENTIN[E]L", { maxRecallTokens: 16000, maxSearchHits: 50 });
    assert.equal(immediate.totalMatches, 0, "the settled dispatch log is not visible before drain");
    release();
    const executed = await running;
    assert.equal(executed.isError, false);
    assert.equal(executed.value.result.immediateMatches, 0);
    const afterDrain = searchSession(session, "TIMING_SENTIN[E]L", { maxRecallTokens: 16000, maxSearchHits: 50 });
    assert.equal(afterDrain.totalMatches, 1);
    assert.equal(afterDrain.hits[0].kind, "tool/ptc-dispatch");
  } finally {
    await setup.ctx.fiber.dispose();
  }
});

test("large nested fan-out keeps chunked recovery markers within limits", async () => {
  const count = MAX_RECALL_ENTRIES + 1;
  const dispatches = [];
  for (let index = 1; index <= count; index += 1) {
    const pair = makeDispatch(index);
    dispatches.push(pair.start, pair.settle);
  }
  const { session } = makePtcHistory({ dispatches, finalText: "done" });
  const nodes = surfaceNodes(session);
  const index = buildPtcDispatchIndex(session, nodes);
  assert.equal(index.referencedSeqs.length, count * 2);
  assert.equal(new Set(index.referencedSeqs).size, count * 2);
  assert.deepEqual(index.referencedSeqs, [...index.referencedSeqs].sort((left, right) => left - right));
  const serialized = JSON.stringify(index.referencedSeqs);
  assert.ok(serialized.length > count, "provenance metadata grows linearly with inspected events");
  const compiled = compileRegion(nodes, { ...PAIR_CONFIG, maxTokens: 32 }, index);
  assert.ok(compiled.capped);
  const selections = compiled.entries
    .filter((entry) => entry.kind === "note")
    .flatMap((entry) => [...entry.text.matchAll(/entries elided: (seqs? [^\]]+)/g)].map((match) => match[1]));
  assert.ok(selections.length > 1, "the fan-out marker is split into multiple recallable chunks");
  const recovered = [];
  for (const selection of selections) {
    const parsed = parseSeqSpec(selection);
    assert.deepEqual(parsed.errors, [], selection);
    const width = parsed.selections.reduce((sum, { start, end }) => sum + end - start + 1, 0);
    assert.ok(width <= MAX_RECALL_ENTRIES, `chunk width ${width}`);
    recovered.push(...expandSelections(parsed.selections));
  }
  const settleSeqs = readDispatch(session).filter((event) => event.type === "tool/ptc-dispatch").map((event) => event.seq);
  assert.equal(settleSeqs.length, count);
  const recoveredSet = new Set(recovered);
  for (const seq of settleSeqs) assert.ok(recoveredSet.has(seq), `settle seq ${seq} remains recoverable`);
});
