# Changelog

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
