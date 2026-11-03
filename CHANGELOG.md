# Changelog

## 0.5.0 — 2026-11-03

### DSH 0.2.2-alpha.3 development baseline

- Moves the default development graph from DSH **0.2.1-rc.5** to **0.2.2-alpha.3** (commit **05b1cae8db6e674c5685101494d4eec24652424a**), with Cordis **4.0.6-alpha.2** and Schemastery **3.18.6-alpha.2**. `engines.dsh`, the DSH peer ranges, and the two runtime dependency ranges add an explicit `^0.2.2-alpha.3` alternative. The earlier alternatives still cover 0.2.1 hosts, while a 0.2.2 host no longer installs a second copy of `@deepseek-ai/dsh-util-values` or `@deepseek-ai/schemastery`.
- Migrates the PTC and preset-controller fixtures from the removed `dsh-tools` `mode` config to the 0.2.2 executor seam. The tests mount `@deepseek-ai/dsh-tool-executor-native` or `@deepseek-ai/dsh-tool-executor-ptc` and call `ctx.tools.execute` with a `ToolBatchInput`; `run_code` is executor-owned, so registry schema assertions now cover registered capabilities and the model-facing transport is exercised through the executor.
- No runtime source change was required: every Host import, event, and service used by the package still exists at 0.2.2-alpha.3, and the strict declaration check passes against the new types.
- Documentation and the bundle header name the new target. The PTC section points at the `tool-executor-ptc` row; `@deepseek-ai/dsh-agent-tool-presentation` with `mode` remains a deprecated compatibility path on 0.2.2, not the recommended composition.

### Verification

- Linux / Node **24.22.1**: the alpha.3 development graph passed `npm ls --all`, syntax and strict declaration checks, all **201** checkout tests, and the isolated tarball package check with **193** artifact tests (`dsh-compaction-instant-0.5.0.tgz`).
- The 0.2.1-rc.5 graph was not re-run for this release; 0.4.1 remains the rc.5 verification record. No live profile deployment, host restart, GUI session, or real model request was performed for 0.5.0.

## 0.4.1 — 2026-11-03

### Fixes from the first live deployment

- **Host registration moved into a command-injected child fiber.** Cordis resolves a service through the fiber that declares it, so an Agent scope whose surrounding composition injects only `tools` rejects `agent.ctx.commands` with "cannot get property \"commands\" without inject". The controller now mounts one child fiber of the Agent scope with `inject: ["tools", "commands"]` and registers all three companions there; the scope tag keeps the effects in the Agent's own layer and releasing the fiber removes them together. Before the fix every registration rolled back silently after the tools step, which is why no target preset received the tools.
- **The roster namespace is injected, not read through a proxy.** The browser module now resolves `remote.agentPresets` through a child fiber that injects `remote` and `remote.agentPresets` (with a direct-read fallback and a mounted-state retry). The previous access went through `ctx.get("remote")` and a property read, which the same guard rejects, so `refresh()` threw before the roster load and the section rendered only the saved ids.
- The controller tests now build their Agent scopes from an owner that injects only `tools`, matching `dsh-agent-loop`; that fixture condition reproduces the live failure instead of hiding it.
- The roster now shows the four shipped presets with their localized names (标准模式 / PTC 模式 / 极简模式 / 创造模式, or Standard / PTC / Minimal / Creator mode) instead of the bare ids. A shipped preset publishes no `name`, so the id fallback made them read like technical tokens; a declaration that publishes its own name keeps that name.

### Verification

- Verified on Linux / Node **24.22.1**: `npm ls --all`, syntax and strict declaration checks, all **201** checkout tests, and the isolated rc.5 tarball package check with **193** artifact tests (`dsh-compaction-instant-0.4.1.tgz`). The 200-test checkout suite was previously cross-checked on **24.19.0**.
- Live deployment on the same Linux host: the package was linked into the Web profile, the host was restarted, and a real PTC session whose Agent scope listed `recall` and `search` executed both tools (`recall` read a checkpoint, `search` returned structured hits). The Plugins page roster loaded and saved the enabled set; the four shipped presets render their localized names (pinned by the client tests, served through client HMR). Preset switching through the GUI and a re-run of the older 0.2.0-rc.1 / 0.2.0-rc.2 / 0.2.1-alpha.5 / 0.2.1-rc.3 graphs remain unverified. The peer range is unchanged; 0.4.1 re-verifies rc.5 only.

