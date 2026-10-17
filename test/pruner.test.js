import assert from "node:assert/strict";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import { ToolResultPruner } from "@deepseek-ai/dsh-compaction-tool-result-pruner";
import { createAssistantMessage, createToolResultMessage, createUserMessage } from "@deepseek-ai/dsh-llm";
import { Session } from "@deepseek-ai/dsh-session";
import { InstantCompactionEngine } from "../src/index.js";
import { resolveRecallReference } from "../src/recall.js";
import { compactSurfaceRegion } from "../src/region.js";
import { defineRecallTool, resolveConfig } from "../src/tool.js";

function makePrunedSession() {
  const session = Session.create("pruned-result-recall", []);
  session.append("turn/start", { turn: 1 });
  const user = session.append("user/message", createUserMessage({
    content: [{ type: "text", text: "read the complete file" }], source: { kind: "user" }
  }), { surfaceOp: "append" });
  session.append("assistant/message", {
    turn: 1, step: 1, stream: [], message: createAssistantMessage({
      content: [{ type: "tool-call", id: "read-1", name: "read", arguments: '{"file_path":"large.txt"}' }],
      source: { provider: "p", model: "m" }
    })
  }, { surfaceOp: "append" });
  const original = session.append("tool/result", {
    message: createToolResultMessage({ callId: "read-1", isError: false,
      content: [{ type: "text", text: "head ".repeat(80) + "UNIQUE_MIDDLE_SENTINEL" + " tail".repeat(80) }] })
  }, { surfaceOp: "append" });
  const last = session.append("assistant/message", {
    turn: 1, step: 2, stream: [], message: createAssistantMessage({
      content: [{ type: "text", text: "read finished" }], source: { provider: "p", model: "m" }
    })
  }, { surfaceOp: "append" });
  session.append("turn/end", { turn: 1 });
  const context = () => {
    const ctx = new Context();
    ctx.provide("tokenMeter", {
      measure: target => ({ nodes: target.surface.nodes.map(seq => ({ seq, tokens: 1000, heuristicTokens: 1000 })) }),
      estimateMessage: message => message.content.reduce((total, block) => total + Math.ceil((block.text?.length ?? 0) / 4), 0)
    });
    return ctx;
  };
  const ctx = context();
  const first = new ToolResultPruner(ctx, { thresholdChars: 200, headChars: 60, tailChars: 60 }).pruneSession(session).pruned[0];
  const second = new ToolResultPruner(context(), { thresholdChars: 80, headChars: 10, tailChars: 10 }).pruneSession(session).pruned[0];
  return { session, ctx, original, user, last, first, second };
}

test("result recall follows official prune provenance through compaction and replay", async () => {
  const { session, ctx, original, user, last, first, second } = makePrunedSession();
  assert.equal(first.originalSeq, original.seq);
  assert.equal(second.originalSeq, first.replacementSeq);
  const pointer = second.replacementSeq;
  const engine = new InstantCompactionEngine(ctx, { auto: false });
  const compacted = await compactSurfaceRegion(engine.regionDependencies(), session, user.seq, last.seq, undefined, {
    owner: null, stability: "selected-span"
  }, undefined);
  assert.ok(compacted.summary.some(block => block.text?.includes("result " + pointer)));
  const log = JSON.stringify(session.snapshotEvents());
  const replayed = Session.create("pruned-result-replay", JSON.parse(log));
  const tool = defineRecallTool(resolveConfig({}));
  for (const target of [session, replayed]) {
    const resolved = resolveRecallReference(target, "result", "result " + pointer);
    assert.deepEqual(resolved, { selections: [{ start: original.seq, end: original.seq }], errors: [] });
    const value = await tool.execute({ type: "result", id: String(pointer) }, { agent: { session: target } });
    assert.match(value.text, /UNIQUE_MIDDLE_SENTINEL/);
    assert.match(value.text, new RegExp("\\[seq " + original.seq + ": tool\\]"));
    const raw = await tool.execute({ type: "seq", id: String(pointer) }, { agent: { session: target } });
    assert.match(raw.text, /tool result middle pruned/);
    assert.doesNotMatch(raw.text, /UNIQUE_MIDDLE_SENTINEL/);
    const limited = await defineRecallTool(resolveConfig({ maxRecallTokens: 16 }))
      .execute({ type: "result", id: String(pointer) }, { agent: { session: target } });
    assert.equal(limited.truncated, true);
  }
  assert.equal(JSON.stringify(session.snapshotEvents()), log, "recall must not rewrite durable history");
});

test("ordinary replacement results stay addressable without a prune marker", () => {
  const { session, original } = makePrunedSession();
  const current = session.surface.nodes.find(seq => session.eventAt(seq).type === "tool/result");
  const replacement = session.append("tool/result", session.eventAt(current).data, {
    surfaceOp: { op: "replace", startSeq: current, endSeq: current }, sourceEventSeqs: [current]
  });
  const resolved = resolveRecallReference(session, "result", String(replacement.seq));
  assert.deepEqual(resolved, { selections: [{ start: replacement.seq, end: replacement.seq }], errors: [] });
  assert.equal(resolveRecallReference(session, "result", String(original.seq)).selections[0].start, original.seq);
});

test("pruned-result recall rejects inconsistent provenance instead of reading another result", async () => {
  const { session, second } = makePrunedSession();
  const source = JSON.parse(JSON.stringify(session.snapshotEvents()));
  const latest = second.replacementSeq;
  const originalSeq = second.originalSeq;
  const variants = [
    events => { events[latest].sourceEventSeqs = [latest]; },
    events => { events[latest].sourceEventSeqs = [originalSeq, 0]; },
    events => { events[latest - 1].data.shadowedSeqs = [0]; },
    events => { events[latest].surfaceOp.startSeq = 0; },
    events => { events[originalSeq].data.message.toolCallId = "another-call"; },
    events => { events[originalSeq].data.message.id = "another-message"; },
    events => { events[originalSeq].type = "user/message"; },
    events => { events[originalSeq] = undefined; }
  ];
  for (const mutate of variants) {
    const events = structuredClone(source);
    mutate(events);
    const target = { eventAt: seq => events[seq] };
    const resolved = resolveRecallReference(target, "result", String(latest));
    assert.deepEqual(resolved.selections, []);
    assert.match(resolved.errors[0], /prune provenance/);
    await assert.rejects(() => defineRecallTool(resolveConfig({}))
      .execute({ type: "result", id: String(latest) }, { agent: { session: target } }),
    error => error.code === "RECALL_INVALID_SELECTION");
  }
});
