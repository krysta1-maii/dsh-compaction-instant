# 未发布 DSH 变更的兼容性审计（0.2.2-rc.3 → master 39163dd3）

- 日期：2026-11-13
- 状态：已完成审计，仅记录结论；本文不含代码改动
- 审计对象：dsh-compaction-instant 0.5.0（开发基线 0.2.2-alpha.3）
- 上游范围：`dsh-v0.2.2-rc.3`（`38a6a5c965aa99ab525161efb7cc5cf1fe62fced`）到 `master`（`39163dd30f703a79079e2d2446545cff3c453738`）
- 运行环境：Linux，Node 24.22.1，已安装 DSH 0.2.2-rc.3

## 1. 审计范围与方法

### 1.1 上游范围的界定

上游仓库 HEAD 的 `git describe` 为 `dsh-v0.2.2-rc.3-608-g39163dd30f`，merge-base 正好是 rc.3 的 tag 提交，因此这段区间共有 608 个提交、76 个 first-parent 合并、3309 个文件变化（+104100/−36870），全部属于 rc.3 之后落地、尚未形成发布版本的内容。HEAD 根 `package.json` 仍写 `0.2.2-rc.3`，下一版本的版本号尚未确定。

把区间内容与 rc.3 标签对照后可以发现一个关键事实：官方仓库在 rc.3 之后补充了 18 篇升级指南（`v0.2.2-rc.1` 目录 5 篇、`v0.2.2-rc.2` 目录 13 篇），这批指南中的多项对应能力在 rc.3 中并不存在。例如 `packages/ptc-runtime/ptc-runtime-node/src/evaluators/scoped-repl.ts`、`packages/client/modules/src/client/main-realm.ts`、`packages/util/text-search/`、`packages/util/package-manifest/src/client-module.ts`、`packages/client/ui-session-status/` 都无法在 rc.3 的树中找到。这说明 master 上积压的是原计划随 rc.1/rc.2 发布、但因发布分支切出较早而未能进入 rc.3 的一整批改动。它们将整体进入下一个发布版本，本次审计的正是这批内容。

### 1.2 证据来源

审计使用四类证据，结论均回到 HEAD 的具体文件与行号：

1. 逐包对比 rc.3 与 HEAD 的 `package.json` 导出映射、peerDependencies 与 dependencies；
2. 逐文件阅读 `compaction`、`session`、`llm`、`tools`、`agent`、`settings`、`preset`、`client/modules`、`boot/app-boot`、`vendor/cordis`、`ptc-runtime` 等包的源码差异；
3. 阅读 master 上新增、rc.3 中缺失的升级指南，作为官方对不兼容变更的书面声明；
4. 把 `@deepseek-ai/*` 通过 tsconfig `paths` 映射到 HEAD 源码，用 tsx 直接加载并运行本项目的完整测试套件。

第四种方式避开了整仓构建（官方仓库的 `lib/` 产物停留在 2026-08-30，与 HEAD 差距过大，直接使用会得到混合版本结论），执行的是真实的 HEAD 代码，因此得到的失败可以直接归因到源码层面的契约变化。

### 1.3 运行环境的说明

本项目 `package.json` 的开发依赖固定在 0.2.2-alpha.3，peer 范围的最高档也止于 0.2.2-alpha.3，而宿主实际安装的是 0.2.2-rc.3。两者并不冲突：alpha.3 是 0.5.0 发布时的验证基线，rc.3 是可用的宿主。本次审计先验证 rc.3 下的现状，再验证 HEAD 下的未来兼容性。

## 2. 结论摘要

| 级别 | 事项 | 对本项目的影响 |
|---|---|---|
| 破坏（必改） | `@deepseek-ai/dsh-commands/brand` 子路径被删除 | 类型检查报 TS2307；发布产物中的 `.d.ts` 同样受影响 |
| 测试失效 | PTC `PtcRunResult.logs` 改为 `output: PtcOutput[]` | 产品代码不受影响；5 个 PTC 用例失败 |
| 语义变化 | Cordis 4.0.0-rc.12 的 root/intercept 重构 | 本项目未直接使用被删接口；两处作用域逻辑需要回归 |
| 语义变化 | 客户端模块元数据与样式所有权 | 浏览器半侧仍可加载；禁用或热替换后样式不再被清理 |
| 版本门槛 | `engines.dsh` 只覆盖 0.2.x | 若下一版本号为 0.3.0，整组组合行会被预检禁用 |