## 0.4.0 — 2026-11-02

### Preset-scoped recall companions

- **Behavior change:** the bundle no longer installs the Host-global `tool-recall` and `command-recall` rows. `recall`, `search`, and `/recall` are registered in each Agent's own scope and only for the presets enabled on the Plugins page. The new target-state list defaults to empty, so upgrading removes the companions from every preset until a user selects one; no preset YAML has to be edited.
- Adds the `dsh-compaction-instant/preset-tools` row (composition id `compaction-instant-preset-tools`): a volatile `presets` settings form (namespace `compaction-instant-preset-tools`) plus a Host controller that reconciles the list against `agentPresets.composedPreset(agent.ctx)`, never against a display name or an event payload.
  - covers Agents live at mount, future `agent/created` Agents, `agent/disposed` cleanup, and `agent-preset/selected` switching before or between turns;
  - registers or releases `recall`, `search`, and `/recall` transactionally in the nearest Agent scope with exact disposers; a registration failure rolls back the companions it created and is logged without failing Agent creation;
  - is idempotent: an unrelated settings write, a repeated notification, or a re-selection of the same preset produces no registration churn or `tools/change` traffic;
  - registers through `agent.ctx`, so the Agent scope unwinds the registration on disposal, and the controller's own teardown releases every Agent it still covers when the row unloads.
- The Plugins page gains a second section on the same bundle page: the preset roster from `remote.agentPresets.list()`, name/id/default/broken/unavailable markers, checkbox selection, and independent save, discard, reset, and refresh state. A missing `remote.agentPresets`, a failed roster read, a broken preset, a preset that left the roster, and a read-only connection each degrade without touching the engine form.
- The static `dsh-compaction-instant/tool` and `dsh-compaction-instant/command` subpaths remain exported for hand-written compositions; do not mount them for a preset that the panel also enables for the same Agent.
- Adds `@deepseek-ai/dsh-scope` as a pinned development dependency, because the controller tests drive a real scoped context. No runtime dependency is added.
- Documents the semantics precisely: the preset is the controller's filter, the contribution lives in the Agent scope, and an in-flight call is never cancelled by a disable.

### Development baseline

- Moves the default development graph from DSH **0.2.1-rc.3** to **0.2.1-rc.5** (commit **b830ec950faba0a46dda564be3e2d854afed94f1**). Peer ranges and `engines.dsh` remain unchanged. The rc.3 → rc.5 source audit found no changes to the Host APIs used by this package.

### Verification

- Verified on Linux / Node **24.22.1** (`npm ls --all`, syntax and strict declaration checks, all **200** checkout tests, and the isolated rc.5 tarball package check with **192** artifact tests) with a **24.19.0** cross-check of the same checkout suite (200/200).
- 0.4.0 was deployed to a live profile and superseded by **0.4.1** after that deployment surfaced the registration failure; see 0.4.1 for the fix and the live verification. A preset switch through the GUI and a re-run of the older 0.2.0-rc.1 / 0.2.0-rc.2 / 0.2.1-alpha.5 / 0.2.1-rc.3 graphs were not performed for 0.4.0. The peer range is unchanged, but 0.4.0 verified rc.5 only.

## 0.3.0 — 2026-10-26

### PTC compatibility and recovery

