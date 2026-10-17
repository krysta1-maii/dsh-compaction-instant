/** DSH 0.2.0 file-reference recall/search compatibility, without attachment I/O. */
import assert from "node:assert/strict";
import test from "node:test";
import { createUserMessage, createToolResultMessage } from "@deepseek-ai/dsh-llm";
import { Session } from "@deepseek-ai/dsh-session";
import { projectMessageText, recallSession } from "../src/recall.js";
import { searchSession } from "../src/search.js";

const attachment = Object.freeze({ attachmentId: "a".repeat(64), name: "audit-report.txt", bytes: 1234 });
const file = Object.freeze({ type: "file", attachment });
const config = { maxRecallTokens: 16000, maxSearchHits: 50 };

function makeSession() {
  const user = createUserMessage({ content: [file], source: { kind: "user" } });
  const result = createToolResultMessage({ callId: "file-result", content: [file], isError: false });
  return Session.create("attachment-recall", [
    { seq: 0, time: 1, type: "user/message", data: user, surfaceOp: "append" },
    { seq: 1, time: 2, type: "tool/result", data: { message: result }, surfaceOp: "append" }
  ]);
}

test("file projection preserves reference metadata without claiming file contents or paths", () => {
  const text = projectMessageText({ content: [file] });
  assert.equal(text, `[file attachment reference: ${JSON.stringify(attachment)}; file contents not included]`);
  assert.equal(projectMessageText({ content: [{ type: "image", attachment: {} }] }), "[image]");
});

test("real Session recall and search retain file identities in user messages and tool results", () => {
  const session = makeSession();
  const before = JSON.stringify(session.snapshotEvents());
  const result = recallSession(session, [{ start: 0, end: 1 }], config);
  assert.equal(result.recalled, 2);
  assert.equal(result.truncated, false);
  assert.equal(result.text.split(attachment.attachmentId).length - 1, 2);
  assert.equal(result.text.split("file contents not included").length - 1, 2);
  for (const pattern of ["audit-report", attachment.attachmentId, "1234"]) {
    const found = searchSession(session, pattern, config);
    assert.equal(found.totalMatches, 2);
    assert.deepEqual(found.hits.map(hit => hit.seq), [0, 1]);
  }
  assert.equal(JSON.stringify(session.snapshotEvents()), before);
});

test("file references survive recursively nested tool-result projection", () => {
  const text = projectMessageText({ content: [{
    type: "tool-result", content: [{
      type: "tool-result", content: [{ type: "text", text: "nested result" }, file]
    }]
  }] });
  assert.ok(text.startsWith("[tool-result]\n[tool-result]\nnested result\n[file attachment reference:"));
  assert.ok(text.includes(JSON.stringify(attachment)));
});

test("attachment projection is still bounded by recall and search budgets", () => {
  const session = makeSession();
  const limited = { ...config, maxRecallTokens: 8 };
  assert.equal(recallSession(session, [{ start: 0, end: 1 }], limited).truncated, true);
  assert.equal(searchSession(session, "audit-report", limited).truncated, true);
});