总体判断：本项目的压缩引擎、会话日志协议、工具注册、设置表单与预设控制器在 HEAD 上保持兼容；需要处理的是一处类型导入、一组 PTC 测试固件，以及发布时的版本号声明。

## 3. 实测结果

### 3.1 基线：rc.3 全部通过

把 `@deepseek-ai/*` 映射到已安装 0.2.2-rc.3 的 `lib` 产物后运行 `test/*.test.js`：200 个用例全部通过，0 失败。rc.3 的现状可以确认为正常。

### 3.2 HEAD 源码：195/200

用同样的方式把 `@deepseek-ai/*` 映射到 HEAD 的 `src/index.ts` 后运行同一套用例：195 个通过，5 个失败。

| 运行目标 | 用例数 | 通过 | 失败 |
|---|---|---|---|
| 已安装 0.2.2-rc.3 的 `lib` 产物 | 200 | 200 | 0 |
| HEAD 源码（tsx 路径映射） | 200 | 195 | 5 |

### 3.3 失败用例的单一根因

5 个失败用例分别是：

- `test/ptc.test.js`：nested PTC dispatch stays out of deriveMessages、a PTC program completes search -> recall through structured fields、spill-policy previews stay visible and are not called the full original、dispatch logs can land after the canonical value returns；
- `test/preset-tools.test.js`：a PTC target scope binds search and recall into run_code。

它们的报错形态一致，都来自 `packages/core/tool-executor-ptc/src/ptc.ts:678` 的 `result.output.flatMap(...)`：测试里的 `FakeRuntime` 仍按旧契约返回 `{ logs, value }`，而 HEAD 的 `PtcRunResult` 已把 `logs: string[]` 换成 `output: PtcOutput[]`（`packages/ptc-runtime/ptc-runtime/src/types.ts:172`）。这是测试固件与上游契约的偏差，不是产品代码的缺陷。

### 3.4 类型解析实验

在项目 `node_modules` 祖先目录之外建立临时包目录，把 `@deepseek-ai/dsh-commands` 指向 HEAD 源码包，用 `moduleResolution: NodeNext` 编译一段只导入 `CommandId` 的探针文件，输出：

```
probe.ts(1,32): error TS2307: Cannot find module '@deepseek-ai/dsh-commands/brand' or its corresponding type declarations.
```

同样的探针在项目现有 `node_modules`（alpha.3）下可以解析成功，说明失败来自 HEAD 的导出表变化，而不是依赖内容缺失。

## 4. 破坏项：`dsh-commands/brand` 子路径被删除

### 4.1 上游变化

HEAD 的 `packages/interaction/commands/package.json` 导出表只剩 `.`、`./types`、`./typert`、`./remote`、`./src/*`、`./package.json`、`./locale/*.json`、`./builtin`，`./brand` 已不存在。同一批清理还删除了 `dsh-llm/brand`、`dsh-browser-use/brand`、`dsh-computer-use/brand`、`dsh-jobs/brand`、`dsh-tools/presentation`、`dsh-file-reference-local/search`，共 7 个子路径；官方指南 `docs/upgrade-guide/v0.2.2-rc.2/package-export-cleanup/guide.md` 给出了逐项替换表。

### 4.2 本项目的使用位置

| 文件 | 行 | 用途 |
|---|---|---|
| `types/index.d.ts` | 8 | `CommandId` 类型 |
| `types/region.d.ts` | 5 | `CommandId` 类型 |
| `test/types/compat.ts` | 2 | `CommandId` 类型 |

三处都是 `import type`，运行时没有任何影响，破坏面限于 TypeScript 解析与发布产物中的声明文件。

### 4.3 替代入口

- `@deepseek-ai/dsh-commands/types`：官方推荐入口，`src/types.ts:121` 再导出 `CommandId` 与 `CommandDefinitionId`；
- `@deepseek-ai/dsh-commands`：包根 `src/index.ts:27` 直接导出同名符号。

迁移只需替换导入说明符。需要说明的边界是：`CommandId(...)` 这类构造器仍保留在包根，本项目在 `region.js` 中调用的 `CompactionId(randomUUID())` 也仍然可用（`packages/compaction/compaction/src/brand.ts` 未变）。这次清理改的是导入路径，没有改类型与值的实现。

## 5. Cordis 4.0.0-rc.12 重构

### 5.1 变更内容

`vendor/cordis` 的变化集中在 `context.ts`、`service.ts`、`fiber.ts`、`reflect.ts`、`registry.ts`。官方指南 `docs/upgrade-guide/v0.2.2-rc.2/cordis-root-and-intercept-metadata/guide.md` 列出七条变更：