- Moves the default development graph to DSH **0.2.1-rc.3**, Cordis **4.0.5**, and Schemastery **3.18.5**. Peer ranges and `engines.dsh` remain `^0.2.0-rc.1 || ^0.2.1-0`; no runtime dependency is added.
- Rejects non-finite, non-safe, reversed, and over-budget recall seq selections before expansion. `MAX_RECALL_ENTRIES` (1000) bounds the declared width of a whole selection, including duplicate ranges and missing seqs; compiler elision markers are split into independently recallable chunks at the same limit.
- Threads optional `AbortSignal`s through recall, search, provenance traversal, and the model-facing tools, checking at every event, selection, and source-chain step without claiming interruption inside a single catastrophic regex.
- Checkpoints retain the outer `run_code` `description` and add one row per nested PTC dispatch with stable start/settle pointers. A start-only row is preserved only when the outer result is the host's `TOOL_OUTCOME_UNKNOWN` recovery outcome; normal completions, duplicate events, orphan settles, `TOOL_NOT_STARTED` with nested history, and identity mismatches abort the compaction instead of committing a partial checkpoint.
- `recall(type:"result")` accepts settled `tool/ptc-dispatch` events directly while keeping the official pruner provenance checks for `tool/result` unchanged. Dispatch events remain log-only and are never added to `shadowedSeqs`.
- The compiler reports inspected dispatch start/settle seqs through optional `referencedSeqs`; the transaction appends them to `checkpoint.sourceEventSeqs`. Custom compile hooks may omit the field, and invalid duplicates/future/unsafe refs fail at `Session.append` and close the compaction in an error bracket.
- The `recall` canonical value now includes `entries` and `seqs`; `search` includes structured `hits` (`seq`/`kind`/`text`). A real `ToolRuntime(mode:"ptc")` program can complete search → recall without parsing display text; `output.render` is unchanged.
- Documentation now limits recall/search promises to recorded durable content, describes spill replacement (post-spill preview plus an opaque locator, not the pre-spill canonical value), explains dispatch-log visibility timing inside one `run_code`, and documents replacing the engine inside `preset-ptc` rather than only `preset-standard`.
- Fixes the isolated package check to pin only top-level lock entries, so nested historical dependency layouts (rc.1/rc.2) can be installed and checked.

### Verification

- Linux / Node **24.22.1**: the rc.3 development graph passed all **177** checkout tests, syntax and strict declaration checks, and the isolated tarball package check (**169** artifact tests).
- Isolated compatibility graphs for **0.2.0-rc.1**, **0.2.0-rc.2**, and **0.2.1-alpha.5** each passed **170** checkout tests, syntax/type checks, and their tarball package checks. The rc.1/rc.2 graphs used Cordis 4.0.5 to keep the pinned Cordis plugin peers consistent.
- No real `preset-ptc` composition with a packaged artifact, live GUI, host restart, deployment, or real model request was performed. Those remain unverified.

## 0.2.1 — 2026-10-21

### Plugin icon

- Adds a locally bundled adaptation of the Lucide Shrink icon: white inward arrows on an indigo rounded square, with its upstream ISC license and source attribution.
- Declares the top-level package `icon` and exports the same artwork for the tool, command, and settings subpaths. Includes all assets in the npm package and verifies them in the isolated tarball smoke check.
- Verifies root icon loading through the real `readPluginMeta` readers from DSH **0.2.0-rc.2** and **0.2.1-rc.2**, plus all three companion icons on **0.2.1-rc.2**. The locked development graph and runtime dependency ranges are unchanged; older companion rows retain their default artwork.
- Verification on Linux / Node **24.19.0**: all **152** checkout tests, syntax and strict declaration checks, and all **144** isolated tarball runtime tests passed, including icon resource and license packaging checks. Chrome rendered the SVG successfully at 24, 40, and 64 pixels on light and dark backgrounds. No profile deployment, running-host reload, or live Plugins-page verification was performed.

### DSH 0.2.1 dependency ranges

- Extends DSH peer/runtime requirements and `engines.dsh` to `^0.2.0-rc.1 || ^0.2.1-0`, admitting the 0.2.1 prerelease line and stable release without dropping rc.1/rc.2.
- Adds Cordis 4.0.5 and Schemastery 3.18.5 prerelease ranges. Keeps the rc.2 development graph and all resolved lockfile packages unchanged.
- The range declaration does not certify untested 0.2.1 releases; the runtime corrections below target the audited alpha.5 contracts.

