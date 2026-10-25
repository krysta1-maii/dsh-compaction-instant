# dsh-compaction-instant

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 打造的**即时、近无损上下文压缩**引擎——**官方引擎 `@deepseek-ai/dsh-compaction-basic` 的替代后端**，用 [lllyasviel/VCC](https://github.com/lllyasviel/VCC) 的"对话编译"思路取代原来的 LLM 摘要。

对话太长了怎么办？普通方案是让模型把旧内容"总结"一遍（慢、花钱、还会丢细节）。本引擎不总结，而是把旧内容**重新整理成一份紧凑的存档**（后面统称"检查点"）：毫秒级完成、不调用模型、只使用原来的原文，不改写、不编造。被收进存档的持久事件内容随时可以通过指针找回；被 spill 策略替换过的 PTC dispatch 记录只能取回写入日志的 preview，详见 Recall 边界。

## 主要特性

- **免 LLM**——压缩过程完全不调用模型：没有摘要请求、没有推理等待、不花 token。它只是确定性的文本处理，哪怕一百万个 token 的历史也是毫秒级搞定。
- **近无损**——存档里只有原文；每处被省略的内容都有标记并注明出处（`seq` 序号），之前的存档会原封不动地保留。
- **即时**——把旧内容扫描一遍就完成；不联网、不调模型、不占 KV 缓存。
- **针对固定版本适配**——使用 DSH 压缩服务和持久事件协议，通过自定义预设显式启用；配置和保留策略并不等同于当前 `compaction-basic`。

## 兼容性

| dsh-compaction-instant | DeepSeek Harness | Node.js |
|---|---|---|
| `0.2.0`, `0.2.1` | `0.2.0-rc.1`, `0.2.0-rc.2` | `>=22.12.0` |
| `0.1.8` | `0.1.7` | `>=22.12.0` |
| `0.1.7` | `0.1.7` | `>=22.12.0` |
| `0.1.6` | `0.1.5-rc.1` | `>=22.12.0` |

0.2.0 与 0.2.1 的目标是 DSH **0.2.0**，兼容 **0.2.0-rc.1 与 0.2.0-rc.2**；当前开发与回归基线为 **0.2.0-rc.2**（commit **639ed015397290b3745d163aafe02ffee4aa3f84**，tag `dsh-v0.2.0-rc.2`）。peer 范围、`engines.dsh` 与运行时依赖范围现为 `^0.2.0-rc.1 || ^0.2.1-0`，保留 rc.1 支持，并允许 0.2.1 系列预发布及正式版。Cordis、Schemastery 也分别放行 4.0.5、3.18.5 系列预发布；开发锁定图仍保持 rc.2。rc.1 → rc.2 中，本后端使用的压缩服务、Session、工具/命令、token 计量器及设置表单相关包仅更新版本号，插件页配置 slot 的接口未变，因此无需修改引擎或浏览器半侧代码。它仍跟随 0.1.7 消息模型——工具结果是一等 `role: "tool"` 消息，`toolCallId` 提升为顶层字段，不再包在 user 角色块里——并使用 `compact-checkpoint` 检查点源标记；旧宿主写入的检查点（`kind: "plugin", plugin: "compact"`）在持久日志中仍会被识别。检查点替换仍是 `surfaceOp: { op: "replace", startSeq, endSeq }`，不支持旧替换字段 `start` / `end`；固定迁移目标也不代表对所有未来版本的兼容承诺。

surface 第 0 个节点若是 `system/message`，系统头会留在压缩范围之外；自动选区从其后的 surface 节点开始，显式替换范围也不能包含系统头。Instant 保留策略不变：`retainTurns` 是偏好，`retainTokens`（或 `retainRatio` 换算预算）是上限，最近回合超限时保留能装下的后缀。工具配对保护可能将后缀扩展到超过上限；受保护的系统头单独保留。目标版本 basic 则按**最近尾部最低预算**选区，不是 instant 的整回合/上限策略，不能假定配置或行为完全等价。

新增 0.2.1 依赖范围不等于完整兼容认证。本次源码审查针对 **0.2.1-alpha.5**（commit `1517a4dbca0a2789ff1d41ba439600f8547d23fa`）。回归现已覆盖按 owner 失效后的客户端重载、保存期间继续编辑草稿、非递增 surface 的恢复选择，以及官方 pruner 经压缩和日志重放后的来源恢复。其他 0.2.1 预发布版本、真实 GUI 和 profile 激活尚未验证。

`recall(type: "result")` 会沿经过校验的官方 pruner 记录恢复原始工具结果；`recall(type: "seq")` 仍读取指定事件本身，包括裁剪后的版本。省略标记列出准确 seq，不把 surface 顺序当作数字区间。完整恢复指针及最低文本/格式开销可能超过异常小的检查点预算，返回的 token 统计会计入这些开销。

固定源码依据：[basic 选区与系统头保护](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/compaction/compaction-basic/src/region.ts#L99-L155)、[替换操作字段](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/compaction/compaction-basic/src/region.ts#L505-L510)。

0.2.0 的插件管理面板会强制校验这些范围：在不兼容的宿主上安装会以 `incompatible-version` 拒绝，并列出未满足的 `@deepseek-ai/dsh-*` peer。确需冒险时走精确版本豁免（`dsh plugin allow-version`，面板会展示该入口），不要靠改本包元数据强行安装。

## 示例

一段包含用户提问、助手回答 + 工具调用及其结果的历史，压缩后长这样：

```
[user]
please fix the bug
[assistant]
on it
* read "a.js" (seq 2 -> result 3)
[user]
next question
```

每个工具调用只占**一行**：白名单里的工具（`toolArgTools`）显示关键参数，其他工具只显示名字（`* job_kill (seq 9 -> result 10)`），`hideTools` 里列的工具完全不出现。工具结果不占位置——通过 `-> result N` 指针，用一次 `recall(type:"result")` 就能取回。较长的用户/助手文本按预算截断，并在末尾标注 `...(truncated from seq N)`；每处省略都写明了完整内容存在哪个事件里。

`run_code` 内部的 PTC 调用是 log-only 事件，因此检查点会保留外层 `description`，并为每个 nested dispatch 增加一行带稳定 start/settle 指针的记录（例如 `* read "a.js" (seq 4 -> result 5)`）。只有外层结果是宿主的中断恢复结果 `TOOL_OUTCOME_UNKNOWN` 时才会出现 start-only 行，且不会伪造 settle。

## Recall：把丢掉的内容找回来

本包还配套了"找回"能力——**同一会话内的回读**，模型和人都能用。因为会话日志只增不改，编译器从持久事件中省略过的每一个字都还在，随时可取：

| 入口 | 模块 | 作用 |
|---|---|---|
| `recall` **工具**（给模型用） | `dsh-compaction-instant/tool` | 按类型恢复持久事件的记录内容：`type:"seq"` 配合 `(seq N)`/`(seqs A-B)` 标记，`type:"result"` 配合 `result N` 指针（含已结算的 PTC dispatch），`type:"checkpoint"` 配合 `[checkpoint N]` 序号；正常事件保持原文，PTC dispatch 可能只有 spill preview |
| `search` **工具**（给模型用，grep） | `dsh-compaction-instant/tool` | 在整个持久日志里按关键词/正则搜索——包括被压缩掉的内容——返回带 `(seq N)` 指针的匹配事件，可直接交给 `recall` 取回 |
| `/recall` **命令**（给人用，grep） | `dsh-compaction-instant/command` | `/recall <关键词|正则>` 追加一条持久的用户消息，内含匹配事件和 seq 指针，下一轮模型就能看到 |
| 共享核心 | `dsh-compaction-instant/recall` + `dsh-compaction-instant/search` | seq 解析（`12`、`3-7`、`seq 12` / `seqs 3-7`）、日志展开、预算、字段筛选；正则编译与命中展示 |

Recall 可回读日志中的文本、推理过程、工具调用的完整参数、嵌套的工具结果与文件引用元数据（可回读/搜索的是引用，不是附件字节）；只在日志里出现过的事件会以带标签的原始数据展示；找不到的 seq 会明确报错。`maxRecallTokens` 预算（默认 **16000**）超限时会截断并标注来源、统计跳过多少；搜索限制展示条数（`maxSearchHits`，默认 **50**）。工具 canonical value 还包含结构化的 `hits`（`seq`/`kind`/`text`）与 recall 的 `entries`/`seqs`，PTC 程序无需解析展示文本即可完成 search → recall；Native 渲染文本保持不变。这两个插件是独立的一行，可以挂在**任何**压缩引擎旁边——它们只读日志，不依赖本引擎。

有两条边界属于契约的一部分：

- **Spill preview 是持久内容，不是完整原文。** `tool/ptc-dispatch` 记录可能在写入前被 spill 策略替换。此时 recall/search 只能返回当时写入的 preview 以及其中的 retrieval hint/locator 文本；locator 是不透明句柄，位于 preview 文本中而不是稳定的事件字段，不得解析。程序当时取得的 pre-spill canonical value 无法从日志还原。
- **dispatch 日志可能晚于 canonical value。** 同一个 `run_code` 内，bridge 先返回 nested 工具的 canonical value，再异步写入 dispatch 日志。需要立即处理结果时，应使用该工具的直接返回值；`search`/`recall` 面向已提交的历史，通常要等外层 `run_code` 返回并 drain，或已明确观察到目标 append。canonical value 已返回不等于 settle 已提交。

每个检查点开头还附了一段简短的 **RECALL 使用指南**，告诉模型怎么用 `recall` / `search` 找回被省略的内容。如果更早的检查点因为空间不够被省略，它不会无声消失：会留下一行 `[checkpoint N]`（N 是压缩序号，1 = 最早），用 `recall(type:"checkpoint", id:"N")` 就能完整恢复。

## 配置

所有配置项都可选，括号里是默认值。下表保留区上限受前述工具配对保护例外约束；系统头单独保护。

| 键 | 默认 | 含义 |
|---|---|---|
| `thresholdRatio` | `0.5` | 上下文用到多大比例时自动触发压缩（0.5 = 用到一半） |
| `retainTurns` | `1` | 优先保留的完整回合数（自动压缩和手动 `/compact` 都按此规则；不突破上限） |
| `retainRatio` | — | 旧版比例模式（不等同于当前 basic 策略）：按路由模型上下文窗口比例计算保留上限；与 `retainTokens` 互斥，且必须小于 `thresholdRatio` |
| `retainTokens` | `5120` | 保留区 token **硬上限**：向前补足完整回合时总量永不超出；若最近回合本身就超过它，只保留该回合内能装下的部分；与 `retainRatio` 互斥 |
| `auto` | `true` | 开启自动压缩：监听 `agent/pre-step` 压力事件和 `agent/request-error` 溢出恢复 |
| `checkpointCap` | `65536` | 单个检查点的编译预算（估算 token）：更小的会话近乎无损地保留，更大的内容则省略到该上限 |
| `maxTokens` / `checkpointScale` | `8192` / `0.1` | **已弃用**——仅为兼容旧配置而接受，**不再起作用**：预算就是 cap 本身（无保底、无比例缩放） |
| `textTokens` | `512` | 每条助手文本的预算 |
| `userTextTokens` | `1024` | 每条用户文本的预算 |
| `toolCallTokens` | `128` | 每个工具调用单行的预算（这个永远不缩放——见下面的省略规则） |
| `toolResultExcerptTokens` | `256` | 仅为兼容官方配置而接受；**不起作用**——工具结果本来就不占位置 |
| `includeReasoning` | `false` | 是否在检查点里保留推理过程 |
| `stripNoiseXml` | `true` | 是否去掉用户文本里配置的噪音标签 |
| `noisePatterns` | 见 compiler | 噪音标签的正则来源，按 `s` 模式匹配 |
| `toolKeyFields` | 内置 | 额外的"工具名 → 参数里的关键字段"映射，用于单行展示 |
| `toolArgTools` | 见 compiler | 白名单：这些工具的关键参数会显示在单行里（`read`/`write`/`edit`/`glob`/`grep`/`bash`/`shell`/`web_search`/`skill`/`subagent`/…）；其余工具只显示名字 |
| `hideTools` | — | 完全从检查点里去掉的内部管理工具 |
| `modelPolicies` | — | 按 provider/model 单独覆盖 `thresholdRatio`/`retainTurns`，并选择 `retainRatio` 或 `retainTokens` |
| `compactionRetries` / `maxOverflowRetries` | `1` / `1` | 重试次数，含义和官方引擎一样 |
| `summarizationProvider` / `summarizationModel` | — | 仅为兼容官方配置而接受；**不起作用**——本引擎从不调用模型 |

recall 工具和命令插件各自接受 `{ maxRecallTokens?: 16000, maxSearchHits?: 50 }` 配置。

> **Cordis 配置坑：** 插件行的配置要经过 schemastery schema 校验，它的 `~standard` 适配器会给**每个没写的数组项注入 `[]`**（`toolArgTools`、`hideTools`、`noisePatterns`、`toolKeyFields`、`modelPolicies`）。本引擎把空数组当作"没设置"，会回退到默认值——所以不写 `toolArgTools` 就自动用内置白名单（千万别用 `toolArgTools: []` 想关掉它；空 = 默认）。`debug: true` 会把每次压缩的诊断写进 `debugLogPath` 指定的文件（默认 `$DSH_HOME/compaction-debug.log`）。

预算有两道保险：按 token 数限制，再按"预算 × 4"的字符数限制——所以再长的连续字符串（base64 大块、压缩过的文件）也绕不过去。工具调用**永远是单行**：不会缩放，预算不够时只压缩对话文本（每条最少留 **32 token**）。如果压缩结果还是超过预算，先删最旧的**工具行**（`[N tool/result entries elided: seqs a-b]`），再删其余最旧的条目（`[N earlier entries elided: seqs a-b]`）——工具调用永远挤不掉对话。最新的内容总能保住。

### 浏览器设置区（插件页面）

DSH 0.1.7 用基于 profile patch 的设置表单取代了旧的设置卡片 API，因此 bundle 附带一个很小的**设置桥接行**（`dsh-compaction-instant/settings`，组合行 id 为 `compaction-instant`，由 bundle patch 安装）。它的全 volatile Config schema 让宿主提供 `compaction-instant` 设置表单，Web 端 **插件 → dsh-compaction-instant → 配置** 区块实时编辑它。写入会持久化到 profile 的 `cordis.patch.yml`，无需重载即作用于所有已挂载的即时引擎；桥接行本身不挂载任何逻辑、与引擎不共享状态——引擎只是监听这份表单。

| 字段 | 含义 |
|---|---|
| `checkpointCap` | 单个检查点的编译预算（引擎默认 65536） |
| `auto` | 注册步骤间自动压缩（引擎默认开启） |
| `thresholdRatio` | 触发自动压缩的上下文窗口占比（引擎默认 `0.5`） |
| `retainTurns` | 优先保留的完整回合数（引擎默认 `1`；不突破上限） |
| `retainTokens` | 固定上限模式中的保留区 token **硬上限**（引擎默认 `5120`） |
| `retainRatio` | 比例兼容模式：按路由模型的上下文窗口换算保留上限 |

bundle 还会安装一个**惰性客户端承载行**（`compaction-instant-client`，以裸包名加 `carrier: true` 声明）：dsh-client-modules 只把组合包的浏览器半侧挂到说明符恰为包名的 profile 行上，该行就是这个锚点。根模块把它分发为空操作，不会在 profile 层挂出与预设引擎竞争的第二个引擎。**请保持该行启用**——禁用它会隐藏插件页的配置区（引擎本身继续按组合配置工作）。

其余字段（`modelPolicies`、`toolArgTools`、`debug`、`debugLogPath`、已弃用的 `maxTokens`/`checkpointScale` 等）仍只由 Cordis 配置管理。未填写的字段继承各引擎自身默认值，所以新建的桥接行一开始是**空的**，不会把默认值复制进 profile。`retainRatio` 与 `retainTokens` 是互斥模式：两者同时出现时按比例模式处理；填写 `retainTokens` 期间会清除组合里的比例模式。若表单内容与某引擎自身组合冲突（例如 `retainRatio` 不低于该引擎的 `thresholdRatio`），只有该引擎记录警告并继续**只使用组合配置**，直到表单对它恢复有效；其余引擎不受影响。设置平面会在写入时校验每个字段，但 0.1.5 卡片的跨引擎组合校验已不存在——冲突的覆盖现在表现为该引擎的警告，而不是拒绝写入。没有桥接行（或没有 settings 服务）时，所有引擎只使用组合配置。0.1.5 卡片写入的旧 `settings.yaml` 覆盖会由宿主的 0.1.7 迁移自动导入。安装后需先请用户确认宿主重载/重启，再让启动图拾取 `dsh.client` bundle；不要自动重启用户宿主。

### 分词与多语言

分词器是简单的字符规则：连续的英文字母算一个 token，连续数字算一个，标点一个字符一个，空格免费，其他每个字符算一个。具体：

| 内容 | Tokens |
|---|---|
| 中文（`你好，世界！`） | 每个字 1（共 6） |
| 西里尔 / 阿拉伯文 | 每个字符 1 |
| 带重音拉丁文（`café`） | 英文部分成组（`caf` + `é`） |
| Emoji（`😀`） | 2（一个 emoji 占两个 UTF-16 单元） |

所有截断都发生在**字符边界**——绝不会把一个 emoji 从中间切开（有 `test/multilang.test.js` 保证）。字符密度上限按 DeepSeek 官方换算（token_usage 文档）：约每个非中日韩字符 0.3 token、每个中日韩字符 0.6 token。

Harness 自带的 token 计量器与 compiler 估算器彼此独立。DSH 0.1.7 提供路由价格 `tokens`（用于压力、保留范围和“压缩后必须变小”检查）以及固定启发式价格 `heuristicTokens`（写入持久化的 `compaction/summary.shadowedTokenCount`）；三者按协议并存。

## 保证

- **即时**——把旧内容扫描一遍就完成；不联网、不调模型、不占 KV 缓存。
- **近无损**——输出里只有原文；每处省略都有标记并注明出处 `seq`；之前的检查点原封不动保留。
- **目标协议适配**——使用 `ctx.compaction`、持久来源记录、`ctx.tokenMeter` 计费和“压缩后必须变小”检查（无法缩小所选范围的检查点会被拒绝）；不代表配置、保留策略或所有预设的激活行为相同。
- **可选 pruner 兼容**——和官方引擎一样会使用可选的 `toolResultPruner` 服务（它负责整理*保留部分*；被压缩的旧内容由本引擎自己处理）。

## 实测压缩率（真实会话、一条不丢）

数据来自真实会话日志（本项目的开发会话），编译时**不丢弃任何一条**——每条都保留，只做条目级截断和工具调用单行化。百分比是相对原文 token 数的比例。

| 负载 | 原文 tokens | 编译后 | 保留 | 压缩 |
|---|---|---|---|---|
| 工具密集会话全量（3,181 节点：1,438 个工具调用 + 1,540 个工具结果） | 2,523,012 | 226,205 | **9.0%** | 91.0% |
| 另一个会话全量（864 节点） | 685,088 | 62,705 | **9.2%** | 90.8% |
| 同一个工具密集会话，最近 800 条消息 | 625,927 | 45,031 | **7.2%** | 92.8% |
| 纯文本（同一会话去掉全部工具行） | 160,963 | 109,945 | **68.3%** | 31.7% |

压缩主要来自哪里（不丢条目的情况下）：

- **工具结果零成本**——结果不产生条目，靠 `-> result N` 指针一个 `recall` 就能取回，这是最大的来源。
- **工具调用一行化**——每个调用压成一行（≤ 128 tokens，平均约 100）。
- **思考过程不保留**——reasoning 增量整体省略（有标记，不是悄悄丢）。
- **对话文本近乎无损**——纯文本对照组保留了 68.3%；文本上那约 1.5 倍压缩基本是剥掉 JSON 包装，外加只截断最长的几段。

预算扫描（同一个 252 万 tokens 的工具密集会话）：默认 64K 上限下，编译视图约 5.6 万 tokens（原文的 2.2%）。只有把上限压到约 22.6 万 tokens 的"完全不丢"阈值以下才开始丢条目——代价是**悬崖不是斜坡**：

| Cap | 编译后 | 保留 | 条目数 | 被丢 |
|---|---|---|---|---|
| 8,192 | 8,243 | 0.33% | 111 | 2,090 |
| 32,768 | 22,263 | 0.88% | 232 | 1,969 |
| 65,536（部署默认） | 55,737 | 2.2% | 325 | 1,876 |
| 131,072 | 131,047 | 5.2% | 1,142 | 1,058 |
| 226,205（一条不丢的临界值） | 226,205 | 9.0% | 2,199 | 0 |

## 安装与升级

### 推荐：直接安装 + profile 预设覆盖

用 Harness 插件管理器安装到实际宿主使用的 profile。仅当该版本已发布时使用 npm 版本；否则使用下文重新打包的本地 tarball：

```bash
dsh plugin --profile web add dsh-compaction-instant@0.2.1
```

DSH Desktop 0.2.0-rc.2 请将 `--profile web` 换为 `--profile desktop`。先启动一次 Desktop 初始化 profile，再完全退出后执行 CLI 包操作，完成后重新打开；中断活跃会话前必须先征得用户确认。

本包的 `dsh.bundle` **只安装 recall/search 工具、/recall 命令、设置桥接行和惰性客户端承载行，不安装压缩引擎**。能看到 recall 工具或插件页配置区块，**不等于即时压缩引擎已启用**；不要因为安装了本包就假定 `standard` 使用它。

DSH 0.2.0 的内置 `standard` 预设是一行 `@deepseek-ai/dsh-agent-preset` 声明（web-app include 树中的 `preset-standard`）；profile 的 `cordis.patch.yml` 中同 id 的行会**整体替换**它，因此覆盖时必须完整重述 `config`——`plugins` 的每一行都要保留，而不是只写差异。不要编辑内置预设安装文件。

1. 把内置 `packages/bundle/web-app/presets/standard.patch.yml` 里的 `preset-standard` 行复制到 profile 的 `cordis.patch.yml`，作为单个 `- insert:` 项，保留 `id: preset-standard`、name 和完整的 `config`（`id`、`order`、全部 `plugins`）。
2. 在复制的 `config.plugins` 里找到 `compaction` 组，只把它的引擎行从 `compaction-basic` 换成本包。按本文审查原后端配置，不要照搬：目标版本 basic 的保留策略已经不同。**组合片段**如下（其余行保持原样）：

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

3. 新建验证会话时选择 `standard` 预设，检查实际解析的插件模块/版本及引擎挂载，再验证 `/compact` 与 recall。预设出现在列表里、recall 可用，都不能代替引擎激活检查；也不要假定已有会话已切换到编辑后的组合。

**PTC 预设是独立的。** 内置 PTC 预设（`preset-ptc`）为工具组设置了 `mode: "ptc"`。安装本包、或只覆盖 `preset-standard`，都不会改变使用 `preset-ptc` 的会话所用引擎。要在 PTC 下启用即时压缩，请把内置 `preset-ptc` 行复制到 profile patch，保留 `mode: "ptc"`、`command-compact` 和 `tool-result-pruner`，只把其 `compaction` 组里的引擎行换成本包，然后显式选择该预设；使用 `mode: "ptc"` 的自定义预设同理。bundle 安装本身仍不会激活 instant 引擎。

完全自定义的预设（另起一行 `@deepseek-ai/dsh-agent-preset`，使用自己的 `config.id`）同样可行，且不影响内置 `standard`，只需显式选择。每个预设上下文只能挂载一个 `ctx.compaction` 实现。不要添加宿主层引擎兜底：未限定作用域的监听器可能收到 agent 事件，与预设后端竞争。`/compact` 本身不绑定特定后端，但所选预设仍须有已启用的压缩后端。

### 升级 tarball 部署

**修改本源码目录，不会更新此前通过 tarball 安装的部署。** 修改包版本或本地测试通过也不等于宿主已更新。审查完成并获得用户部署确认后：

```bash
# 在本插件源码目录重新生成包产物。
npm pack
# 将这个新产物安装到实际宿主 profile，使用它的绝对路径。
dsh plugin --profile web add /absolute/path/dsh-compaction-instant-0.2.1.tgz
```

执行这些部署步骤前，先向用户确认目标 profile、安装包名（直接安装还是别名）、当前解析路径/版本和目标预设。若已有旧别名部署，应明确规划替换/移除，避免留下两套可能的引擎解析路径。安装后检查新产物及自定义预设实际解析结果。**宿主重载/重启必须先经用户确认**，因为可能中断活跃会话。重载宿主以重新加载包代码和启动元数据，然后刷新 Web 页面，在原宿主 URL 和新会话上验证；profile patch 热重载或仅刷新页面，都不能证明已加载模块换成了新代码。以上是操作步骤，不代表本版本已经部署。

### 别名安装：仅限明确核验的高级用法

浏览器脚本只注册真实包名 `dsh-compaction-instant`。DSH alpha.5 按实际 manifest 包名发现 Client，仅有 npm 别名不属于受支持的浏览器承载路径。完整引擎/设置部署请使用直接安装加显式预设覆盖；旧的纯别名部署应迁移后再依赖插件配置页。

以 `@deepseek-ai/dsh-compaction-basic` 为别名安装是旧版替换路径，只有实际预设与 resolver 选中该别名时才有效。它**不是天然安全的**，也不保证 `standard` 或所有配置都正确使用 instant；当前 basic 的策略不同。推荐上面的显式预设覆盖。若有意保留别名，需要核对解析模块、配置和配套子路径名称，经用户确认重新安装及宿主重载后验证所选预设。不要在同一预设里同时添加别名引擎与直接引擎行。

## 开发

```bash
npm ci          # 精确安装 DSH 0.2.0-rc.2 开发依赖图
npm test        # compiler/config/session/settings/engine 集成测试
npm run check   # 源码语法 + 严格公共类型声明检查
npm run check:package # 打包 + 隔离安装产物的测试/导出/浏览器注册检查
```

本包只有两个直接运行时依赖：`@deepseek-ai/schemastery` 用于配置 schema（包括设置桥接的 volatile 字段），`@deepseek-ai/dsh-util-values` 提供共享不可变值工具。其余 Harness 组件仍是 peer；测试使用锁定的 0.2.0-rc.2 开发依赖。`src/compiler.js` 仍保持零依赖。

0.2.0 的验证范围包括新替换字段与旧形状拒绝、系统头保护、显式范围、保留策略/工具配对、持久重放/来源记录、recall/search 文件引用、tool 角色消息投影与两代检查点标记、设置桥接 schema 及设置平面的跟随/回退行为、根模块分发（承载行惰性、carrier 键剥离、引擎 fiber 状态传播），以及安装产物导出/浏览器注册。在 Windows 上实测：对照干净安装的 0.2.0-rc.2 开发依赖图，Node 24.15.0 通过全部 128 项检出测试，语法/类型检查通过；打包 tarball 在隔离环境安装后解析 0.2.0-rc.2 peer 依赖图，并通过全部 121 项安装产物运行时测试。运行中宿主重启、真实 GUI 验证、部署与真实模型请求本次未执行。上方压缩率表是历史测量，不是本版本重新运行的结果。

本次 Windows 沙箱验证以无子进程隔离模式运行测试（`node --test --experimental-test-isolation=none`；打包检查通过 `NODE_OPTIONS=--experimental-test-isolation=none` 传递该选项）。

## 和官方引擎的区别

- 不调摘要模型 → 压缩从几秒变成几毫秒；不花摘要的 token。
- 不改写 → 事实、文件路径、命令、变量名都一字不差；模型继续用自己的话接着聊。
- 确定性 → 同样的内容永远压缩出同样的检查点。
- 之前的检查点原样保留，而不是重新摘要一遍（又快又无损）。
- 手动 `/compact` 和自动压力压缩都会保留最近的一段原文；上限来自固定 `retainTokens` 或按上下文计算的 `retainRatio`。优先保留整回合，最新回合超限时只保留能装下的后缀，只有更早的部分进入检查点。
- `compaction/summary` 事件携带**压缩后的条目本身**——UI 里可展开的检查点行显示的就是模型实际看到的内容，外面包一层**能自动变长的代码框**（框线永远比内容里的 ``` 长，所以含 markdown 的消息也能整齐地显示成一个代码块），检查点开头还有一段简短的使用指南，告诉模型怎么用 `recall` / `search` 找回被省略的内容。
- 权衡：对以长对话、叙述为主的历史，检查点的信息密度可能不如 LLM 摘要（长句是截断而不是合并）。正在进行的对话有逐字保留的尾部（`retainTurns`/`retainTokens`）兜底，其余持久事件内容都能通过 `(seq N)` 指针 + recall 找回；被 spill 替换为 preview 的 PTC dispatch 记录例外。

代码采用 MIT 许可证。[插件图标](<assets/icon.svg>) 改编自 [Lucide Shrink](https://lucide.dev/icons/shrink)，采用 [ISC 许可证](<assets/LICENSE.lucide>)，详见[来源与修改说明](<assets/README.md>)。0.2.1 声明本地包图标，已通过 DSH 0.2.0-rc.2 和 0.2.1-rc.2 的实际元数据读取器验证；配套插件行的图标使用新版子路径资源接口，已在 0.2.1-rc.2 验证。旧版配套插件行保留默认图标。