1. `ctx.root` 被 `ctx[Context.root]` 取代（`vendor/cordis/src/context.ts:44`），读取 `ctx.root` 会抛 `cannot get property "root" without inject`；
2. `Service.config` 改为 `Service.metadata`，`[Service.resolveConfig](base, head)` 改为无参的 `[Service.resolveIntercept]()`（`vendor/cordis/src/service.ts:26-28`、`86-110`）；
3. `Config.merge` 钩子不再被调用，改为覆写 `[Service.mergeIntercept]`；
4. 对象形式 `inject` 声明的元数据降为最低优先级；
5. `ctx.isolate(name)` 不再回退到外层插件注入的 `name`；
6. `ctx.parallel()` 失败改抛 `AggregateError`；
7. 未激活时被释放的 fiber 现在落定为 `FiberState.DISPOSED`。

### 5.2 对本项目的影响

`ctx.root`、`Service.config`、`resolveConfig`、`Config.merge`、`ctx.parallel()` 在本项目的 `src/`、`types/`、`test/` 中均无引用，因此不存在直接破坏。

两项需要实际回归：

- `preset-tools.js` 在 Agent scope 内挂载伴生 fiber 的做法依赖服务解析。新内核下 `ctx.isolate` 不再回退，以前偶然可用的读取会变成 pending 或显式抛错。该文件对 `composedPreset`、`presetOf`、`register` 都有 try/catch 与降级，实际表现需要在真实 Host 上确认。
- `fiber.state` 的数值常量仍正确。`FiberState` 的枚举顺序未变（PENDING 0、LOADING 1、ACTIVE 2、FAILED 3、DISPOSED 4、UNLOADING 5，见 `vendor/cordis/src/fiber.ts:177-184`），`src/index.js:134` 与 `src/preset-tools.js:129` 中的 `2/4/5` 继续成立；但“未激活即 DISPOSED”会让 `deferUntilActive` 的失败分支更早走到重试上限。

`ctx.effect`、`fiber.await()`、`ctx.on`、`ctx.inject`、`ctx.plugin` 的签名都没有变（`vendor/cordis/src/registry.ts` 中 `inject()` 与 `plugin()` 的实现与 rc.3 一致）。195 个用例在 HEAD 上通过，说明引擎挂载、服务注册与事件监听这些主路径是稳的。

## 6. 客户端模块元数据与样式所有权

### 6.1 静态模块机制

`ClientModuleCreateOptions.staticModules` 从 `Record<string, unknown>`（说明符到实例的 seed 表）改为 `readonly DshClientModuleManifest[]`（注册项数组）。`packages/client/modules/src/client/system.ts:130` 把每个静态模块的 `id` 放进 `staticIds`，`system.ts:157` 的 `resolveModuleId` 据此判断；未命中的说明符现在直接抛 `require(...) missed the module table`，不再有“平台种子词”这一隐式类别。

本项目 `src/client.js:36` 需要 `react` 与 `@deepseek-ai/dsh-client-store`。两者仍在 shell 的静态清单里：`packages/client/web/src/seed.ts:38` 注册 `react`，`:45` 注册 `@deepseek-ai/dsh-client-store`，`packages/client/web/src/platform.ts` 的 `PLATFORM_MODULES` 未变。`window.__ModuleLoader__.load({ id, factory })` 的注册面也保持原样（`ClientBundleRegistration = DshClientModuleManifest`，`id` 与 `factory` 必填，`chunk` 与 `meta` 可选），本项目用包名注册的 id 与官方构建产物一致。

### 6.2 样式清理语义

rc.3 的 `system.ts` 有 `claimStyles`、`entry-lifecycle.ts` 有 `removeOwnedStyles`，模块工厂注入的 `<style data-plugin>` 会被登记并在禁用或热替换时删除。HEAD 删除了这两个函数，样式改由渲染器从 `meta.stylesheets` 安装（新增 `packages/client/ui-renderer/src/client/styles/document-styles.ts`）。

本项目在 `src/client.js:83` 自行注入带 `data-plugin` 与 `data-plugin-css` 的 style 标签。这种做法仍能显示，但禁用插件或热替换后样式会留在页面上，替换后也可能沿用旧文本。官方指南 `docs/upgrade-guide/v0.2.2-rc.2/client-module-metadata/guide.md` 明确记录了这个兼容行为，并给出迁移路径：在 `load({ id, factory, meta })` 中提供 `stylesheets` 描述符，由渲染器接管安装与清理。本项目是手写 JS，可以直接手写 `meta`，不依赖 clientBundle 构建预设。

### 6.3 其余客户端契约

