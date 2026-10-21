# dsh-compaction-instant

[English](README.md) | [简体中文](README.zh-CN.md)

Instant, near-lossless context compaction for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — an **alternative backend for `@deepseek-ai/dsh-compaction-basic`** that replaces LLM summarization with the deterministic conversation-compiler principle of [lllyasviel/VCC](https://github.com/lllyasviel/VCC).

A compaction compresses a shadowed history span in **milliseconds, with zero model calls**, keeping **original tokens only** — no paraphrase, no hallucination, no summarizer cost. Everything that is cut is still recoverable through `(seq N)` pointers into the durable session log.

## Key features

- **LLM-free** — compaction never invokes a model. No summarizer prompt, no inference latency, no token spend; the compile is deterministic text processing, so a million-token history compresses in milliseconds.
- **Near-lossless** — output contains only original tokens; every cut is marked and points at its durable `seq`, and prior checkpoints are copied verbatim.
- **Instant** — a single deterministic pass over the shadowed nodes; no network, no model, no KV-cache concerns.
- **Version-targeted backend** — uses the DSH compaction service and durable event protocol; activate it explicitly in a custom preset. Configuration and retention policy are not identical to the current `compaction-basic`.

## Compatibility

| dsh-compaction-instant | DeepSeek Harness | Node.js |
|---|---|---|
| `0.2.0`, `0.2.1` | `0.2.0-rc.1`, `0.2.0-rc.2` | `>=22.12.0` |
| `0.1.8` | `0.1.7` | `>=22.12.0` |
| `0.1.7` | `0.1.7` | `>=22.12.0` |
| `0.1.6` | `0.1.5-rc.1` | `>=22.12.0` |

Versions 0.2.0 and 0.2.1 target DSH **0.2.0**, supporting **0.2.0-rc.1 and 0.2.0-rc.2**; the current development and regression baseline is **0.2.0-rc.2** (commit **639ed015397290b3745d163aafe02ffee4aa3f84**, tag `dsh-v0.2.0-rc.2`). Peer ranges, `engines.dsh`, and the runtime dependency range are now `^0.2.0-rc.1 || ^0.2.1-0`, preserving rc.1 support while admitting the 0.2.1 prerelease line and stable release. Cordis and Schemastery also admit the 4.0.5 and 3.18.5 prerelease lines, respectively; the development lock remains on rc.2. From rc.1 to rc.2, the compaction, Session, tools/commands, token-meter and settings-form packages this backend uses only change version numbers, and the Plugins-page configuration slot contract is unchanged; no engine or browser-half code changes are needed. It still follows the 0.1.7 message model — tool results are first-class `role: "tool"` messages with a top-level `toolCallId` instead of user-role wrapper blocks — and the `compact-checkpoint` checkpoint source marker; checkpoints written by older hosts (`kind: "plugin", plugin: "compact"`) are still recognized in durable logs. Checkpoint replacements remain `surfaceOp: { op: "replace", startSeq, endSeq }`; the former `start` / `end` replacement fields are not supported. This is a specific migration target, not a compatibility claim for all future releases.

A leading `system/message` at surface node 0 stays outside the compacted span; selection begins at the next surface node, and explicit replacement ranges cannot include the system head. Instant's retention policy is unchanged: `retainTurns` is a preference, `retainTokens` (or the `retainRatio`-derived budget) is a ceiling, and an oversized latest turn keeps a fitting suffix. Tool-pair balancing may extend that suffix beyond the ceiling; the protected system head is separate. By contrast, the target basic backend uses a **minimum recent-tail budget**, not instant's whole-turn/ceiling policy. Do not assume configuration or behavior equivalence.

The added 0.2.1 dependency range is not a full compatibility certification. Source review used **0.2.1-alpha.5** (commit `1517a4dbca0a2789ff1d41ba439600f8547d23fa`). Regression coverage now includes owner-scoped client reload, drafts edited during a pending save, nonmonotonic surface recovery selections, and official-pruner provenance through compaction and replay. Other 0.2.1 prereleases and live GUI/profile activation have not been verified.

Typed `recall(type: "result")` follows validated official-pruner records back to the original tool result; `recall(type: "seq")` still reads the addressed event itself, including its pruned representation. Elision markers list exact seqs rather than treating surface order as a numeric interval. Complete recovery markers and minimum text/framing overhead can exceed an unusually small checkpoint cap; the reported token count includes that overhead.

Pinned evidence: [basic selector and system-head protection](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/compaction/compaction-basic/src/region.ts#L99-L155), [replacement operation](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/compaction/compaction-basic/src/region.ts#L505-L510).

The 0.2.0 plugin manager enforces these ranges itself: installing on an incompatible host fails with an `incompatible-version` refusal naming the unsatisfied `@deepseek-ai/dsh-*` peers. The deliberate escape hatch is an exact-version exemption (`dsh plugin allow-version`), which the panel surfaces — do not edit this package's metadata to force an install.

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

Recall projects durable text, reasoning, raw tool-call arguments, nested tool-result content and file-reference metadata (readable/searchable references, not attachment bytes); log-only events render as labeled data dumps; missing seqs are reported; a `maxRecallTokens` budget (default **16000**) cuts with a provenance marker and counts the skipped remainder; searches cap shown hits (`maxSearchHits`, default **50**). Both plugins are separate rows, so they can be mounted next to **any** compaction backend — they only read the durable log.

Every checkpoint also frames a short **RECALL guide** at its head, telling the model exactly how to use `recall` / `search` to recover elided content. When a prior checkpoint is elided under cap pressure it never vanishes silently: it leaves a single `[checkpoint N]` line (N = compaction ordinal, 1 = oldest), which `recall(type:"checkpoint", id:"N")` restores in full.

## Configuration

All fields optional; defaults shown. The retained-tail ceiling is subject to the tool-pair balancing exception described above; the protected system head is separate.

| Key | Default | Meaning |
|---|---|---|
| `thresholdRatio` | `0.5` | Fraction of the routed model's context window that triggers automatic compaction |
| `retainTurns` | `1` | Preferred complete recent turns kept verbatim (automatic and manual `/compact`); never overrides the ceiling |
| `retainRatio` | — | Legacy ratio mode (not current basic policy equivalence): derive the retained ceiling from the routed model context window; mutually exclusive with `retainTokens` and must be below `thresholdRatio` |
| `retainTokens` | `5120` | **Hard** retained-region token ceiling: older whole turns are added only while the total fits, and when the latest turn alone exceeds it, only the fitting suffix of that turn is kept; mutually exclusive with `retainRatio` |
| `auto` | `true` | Register `agent/pre-step` pressure and `agent/request-error` overflow recovery |
| `checkpointCap` | `65536` | Total budget for one compiled checkpoint (compiler tokens): a checkpoint compiled from a smaller span stays near-lossless, a larger one elides down to this cap |
| `maxTokens` / `checkpointScale` | `8192` / `0.1` | **Deprecated** — accepted for legacy configuration compatibility but **ignored**: the budget is the cap alone (no floor, no proportional scaling) |
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
| `summarizationProvider` / `summarizationModel` | — | Accepted for legacy configuration compatibility; **inert** — this backend never routes a model |

The tool and command plugins each take their own `{ maxRecallTokens?: 16000, maxSearchHits?: 50 }` config.

> **Cordis config gotcha:** the plugin row's config passes through the schemastery schema, whose `~standard` adapter injects **`[]` for every absent array key** (`toolArgTools`, `hideTools`, `noisePatterns`, `toolKeyFields`, `modelPolicies`). The resolver treats an empty list as *unset* and falls back to the defaults — so a missing `toolArgTools` keeps the built-in whitelist (never disable it by writing `toolArgTools: []`; empty means default). `debug: true` writes per-compile diagnostics to the configured `debugLogPath` (default `$DSH_HOME/compaction-debug.log`).

Budgets are enforced twice — by token count and by a `budget × 4` character ceiling — so pathological unbroken runs (base64 blobs, minified files) cannot bypass them. Tool calls are **always one line**: they are never rescaled, and the cap loop shrinks only the conversation-text budgets (floor **32 tokens** each). If the compiled region still exceeds the cap, the oldest **tool rows** are removed first (`[N tool/result entries elided: seqs a-b]`), and only then the oldest remaining entries (`[N earlier entries elided: seqs a-b]`) — tool calls can never squeeze the dialogue out. The newest content always survives.

### Browser settings section (Plugins page)

DSH 0.1.7 replaced the old settings-card API with profile-patch-backed settings forms, so the bundle ships a tiny **settings bridge row** (`dsh-compaction-instant/settings`, composition id `compaction-instant`, installed by the bundle patch). Its all-volatile Config schema makes the host serve the `compaction-instant` settings form, and the Web **Plugins → dsh-compaction-instant → configuration** section edits it live. Writes persist into the profile's `cordis.patch.yml` and apply to every mounted instant engine without a reload; the bridge row itself mounts nothing and shares no state with the engines — they watch the served form.

| Field | Meaning |
|---|---|
| `checkpointCap` | Total compiler-token budget for one checkpoint (engine default 65536) |
| `auto` | Register automatic between-step compaction (engine default on) |
| `thresholdRatio` | Context-window fraction that triggers automatic compaction (engine default `0.5`) |
| `retainTurns` | Preferred complete recent turns kept verbatim (engine default `1`) |
| `retainTokens` | **Hard** retained-token ceiling for the fixed-ceiling mode (engine default `5120`) |
| `retainRatio` | Ratio compatibility mode: derive the retained ceiling from the routed model context window |

The bundle also installs an inert **client-carrier row** (`compaction-instant-client`, naming the bare package with `carrier: true`): dsh-client-modules binds a bundle's browser half to the profile row whose specifier is exactly the package name, and this row is that anchor. The root module dispatches it to a no-op, so no profile-level engine races the preset-owned backend. Keep the row enabled — disabling it hides the configuration section while the engines keep working composition-only.

Everything else (`modelPolicies`, `toolArgTools`, `debug`, `debugLogPath`, the deprecated `maxTokens`/`checkpointScale`, …) stays Cordis-config-only. Unset fields inherit each engine's own defaults, so a fresh bridge row starts **empty** rather than cloning defaults into the profile. `retainRatio` and `retainTokens` are mutually exclusive retention modes; a section carrying both resolves to ratio mode, and a served `retainTokens` clears an entry's ratio mode for as long as it is set. A section that conflicts with an engine's own composition (for example a `retainRatio` at or above that engine's `thresholdRatio`) makes only that engine log a warning and continue **composition-only** until the section becomes valid for it; every other engine keeps following. The settings plane validates each field at write time, but the cross-engine combination check of the 0.1.5 card is gone — a conflicting override now surfaces as that per-engine warning instead of a refused write. Without the bridge row (or without a settings service) every engine uses only its composition entry. Legacy `settings.yaml` overrides written by the 0.1.5 card are imported automatically by the host's 0.1.7 migration. After installation, ask the user to confirm a host reload/restart so the boot graph can pick up the `dsh.client` bundle; do not restart their host automatically.

### Tokenizer and multilingual behavior

The tokenizer is a character-class heuristic: ASCII letter runs and digit runs count as one token each, punctuation is per-character, whitespace is free, and every other code unit is its own token. Concretely:

| Content | Tokens |
|---|---|
| CJK (`你好，世界！`) | 1 per code point (6) |
| Cyrillic / Arabic | 1 per code unit |
| Accented Latin (`café`) | ASCII runs stay grouped (`caf` + `é`) |
| Emoji (`😀`) | 2 (surrogate pair) |

Every truncation, excerpt, and cap cut is taken at a **code-point boundary** — a slice never leaves a lone surrogate half, so emoji and other astral characters always reach the model intact (pinned by `test/multilang.test.js`). The character-density ceiling follows the DeepSeek docs conversion (quick_start/token_usage): about 0.3 tokens per non-CJK character and 0.6 per CJK character.

The Harness token meter is separate from the compiler estimator. Under DSH 0.1.7 it supplies route-priced `tokens` for pressure, retention, and the shrink guarantee, plus fixed `heuristicTokens` for the durable `compaction/summary.shadowedTokenCount` projection. The compiler heuristic and both Harness prices deliberately coexist.

## Guarantees

- **Instant** — the compile is a single deterministic pass over the shadowed nodes; no network, no model, no KV-cache concerns.
- **Near-lossless** — output contains only original tokens; every cut is marked and points at its durable `seq`; prior checkpoints are copied verbatim.
- **Targeted protocol support** — uses `ctx.compaction`, durable provenance, `ctx.tokenMeter` pricing, and the shrink check (a checkpoint that would not reduce the selected surface is rejected). This does not imply identical configuration, retention policy, or activation across presets.
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

## Installation and upgrade

### Recommended: direct install + profile preset override

Install into the profile used by your host with Harness's plugin manager. Use the published version only if it is available, or the freshly packed local tarball described below:

```bash
dsh plugin --profile web add dsh-compaction-instant@0.2.1
```

For DSH Desktop 0.2.0-rc.2, use `--profile desktop` instead of `--profile web`. Open Desktop once to initialize the profile, fully quit it before CLI package operations, then reopen it afterward; obtain user confirmation before interrupting active sessions.

The package's `dsh.bundle` installs **the recall/search tool, the /recall command, the settings bridge row, and the inert client-carrier row** — not the compaction engine. Seeing recall tools or the Plugins-page configuration section does **not** prove instant compaction is active. Do not assume `standard` uses this package just because it is installed.

In DSH 0.2.0 the shipped `standard` preset is one `@deepseek-ai/dsh-agent-preset` declaration row (`preset-standard` in the web-app include tree); a same-id row in the profile's `cordis.patch.yml` **replaces it wholesale**, so the override must restate the full `config` — every `plugins` row, not just the delta. Do not edit shipped preset files.

1. Copy the `preset-standard` row from the shipped `packages/bundle/web-app/presets/standard.patch.yml` into the profile's `cordis.patch.yml` under a single `- insert:` item, keeping `id: preset-standard`, the name, and the entire `config` (`id`, `order`, all `plugins`).
2. Inside the copied `config.plugins`, find the `compaction` group and change only its engine row from `compaction-basic` to this package. Review the old backend's config against this README rather than blindly copying it; the target basic retention policy differs. The **group fragment** (everything else stays as shipped):

```yaml
- id: compaction
  name: cordis:group
  group: true
  isolate:
    compaction: true
    toolResultPruner: true
  config:
    - id: compaction-instant
      name: dsh-compaction-instant
    - id: command-compact
      name: '@deepseek-ai/dsh-command-compact'
    - id: tool-result-pruner
      name: '@deepseek-ai/dsh-compaction-tool-result-pruner'
      config:
        thresholdChars: 8192
        headChars: 4096
        tailChars: 1024
```

3. Select the `standard` preset for a new validation session. Verify its resolved plugin module/version and that the engine mounts, then exercise `/compact` and recall. A preset being listed, or recall being available, is not an engine activation check. Do not assume an existing session has switched to a newly edited composition.

A fully custom preset (a second `@deepseek-ai/dsh-agent-preset` row with its own `config.id`) works the same way and leaves the shipped `standard` untouched; select it explicitly. Only one `ctx.compaction` implementation may be mounted per preset context. Do not add a host-level engine as a fallback: an unscoped listener can receive agent events and race the preset-owned backend. `/compact` is backend-independent, but it still requires an active backend in the selected preset.

### Upgrading a tarball deployment

**Editing this source checkout does not update a previously installed tarball.** A package version edit or passing local tests also does not update the running host. After review and user confirmation of deployment:

```bash
# In this plugin checkout: create a new package artifact.
npm pack
# Install that NEW artifact into the actual host profile (use its absolute path).
dsh plugin --profile web add /absolute/path/dsh-compaction-instant-0.2.1.tgz
```

Before running these deployment steps, confirm the target profile, installed package name (direct or alias), current resolved path/version, and intended preset with the user. If an old alias deployment exists, explicitly plan its replacement/removal instead of leaving two possible engine resolutions. Inspect the newly installed artifact and the custom preset's resolution afterward. **Ask the user to confirm host reload/restart** before doing it; it may interrupt active sessions. Reload the host so package code/boot metadata are loaded, then refresh the Web page and verify the existing host URL and a new session. A profile patch hot reload or page refresh alone is not proof that new package code replaced an already loaded module. These are operator instructions, not a claim that this release has been deployed.

### Alias installation: advanced, conditional

The browser bundle registers only `dsh-compaction-instant`. DSH alpha.5 discovers a Client by the actual package manifest name, so an npm alias alone is not a supported browser-carrier path. Use direct installation plus the explicit preset override for the complete engine/settings deployment; migrate old alias-only deployments before relying on the Plugins configuration page.

Installing under `@deepseek-ai/dsh-compaction-basic` was the older replacement route. It only works when the actual preset and resolver select that alias; it is **not inherently safe**, nor a guarantee that `standard` or all configurations will use instant correctly. Basic's current policy is different. Prefer the explicit preset override above. If you intentionally retain an alias, verify the resolved module, review configuration and companion subpath names, and validate the selected preset after a user-approved reinstall and host reload. Do not combine alias and direct engine rows in the same preset.

## Development

```bash
npm ci          # exact DSH 0.2.0-rc.2 development graph
npm test        # compiler/config/session/settings/engine integration
npm run check   # syntax + strict public-declaration typecheck
npm run check:package # pack + isolated installed-artifact tests/exports/browser registration
```

The package has two direct runtime dependencies: `@deepseek-ai/schemastery` for Config schemas (including the settings bridge's volatile fields) and `@deepseek-ai/dsh-util-values` for the shared immutable-value helpers. Harness component packages remain peers; exact 0.2.0-rc.2 copies are development dependencies and locked for reproducible tests. `src/compiler.js` remains dependency-free.

Verification scope for 0.2.0 includes replacement fields and rejection of the old shape, system-head protection, explicit ranges, retention/tool pairing, durable replay/provenance, recall/search file references, tool-role message projection and both generations of checkpoint markers, the settings bridge schema plus settings-plane follow/fallback behavior, root-module dispatch (carrier inertness, carrier-key stripping, engine fiber-state propagation), and installed-artifact exports/browser registration. Verified on Windows: against the clean-installed 0.2.0-rc.2 development graph, Node 24.15.0 passed all 128 checkout tests and the syntax/type checks passed; the packed tarball installed in isolation resolved the 0.2.0-rc.2 peer graph and passed all 121 installed-artifact runtime tests. A running-host restart, live GUI verification, deployment, and real model requests were not performed for this retarget. The measured compression tables above are historical, not a rerun for this release.

For this Windows sandbox run, tests used no child-process isolation (`node --test --experimental-test-isolation=none`; the package check received the same flag through `NODE_OPTIONS=--experimental-test-isolation=none`).

## Differences from compaction-basic

- No summarizer call → compaction latency goes from seconds to milliseconds; no summarizer token spend.
- No rephrasing → facts, file paths, commands, and identifiers survive byte-exact; the model continues on its own words.
- Deterministic → the same region always compiles to the same checkpoint.
- Prior checkpoints are copied verbatim instead of being re-summarized (cheap and lossless).
- Manual `/compact` and automatic pressure compaction both keep a verbatim recent tail capped by fixed `retainTokens` or by the `retainRatio`-derived ceiling (whole turns first; a latest turn larger than the ceiling keeps only its fitting suffix) instead of compiling the whole history.
- The `compaction/summary` event carries the **compiled entries themselves** — the UI's expandable checkpoint row shows exactly the body the model sees, wrapped in an **adaptive Markdown code fence** (the fence grows longer than any ``` inside, so messages containing markdown render as one tidy code block), and the checkpoint heads with a short RECALL guide telling the model how to recover elided content via `recall` / `search`.
- Trade-off: the checkpoint can be less *dense* than an LLM summary for prose-heavy history (facts are truncated, not merged). The verbatim tail (`retainTurns`/`retainTokens`) is where active work lives, and everything else stays recoverable through `(seq N)` pointers + recall.

MIT licensed. The [plugin icon](<assets/icon.svg>) adapts [Lucide Shrink](https://lucide.dev/icons/shrink), distributed under the [ISC license](<assets/LICENSE.lucide>); see [source and modifications](<assets/README.md>). Version 0.2.1 declares a local package icon verified with the DSH 0.2.0-rc.2 and 0.2.1-rc.2 metadata readers; the companion-entry icons use the newer subpath resource contract verified on 0.2.1-rc.2. Older companion rows keep their default artwork.
