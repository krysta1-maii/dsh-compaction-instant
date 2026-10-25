/**
 * Instant replay-aware compaction backend types: VCC-style deterministic
 * context compilation for the DeepSeek Harness.
 * @module dsh-compaction-instant
 */
import type { Context } from '@deepseek-ai/cordis';
import type z from '@deepseek-ai/schemastery';
import type { CommandId } from '@deepseek-ai/dsh-commands/brand';
import type { CompactionAgentContext, CompactionEngine as CompactionEngineBase, CompactionResult, CompactionTrigger, ManualCompactAgentContext } from '@deepseek-ai/dsh-compaction';
import type { Session, SessionSeq } from '@deepseek-ai/dsh-session';
import type { CompileEntry, CompileStats } from './compiler.js';
import type { RegionDependencies } from './region.js';

/** Per-target pressure/retention overrides, mirroring compaction-basic's shape. */
export interface ModelPolicyOverride {
    provider: string;
    model: string;
    thresholdRatio?: number;
    /** Mandatory complete recent turns kept verbatim for this target. */
    retainTurns?: number;
    /** compaction-basic compatibility: fraction of the target context window retained. */
    retainRatio?: number;
    /** Retained-region token ceiling for this target; mutually exclusive with retainRatio. */
    retainTokens?: number;
    /** Accepted for drop-in configuration compatibility; inert in this backend. */
    summarizationProvider?: string;
    /** Accepted for drop-in configuration compatibility; inert in this backend. */
    summarizationModel?: string;
    /** Checkpoint total cap for the exact target (unused by the shared cap). */
    maxTokens?: number;
    compactionRetries?: number;
    maxOverflowRetries?: number;
}

/** Public plugin configuration, all fields optional. */
export interface InstantCompactionConfig {
    /** Request-pressure fraction that triggers automatic compaction. Default 0.5. */
    thresholdRatio?: number;
    /** Preferred complete recent turns kept verbatim; never overrides the ceiling. Default 1. */
    retainTurns?: number;
    /** compaction-basic compatibility: fraction of the routed model context retained. */
    retainRatio?: number;
    /**
     * **Hard** retained-region token ceiling (mutually exclusive with retainRatio): older complete turns are added
     * only while the total fits, and when the latest turn alone exceeds it,
     * only the fitting suffix of that turn is kept. Default 5120.
     */
    retainTokens?: number;
    /** Accepted for drop-in configuration compatibility; the backend never routes a model. */
    summarizationProvider?: string;
    /** Accepted for drop-in configuration compatibility; the backend never routes a model. */
    summarizationModel?: string;
    /** Deprecated — accepted for drop-in compatibility but ignored (no budget floor anymore). */
    maxTokens?: number;
    /** Deprecated — accepted for drop-in compatibility but ignored (no proportional scaling anymore). */
    checkpointScale?: number;
    /** Total budget for one compiled checkpoint, in compiler tokens. Default 65536. */
    checkpointCap?: number;
    /** Automatic compaction retry attempts per threshold crossing. Default 1. */
    compactionRetries?: number;
    /** Context-overflow recovery retry budget. Default 1. */
    maxOverflowRetries?: number;
    modelPolicies?: ModelPolicyOverride[];
    /** Enable automatic pressure/overflow compaction. Default true. */
    auto?: boolean;
    /** Per assistant-text-block token budget for the compiled view. Default 512. */
    textTokens?: number;
    /** Per user-text-block token budget for the compiled view. Default 1024. */
    userTextTokens?: number;
    /** Per tool-call one-liner token budget. Default 128. */
    toolCallTokens?: number;
    /** Accepted for drop-in compatibility; tool results no longer occupy entries (inert). */
    toolResultExcerptTokens?: number;
    /** Keep reasoning blocks in the compiled view. Default false. */
    includeReasoning?: boolean;
    /** Strip known noise XML wrappers from user text. Default true. */
    stripNoiseXml?: boolean;
    /** Noise XML regex sources applied with the `s` flag. */
    noisePatterns?: string[];
    /** Tool-name → preferred argument field for one-liners, merged over built-ins. */
    toolKeyFields?: Record<string, string>;
    /**
     * Tools whose key argument is rendered in the one-liner; every other tool
     * shows name-only. Defaults to the necessary set (read/write/edit/glob/
     * grep/bash/shell/web_search/skill/subagent/…).
     */
    toolArgTools?: string[];
    /** Bookkeeping tools to drop from the checkpoint entirely (VCC `_BRIEF_HIDE_TOOLS`). Default none. */
    hideTools?: string[];
    /** Enable per-compile diagnostics to the debug log and stderr. Default false. */
    debug?: boolean;
    /** Debug log file path. Defaults to `$DSH_HOME/compaction-debug.log`. */
    debugLogPath?: string;
}