`plugins.bundle.config` 槽仍以包名作 key（`packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx:825`），`configForms`、`slots`、`locale` 三个服务的源码未改动，`remote.agentPresets` 的 `list` 方法未变，`@deepseek-ai/dsh-client-store` 的 `createSnapshotStore` 保持导出。项目的 23 个客户端表单用例在 HEAD 下全部通过。

## 7. PTC 输出协议

### 7.1 上游变化

`PtcRunResult` 的 `logs: string[]` 被 `output: PtcOutput[]` 取代，`run_code` 的外层 canonical value 从 `{ logs, result?, sandbox? }` 变成 `{ logs, sandbox? }`。程序返回值与末尾表达式不再自动出现，需要用 `inspect(...)` 显式输出（`docs/upgrade-guide/v0.2.2-rc.1/ptc-inspect-output/guide.md`）。

### 7.2 对生产代码无影响

编译器渲染的是消息内容块，recall 恢复的是 `tool/result` 与 `tool/ptc-dispatch` 的 `content`。`src/ptc.js:50` 配对的日志事件字段在 HEAD 完全没变：`rootCallId`、`parentCallId`、`subCallId`、`name`、`arguments`，结算事件另加 `isError`、`content`、`meta`、`error`，与项目要求的校验条件逐项吻合。

### 7.3 测试固件需要更新

`test/ptc.test.js:46` 的默认 `behavior` 与多处 `return { logs: [...], value }` 需要改成 `return { output: [{ type: "text", text }], value }`；断言中 `executed.value.result` 的路径要改为不再期望 `result` 字段。按此调整后，这 5 个用例应恢复通过。

## 8. 版本门槛

`packages/boot/app-boot/src/plugin-compatibility.ts:57-59` 规定：插件只要有 `engines.dsh`，就只按它判定，peerDependencies 不参与；不满足时 `compatibility-preflight.ts` 会把该行 `disabled = true`，整组随之关闭，并输出 `Plugin name@version is incompatible with dsh ...` 警告。

本项目 `engines.dsh` 为 `^0.2.0-rc.1 || ^0.2.1-0 || ^0.2.2-alpha.3`。用 semver 7.8.5 按宿主相同的 `{ includePrerelease: true }` 实测：

| 宿主版本 | 是否满足 |
|---|---|
| 0.2.2-rc.3 | 是 |
| 0.2.2-rc.4 | 是 |
| 0.2.3-rc.1 | 是 |
| 0.2.3 | 是 |
| 0.3.0-rc.1 | 否 |
| 0.3.0 | 否 |

下一版本只要仍在 0.2.x 线上，插件会被正常加载；一旦跳到 0.3.x，三行组合行会在启动时被预检禁用（stderr 输出不兼容警告），表现为插件已安装但不生效。这一条与代码改动无关，取决于发布时的版本号决策。

## 9. 已核对为兼容的契约

| 契约 | 证据 | 结论 |
|---|---|---|
| 压缩事务协议 | `docs/subsystems/compaction.md` 的 `compaction/start`、`compaction/summary`、`compaction/end` 字段表，`packages/compaction/compaction/src/index.ts` | 未变，自实现的 bracket 仍合法 |
| 压缩基类 | `CompactionEngine` 抽象方法签名、`ManualCompactionError` 的六个 code、`CompactionId` 构造器 | 未变 |
| Session API | `packages/core/session/src` 无改动 | `append`、`surfaceOp`、`eventAt`、`deriveEventMessage`、`requestHeader`、`replaceGeneration` 稳定 |
| 事件载荷 | `agent/pre-step`、`agent/status`、`agent/request-error`、`session/event`、`agent/created`、`agent/disposed`、`agent-preset/selected` | 名称与载荷未变 |
| 工具定义 | `packages/core/tools/src` 仅 `pipeline.ts` 改动（取消分类措辞） | `defineTool`、`output.render`、`presentCall`、`ToolCallView` 未变 |
| Settings 表单 | `packages/settings/settings/src/index.ts` 仅一处 `ctx.root` 改符号 | `describe()`、`document-updated`、volatile 机制稳定 |
| volatile 协议 | `vendor/cosmokit/src/volatile.ts:3` | `Symbol.for("cosmokit.volatile.write")` 未变，`preset-tools.js` 的解包逻辑有效 |
| 预设注册表 | `composedPreset(ctx)` 签名、`@Remote('list')` | 未变，客户端 roster 读取仍可用 |
| Token 计量 | `packages/llm/token-meter/src` 无改动 | `measure`、`estimateMessage`、`TokenMeasurement` 稳定 |
| 命令注册 | `CommandRuntime.register` 与 `CommandResult` | 未变 |
| 客户端 Store | `packages/client/store/src` 无改动 | `createSnapshotStore` 仍在包根导出 |
| Bundle 补丁 | `applyEntryPatches` 未变；YAML 解析抽成 `parseEntryYaml`，schema 相同 | `cordis.patch.yml` 的 `insert` 三行继续有效 |
| 检查点渲染 | `packages/client/ui-chat/src/client/conversation-nodes/message.ts` 未改 | `compact-checkpoint` 的 UI 呈现不受影响 |

