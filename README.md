# dsh-compaction-instant

[English](README.md) | [简体中文](README.zh-CN.md)

Instant, near-lossless context compaction for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — a **drop-in replacement for `@deepseek-ai/dsh-compaction-basic`** that replaces LLM summarization with the deterministic conversation-compiler principle of [lllyasviel/VCC](https://github.com/lllyasviel/VCC).

A compaction compresses a shadowed history span in **milliseconds, with zero model calls**, keeping **original tokens only** — no paraphrase, no hallucination, no summarizer cost. Everything that is cut is still recoverable through `(seq N)` pointers into the durable session log.

## Key features

- **LLM-free** — compaction never invokes a model. No summarizer prompt, no inference latency, no token spend; the compile is deterministic text processing, so a million-token history compresses in milliseconds.
- **Near-lossless** — output contains only original tokens; every cut is marked and points at its durable `seq`, and prior checkpoints are copied verbatim.
- **Instant** — a single deterministic pass over the shadowed nodes; no network, no model, no KV-cache concerns.
- **Contract-exact drop-in** — same seam, events, provenance and failure vocabulary as `compaction-basic`; every compaction-enabled built-in preset loads it unchanged (alias install).

## Compatibility

| dsh-compaction-instant | DeepSeek Harness | Node.js |
|---|---|---|
| `0.1.5` | `0.1.2-rc.1` | `>=22.12.0` |

Version 0.1.5 uses the immutable `Session.eventAt()` / `snapshotEvents()` API, the dual route/heuristic token-meter protocol, and the preset-owned compaction topology introduced by DSH 0.1.2-rc.1. Older Harness prereleases are not supported by this release.

## Example

A region containing a user request, an assistant text + tool call, and its result compiles to:

```
[user]
please fix the bug
[assistant]
on it
* read "a.js" (seq 2 -> result 3)
[user]
next question
```

Every tool call is ONE line: the key argument for whitelisted tools (`toolArgTools`), name-only for the rest (`* job_kill (seq 9 -> result 10)`), nothing at all for `hideTools` rows. Tool results never occupy entries — the `-> result N` pointer keeps them one `recall(type:"result")` away. Long user/assistant text is truncated to its budget with `...(truncated from seq N)`; every elision names the durable event that still holds the full content.

## Recall: the lossless read-back layer

The package also ships the counterparts that close the near-lossless loop — **same-session recall** for the agent and the human. Because the session log is append-only, every token the compiler ever elided is still recoverable:

| Entry point | Module | What it does |
|---|---|---|
| `recall` **tool** (model-facing) | `dsh-compaction-instant/tool` | Typed restore: `type:"seq"` with `(seq N)`/`(seqs A-B)` markers, `type:"result"` with the `result N` pointer, `type:"checkpoint"` with a `[checkpoint N]` ordinal — restores exact original content into the current tool result |
| `search` **tool** (model-facing, grep) | `dsh-compaction-instant/tool` | Keyword/regex search over the whole durable log — including content elided by compaction — returning matching events with their `(seq N)` pointers, ready for `recall` |
| `/recall` **command** (human, grep) | `dsh-compaction-instant/command` | `/recall <keyword|regex>` appends a durable `form: "recall"` user message with the matching events and their seq pointers, so the next model turn sees them |
| Shared cores | `dsh-compaction-instant/recall` + `dsh-compaction-instant/search` | Seq parsing (`12`, `3-7`, `seq 12` / `seqs 3-7`), log expansion, budgets, projection; regex compilation and hit rendering |

Recall keeps **everything**: text, reasoning, raw tool-call arguments, nested tool-result content; log-only events render as labeled data dumps; missing seqs are reported; a `maxRecallTokens` budget (default **16000**) cuts with a provenance marker and counts the skipped remainder; searches cap shown hits (`maxSearchHits`, default **50**). Both plugins are separate rows, so they can be mounted next to **any** compaction backend — they only read the durable log.

Every checkpoint also frames a short **RECALL guide** at its head, telling the model exactly how to use `recall` / `search` to recover elided content. When a prior checkpoint is elided under cap pressure it never vanishes silently: it leaves a single `[checkpoint N]` line (N = compaction ordinal, 1 = oldest), which `recall(type:"checkpoint", id:"N")` restores in full.

## Configuration

All fields optional; defaults shown.

| Key | Default | Meaning |
|---|---|---|
| `thresholdRatio` | `0.5` | Fraction of the routed model's context window that triggers automatic compaction |
| `retainTurns` | `1` | Preferred complete recent turns kept verbatim (automatic and manual `/compact`); never overrides the ceiling |
| `retainRatio` | — | `compaction-basic` compatibility mode: derive the retained ceiling from the routed model context window; mutually exclusive with `retainTokens` and must be below `thresholdRatio` |
| `retainTokens` | `5120` | **Hard** retained-region token ceiling: older whole turns are added only while the total fits, and when the latest turn alone exceeds it, only the fitting suffix of that turn is kept; mutually exclusive with `retainRatio` |
| `auto` | `true` | Register `agent/pre-step` pressure and `agent/request-error` overflow recovery |
| `checkpointCap` | `65536` | Total budget for one compiled checkpoint (compiler tokens): a checkpoint compiled from a smaller span stays near-lossless, a larger one elides down to this cap |
| `maxTokens` / `checkpointScale` | `8192` / `0.1` | **Deprecated** — accepted for drop-in compatibility but **ignored**: the budget is the cap alone (no floor, no proportional scaling) |
| `textTokens` | `512` | Budget per assistant text block |
| `userTextTokens` | `1024` | Budget per user text block |
| `toolCallTokens` | `128` | Budget per tool-call one-liner (never rescaled — see the elision rules) |
| `toolResultExcerptTokens` | `256` | Accepted for compatibility; **inert** — tool results no longer occupy entries |
| `includeReasoning` | `false` | Keep reasoning blocks in the checkpoint |
| `stripNoiseXml` | `true` | Strip configured noise wrappers from user text |
| `noisePatterns` | see compiler | Noise XML regex sources, applied with the `s` flag |
| `toolKeyFields` | built-ins | Extra tool-name → argument-field map for one-liners |
| `toolArgTools` | see compiler | Whitelist whose key argument renders in the one-liner (`read`/`write`/`edit`/`glob`/`grep`/`bash`/`shell`/`web_search`/`skill`/`subagent`/…); every other tool is name-only |
| `hideTools` | — | Bookkeeping tools dropped from the checkpoint entirely |
| `modelPolicies` | — | Per provider/model overrides of `thresholdRatio`/`retainTurns` and either `retainRatio` or `retainTokens` |
| `compactionRetries` / `maxOverflowRetries` | `1` / `1` | Retry budgets, same semantics as basic |
| `summarizationProvider` / `summarizationModel` | — | Accepted for config drop-in compatibility; **inert** — this backend never routes a model |

The tool and command plugins each take their own `{ maxRecallTokens?: 16000, maxSearchHits?: 50 }` config.

> **Cordis config gotcha:** the plugin row's config passes through the schemastery schema, whose `~standard` adapter injects **`[]` for every absent array key** (`toolArgTools`, `hideTools`, `noisePatterns`, `toolKeyFields`, `modelPolicies`). The resolver treats an empty list as *unset* and falls back to the defaults — so a missing `toolArgTools` keeps the built-in whitelist (never disable it by writing `toolArgTools: []`; empty means default). `debug: true` writes per-compile diagnostics to the configured `debugLogPath` (default `$DSH_HOME/compaction-debug.log`).

Budgets are enforced twice — by token count and by a `budget × 4` character ceiling — so pathological unbroken runs (base64 blobs, minified files) cannot bypass them. Tool calls are **always one line**: they are never rescaled, and the cap loop shrinks only the conversation-text budgets (floor **32 tokens** each). If the compiled region still exceeds the cap, the oldest **tool rows** are removed first (`[N tool/result entries elided: seqs a-b]`), and only then the oldest remaining entries (`[N earlier entries elided: seqs a-b]`) — tool calls can never squeeze the dialogue out. The newest content always survives.

### Browser settings card (Settings → Plugins)

The first instant engine mounted by a DSH 0.1.2 preset owns the **host-global settings namespace** `compaction-instant`; its resolved exposed values form the shared base. Compatible later preset/session instances reuse that base instead of registering duplicates, and a live compatible follower is promoted automatically if the owner unloads. User overrides are persisted to `settings.yaml` and apply to every participating instant engine:

| Field | Meaning |
|---|---|
| `checkpointCap` | Total compiler-token budget for one checkpoint (default 65536) |
| `auto` | Register automatic between-step compaction |
| `thresholdRatio` | Context-window fraction that triggers automatic compaction (default `0.5`) |
| `retainTurns` | Preferred complete recent turns kept verbatim (default `1`) |
| `retainTokens` | **Hard** retained-token ceiling in the default fixed-ceiling mode (default `5120`) |
| `retainRatio` | Ratio shown only when the owning composition selected ratio compatibility mode |

Everything else (`modelPolicies`, `toolArgTools`, `debug`, `debugLogPath`, the deprecated `maxTokens`/`checkpointScale`, …) stays Cordis-config-only. `retainRatio` and `retainTokens` are mutually exclusive retention modes; the first engine establishes the host-global mode, the settings card edits that mode, and later instant-engine instances follow it rather than creating a conflicting namespace. Every write is re-validated against every participating live engine before persistence. Non-exposed fields remain per-entry; exposed fields follow the shared first-owner base plus user layer. If that shared layer conflicts with a later preset's non-exposed policy (for example a model-specific `retainRatio` above the shared threshold), that engine logs a warning and continues **composition-only**; it neither follows nor blocks the global settings section. Without a settings service the engine uses only its composition entry. Restart `dsh web` after installation so the boot graph picks up the `dsh.client` bundle.

### Tokenizer and multilingual behavior

The tokenizer is a character-class heuristic: ASCII letter runs and digit runs count as one token each, punctuation is per-character, whitespace is free, and every other code unit is its own token. Concretely:

| Content | Tokens |
|---|---|
| CJK (`你好，世界！`) | 1 per code point (6) |
| Cyrillic / Arabic | 1 per code unit |
| Accented Latin (`café`) | ASCII runs stay grouped (`caf` + `é`) |
| Emoji (`😀`) | 2 (surrogate pair) |

Every truncation, excerpt, and cap cut is taken at a **code-point boundary** — a slice never leaves a lone surrogate half, so emoji and other astral characters always reach the model intact (pinned by `test/multilang.test.js`). The character-density ceiling follows the DeepSeek docs conversion (quick_start/token_usage): about 0.3 tokens per non-CJK character and 0.6 per CJK character.

The Harness token meter is separate from the compiler estimator. Under DSH 0.1.2 it supplies route-priced `tokens` for pressure, retention, and the shrink guarantee, plus fixed `heuristicTokens` for the durable `compaction/summary.shadowedTokenCount` projection. The compiler heuristic and both Harness prices deliberately coexist.

## Guarantees

- **Instant** — the compile is a single deterministic pass over the shadowed nodes; no network, no model, no KV-cache concerns.
- **Near-lossless** — output contains only original tokens; every cut is marked and points at its durable `seq`; prior checkpoints are copied verbatim.
- **Contract-exact drop-in** — identical seam, events, provenance, pricing (via the singleton `ctx.tokenMeter`), and failure vocabulary as `compaction-basic`, including the shrink guarantee (a checkpoint that would not reduce the surface is rejected).
- **Optional pruner compatible** — consumes the optional `toolResultPruner` service exactly like basic (it helps the *retained tail*; the compiler collapses the *shadowed* region).

## Measured compression (real sessions, no drops)

Rates measured on real session logs (this project's own development sessions), compiled **without dropping a single entry** — every row survives, only per-entry truncation and one-line tool rows apply. Percentages are of the original token count.

| Load | Raw tokens | Compiled | Retained | Compressed |
|---|---|---|---|---|
| Tool-dense session, full (3,181 nodes: 1,438 tool calls + 1,540 results) | 2,523,012 | 226,205 | **9.0%** | 91.0% |
| Another session, full (864 nodes) | 685,088 | 62,705 | **9.2%** | 90.8% |
| Same tool-dense session, recent 800 messages | 625,927 | 45,031 | **7.2%** | 92.8% |
| Pure text only (same session minus all tool rows) | 160,963 | 109,945 | **68.3%** | 31.7% |

Where the ratio comes from (no drops):

- **Tool results cost nothing** — results never produce entries; the `-> result N` pointer keeps each one one `recall` away. That is the biggest win.
- **Tool calls are one line** — each call collapses to a single row (≤ 128 tokens; ~100 on average).
- **Reasoning text is not retained** — reasoning deltas are elided entirely (marked, never silent).
- **Conversation text is nearly lossless** — the pure-text control retained 68.3%; the ~1.5x on text is mostly JSON wrapper stripping plus truncation of only the longest blocks.

Budget scan (same 2.5M-token tool-dense session): with the 64K default cap, the compiled view lands at ~56K tokens (2.2% of the raw size). Dropping starts only as the cap shrinks below the no-drop threshold of ~226K tokens — a lower cap costs a cliff, not a slope:

| Cap | Compiled | Retained | Entries | Dropped |
|---|---|---|---|---|
| 8,192 | 8,243 | 0.33% | 111 | 2,090 |
| 32,768 | 22,263 | 0.88% | 232 | 1,969 |
| 65,536 (deployment default) | 55,737 | 2.2% | 325 | 1,876 |
| 131,072 | 131,047 | 5.2% | 1,142 | 1,058 |
| 226,205 (no-drop threshold) | 226,205 | 9.0% | 2,199 | 0 |

## Installation

All three methods below install the package (published to npm as `dsh-compaction-instant`) with the harness's own plugin manager (which runs pnpm inside the profile directory, making the package resolvable to both the host composition and every agent preset):

```bash
dsh plugin --profile web add <spec>
```

`dsh-command-compact` (`/compact`) is backend-independent, so it keeps working unchanged in every method.

### Method 1 — Drop-in replace the built-in engine (alias)

```bash
dsh plugin --profile web add "@deepseek-ai/dsh-compaction-basic@npm:dsh-compaction-instant"
```

DSH 0.1.2 owns compaction on the preset plane, and its compaction-enabled built-in presets (`standard`, `ptc`, `cordis`) pin the package name `@deepseek-ai/dsh-compaction-basic`. To use this engine inside those presets you **masquerade as the built-in plugin**: preset rows resolve bare package names from the profile's `node_modules` (which outranks the Harness installation), so installing this package under the built-in name makes those three presets load it automatically. `minimal` has no compaction group and is intentionally unchanged.

The masquerade is safe by construction: this engine is a contract-exact drop-in — the same `ctx.compaction` seam, the **identical inject list** (`llm`, `tokenMeter`, `sessions`), the same event protocol and error vocabulary, and its `Config` accepts every key of basic's configuration surface. Removing the alias dependency restores the real basic.

This install is **not** recognized as this package's bundle, so add only the recall tool and `/recall` command to the profile's `cordis.patch.yml` (new rows use an `insert` list; the file hot-reloads). Row names use the alias package name:

```yaml
- insert:
    - id: tool-recall
      name: '@deepseek-ai/dsh-compaction-basic/tool'
    - id: command-recall
      name: '@deepseek-ai/dsh-compaction-basic/command'
```

Do **not** add a host-level instant engine as a fallback: in DSH 0.1.2 an unscoped host listener would also receive events from `standard`/`ptc`/`cordis` and race their preset-owned engine. To add compaction to `minimal`, copy that preset and add the isolated compaction group there.

### Method 2 — Direct install + AI-authored preset copy (dsh authoring mode)

```bash
dsh plugin --profile web add dsh-compaction-instant
```

Then open a session with the preset-authoring preset (the shipped `cordis` preset, "creation mode") and ask the AI to:

> Copy the `standard` preset and swap its compaction engine row to `dsh-compaction-instant`.

The AI uses `agentPresets.copy('standard', '<id>')` to create a locally authored preset, swaps the compaction row's `name` in the copy, mount-validates it with `standingKeyFor('<id>')`, and can set it as the default by patching the `agent-presets` row (`config.default: <id>`). The new preset appears in the UI picker; the built-in presets stay untouched.

The direct install declares `dsh.bundle`, which registers only the globally inherited recall tool and command. The bundle deliberately does **not** mount a host compaction engine: DSH 0.1.2 selects the backend inside each preset. The copied preset is therefore the single engine activation point.

### Method 3 — Direct install + manual preset configuration

```bash
dsh plugin --profile web add dsh-compaction-instant
mkdir -p "$DSH_HOME/.agent-presets/<id>"
# copy composition + metadata from the built-in preset you want as a base
# (the preset roster lists every preset's real path):
cp <built-in-preset>/agent.cordis.yml "$DSH_HOME/.agent-presets/<id>/agent.cordis.yml"
# write preset.yml beside it with name + description
```

Then hand-edit the copy's compaction group — one row name change, inside the same isolate realm:

```yaml
- id: compaction
  name: cordis:group
  group: true
  isolate:
    compaction: true
    toolResultPruner: true      # the pruner must share this realm
  config:
    - id: compaction-instant
      name: dsh-compaction-instant   # was '@deepseek-ai/dsh-compaction-basic'
    - id: command-compact
      name: '@deepseek-ai/dsh-command-compact'
    # ... keep the pruner row
```

Rules: never edit the shipped preset install; keep the isolate realm; a successful `standingKeyFor` mount (or simply starting a session on the preset) is the real validation — the roster's `broken` flag only catches parse errors.

No manual host rows are needed for Methods 2 and 3: the bundle registers the recall companions, while the copied preset owns the only compaction engine.

| Method | Engine in built-in presets | Touches preset files | Extra preset in picker | Setup effort |
|---|---|---|---|---|
| **1. Alias replace** | ✅ automatic (`standard`/`ptc`/`cordis`) | no | no | one command + recall patch rows |
| **2. AI-authored copy** | only the new preset | the copy | yes | one prompt |
| **3. Manual preset** | only the new preset | the copy | yes | manual edit |

> Only one `ctx.compaction` implementation may be mounted per preset context. Version 0.1.5 intentionally removed the bundle's old host-engine row so a host listener cannot race the preset-selected engine.

## Development

```bash
npm ci          # exact DSH 0.1.2-rc.1 development graph
npm test        # compiler/config/session/settings/engine integration
npm run check   # syntax + strict public-declaration typecheck
```

The package has two direct runtime dependencies: `@deepseek-ai/schemastery` for Config schemas and `@deepseek-ai/dsh-util-values` for the shared immutable-value helpers. Harness component packages remain peers; exact 0.1.2-rc.1 copies are development dependencies and locked for reproducible tests. `src/compiler.js` remains dependency-free.

## Differences from compaction-basic

- No summarizer call → compaction latency goes from seconds to milliseconds; no summarizer token spend.
- No rephrasing → facts, file paths, commands, and identifiers survive byte-exact; the model continues on its own words.
- Deterministic → the same region always compiles to the same checkpoint.
- Prior checkpoints are copied verbatim instead of being re-summarized (cheap and lossless).
- Manual `/compact` and automatic pressure compaction both keep a verbatim recent tail capped by fixed `retainTokens` or by the `retainRatio`-derived ceiling (whole turns first; a latest turn larger than the ceiling keeps only its fitting suffix) instead of compiling the whole history.
- The `compaction/summary` event carries the **compiled entries themselves** — the UI's expandable checkpoint row shows exactly the body the model sees, wrapped in an **adaptive Markdown code fence** (the fence grows longer than any ``` inside, so messages containing markdown render as one tidy code block), and the checkpoint heads with a short RECALL guide telling the model how to recover elided content via `recall` / `search`.
- Trade-off: the checkpoint can be less *dense* than an LLM summary for prose-heavy history (facts are truncated, not merged). The verbatim tail (`retainTurns`/`retainTokens`) is where active work lives, and everything else stays recoverable through `(seq N)` pointers + recall.

MIT licensed.