### Runtime recovery and client fixes

- Registers the browser factory under the real package owner only, so owner-scoped invalidation can reload it without a stale alias collision. Legacy npm-alias-only browser deployments must migrate to direct installation plus explicit preset composition.
- Successful settings saves clear only the submitted draft revisions, preserving edits, resets, and clears made while the Host mutation is pending.
- Emits exact, deduplicated recovery seq selections for nonmonotonic surfaces, splitting consecutive runs at the recall span limit. Keeps both elision phases' provenance and the newest event's seq pointer intact.
- Typed result recall follows validated adjacent official-pruner records back through repeated pruning to the original tool result. Raw seq recall remains verbatim; malformed provenance fails instead of following an unrelated result.
- Complete recovery markers take priority over an impossibly small checkpoint budget. Token accounting includes this irreducible marker/text overhead; no hard-cap guarantee is made for those tiny-budget cases.

### Runtime fix verification

- On Linux, Node 22.22.1 passed all 150 checkout tests; Node 24.19.0 passed 151 (including automatic loading of the TypeScript compatibility fixture). Syntax and strict declaration checks passed.
- The installed tarball passed all 144 artifact runtime tests on both the locked 0.2.0-rc.2 graph and an isolated, normally installed 0.2.1-alpha.5 graph with matching vendored prereleases. Alpha.5 Node exports, dependency validation, and strict consumer types also passed. Repository-only version assertions are excluded from artifact runs.
- The real alpha.5 ClientModuleSystem source at `1517a4dbca0a2789ff1d41ba439600f8547d23fa` passed initial factory materialization plus two owner invalidation/reload cycles in a Node VM smoke. This is not a live browser/profile activation test. No deployment, host restart, or model request was performed.

## 0.2.0

### DSH 0.2.0-rc.2 compatibility

- Adds DSH **0.2.0-rc.2** to the supported targets (commit `639ed015397290b3745d163aafe02ffee4aa3f84`, tag `dsh-v0.2.0-rc.2`). The runtime contracts used by the engine and browser configuration remain compatible; no runtime source changes are required.
- Pins the development dependency graph to rc.2 and makes installed-package version checks follow the manifest. Peer/runtime ranges and `engines.dsh` stay at `^0.2.0-rc.1`, retaining rc.1 support. The plugin version remains 0.2.0.
- The package checker captures `npm pack --json` in a regular file instead of a child-process pipe, supporting Windows confined runs.
- Verified on Windows / Node 24.15.0 after a clean rc.2 install: syntax and strict type checks passed, all 128 checkout tests passed, and all 121 isolated tarball runtime tests plus exports/browser registration checks passed. Tests used `--experimental-test-isolation=none` (via `NODE_OPTIONS` for the package check). No host deployment/restart, live GUI verification, or real model request was performed.

### DSH 0.2.0 retarget

- Targets DSH component packages 0.2.0 (verified against **0.2.0-rc.1**, commit `4878cdabd87d4041bdaff61d04c966883b9fd07a`, tag `dsh-v0.2.0-rc.1`); peer ranges move to `^0.2.0-rc.1` with `engines.dsh`, and `@deepseek-ai/dsh-util-values` follows as a runtime dependency. Cordis ^4.0.4, Schemastery ^3.18.4 and Node.js >=22.12.0 are unchanged. DSH 0.1.7 is no longer a supported peer of this release (0.1.8 remains the 0.1.7 line).
- No engine or browser-half code changes: the 0.1.7-rc.1 → 0.2.0-rc.1 source diff is additive for every interface this backend touches. The `ctx.compaction` durable protocol (`compaction/start|summary|end`, checkpoint replacement, failure vocabulary), the token meter, the session request-header surface, the settings-form plane (`configForms`), and the Plugins-page `plugins.bundle.config` slot are byte-identical or unchanged in behavior; the new session `toolHistory()` fold and LLM tool-update projection serve LLM-calling backends and are optional inputs the deterministic compiler does not consume.