另有 `@deepseek-ai/dsh-tools/presentation` 与 `@deepseek-ai/dsh-llm/brand` 被删除，但本项目没有引用，无需处理。

## 10. 未发布的升级指南索引

rc.3 中缺失、master 中存在的 18 篇指南，按与本项目的关系分类如下。

| 指南 | 关系 |
|---|---|
| `package-export-cleanup`（rc.1、rc.2 各一份） | 直接相关，见第 4 节 |
| `cordis-root-and-intercept-metadata` | 需回归，见第 5 节 |
| `client-module-metadata` | 需留意，见第 6 节 |
| `ptc-inspect-output` | 测试固件相关，见第 7 节 |
| `ptc-scoped-repl-default`、`ptc-bootstrap-protocol` | PTC 运行时内部变化，日志事件未变 |
| `python-ptc-removal` | 本项目不使用 Python PTC |
| `web-fetch-transport-error-codes` | 无关 |
| `connection-page-peer`、`session-status-package`、`shared-search-filter` | 客户端其他子系统，本项目未使用 |
| `cua-agents-without-preset`、`cua-macos-provider`、`cua-partial-observations` | Computer Use，无关 |
| `deepseek-files-timeout` | Provider 实现细节，无关 |
| `experimental-tool-error-codes`、`shell-fs-tool-error-codes` | 其他插件的错误码，本项目自定义错误码不受影响 |

## 11. 建议动作

本次只记录结论，不实施改动。后续升级时按以下顺序处理：

1. 把 `types/index.d.ts`、`types/region.d.ts`、`test/types/compat.ts` 三处 `@deepseek-ai/dsh-commands/brand` 改为 `@deepseek-ai/dsh-commands/types`；
2. 更新 `test/ptc.test.js` 与 `test/preset-tools.test.js` 的 `FakeRuntime` 与结果断言，使其符合 `PtcRunResult.output` 契约；
3. 视需要在 `src/client.js` 的 `__ModuleLoader__.load` 调用中补充 `meta.stylesheets`，恢复样式清理；不补也可正常显示，只是会留下样式残留；
4. 发布版本若落在 0.3.x，需要同步扩展 `engines.dsh`（例如加入 `^0.3.0-0`），否则插件会被预检整体禁用；
5. 升级后在真实 Host 上回归：profile 装载与 bundle 补丁、Plugins 页两个配置区域、预设切换后的伴生工具注册与释放、一次自动压缩与一次手动 `/compact`、PTC 会话内的 `recall` 与 `search`。

## 12. 未验证事项

本次没有构建官方仓库。其 `packages/*/lib` 产物停留在 2026-08-30，与 HEAD 源码差距过大，直接使用会得到混合版本结论，因此运行时验证走的是“tsx 直接加载 HEAD 源码”的路径。由此留下三个未覆盖点：

- 真实 Host 启动（profile 装载、bundle 补丁应用、兼容性预检）未运行；
- 浏览器端未实测，客户端结论来自导出映射与服务源码；
- 完整的 `tsc` 未针对 HEAD 的构建声明运行，类型结论来自隔离目录的定向复现。

这三项需要先在官方仓库完成一次 host 侧构建才能补齐。

## 13. 复现方式

1. 生成一个 tsconfig，把 `@deepseek-ai/<name>` 映射到官方仓库对应包的 `src/index.ts`，子路径映射到 `src/<sub>.ts` 或 `src/<sub>/index.ts`；
2. 以该 tsconfig 作为 `TSX_TSCONFIG_PATH`，用官方仓库内的 tsx 运行 `test/*.test.js`；
3. 同样方式另建一份映射，指向已安装 rc.3 的 `node_modules/@deepseek-ai/<name>/lib` 下的入口文件，作为基线对照；
4. 类型实验需要在项目 `node_modules` 祖先目录之外建立临时目录，否则解析会回退到项目内安装的 alpha.3 包，得到错误的“可解析”结论。
