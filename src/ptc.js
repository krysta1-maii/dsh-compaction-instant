/**
 * Internal PTC dispatch-history index for `dsh-compaction-instant`.
 *
 * `tool/ptc-dispatch-start` and `tool/ptc-dispatch` are log-only events: they
 * never enter `deriveMessages()` or the surface. The compiler can still point
 * the model at their durable records by pairing each nested dispatch that
 * belongs to a selected outer `run_code` call. This module discovers those
 * events, validates their identity and pairing, and returns the exact seqs
 * the compile inspected so the checkpoint can cite them in
 * `sourceEventSeqs`.
 *
 * Only rootCallId/parentCallId/subCallId are treated as opaque identity keys.
 * Nested order comes from startSeq, never from parsing the `:ptc:n` suffix.
 *
 * @module dsh-compaction-instant/ptc
 */
import { isDeepStrictEqual } from "node:util";
import { TOOL_NOT_STARTED, TOOL_OUTCOME_UNKNOWN } from "@deepseek-ai/dsh-session";

/** Reserved PTC transport name; kept local to avoid a runtime tools import. */
const RUN_CODE_NAME = "run_code";

/** A corrupt or inconsistent dispatch history that must abort compaction. */
function corrupt(detail) {
  return new Error(`compaction: inconsistent PTC dispatch history (${detail})`);
}

/** Require a non-empty opaque identity string. */
function identity(value) {
  return typeof value === "string" && value.length > 0;
}

/** Read the outer result event's recovery classification, if any. */
function resultErrorCode(session, seq) {
  const event = session.eventAt(seq);
  return event?.data?.error?.code;
}

/**
 * Pair every dispatch event that belongs to one outer `run_code` call.
 * @param session - session supplying the durable dispatch log.
 * @param parentCallId - outer run_code call id.
 * @param resultCode - outer tool/result error code, when present.
 */
function pairDispatches(session, parentCallId, resultCode) {
  const starts = new Map();
  const settles = new Map();
  const inspected = [];
  for (const event of session.snapshotEvents()) {
    if (event.type !== "tool/ptc-dispatch-start" && event.type !== "tool/ptc-dispatch") continue;
    const data = event.data;
    if (data?.parentCallId !== parentCallId) continue;
    inspected.push(event);
    if (!identity(data.subCallId)) throw corrupt(`event seq ${event.seq} has no subCallId`);
    if (!identity(data.rootCallId)) throw corrupt(`event seq ${event.seq} has no rootCallId`);
    if (typeof data.name !== "string" || data.name.length === 0) throw corrupt(`event seq ${event.seq} has no tool name`);
    if (!Object.hasOwn(data, "arguments")) throw corrupt(`event seq ${event.seq} has no arguments`);
    const map = event.type === "tool/ptc-dispatch-start" ? starts : settles;
    if (map.has(data.subCallId)) throw corrupt(`duplicate ${event.type} for subCallId ${data.subCallId}`);
    map.set(data.subCallId, event);
  }
  if (resultCode === TOOL_NOT_STARTED && inspected.length > 0) {
    throw corrupt(`outer call ${parentCallId} is TOOL_NOT_STARTED but has nested dispatch events`);
  }
  for (const subCallId of settles.keys()) {
    if (!starts.has(subCallId)) throw corrupt(`settle for subCallId ${subCallId} has no start`);
  }
  const pairs = [];
  for (const [subCallId, start] of starts) {
    const settle = settles.get(subCallId);
    if (settle !== undefined) {
      if (settle.data.rootCallId !== start.data.rootCallId
        || settle.data.parentCallId !== start.data.parentCallId
        || settle.data.name !== start.data.name
        || !isDeepStrictEqual(settle.data.arguments, start.data.arguments)
        || typeof settle.data.isError !== "boolean") {
        throw corrupt(`start/settle identity mismatch for subCallId ${subCallId}`);
      }
      pairs.push({
        startSeq: start.seq,
        name: start.data.name,
        arguments: start.data.arguments,
        settleSeq: settle.seq,
        isError: settle.data.isError
      });
      continue;
    }
    if (resultCode !== TOOL_OUTCOME_UNKNOWN) {
      throw corrupt(`subCallId ${subCallId} has no settle event and the outer result is not TOOL_OUTCOME_UNKNOWN`);
    }
    pairs.push({
      startSeq: start.seq,
      name: start.data.name,
      arguments: start.data.arguments
    });
  }
  pairs.sort((left, right) => left.startSeq - right.startSeq);
  return { pairs, inspected };
}

/**
 * Build the dispatch index for the outer `run_code` calls among the selected
 * surface nodes. Normal completions must pair every start with a settle;
 * only an outer TOOL_OUTCOME_UNKNOWN result may retain start-only history.
 * @param session - session supplying the immutable event log.
 * @param nodes - ordered selected surface projections.
 * @param signal - optional cooperative cancellation signal.
 * @returns `{ byOuterCallId, referencedSeqs }` with inspected start/settle seqs.
 */
export function buildPtcDispatchIndex(session, nodes, signal) {
  signal?.throwIfAborted();
  const outer = new Map();
  for (const node of nodes) {
    const message = node.message;
    if (message === null || message === undefined || message.content === undefined) continue;
    if (message.role === "assistant") {
      for (const block of message.content) {
        if (block?.type === "tool-call" && block.name === RUN_CODE_NAME && identity(block.id)) {
          outer.set(block.id, { callId: block.id, resultSeq: undefined });
        }
      }
      continue;
    }
    if (message.role === "tool" && identity(message.toolCallId) && outer.has(message.toolCallId)) {
      outer.get(message.toolCallId).resultSeq = node.seq;
      continue;
    }
    if (message.role === "user") {
      const first = message.content[0];
      if (first?.type === "tool-result" && identity(first.toolCallId) && outer.has(first.toolCallId)) {
        outer.get(first.toolCallId).resultSeq = node.seq;
      }
    }
  }
  if (outer.size === 0) return { byOuterCallId: new Map(), referencedSeqs: [] };
  const byOuterCallId = new Map();
  const referenced = new Set();
  for (const { callId, resultSeq } of outer.values()) {
    signal?.throwIfAborted();
    const resultCode = resultSeq === undefined ? undefined : resultErrorCode(session, resultSeq);
    const { pairs, inspected } = pairDispatches(session, callId, resultCode);
    for (const event of inspected) referenced.add(event.seq);
    if (pairs.length > 0) byOuterCallId.set(callId, pairs);
  }
  return {
    byOuterCallId,
    referencedSeqs: [...referenced].sort((left, right) => left - right)
  };
}
