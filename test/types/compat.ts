import type { Context } from '@deepseek-ai/cordis';
import type { CommandId } from '@deepseek-ai/dsh-commands/brand';
import type { CompactionEngine, CompactionTrigger, ManualCompactAgentContext } from '@deepseek-ai/dsh-compaction';
import type { Session, SessionSeq, SessionEventMap, SurfaceOp } from '@deepseek-ai/dsh-session';
import type { TokenMeasurement } from '@deepseek-ai/dsh-token-meter';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';

import InstantCompactionPlugin, {
  COMPILER_MODEL,
  COMPILER_PROVIDER,
  InstantCompactionEngine,
  TargetPressureConfigError,
  resolveCompactSpec,
  resolveConfig,
  resolveTargetPolicy,
  routedTarget,
  type CompiledRegion,
  type InstantCompactionConfig,
  type InstantCompactionSettings,
  type ResolvedCompactSpec,
  type ResolvedTargetPolicy,
} from 'dsh-compaction-instant';
import {
  CHECKPOINT_CLOSE_TAG,
  CHECKPOINT_OPEN_TAG,
  CHECKPOINT_PREAMBLE,
  COMPILER_REV,
  DEFAULT_ARG_TOOLS,
  DEFAULT_NOISE_PATTERNS,
  DEFAULT_TOOL_KEY_FIELDS,
  MAX_RECALL_ENTRIES,
  MAX_RECALL_SPAN as COMPILER_MAX_RECALL_SPAN,
  RECALL_GUIDE,
  compileNodes,
  compileRegion,
  countTokens,
  entryText,
  estimateDeepSeekTokens,
  estimateEntryTokens,
  excerptToolResult,
  frameCheckpoint,
  isCheckpointSource,
  isCjkChar,
  joinCompiledEntries,
  oneLineArg,
  parseToolArguments,
  pickToolKeyArg,
  projectToolResultText,
  sanitize,
  stripNoiseXml,
  tokenize,
  truncateTokens,
  type PtcDispatchIndex,
} from 'dsh-compaction-instant/compiler';
import {
  SurfaceChangedError,
  assertNoActiveCompaction,
  assertSelectedSpanStable,
  assertWholeSurfaceUnchanged,
  compactSurfaceRegion,
  fenceCode,
  inspectCompactionEntryState,
  prepareCompaction,
  selectCompactableRange,
  validateSurfaceRegion,
} from 'dsh-compaction-instant/region';
import {
  DEFAULT_MAX_RECALL_TOKENS,
  MAX_RECALL_SPAN,
  expandSelections,
  findCheckpointSeqs,
  parseSeqSpec,
  projectMessageText,
  recallSession,
  resolveRecallReference,
  type RecallableSession,
} from 'dsh-compaction-instant/recall';
import {
  DEFAULT_MAX_SEARCH_HITS,
  InvalidSearchPatternError,
  MAX_LINES_PER_HIT,
  compileSearchPattern,
  searchSession,
  type SearchableSession,
} from 'dsh-compaction-instant/search';
import {
  DEFAULT_MAX_RECALL_TOKENS as TOOL_DEFAULT_MAX_RECALL_TOKENS,
  RECALL_DESCRIPTION,
  SEARCH_DESCRIPTION,
  apply as applyTools,
  defineRecallTool,
  defineSearchTool,
  inject as toolInject,
  name as toolName,
  resolveConfig as resolveToolConfig,
} from 'dsh-compaction-instant/tool';
import {
  USAGE,
  apply as applyCommand,
  defineRecallCommand,
  inject as commandInject,
  name as commandName,
  resolveConfig as resolveCommandConfig,
} from 'dsh-compaction-instant/command';

const publicConfig: InstantCompactionConfig = { retainRatio: 0.2, thresholdRatio: 0.5 };
const publicSettings: InstantCompactionSettings = InstantCompactionEngine.SETTINGS_SCHEMA({ retainRatio: 0.2 });
void [InstantCompactionEngine.SETTINGS_NAMESPACE, publicSettings];
// The root default export is the dispatcher: carrier rows no-op, engine rows mount.
const carrierRowConfig: InstantCompactionConfig & { carrier?: boolean } = { carrier: true };
void [InstantCompactionPlugin, carrierRowConfig];
const resolved = resolveConfig(publicConfig);
const policy: ResolvedTargetPolicy = resolveTargetPolicy(resolved, { provider: 'p', model: 'm' });
const compactSpec: ResolvedCompactSpec = resolveCompactSpec(policy, 100_000);
const concreteRetainTokens: number = compactSpec.retainTokens;
const concreteThresholdTokens: number = compactSpec.thresholdTokens;
void [policy.target.provider, concreteRetainTokens, concreteThresholdTokens];
void [COMPILER_MODEL, COMPILER_PROVIDER, TargetPressureConfigError];

