/**
 * Integration tests for the durable compaction transaction against a real
 * detached Session, a fake token meter, and a fake compile hook.
 * @module dsh-compaction-instant/test/region
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ManualCompactionError } from "@deepseek-ai/dsh-compaction";
import { createMessage, createSystemMessage, createToolResultMessage, createUserMessage } from "@deepseek-ai/dsh-llm";
import { Session } from "@deepseek-ai/dsh-session";
import { compactSurfaceRegion, fenceCode, selectCompactableRange, SurfaceChangedError } from "../src/region.js";

/** Build one detached session with a complete (idle) turn bracket. */
function makeIdleSession() {
  const user = createUserMessage({
    content: [{ type: "text", text: "please fix the bug" }],
    source: { kind: "user" }
  });
  const assistant = createMessage({
    role: "assistant",
    content: [
      { type: "text", text: "on it" },
      { type: "tool-call", id: "call-1", name: "read", arguments: '{"file_path":"a.js"}' }
    ],
    source: { kind: "model", provider: "p", model: "m" }
  });
  const result = createToolResultMessage({
    callId: "call-1",
    content: [{ type: "text", text: "file content" }],
    isError: false
  });
  const assistant2 = createMessage({
    role: "assistant",
    content: [{ type: "text", text: "done" }],
    source: { kind: "model", provider: "p", model: "m" }
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
    { type: "assistant/message", seq: 4, time: 5, data: { turn: 1, step: 1, stream: [], message: assistant2 }, surfaceOp: "append" },
    { type: "user/message", seq: 5, time: 6, data: user2, surfaceOp: "append" },
    { type: "turn/end", seq: 6, time: 7, data: { turn: 1 } }
  ];
  return Session.create("session-1", seed);
}

/** Static fake meter pricing 100 tokens per surface node and 10 for any message. */
function makeFakeMeter() {
  return {
    measure: (session) => {
      const nodes = session.surface.nodes.map((seq) => ({ seq, tokens: 100, heuristicTokens: 100 }));
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
  };
}

const fakeCompile = async () => ({
  entries: [{ seq: 1, text: "[user]\ncompiled body" }],
  stats: { tokens: 3 },
  capped: false,
  provider: "test-provider",
  model: "test-compiler"
});

/**
 * Build one detached three-turn session:
 * turn 1 (no tools): user + assistant;
 * turn 2 (tools): user + assistant(tool-call) + tool/result + assistant;
 * turn 3 (no tools): user + assistant.
 * Every surface node prices at 100 tokens through the fake meter.
 */
function makeMultiTurnSession() {
  const user = (text) => createUserMessage({
    content: [{ type: "text", text }],
    source: { kind: "user" }
  });
  const assistant = (text, content = [{ type: "text", text }]) => createMessage({
    role: "assistant",
    content,
    source: { kind: "model", provider: "p", model: "m" }
  });
  const seed = [];
  let seq = 0;
  let turn = 0;
  const push = (type, data, surfaceOp) => {
    if (type === "turn/start") turn = data.turn;
    seed.push({
      type,
      seq: seq++,
      time: seq,
      data: type === "assistant/message" ? { turn, step: 1, stream: [], ...data } : data,
      ...surfaceOp === undefined ? {} : { surfaceOp }
    });
  };
  // Turn 1: seqs 1-2
  push("turn/start", { turn: 1 });
  push("user/message", user("please fix the bug"), "append");
  push("assistant/message", { message: assistant("on it") }, "append");
  push("turn/end", { turn: 1 });
  // Turn 2: seqs 5-8
  push("turn/start", { turn: 2 });
  push("user/message", user("show me the file"), "append");
  push("assistant/message", { message: assistant("reading", [
    { type: "text", text: "reading" },
    { type: "tool-call", id: "call-1", name: "read", arguments: '{"file_path":"a.js"}' }
  ]) }, "append");
  push("tool/result", { message: createToolResultMessage({
    callId: "call-1",
    content: [{ type: "text", text: "file content" }],
    isError: false
  }) }, "append");
  push("assistant/message", { message: assistant("done") }, "append");
  push("turn/end", { turn: 2 });
  // Turn 3: seqs 11-12
  push("turn/start", { turn: 3 });
  push("user/message", user("thank you"), "append");
  push("assistant/message", { message: assistant("welcome") }, "append");
  push("turn/end", { turn: 3 });
  return Session.create("session-multi", seed);
}

test("selectCompactableRange retains complete turns and never exceeds the token ceiling", () => {
  const session = makeMultiTurnSession();
  const measurement = makeFakeMeter().measure(session); // 8 nodes × 100 tokens
  // Default semantics: 1 mandatory turn (200 tokens), no ceiling → only turn 3 stays.
  const one = selectCompactableRange(session, measurement, 1, 0);
  assert.deepEqual([one.start, one.end], [1, 8]);
  // Two mandatory turns → turns 2+3 stay, only turn 1 compiles.
  const two = selectCompactableRange(session, measurement, 2, 0);
  assert.deepEqual([two.start, two.end], [1, 2]);
  // Ceiling 600 = exactly last two turns (turn 3: 200 + turn 2: 400) → both stay.
  const fits = selectCompactableRange(session, measurement, 1, 600);
  assert.deepEqual([fits.start, fits.end], [1, 2]);
  // Ceiling 599: turn 3 is 200 < 599, but adding turn 2 (400) would overshoot
  // to 600 → never exceeds the ceiling → only turn 3 stays.
  const capped = selectCompactableRange(session, measurement, 1, 599);
  assert.deepEqual([capped.start, capped.end], [1, 8]);
  // A huge ceiling retains everything compilable → nothing left to compile.
  const huge = selectCompactableRange(session, measurement, 1, 1_000_000);
  assert.equal(huge, null);
  // Ceiling 150 < the latest turn alone (200): the ceiling is absolute even
  // against the mandated turn — only the node suffix that fits stays
  // (turn 3's last node, seq 12; the cut before it is balanced).
  const partial = selectCompactableRange(session, measurement, 1, 150);
  assert.deepEqual([partial.start, partial.end], [1, 11]);
  // The preferred-turn rule never overrides the ceiling either (retainTurns=3
  // with ceiling 100 still keeps only the last node).
  const partialPreferred = selectCompactableRange(session, measurement, 3, 100);
  assert.deepEqual([partialPreferred.start, partialPreferred.end], [1, 11]);
  // Selecting with no compilable predecessor → null (single-turn session with
  // the mandatory turn covering the whole surface).
  const whole = selectCompactableRange(makeIdleSession(), makeFakeMeter().measure(makeIdleSession()), 1, 0);
  assert.equal(whole, null);
});

test("compactSurfaceRegion runs a complete manual transaction with a flush", async () => {
  const session = makeIdleSession();
  const meter = makeFakeMeter();
  let flushed = 0;
  const result = await compactSurfaceRegion({ meter, compile: fakeCompile }, session, 1, 4, undefined, {
    owner: null,
    stability: "selected-span",
    flush: async () => {
      flushed += 1;
    }
  }, undefined);
  assert.equal(flushed, 1);
  assert.deepEqual(result.shadowedSeqs, [1, 2, 3, 4]);
  assert.equal(result.shadowedTokenCount, 400);
  assert.deepEqual(result.shadowedRange, { start: 1, end: 4 });
  // The UI-facing summary is the compiled body in one adaptive code fence,
  // opened by a compaction intro line and closed by the retention footer.
  const summaryText = result.summary[0].text;
  assert.match(summaryText, /自动压缩: 将 4 个节点 \/ ~400 tokens 编译为 1 条目 \/ ~3 tokens/);
  assert.match(summaryText, /## Compiled checkpoint: 4 nodes \(seqs 1-4, ~400 tokens\)/);
  assert.match(summaryText, /\[user\]\ncompiled body/);
  assert.match(summaryText, /尾部原文保留: 1 节点 \/ ~100 tokens/);
  const events = session.snapshotEvents();
  const startEvent = events[result.startSeq];
  const summaryEvent = events[result.summarySeq];
  const endEvent = events[result.endSeq];
  assert.equal(startEvent.type, "compaction/start");
  assert.equal(summaryEvent.type, "compaction/summary");
  assert.equal(endEvent.type, "compaction/end");
  assert.equal(summaryEvent.data.compactionId, startEvent.data.compactionId);
  assert.equal(summaryEvent.data.provider, "test-provider");
  assert.equal(summaryEvent.data.model, "test-compiler");
  assert.deepEqual(summaryEvent.data.shadowedSeqs, [1, 2, 3, 4]);
  assert.deepEqual(summaryEvent.data.shadowedRange, { start: 1, end: 4 });
  const checkpoint = events[result.summarySeq + 1];
  assert.equal(checkpoint.type, "user/message");
  assert.deepEqual(checkpoint.surfaceOp, { op: "replace", startSeq: 1, endSeq: 4 });
  assert.equal(checkpoint.data.source.kind, "compact-checkpoint");
  assert.equal(checkpoint.data.source.sourceCommandId, undefined);
  assert.equal(checkpoint.data.source.compactionId, startEvent.data.compactionId);
  assert.deepEqual(session.surface.nodes, [checkpoint.seq, 5]);
});

test("compactSurfaceRegion records heuristic shadow price but checks shrink against route tokens", async () => {
  const session = makeIdleSession();
  const meter = makeFakeMeter();
  meter.measure = (target) => {
    const measured = makeFakeMeter().measure(target);
    return {
      ...measured,
      nodes: measured.nodes.map((node) => ({ ...node, heuristicTokens: 25 }))
    };
  };
  meter.estimateMessage = () => 200;
  const result = await compactSurfaceRegion({ meter, compile: fakeCompile }, session, 1, 4, undefined, {
    owner: null,
    stability: "selected-span"
  }, undefined);
  assert.equal(result.shadowedTokenCount, 100);
  assert.equal(session.eventAt(result.summarySeq).data.shadowedTokenCount, 100);
});

test("compactSurfaceRegion rejects a checkpoint that does not shrink the surface", async () => {
  const session = makeIdleSession();
  const meter = makeFakeMeter();
  meter.estimateMessage = () => 500;
  await assert.rejects(
    () => compactSurfaceRegion({ meter, compile: fakeCompile }, session, 1, 4, undefined, { owner: null, stability: "selected-span" }, undefined),
    (error) => error instanceof ManualCompactionError && error.code === "summary"
  );
  // The failed manual attempt still closed its bracket with an error marker.
  const events = session.snapshotEvents();
  const last = events[events.length - 1];
  assert.equal(last.type, "compaction/end");
  assert.ok(last.data.error.length > 0);
  // Surface untouched.
  assert.deepEqual(session.surface.nodes, [1, 2, 3, 4, 5]);
});

test("a flush failure reports persistence after a replayable committed replacement", async () => {
  const session = makeIdleSession();
  const failure = new Error("disk unavailable");
  await assert.rejects(() => compactSurfaceRegion({ meter: makeFakeMeter(), compile: fakeCompile },
    session, 1, 4, undefined, {
      owner: null, stability: "selected-span", flush: async () => { throw failure; }
    }, undefined), (error) => error instanceof ManualCompactionError && error.code === "persistence" && error.cause === failure);
  const events = session.snapshotEvents();
  const markers = events.filter((event) => event.type.startsWith("compaction/"));
  assert.deepEqual(markers.map((event) => event.type), ["compaction/start", "compaction/summary", "compaction/end"]);
  assert.equal(markers[0].data.compactionId, markers[2].data.compactionId);
  assert.equal(markers[2].data.error, undefined);
  const checkpoint = session.eventAt(markers[1].seq + 1);
  assert.deepEqual(session.surface.nodes, [checkpoint.seq, 5]);
  // In-memory commit survives replay; this does not claim that the failed flush persisted it.
  assert.deepEqual(Session.create("flush-replay", events).surface.nodes, session.surface.nodes);
});

test("compile failure closes exactly one error bracket without replacing history", async () => {
  const session = makeIdleSession();
  const failure = new Error("compiler failed");
  await assert.rejects(() => compactSurfaceRegion({
    meter: makeFakeMeter(), compile: async () => { throw failure; }
  }, session, 1, 4, undefined, { owner: null, stability: "selected-span" }, undefined),
  (error) => error instanceof ManualCompactionError && error.code === "summary" && error.cause === failure);
  const events = session.snapshotEvents();
  const markers = events.filter((event) => event.type.startsWith("compaction/"));
  assert.deepEqual(markers.map((event) => event.type), ["compaction/start", "compaction/end"]);
  assert.equal(markers[0].data.compactionId, markers[1].data.compactionId);
  assert.ok(markers[1].data.error.length > 0);
  assert.deepEqual(session.surface.nodes, [1, 2, 3, 4, 5]);
  assert.deepEqual(Session.create("compile-failure-replay", events).surface.nodes, session.surface.nodes);
});

test("cancellation during compilation closes its bracket and preserves abort precedence", async () => {
  const session = makeIdleSession();
  const controller = new AbortController();
  const reason = new Error("stop compilation");
  let flushed = 0;
  await assert.rejects(() => compactSurfaceRegion({
    meter: makeFakeMeter(), compile: async () => {
      controller.abort(reason);
      return fakeCompile();
    }
  }, session, 1, 4, undefined, {
    owner: null, stability: "selected-span", flush: async () => { flushed += 1; }
  }, controller.signal), (error) => error === reason);
  const events = session.snapshotEvents();
  const markers = events.filter((event) => event.type.startsWith("compaction/"));
  assert.deepEqual(markers.map((event) => event.type), ["compaction/start", "compaction/end"]);
  assert.equal(markers[0].data.compactionId, markers[1].data.compactionId);
  assert.ok(markers[1].data.error.length > 0);
  assert.equal(flushed, 1);
  assert.deepEqual(session.surface.nodes, [1, 2, 3, 4, 5]);
  assert.deepEqual(Session.create("abort-replay", events).surface.nodes, session.surface.nodes);
});

test("compactSurfaceRegion reports busy on an unmatched compaction start", async () => {
  const session = makeIdleSession();
  session.append("compaction/start", { compactionId: "stale", turn: null });
  await assert.rejects(
    () => compactSurfaceRegion({ meter: makeFakeMeter(), compile: fakeCompile }, session, 1, 4, undefined, { owner: null, stability: "selected-span" }, undefined),
    (error) => error instanceof ManualCompactionError && error.code === "busy"
  );
});

test("compactSurfaceRegion reports busy for manual compaction inside an open turn", async () => {
  const session = makeIdleSession();
  session.append("turn/start", { turn: 2 });
  await assert.rejects(
    () => compactSurfaceRegion({ meter: makeFakeMeter(), compile: fakeCompile }, session, 1, 4, undefined, { owner: null, stability: "selected-span" }, undefined),
    (error) => error instanceof ManualCompactionError && error.code === "busy"
  );
});

test("compactSurfaceRegion reports changed when the surface moves during compilation", async () => {
  const session = makeIdleSession();
  const meter = makeFakeMeter();
  let calls = 0;
  const original = meter.measure;
  meter.measure = (target) => {
    calls += 1;
    const measured = original(target);
    if (calls > 1) measured.nodes = measured.nodes.map((node) => ({ ...node, tokens: 999 }));
    return measured;
  };
  await assert.rejects(
    () => compactSurfaceRegion({ meter, compile: fakeCompile }, session, 1, 4, undefined, { owner: null, stability: "selected-span" }, undefined),
    (error) => error instanceof ManualCompactionError && error.code === "changed"
  );
});

test("compactSurfaceRegion runs an automatic in-turn transaction", async () => {
  const session = makeIdleSession();
  session.append("turn/start", { turn: 2 });
  const result = await compactSurfaceRegion({ meter: makeFakeMeter(), compile: fakeCompile }, session, 1, 4, undefined, {
    owner: "current-turn",
    stability: "whole-surface"
  }, undefined);
  assert.deepEqual(result.shadowedSeqs, [1, 2, 3, 4]);
  assert.equal(session.eventAt(result.startSeq).data.turn, 2);
});

/** Build surface-boundary fixtures with real 0.2.0-rc.2 message envelopes. */
function makeBoundarySession(turns) {
  const session = Session.create("session-boundary");
  for (const [index, kinds] of turns.entries()) {
    const turn = index + 1;
    session.append("turn/start", { turn });
    for (const kind of kinds) {
      let type;
      let data;
      if (kind === "system" || kind === "empty-system") {
        type = "system/message";
        data = { turn, step: 1, message: createSystemMessage(kind === "system" ? "system prompt" : "", "test-system") };
      } else if (kind === "call") {
        type = "assistant/message";
        data = { turn, step: 1, stream: [], message: createMessage({
          role: "assistant",
          content: [{ type: "tool-call", id: "boundary-call", name: "read", arguments: "{}" }],
          source: { kind: "model", provider: "p", model: "m" }
        }) };
      } else if (kind === "result") {
        type = "tool/result";
        data = { turn, step: 1, message: createToolResultMessage({
          callId: "boundary-call", content: [{ type: "text", text: "result" }], isError: false
        }) };
      } else {
        type = "user/message";
        data = createUserMessage({ content: [{ type: "text", text: kind }], source: { kind: "user" } });
      }
      session.append(type, data, { surfaceOp: "append" });
    }
    session.append("turn/end", { turn, reason: { kind: "completed" } });
  }
  return session;
}

test("selection protects only the leading system message, including an empty head", () => {
  for (const head of ["system", "empty-system"]) {
    const session = makeBoundarySession([[head, "system", "old"], ["recent"]]);
    const nodes = session.surface.nodes;
    for (const ceiling of [0, 100]) {
      assert.deepEqual(selectCompactableRange(session, makeFakeMeter().measure(session), 1, ceiling), {
        start: nodes[1], end: nodes[2]
      });
    }
    assert.equal(selectCompactableRange(session, makeFakeMeter().measure(session), 2, 0), null);
    assert.equal(selectCompactableRange(session, makeFakeMeter().measure(session), 1, 10_000), null);
  }
  // A later system update does not move the start past a non-system head.
  const session = makeBoundarySession([["old", "system"], ["recent"]]);
  const nodes = session.surface.nodes;
  assert.deepEqual(selectCompactableRange(session, makeFakeMeter().measure(session), 1, 0), {
    start: nodes[0], end: nodes[1]
  });
});

test("empty surfaces, system-only surfaces and retained-only history have no range", () => {
  for (const turns of [[], [["system"]], [["empty-system"]], [["system"], ["recent"]]]) {
    const session = makeBoundarySession(turns);
    for (const ceiling of [0, 100, 10_000]) {
      assert.equal(selectCompactableRange(session, makeFakeMeter().measure(session), 1, ceiling), null);
    }
  }
});

test("the protected head does not consume the retained history token ceiling", () => {
  // The head is inside turn 1, as in the agent loop, not a separate turn 0.
  const session = makeBoundarySession([["system", "first", "second"], ["recent"]]);
  const measurement = makeFakeMeter().measure(session);
  measurement.nodes[0].tokens = 10_000;
  assert.equal(selectCompactableRange(session, measurement, 1, 300), null);
  assert.deepEqual(selectCompactableRange(session, measurement, 1, 299), {
    start: session.surface.nodes[1], end: session.surface.nodes[2]
  });
});

test("pairing fallback reaches but never crosses the protected system head", () => {
  const session = makeBoundarySession([["system", "call", "result"]]);
  assert.equal(selectCompactableRange(session, makeFakeMeter().measure(session), 1, 100), null);
  // With a predecessor, retain the whole pair even when it exceeds the ceiling.
  const withPrefix = makeBoundarySession([["system", "old", "call", "result"]]);
  const nodes = withPrefix.surface.nodes;
  assert.deepEqual(selectCompactableRange(withPrefix, makeFakeMeter().measure(withPrefix), 1, 100), {
    start: nodes[1], end: nodes[1]
  });
});

test("a ceiling below one node checks the tail cut without an undefined sequence", () => {
  for (const head of [[], ["system"]]) {
    const session = makeBoundarySession([[...head, "old", "recent"]]);
    const nodes = session.surface.nodes;
    assert.deepEqual(selectCompactableRange(session, makeFakeMeter().measure(session), 1, 1), {
      start: nodes[head.length], end: nodes.at(-1)
    });
    const open = makeBoundarySession([[...head, "old", "call"]]);
    const openNodes = open.surface.nodes;
    assert.deepEqual(selectCompactableRange(open, makeFakeMeter().measure(open), 1, 1), {
      start: openNodes[head.length], end: openNodes[head.length]
    });
  }
  const onlyOpen = makeBoundarySession([["system", "call"]]);
  assert.equal(selectCompactableRange(onlyOpen, makeFakeMeter().measure(onlyOpen), 1, 1), null);
});

test("explicit system-head spans reject before compaction/start or any compile work", async () => {
  for (const head of ["system", "empty-system"]) {
    for (const owner of [null, "current-turn"]) {
      const session = makeBoundarySession([[head, "old"]]);
      if (owner !== null) session.append("turn/start", { turn: 2 });
      const before = session.snapshotEvents();
      const nodes = [...session.surface.nodes];
      for (const end of nodes) {
        await assert.rejects(() => compactSurfaceRegion({
          meter: { measure: () => assert.fail("must not measure") },
          compile: () => assert.fail("must not compile")
        }, session, nodes[0], end, undefined, { owner, stability: "selected-span" }, undefined), /system\/message at surface head/);
        assert.deepEqual(session.snapshotEvents(), before);
        assert.deepEqual(session.surface.nodes, nodes);
      }
    }
  }
});

test("replacement preserves a newer-seq system head and replays 0.2.0-rc.2 boundaries", async () => {
  const session = makeBoundarySession([["system", "system", "old"], ["recent"]]);
  const original = [...session.surface.nodes];
  // Surface order, not numerical seq order or an assumed seq 0, defines the head.
  const newHead = session.append("system/message", {
    turn: 2, step: 1, message: createSystemMessage("updated head", "test-system")
  }, { surfaceOp: { op: "replace", startSeq: original[0], endSeq: original[0] }, sourceEventSeqs: [original[0]] });
  const range = selectCompactableRange(session, makeFakeMeter().measure(session), 1, 0);
  assert.deepEqual(range, { start: original[1], end: original[2] });
  const result = await compactSurfaceRegion({ meter: makeFakeMeter(), compile: fakeCompile },
    session, range.start, range.end, undefined, { owner: null, stability: "selected-span" }, undefined);
  const checkpoint = session.eventAt(result.summarySeq + 1);
  assert.deepEqual(checkpoint.surfaceOp, { op: "replace", startSeq: original[1], endSeq: original[2] });
  assert.deepEqual(result.shadowedSeqs, [original[1], original[2]]);
  assert.deepEqual(session.surface.nodes, [newHead.seq, checkpoint.seq, original[3]]);
  const restored = Session.create("session-restored", session.snapshotEvents());
  assert.deepEqual(restored.surface.nodes, session.surface.nodes);
  assert.equal(restored.eventAt(newHead.seq).data.message.content[0].text, "updated head");
});

test("SurfaceChangedError is exported for callers to distinguish", () => {
  assert.equal(new SurfaceChangedError("x") instanceof Error, true);
});

test("fenceCode wraps text and adapts to embedded fences", () => {
  assert.equal(fenceCode("a\nb"), "```\na\nb\n```");
  // A 3-backtick run inside forces a longer fence; content bytes untouched.
  assert.equal(fenceCode("x\n```\ncode\n```\ny"), "````\nx\n```\ncode\n```\ny\n````");
  // Longer runs escalate further.
  assert.equal(fenceCode("````"), "`````\n````\n`````");
  assert.equal(fenceCode(""), "```\n\n```");
  assert.equal(fenceCode("no backticks"), "```\nno backticks\n```");
});