### Verification

- Regression scope: the full 0.1.8 scope against the clean-installed 0.2.0-rc.1 development graph.
- Verified on Windows with Node 24.15.0: all 128 checkout tests passed; syntax and strict declaration typecheck passed; the isolated tarball run passed all 121 tests against DSH 0.2.0-rc.1. A running-host restart, live GUI verification, deployment, and real model requests were not performed for this retarget.

## 0.1.8

### Plugins page configuration fix

- The bundle patch now installs an inert client-carrier row (`compaction-instant-client`, bare package specifier with `carrier: true`): dsh-client-modules binds a bundle's browser half only to the profile row whose specifier is exactly the package name, so the subpath-only 0.1.7 patch never loaded the client module and the Plugins page showed no configuration section. Keep the carrier row enabled; disabling it hides the section while engines keep working composition-only.
- The root module is now a dispatcher: carrier rows no-op; every other row mounts the engine with its fiber state propagated to the row, preserving preset mount-audit semantics. No profile-level engine races preset-owned backends.

### Verification

- Regression scope: the 0.1.7 scope plus root-module dispatch (carrier inertness, engine mounting with the carrier key stripped, fiber failure propagation, malformed-flag rejection) and the four-row bundle patch shape.
- Verified on Windows with npm 11: clean `npm install`, syntax checks and strict declaration checks passed. Node 24.15.0 passed all 128 checkout tests; the isolated tarball run passed all 121 tests (migration tests excluded by design) against DSH 0.1.7-rc.1.

## 0.1.7

### DSH 0.1.7 migration

- Targets DSH component packages 0.1.7 (verified against 0.1.7-rc.1, commit `46a7f68b0922371ce7144b668b90e377d8e799f4`, tag `dsh-v0.1.7-rc.1`); peer ranges move to ^0.1.7-alpha.1 with `engines.dsh`, Cordis ^4.0.4, Schemastery ^3.18.4; Node.js remains >=22.12.0. DSH 0.1.5 is no longer a supported peer.
- Follows the 0.1.7 message model: tool results are first-class `role: "tool"` messages with a top-level `toolCallId`. The compiler maps result pointers from them (and still recognizes the pre-0.1.7 user-role shape in older logs), and recall/search render the `[seq N: tool]` role header.
- Recognizes the 0.1.7 `compact-checkpoint` checkpoint source marker; checkpoints persisted by older hosts (`kind: "plugin", plugin: "compact"`) are still identified, so recall(type:"checkpoint") and checkpoint-copy keep working across upgraded logs.
- Settings move to the 0.1.7 settings plane. The bundle patch now installs a settings bridge row (`dsh-compaction-instant/settings`, composition id `compaction-instant`) whose all-volatile Config schema serves the `compaction-instant` form namespace; engines overlay the sparse section on their composition entries and follow `settings/document-updated` live. The browser half migrates from the removed `settingsScope`/`settings.plugin.item` card to `ctx.configForms` plus a `plugins.bundle.config` section on the Plugins page; writes persist into the profile `cordis.patch.yml`.
- Behavior change: the 0.1.5 card's write-time cross-engine validation is gone. The settings plane validates each field, and an engine whose composition conflicts with the served section logs a warning and continues composition-only until the section becomes valid for it — it never breaks, and other engines keep following.
- Preset activation docs updated for 0.1.7: `standard` is a `@deepseek-ai/dsh-agent-preset` declaration row; override `preset-standard` from the profile `cordis.patch.yml` (a same-id row replaces it wholesale, so restate the full `plugins` list) and swap the compaction group's engine row to `dsh-compaction-instant`.

### Verification