/**
 * Settings-form subset served by the bundle's bridge row, as sparse user
 * overrides; unset fields inherit the engine/composition defaults. A section
 * carrying both retention modes resolves to ratio mode engine-side.
 */
export interface InstantCompactionSettings {
    checkpointCap?: number;
    auto?: boolean;
    thresholdRatio?: number;
    retainTurns?: number;
    retainRatio?: number;
    retainTokens?: number;
}

/** Exactly one resolved retention form. */
export type ResolvedRetention =
    | { readonly retainRatio: number; readonly retainTokens?: never }
    | { readonly retainRatio?: never; readonly retainTokens: number };

/** Fields shared by every resolved engine configuration. */
export interface ResolvedInstantCompactionConfigFields {
    readonly thresholdRatio: number;
    readonly retainTurns: number;
    /** Deprecated — carried for drop-in compatibility; the checkpoint budget is the cap alone. */
    readonly maxTokens: number;
    /** Deprecated — carried for drop-in compatibility; the checkpoint budget is the cap alone. */
    readonly checkpointScale: number;
    readonly checkpointCap: number;
    readonly compactionRetries: number;
    readonly maxOverflowRetries: number;
    readonly modelPolicies: readonly ModelPolicyOverride[];
    readonly auto: boolean;
    readonly textTokens: number;
    readonly userTextTokens: number;
    readonly toolCallTokens: number;
    readonly toolResultExcerptTokens: number;
    readonly includeReasoning: boolean;
    readonly stripNoiseXml: boolean;
    readonly noisePatterns: readonly RegExp[];
    readonly toolKeyFields: Readonly<Record<string, string>>;
    readonly toolArgTools: readonly string[];
    readonly hideTools: readonly string[];
    readonly debug: boolean;
    readonly debugLogPath: string;
    /** File-appending line sink installed when `debug` is enabled. */
    readonly debugSink?: (line: string) => void;
}

/** Resolved, validated, frozen configuration after {@link resolveConfig}. */
export type ResolvedInstantCompactionConfig = ResolvedInstantCompactionConfigFields & ResolvedRetention;

/** Fields common to fixed-token and context-ratio target policies. */
export interface ResolvedTargetPolicyFields {
    readonly target: { readonly provider: string; readonly model: string };
    readonly thresholdRatio: number;
    readonly retainTurns: number;
    readonly summarizationProvider: string;
    readonly summarizationModel: string;
    readonly maxTokens: number;
    readonly compactionRetries: number;
    readonly maxOverflowRetries: number;
}

/** Exact-target policy before model-capacity scaling. */
export type ResolvedTargetPolicy = ResolvedTargetPolicyFields & ResolvedRetention;

/** Concrete pressure and retention budgets for one routed model context. */
export interface ResolvedCompactSpec {
    readonly target: { readonly provider: string; readonly model: string };
    readonly contextWindow: number;
    readonly thresholdRatio: number;
    readonly thresholdTokens: number;
    readonly retainTurns: number;
    readonly retainTokens: number;
    readonly maxTokens: number;
    readonly compactionRetries: number;
    readonly maxOverflowRetries: number;
}

/** Target-specific pressure configuration failure eligible for warning suppression. */
export declare class TargetPressureConfigError extends Error {
    readonly targetKey: string;
    constructor(targetKey: string, message: string);
}

