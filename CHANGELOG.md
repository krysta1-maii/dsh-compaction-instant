# Changelog

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