export function checkRc2Contracts(
  ctx: Context,
  session: Session,
  seq: SessionSeq,
  measurement: TokenMeasurement,
  agent: ManualCompactAgentContext,
  commandId: CommandId,
  signal: AbortSignal,
  assistantMessage: SessionEventMap['assistant/message']['message'],
): void {
  const engine = null as unknown as InstantCompactionEngine;
  const seam: CompactionEngine = engine;
  const trigger: CompactionTrigger = 'pressure';
  const overflowTrigger: CompactionTrigger = 'context-overflow';
  const replacement: SurfaceOp = { op: 'replace', startSeq: seq, endSeq: seq };
  const settlement: SessionEventMap['assistant/message'] = {
    turn: 1, step: 1, stream: [], message: assistantMessage,
  };
  // @ts-expect-error 0.2.0 requires settlement provenance, not message alone.
  const obsoleteSettlement: SessionEventMap['assistant/message'] = { message: settlement.message };
  // @ts-expect-error 0.2.0 replacements are positional, not a seq-list operation.
  const obsoleteReplacement: SurfaceOp = { replace: [seq] };
  // @ts-expect-error 0.1.2-rc.1 start/end fields were renamed to startSeq/endSeq.
  const previousReplacement: SurfaceOp = { op: 'replace', start: seq, end: seq };
  void [replacement, obsoleteSettlement, obsoleteReplacement, previousReplacement];
  void seam.compactIfNeeded(agent, overflowTrigger, signal);
  const recallable: RecallableSession = session;
  const searchable: SearchableSession = session;
  const selection = validateSurfaceRegion(session, seq, seq);
  const prepared = prepareCompaction(engine.regionDependencies(), session, selection);
  const recallTool: ToolDefinition = defineRecallTool(resolveToolConfig());
  const searchTool: ToolDefinition = defineSearchTool(resolveToolConfig());

  void seam.compactIfNeeded(agent, trigger, signal);
  void seam.compactNow(agent, signal, commandId);
  void seam.compactRegion(seq, seq, agent, signal);
  void selectCompactableRange(session, measurement, 1, 5120);
  void compactSurfaceRegion(engine.regionDependencies(), session, seq, seq, agent, { owner: null, stability: 'selected-span', sourceCommandId: commandId }, signal);
  assertNoActiveCompaction(session, 'types');
  assertWholeSurfaceUnchanged(engine.regionDependencies(), session, prepared);
  assertSelectedSpanStable(engine.regionDependencies(), session, prepared);
  void inspectCompactionEntryState(session);
  void fenceCode('x');
  void SurfaceChangedError;

  const parsed = parseSeqSpec('1');
  void expandSelections(parsed.selections, signal);
  void findCheckpointSeqs(recallable, signal);
  void resolveRecallReference(recallable, 'seq', '1', signal);
  void recallSession(recallable, parsed.selections, { maxRecallTokens: 100 }, signal);
  void searchSession(searchable, 'x', { maxRecallTokens: 100, maxSearchHits: 5 }, signal);
  void [DEFAULT_MAX_RECALL_TOKENS, MAX_RECALL_SPAN, MAX_RECALL_ENTRIES, COMPILER_MAX_RECALL_SPAN, DEFAULT_MAX_SEARCH_HITS, MAX_LINES_PER_HIT, InvalidSearchPatternError];

  const nodes = [{ seq: 1, message: null }];
  const compilerConfig = {
    maxTokens: 100,
    textTokens: 10,
    userTextTokens: 10,
    toolCallTokens: 10,
    toolResultExcerptTokens: 10,
    includeReasoning: false,
    stripNoiseXml: false,
    noisePatterns: [],
  };
  const ptcIndex: PtcDispatchIndex = {
    byOuterCallId: new Map([['call-1', [{
      startSeq: 2,
      name: 'read',
      arguments: { file_path: 'a.js' },
      settleSeq: 3,
      isError: false,
    }]]]),
    referencedSeqs: [2, 3],
  };
  const compiled = compileNodes(nodes, compilerConfig, undefined, ptcIndex);
  void compileRegion(nodes, compilerConfig, ptcIndex);
  const recovery: readonly SessionSeq[] | undefined = compiled.entries[0]?.recoverySeqs;
  const region: CompiledRegion = null as unknown as CompiledRegion;
  void [recovery, region.referencedSeqs];
  void frameCheckpoint(compiled.entries, 'header', 'intro', 'footer');
  void [tokenize('x'), isCjkChar('中'), estimateDeepSeekTokens('x'), countTokens('x'), estimateEntryTokens('x')];
  void [sanitize('x'), truncateTokens('x', 1), stripNoiseXml('x', []), oneLineArg('x')];
  void [pickToolKeyArg('read', {}, {}), parseToolArguments('{}'), projectToolResultText([]), isCheckpointSource({}), excerptToolResult('x', 1, 'seq 1')];
  void [entryText('x'), joinCompiledEntries(['x']), CHECKPOINT_OPEN_TAG, CHECKPOINT_CLOSE_TAG, CHECKPOINT_PREAMBLE, RECALL_GUIDE, COMPILER_REV];
  void [DEFAULT_ARG_TOOLS, DEFAULT_NOISE_PATTERNS, DEFAULT_TOOL_KEY_FIELDS, projectMessageText];
  void [recallTool, searchTool, TOOL_DEFAULT_MAX_RECALL_TOKENS, RECALL_DESCRIPTION, SEARCH_DESCRIPTION, toolInject, toolName];
  void [USAGE, commandInject, commandName, defineRecallCommand(resolveCommandConfig())];
  applyTools(ctx);
  applyCommand(ctx);
  void routedTarget(session);
}