/** Validate and resolve the plugin configuration. */
export declare function resolveConfig(config?: InstantCompactionConfig): ResolvedInstantCompactionConfig;
/** Merge the exact provider/model override over the validated default policy. */
export declare function resolveTargetPolicy(config: ResolvedInstantCompactionConfig, target: { provider: string; model: string }): ResolvedTargetPolicy;
/** Scale one routed policy into concrete token budgets for its model capacity. */
export declare function resolveCompactSpec(policy: ResolvedTargetPolicy, contextWindow: number): ResolvedCompactSpec;
/** Resolve the exact provider/model durably routed for the latest request. */
export declare function routedTarget(session: Session): { provider: string; model: string } | undefined;

/** Backend provenance recorded on the `compaction/summary` event. */
export declare const COMPILER_PROVIDER: string;
export declare const COMPILER_MODEL: string;

/** One ordered compiled region, returned by the `compile` hook. */
export interface CompiledRegion {
    /** Ordered compiler entries, newest last. */
    entries: CompileEntry[];
    /** Compile statistics including the density-aware token total. */
    stats: CompileStats;
    /** Whether the total cap forced budget rescaling or front elision. */
    capped: boolean;
    /** Extra durable sources inspected by the compiler (PTC dispatch history). */
    referencedSeqs?: readonly SessionSeq[];
    provider: string;
    model: string;
}

/**
 * Deterministic compaction backend using `ctx.tokenMeter` for pressure and
 * the offline VCC-style compiler instead of an LLM summarizer. Drop-in
 * replacement for `@deepseek-ai/dsh-compaction-basic` at the `ctx.compaction`
 * seam.
 */
export declare class InstantCompactionEngine extends CompactionEngineBase {
    static inject: string[];
    static Config: z<InstantCompactionConfig>;
    /** Settings form namespace of the bundle's settings bridge row (composition row id). */
    static SETTINGS_NAMESPACE: 'compaction-instant';
    /** Field constraints of the settings-form subset; the bridge serves them as volatile schema. */
    static SETTINGS_SCHEMA: z<InstantCompactionSettings>;
    readonly config: ResolvedInstantCompactionConfig;
    constructor(ctx: Context, config?: InstantCompactionConfig);
    /** Resolve the total budget for one compiled checkpoint: always `checkpointCap`. */
    effectiveMaxTokens(shadowedTokenCount: number): number;
    /** Compile one priced region with the deterministic compiler; the sole subclass hook. */
    compile(prepared: {
        shadowedSeqs: readonly SessionSeq[];
        session: Session;
        [key: string]: unknown;
    }, agent: CompactionAgentContext | undefined, signal: AbortSignal | undefined): Promise<CompiledRegion>;
    /** Compact for step-boundary pressure or provider-confirmed context overflow. */
    compactIfNeeded(agent: CompactionAgentContext, trigger: CompactionTrigger, signal: AbortSignal): Promise<CompactionResult | null>;
    /** Compact one inclusive positional range from the agent-owned surface. */
    compactRegion(start: SessionSeq, end: SessionSeq, agent: CompactionAgentContext, signal?: AbortSignal): Promise<CompactionResult>;
    /** Force one useful idle-session compaction below the pressure threshold. */
    compactNow(agent: ManualCompactAgentContext, signal: AbortSignal, sourceCommandId?: CommandId): Promise<CompactionResult | null>;
    /** Bind the effective token meter and dynamically dispatched compile hook. */
    regionDependencies(): RegionDependencies;
}

/**
 * Root-module plugin: dispatches on the row's purpose. Composition rows naming
 * this package mount the engine; the bundle's `compaction-instant-client`
 * carrier row (`carrier: true`) stays inert so dsh-client-modules can bind the
 * browser half to the bare package specifier without mounting a profile-level
 * engine that would race preset-owned backends.
 */
export declare const InstantCompactionPlugin: {
    Config: unknown;
    apply(ctx: unknown, config?: InstantCompactionConfig & { carrier?: boolean }): Promise<void>;
};
export default InstantCompactionPlugin;