- Regression scope: the 0.1.6 scope plus tool-role message projection (compiler result pointers, recall/search headers), both generations of checkpoint markers, the bridge schema's volatile validation, settings-plane follow/fallback across independent engines, and the ConfigForms client save path.
- Verified on Windows with npm 11: clean `npm install`, syntax checks and strict declaration checks passed. Node 24.15.0 passed all 127 checkout tests; the isolated tarball passed all 121 runtime tests. File readback/Session replay and browser registration remain smoke checks, not a live GUI test; no profile deployment, host restart or real model request was performed. Historical compression measurements are unchanged.

## 0.1.6

### DSH 0.1.5-rc.1 migration

- Targets DSH component packages 0.1.5-rc.1 at commit `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`; Node.js remains >=22.12.0.
- Writes checkpoint replacement operations with `surfaceOp: { op: "replace", startSeq, endSeq }`. The old `start` / `end` surface-operation protocol is not supported by this release.
- Protects a leading `system/message` from compaction, both in automatic selection and explicit replacement ranges; the compactable prefix begins at the next surface node after that head.
- Preserves instant's existing retention policy: preferred `retainTurns`, fixed `retainTokens` or ratio-derived ceiling, oversized-turn suffix retention, and tool-pair balancing. The protected system head is separate; balancing may exceed the tail ceiling. This is not the target basic backend's minimum-tail policy, and not a promise of full configuration equivalence.
- Preserves file-reference metadata in recall/search projection; this makes references readable/searchable, not a restoration of attachment bytes.
- Documents explicit custom-preset activation, recall-only bundle semantics, and tarball upgrades. Source edits do not change an installed tarball: repack/reinstall into the intended profile and obtain user confirmation before host reload/restart. Removes unconditional alias safety and built-in-preset activation claims.

### Verification

- Regression scope: new surface-operation fields and old-shape rejection; system-head protection and explicit ranges; unchanged retention and tool-pair balancing; durable compaction provenance, replay and recall/search including file references; token-meter, settings and engine integration; syntax and strict public declarations.
- `npm run check:package` covers packing, isolated artifact installation, tests against the installed artifact, exports and browser bundle registration. CI uses this artifact check rather than a pack dry-run alone.
- Verified with npm 9.2.0: clean `npm ci`, syntax checks and strict declaration checks passed. Node 22.22.1 passed all 126 tests; Node 24.19.0 passed the same tests plus automatic loading of the TypeScript compatibility fixture (127 reported). The isolated tarball passed all 121 runtime tests; repository-only migration checks run in the source suite.
- Verified file serialization/readback and real Session replay, not a full running-host SessionStore restart. Browser registration is a module-loader smoke check, not a live GUI test. No profile deployment, host restart or real model request was performed. Historical compression measurements are unchanged and are not a new-release benchmark.

## 0.1.5 — 2026-09-04

### DSH 0.1.2-rc.1 migration

- Requires DeepSeek Harness component packages ^0.1.2-rc.1, Cordis ^4.0.2, Schemastery ^3.18.2, and Node.js >=22.12.0.
- Replaced removed public Session.events access with eventAt(), snapshotEvents(), and seq.
- Adopted the rc.1 dual token protocol: route-priced tokens drive pressure, retention, and shrink checks; fixed heuristicTokens drive durable shadow pricing.
- Added full compaction-basic retainRatio compatibility, including model-policy inheritance, mutual exclusion with retainTokens, and context-window scaling.
- Migrated browser code from removed dsh-client-runtime/client to the rc.1 static dsh-client-store module and dsh-api-remotes injection; multi-field saves now use one atomic settings mutation.
- Uses SettingsProvider.installSection; compatible isolated preset engines share the host-global namespace and promote a live follower on owner unload, while incompatible entries explicitly fall back to composition-only mode.
- Removed the bundle's host-level compaction engine. DSH 0.1.2 presets own the engine, preventing host/preset event-listener races.
- Added exact development dependencies, npm lockfile, Node 22.12/24 CI, strict declaration checks, export smoke coverage, and real rc.1 settings/token/session integration tests.

## 0.1.4

- Browser settings card, 64K checkpoint cap, adaptive checkpoint presentation, and repository metadata updates.
