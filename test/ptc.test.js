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
import { Session } from "@deepseek-ai/dsh-session";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime, { RUN_CODE_NAME, defineTool } from "@deepseek-ai/dsh-tools";
import { compileNodes } from "../src/compiler.js";
import * as recallTools from "../src/tool.js";

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
