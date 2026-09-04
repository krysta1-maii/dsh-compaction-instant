/**
 * Model-facing same-session recall tool types: `recall` (typed restore) and
 * `search` (keyword/regex grep) over the durable log.
 * @module dsh-compaction-instant/tool
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';

/** Cordis companion plugin name. */
export declare const name: 'tool-recall';
/** Service required before the companion can register. */
export declare const inject: string[];
/** Model-facing recall tool description. */
export declare const RECALL_DESCRIPTION: string;
/** Model-facing durable-log search tool description. */
export declare const SEARCH_DESCRIPTION: string;
/** Default total budget for recall/search. */
export declare const DEFAULT_MAX_RECALL_TOKENS: number;
/** Tool plugin configuration. */
export interface ToolRecallConfig {
    /** Total budget for one recall/search operation, in density-aware tokens. Default 16000. */
    maxRecallTokens?: number;
    /** Cap on shown matching events per search. Default 50. */
    maxSearchHits?: number;
}
/** Validate and default the tool plugin configuration. */
export declare function resolveConfig(config?: ToolRecallConfig): Required<ToolRecallConfig>;
/** Register the recall tools; returns the combined disposer. */
export declare function apply(ctx: Context, config?: ToolRecallConfig): void;
/** The typed `recall` tool definition (type: seq | result | checkpoint). */
export declare function defineRecallTool(config: Required<ToolRecallConfig>): ToolDefinition;
/** The grep `search` tool definition (for tests and introspection). */
export declare function defineSearchTool(config: Required<ToolRecallConfig>): ToolDefinition;
