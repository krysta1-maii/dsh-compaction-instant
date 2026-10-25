# PTC 兼容性修复计划

- 日期：2026-10-26
- 状态：待实施
- 插件基线：dsh-compaction-instant 0.2.1，提交 a602a8b
- 主要开发基线：DSH 0.2.0-rc.2，提交 639ed015397290b3745d163aafe02ffee4aa3f84
- 当前核对基线：DSH 0.2.1-rc.3，提交 1f81c047fc48fa190a683e469daa699857e9afe8
- 计划范围：插件仓库内的实现、测试、文档和真实组合验证；不修改上游 DSH

## 1. 背景

当前插件可以注册并由 PTC 调用 recall/search，外层 run_code 与外层 tool/result 也能沿用现有 surface pairing 和压缩事务。需要修复的是压缩后的操作语义、恢复接口、日志时序说明和一个独立的宿主稳定性问题。

审查已经确认以下事实：

1. parseSeqSpec 接受 2^53 等非安全整数，expandSelections 的 seq += 1 在这些值上不再前进，可形成同步永久循环。
2. PTC 的 tool/ptc-dispatch-start 与 tool/ptc-dispatch 是 log-only 事件，不进入 deriveMessages()。当前编译器只处理 surface，因此一个外层 run_code 中的 nested read/edit/bash 等调用不会进入检查点。
3. 默认 DEFAULT_ARG_TOOLS 不含 run_code，检查点只保留 * run_code (seq A -> result B)，连 description 也不保留；type:"result" 又只接受 tool/result，不能直接恢复 tool/ptc-dispatch。
4. searchSession 已生成 hits，recallSession 已生成 entries/seqs，但工具 canonical value 删除了这些字段，PTC 程序只能解析展示文本。
5. spill-policy 可以把 dispatch 日志内容替换为 preview + locator。recall/search 当前只读 event.data，不能还原 spill 前的 canonical value。
6. PTC bridge 先返回 nested canonical value，再异步写 dispatch 日志，并在外层 run_code 收尾时 drain。同一程序内刚 await 完工具就 search/recall，可能看不到刚完成的结果。
7. 现有测试没有 run_code、tool/ptc-dispatch 或 PTC preset 组合用例。peer range 不能替代这些行为验证。

固定源码依据：

- [PTC dispatch 的类型与 log-only 语义](https://github.com/deepseek-ai/deepseek-harness/blob/1f81c047fc48fa190a683e469daa699857e9afe8/packages/core/tools/src/types.ts#L30-L61)
- [Session 的 surface 事件范围](https://github.com/deepseek-ai/deepseek-harness/blob/1f81c047fc48fa190a683e469daa699857e9afe8/packages/core/session/src/surface.ts#L49-L65)
- [PTC settle、异步日志与 drain](https://github.com/deepseek-ai/deepseek-harness/blob/1f81c047fc48fa190a683e469daa699857e9afe8/packages/core/tools/src/ptc.ts#L564-L602)
- [spill-policy 的日志裁剪](https://github.com/deepseek-ai/deepseek-harness/blob/1f81c047fc48fa190a683e469daa699857e9afe8/packages/spill/spill-policy/src/index.ts#L90-L126)
- [PTC SDK 使用 canonical value](https://github.com/deepseek-ai/deepseek-harness/blob/1f81c047fc48fa190a683e469daa699857e9afe8/packages/core/tools/src/ts-types.ts#L259-L271)
- [官方 compaction-basic 同样只读 surface](https://github.com/deepseek-ai/deepseek-harness/blob/1f81c047fc48fa190a683e469daa699857e9afe8/packages/compaction/compaction-basic/src/region.ts#L532-L562)
- [中断恢复只合成外层 tool/result（alpha.1 固定源码）](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/core/session/src/repair.ts#L157-L193)

## 2. 目标

实施完成后，应同时满足：

1. 任意数字形式的 seq 输入都在有限时间内被接受或拒绝，不会卡住宿主线程。
2. 默认 PTC 检查点保留外层 description，并为每个 nested dispatch 留下可跟随的稳定恢复指针。
3. recall(type:"result") 能恢复 tool/ptc-dispatch 的参数与结算内容，且不会把它误当作官方 pruner 的 surface 替换节点。
4. PTC 程序可以用结构化 hits/entries/seqs 直接完成 search → recall，无需解析 Native 文本。
5. 文档准确区分 durable event content、spill 前的 canonical value 和同一 run_code 内的日志延迟可见性。
6. rc2 默认测试、rc3 当前运行时复核和真实 PTC 组合测试都有明确覆盖；不再仅凭依赖范围宣称兼容。
7. 现有 native 压缩、官方 pruner provenance、surface replay、设置页和 bundle 激活方式保持可用。

## 3. 非目标与约束

本阶段不做以下事项：

- 不把 tool/ptc-dispatch* 加入 surface，不改变 DSH 的消息投影、tool pairing 或 Session 格式。
- 不修改上游 DSH，不给 compaction-basic 增加 PTC 特判，也不把宿主共同限制当成本插件独有的回归。
- 不实现持久 PTC REPL 状态序列化。persistent-in-memory 的进程状态重启后仍按宿主规则处理；本计划只保证声明代码仍可通过外层 seq 找回。
- 不实现通用的 spill 自动解引用。当前 SpillStore 只有 saveText，没有通用 read/search API，SpillLocator 也是不应解析的不透明句柄。
- 不通过 sleep、固定重试次数或猜测 seq 来掩盖同一 run_code 内的日志提交窗口。
- 不引入新的运行时依赖，不扩大 engines/peer 版本范围，不升级项目锁定的 DSH 开发图。
- 不改动后台任务、子代理 Session、命令 source kind 或 deprecated Session API 的迁移；这些分别跟踪，不与本次 PTC 修复混合。

必须保持的兼容性约束：

1. shadowedSeqs 继续只包含被替换的 surface 节点；shadowedTokenCount、shadowedRouteTokenCount 和 shrink 比较的含义不变。
2. PTC dispatch 只作为检查点引用的日志事件，不参与 surface pairing，也不进入 token-meter 的模型可见价格。
3. checkpoint 的 sourceEventSeqs 可以追加编译时实际检查的 dispatch 来源事件；referencedSeqs 是完整 inspected provenance，不要求与最终文本引用一一对应，hideTools/cap elision 不裁剪它，但这些 seq 不得混入 shadowedSeqs。
4. 自定义 compile hook 不必立即返回新字段；新增的 referencedSeqs 必须可选并默认为空。
5. Native output.render 的文本形式保持兼容；新增数据只进入 canonical value。
6. recall(type:"seq") 对 log-only 事件的现有 JSON 展示保持兼容，type:"result" 对官方 pruner 的逐层来源校验不得放宽。
7. rootCallId、parentCallId、subCallId 只作为不透明身份键使用；不得解析 :ptc:n 后缀推断顺序或归属，嵌套顺序取 startSeq。
8. recoverySeqs 表达模型可见的恢复路径，referencedSeqs 表达编译检查的持久来源；旧 checkpoint 再次压缩时允许经旧 checkpoint 形成间接引用链，不要求把旧 dispatch 全部提升为新 checkpoint 的直接 referencedSeqs。

## 4. 总体设计

| 问题 | 实施决定 | 主要代码位置 |
|---|---|---|
| 非安全 seq 死循环 | 在所有数字引用入口拒绝非有限、非安全整数；展开前再次验证 | src/recall.js |
| run_code 只剩名称 | 默认保留 description；完整代码继续由外层 seq 恢复，避免依赖 code/description 属性顺序 | src/compiler.js |
| nested 调用无检查点入口 | 按 parentCallId/subCallId 建立 dispatch 索引，在外层 run_code 行后生成 nested 工具行和 result 指针 | src/ptc.js、src/compiler.js、src/index.js |
| result 拒绝 dispatch | type:"result" 同时接受 tool/result 与 tool/ptc-dispatch；后者直接选择事件，不走 pruner 解引用 | src/recall.js |
| 引用来源未记录 | compile 返回可选 referencedSeqs，提交时追加到 checkpoint.sourceEventSeqs，并由 Session.append 校验 | src/index.js、src/region.js、types |
| PTC 只能解析文本 | canonical value 保留 hits、entries、seqs，Native render 不变 | src/tool.js |
| spill 承诺失真 | 明确只恢复 durable content；保留 preview/locator，不解析 locator，不承诺 pre-spill canonical value | 工具描述、RECALL_GUIDE、双语 README |
| 同程序日志延迟 | 文档要求立即处理使用直接 canonical value；增加时序回归，不加入等待猜测 | test/ptc.test.js、README |
| 取消观察不足 | 在工具入口、事件循环、范围展开和来源链遍历中加入协作式 signal 检查 | src/tool.js、src/search.js、src/recall.js |

## 5. 分阶段实施

### 阶段 0：先建立 PTC 测试夹具

新增 test/ptc.test.js，复用审查探针的结构，而不是只用 session-shaped mock：

1. 使用真实 Context、SystemPrompt、ToolRuntime(mode:"ptc")、Session 和插件工具定义。
2. 使用可编程 FakeRuntime 驱动 request.bindings，覆盖 nested 调用、canonical value、dispatch start/settle、logWork drain 和取消。
3. 提供 makePtcSession、setupPtc、runCode、readDispatch 等局部 helper；helper 只服务该测试文件，不新建通用测试框架。
4. 默认测试不依赖真实模型、网络、GUI、凭据或宿主 profile。
5. 先加入两个基线测试：当前 nested dispatch 不进入 deriveMessages；外层 run_code/result pairing 与 replay 保持不变。后续修复不得通过破坏这两条来“通过”。

完成标准：测试能在默认 rc2 开发图运行，并能在隔离的 rc3 安装图复用。

### 阶段 1：消除 seq 稳定性问题并补协作式取消

修改 src/recall.js：

1. parseSeqSpec 在 Number() 后验证 start/end 为有限安全整数，且 0 <= start <= end；非安全值返回稳定错误，不进入 expandSelections。
2. type:"result" 的数字 seq、type:"checkpoint" 的 seq 形式使用相同验证。checkpoint ordinal 保留现有安全整数检查。
3. expandSelections 在循环前防御性验证 selection；任何 start/end 非安全整数都抛出可诊断错误，避免未来其他调用方绕过 parseSeqSpec。
4. 新增协议级 MAX_RECALL_ENTRIES=1000，在 compiler.js 中定义并由 recall 公共入口 re-export，避免 compiler → recall 的循环依赖；它与单范围 MAX_RECALL_SPAN 分开：parseSeqSpec 按所有逗号范围的声明总宽度（包括重复）拒绝超限输入，expandSelections 对直接调用方也按同一声明宽度规则限制。missing seq 同样占名额，防止 missing-heavy 输入绕开文本预算制造无界 entries/seqs。
5. recallSession(session,selections,config,signal?)、searchSession(session,pattern,config,signal?)、resolveRecallReference(session,type,id,signal?)、findCheckpointSeqs(session,signal?) 和 expandSelections(selections,signal?) 均在现有参数末尾追加可选 AbortSignal；在入口、每个事件/选择单元及来源链每次迭代前调用 throwIfAborted()。
6. executeRecall 和 search 的 execute 在入口传递 exec.signal。已有调用方不传 signal 时行为不变。
7. 不声称能解决单个灾难性正则内部的不可中断执行；文档只承诺事件与选择单元之间的协作式取消。

测试：

- 2^53、2^53+1 的原始十进制文本、数百位数字、超宽范围和逆序范围均快速拒绝。
- 修复后直接执行 tool.execute({type:"seq", id:"9007199254740992"})，断言 RECALL_INVALID_SELECTION；测试本身不得依赖 timeout 救命。
- result/checkpoint 的非安全数字同样返回输入错误，而非 not found 或长循环。
- 数千个 missing seq、超额的重复范围和超宽逗号选择在 MAX_RECALL_ENTRIES 处快速拒绝，不返回无界 entries/seqs；边界内 missing 与重复范围仍按现有语义返回。
- 预先 aborted、处理中 aborted 的 search/recall 均在下一个检查点停止；保留 signal.reason。
- 现有合法 seq 0、最大安全整数单点“未找到”、pruner 链和 checkpoint ordinal 行为不变。

### 阶段 2：实现 PTC-aware 编译与恢复

#### 2.1 新增内部 dispatch 索引模块

新增 src/ptc.js，仅作内部模块，不增加 package exports。它负责：

1. 从 surface nodes 中识别 name 为 run_code 的 assistant tool-call，取得外层 callId。
2. 扫描 session.snapshotEvents()，按 parentCallId 找到属于这些外层调用的 start/settle，按 subCallId 配对。
3. 返回 Map<outerCallId, PtcDispatchPair[]> 和按 seq 升序去重的 referencedSeqs。referencedSeqs 覆盖本次实际检查的 start/settle，不随 hideTools/cap elision 减少。每对保留 startSeq、name、arguments；settled 记录另含 settleSeq/isError，start-only 记录不包含这些字段。
4. 只校验被选中的 run_code 子树。正常完成的外层结果要求 start/settle 配对完整；缺 start 或缺 settle 按损坏日志处理并中止本次压缩提交。
5. 使用原始外层 tool/result 事件的 data.error?.code 与 dsh-session 导出的 TOOL_OUTCOME_UNKNOWN 识别 crash/fork/step-failure 的恢复结果。此类合法日志允许 nested start-only：保留 startSeq 和未结算状态，不生成 result 指针，不合成 dispatch settle。TOOL_NOT_STARTED 不应带有 nested 事件，如出现则按身份不一致处理。
6. 重复 start/settle、root/parent/name/arguments 身份不一致以及 settle 无 start 仍应失败；arguments 使用 deep-strict JSON 相等比较，不依赖属性顺序或重新序列化后的文本。不得用中断恢复分支掩盖重复或错配。
7. 与当前选择无关的 PTC 事件不做额外限制。后台 job、其他 agent 和其他 Session 的事件不纳入索引。

在 types/compiler.d.ts 声明 PtcDispatchPair/PtcDispatchIndex 的结构，供 compileNodes/compileRegion 的可选参数使用；同时按 Session.deriveEventMessage 的实际输入补齐 CompileNode 的 tool role 与可选 toolCallId，不改变运行时行为。不要为内部 src/ptc.js 新增公共子路径。

#### 2.2 保留外层 description 和 nested 工具行

修改 src/compiler.js：

1. DEFAULT_ARG_TOOLS 加入 run_code，DEFAULT_TOOL_KEY_FIELDS.run_code 固定为 description。这样 code-first 与 description-first 的原始 JSON 都产生相同检查点。
2. 完整代码仍通过外层 assistant seq 恢复；不把多行 code 的第一行误当成完整程序。用户仍可通过 toolKeyFields 显式覆盖显示字段。
3. 提取现有工具 one-line 生成逻辑为内部 helper，统一 toolArgTools、toolKeyFields、oneLineArg、hideTools 和 toolCallTokens。native block.arguments 仍按 raw JSON string 解析；nested dispatch.arguments 已是 JSON value，必须直接使用，不得再次 JSON.parse 或双重 stringify。nested 对象参数复用 pickToolKeyArg，字符串标量可直接交 oneLineArg，数组及其他标量默认 name-only；native 现有行为不变。
4. 在外层 run_code 行之后，按 startSeq 顺序生成 nested 行，例如：

~~~text
* run_code "Inspect a.js" (seq 2 -> result 8)
* read "a.js" (seq 3 -> result 4)
* bash "npm test" (seq 5 -> result 6)
~~~

5. nested 行使用 startSeq 作为条目 seq，settleSeq 作为 result 指针；条目 kind 继续使用 tool，使 cap elision 与现有低价值日志策略一致。中断恢复的 start-only 行只写 startSeq，不写 result 指针。
6. CompileEntry 新增可选 recoverySeqs: readonly SessionSeq[]。普通条目缺省等价于 [entry.seq]；native 工具行在存在对应结果时包含 call seq+result seq，否则只含 call seq；nested settled 行包含 startSeq+settleSeq，start-only 行只含 startSeq。seqSelectionOf 在 phase A/B 都展开 recoverySeqs 并保持首次出现顺序去重，确保 elision marker 不丢结果恢复入口。恢复选择同时按 MAX_RECALL_ENTRIES 分块：普通小选择保持现有单行格式，超限选择生成多个可独立 recall 的连续 marker 行，各块并集必须覆盖全部 recoverySeqs，且每块的声明总宽度不超过上限。
7. hideTools 含 run_code 时隐藏整个子树；含某个 nested 工具名时只隐藏该工具的嵌套行，保持配置直觉一致。
8. 不改变 stats.toolCalls/toolResults 原有的 surface 统计含义。nested 数量写入 debug 诊断，不新增统计字段。
9. COMPILER_REV 随输出格式变化更新。

#### 2.3 扩展 result 引用，保持 pruner 校验分离

修改 src/recall.js：

1. type:"result" 遇到 tool/result 时继续走 resolveResultSource，保留相邻 compaction/prune、sourceEventSeqs、surfaceOp、message id/toolCallId 的完整校验。
2. 遇到 tool/ptc-dispatch 时直接返回该 settle seq 的 selection，不读取 surfaceOp，不伪造 pruner 来源，也不回退到其他事件。
3. 其他事件类型继续报错。tool/ptc-dispatch-start 不是结果，不能作为 type:"result" 的目标。
4. type:"seq" 的现有行为不变；dispatch 的 name/arguments/content/isError/meta/error 仍通过 log-only JSON 投影可见。

#### 2.4 记录额外引用，不改变 shadow 价格

修改 src/index.js、src/region.js 和公共类型：

1. InstantCompactionEngine.compile 在取得 prepared.shadowedSeqs 对应 nodes 后建立 dispatch 索引，把它传给 compileRegion，并在 CompiledRegion 中返回 referencedSeqs。
2. CompiledRegion.referencedSeqs 与 RegionDependencies compile 返回类型均声明为 referencedSeqs?: readonly SessionSeq[]；自定义 compiler 未返回时按 [] 处理。
3. compileCompaction 的返回对象显式把 referencedSeqs 从 compile 结果继续传递到提交阶段；commitCompactionBody 再将 startEvent、summaryEvent、shadowedSeqs、referencedSeqs 按该顺序写入 checkpoint.sourceEventSeqs。插件索引已保证 referencedSeqs 唯一，提交层不再去重或掩盖自定义 hook 的重复输入，由 Session.append 最终校验唯一性、真实早期 seq 和安全整数。
4. compaction/summary.shadowedSeqs、CompactionResult.shadowedSeqs 和 shadowedRange 完全不变。
5. checkpoint 的 framedTokenCount 继续包含新增 nested 行；shadowedRouteTokenCount 不增加 log-only 事件。若大量 nested 行使检查点无法缩小，先由现有 cap/elision 处理，仍无法缩小时按现有规则拒绝，不隐藏超额。

阶段 2 测试：

- 一个 run_code 含至少两个 nested 调用，检查点包含 description、每个 nested 名称/关键参数和稳定 start/settle 指针。
- type:"result" 能恢复每个 settle 的 name/arguments/content/isError；start 和其他事件仍被拒绝。
- code-first/description-first 输出一致；hideTools 和多字节内容行为有覆盖。对象、数组、字符串三类 nested arguments 分别验证 key-field 选择、name-only 回退和字面字符串展示，不发生二次解析或双重 stringify。
- 分别强制 phase A 与 phase B elision，跟随检查点中模型可见的 marker 恢复 native result 与 nested settle；不能只检查模型不可见的 sourceEventSeqs，也不能构造虚假的数字区间。另以超过 1000 个 nested 调用的 fan-out（start+settle 超过 2000 个唯一 seq）验证 marker 分块，逐块 recall 后的并集覆盖全部 settle；现有 1020 项 round-trip 继续通过。
- 对同一大 fan-out 记录 referencedSeqs/sourceEventSeqs 的数量和序列化大小，断言与实际检查事件一一对应、无重复、可 replay；元数据只随实际 dispatch 数线性增长，不随 checkpointCap 静默截断，也不承诺 range encoding 一定压缩。
- replay/fork 后 dispatch 仍为 log-only，surface 与 deriveMessages 一致；checkpoint.sourceEventSeqs 包含引用，shadowedSeqs 不包含 dispatch。
- 官方 pruner 对外层 run_code result 的重复 prune → compact → replay 仍能回到原始外层结果；nested dispatch 不被误 prune。
- 正常完成调用的损坏配对在 compile 阶段失败并写入 compaction/end 错误括号，不提交部分 checkpoint。
- 用 interruptedTurnClosers/等价 fork seed/step-failure 恢复路径构造 start-only 与已 settle 混合的 nested 历史及外层 TOOL_OUTCOME_UNKNOWN，压缩和 replay 均成功，start-only 行无 result 指针；NOT_STARTED 出现 nested、重复、错配和 settle 无 start 仍失败，CODE_RUN_FAILED/ABORTED 等普通外层结果仍要求完整配对。
- 连续执行两次 compaction，确认旧 checkpoint 中的 dispatch 指针与旧来源链仍可恢复；允许新 checkpoint 通过旧 checkpoint 间接引用，不要求复制全部旧 referencedSeqs。
- 自定义 compile hook 返回未来、重复或非安全的 referencedSeqs 时，Session.append 在 commit 阶段拒绝，写入 compaction/end 错误括号且不产生 checkpoint 或 surface 替换。

### 阶段 3：补齐 canonical value 和 PTC 组合调用

修改 src/tool.js：

1. SEARCH_OUTPUT.schema 增加 hits：array，item 为 {seq: integer, kind: string, text: string}，对象 additionalProperties:false，三个字段均 required。
2. search execute 返回 result.hits，保留现有 text/pattern/totalMatches/omitted/truncated/tokens。
3. RECALL_OUTPUT.schema 增加 entries 和 seqs：
   - entries：array，item 为 {seq: integer, text: string, truncated?: boolean}；seq/text required，truncated 可选。
   - seqs：array，item 为 integer。
4. recall execute 返回 recalled.entries 与 recalled.seqs，保留现有计数字段。
5. output.render 继续只使用 value.text，不改变 Native 展示，也不把重复结构化数据追加到模型文本。
6. maxRecallTokens 继续只约束已包含文本；同时由阶段 1 的 MAX_RECALL_ENTRIES 限制选择展开和 missing 条目数量。不得把文本预算单独描述为结构化字段的总内存上限。

测试：

- 直接工具测试断言 hits/entries/seqs 的内容和 schema 校验，不只断言 render 文本。
- 真实 ToolRuntime(mode:"ptc") 中先用第一个 run_code 产生 nested result 并完成 drain，再在第二个 run_code 执行以下结构化组合，避免撞上同程序日志延迟窗口。搜索式采用不自匹配写法，并按事件 kind 选择目标：

~~~ts
const found = await tools.search({ pattern: 'UNIQUE_NESTED_RES[U]LT' });
const hit = found.hits.find(candidate => candidate.kind === 'tool/ptc-dispatch');
if (!hit) throw new Error('missing nested dispatch');
const restored = await tools.recall({ type: 'seq', id: String(hit.seq) });
return { hit, restoredSeqs: restored.seqs };
~~~

- 上述程序不得正则解析 found.text；断言 restored.seqs 与搜索命中的 seq 一致。
- output.render 的现有深度相等测试保持，证明 Native 文本未因新增字段变化。
- 直接工具测试增加 missing-heavy 输入，确认 MAX_RECALL_ENTRIES 在返回 canonical entries/seqs 前生效。
- test/types/compat.ts 覆盖末尾可选 signal、CompiledRegion.referencedSeqs、CompileEntry.recoverySeqs 和 compiler PTC 参数类型。

### 阶段 4：收窄 spill 与日志时序承诺，避免错误修复

当前 SpillStore 只有 saveText，locator 不应解析。本阶段选择“准确说明并保留恢复线索”，不实现伪通用读取。

修改 RECALL_DESCRIPTION、SEARCH_DESCRIPTION、RECALL_GUIDE、相关 JSDoc、README.md 与 README.zh-CN.md：

1. 将“exact original / nothing is lost”限定为当前 durable event 的内容和预算允许的范围。
2. 明确 tool/result 与 tool/ptc-dispatch 的恢复差异：后者可能只有 post-spill preview + locator，不能还原程序曾取得的完整 canonical value。
3. 保留 preview content 及其中文本 notice 的 locator/retrievalHint，让调用方可以按宿主提示继续处理；它们位于 preview 文本中，不是 event.data 的稳定结构字段，不按字段读取或解析，也不新增对 spill-local 的依赖。
4. 说明同一 run_code 内的 dispatch 日志可能晚于 canonical value 返回。需要立即处理结果时使用该工具的直接返回值；search/recall 用于 dispatch 日志已提交的历史，通常在外层 run_code 返回/drain 后，或已经明确观察到目标 append 后。canonical value 已返回不等于 settle 已提交。
5. 增加 PTC 激活说明：必须覆盖 preset-ptc 的 compaction group，或使用带 mode:ptc 的自定义预设。只替换 preset-standard 不会修改 PTC 预设的引擎。
6. 继续强调 bundle 安装 companion 不等于 instant 引擎已激活。

测试：

- 用 tools/ptc-dispatch-log 注入 preview + locator，断言 recall/search 保留该记录，不把 preview 错称为完整原始值。
- 使用不自匹配的 pattern（例如 echo:sentin[e]l）和受控延迟监听器，固定“立即搜索可为 0、drain 后事件存在”的时序；测试用于验证文档所述限制，不用 sleep 尝试把它修成强一致。
- 若未来上游提供通用 spill 读取或 dispatch 提交屏障，再单独设计自动恢复/强一致读取，不在本阶段预留虚假接口。

### 阶段 5：真实组合、版本矩阵与发布材料

默认验证：

1. npm test
2. npm run check
3. npm run check:package
4. git diff --check

隔离版本验证，不改变默认 lock：

| DSH 版本 | 验证重点 |
|---|---|
| 0.2.0-rc.1（4878cdabd87d4041bdaff61d04c966883b9fd07a） | 最低支持范围的 defineTool、native/ptc/both、surface、dispatch result 引用和 replay |
| 0.2.0-rc.2 | 完整默认测试、类型检查、包检查、真实 PTC bridge、既有 error 字段 |
| 0.2.1-alpha.5 | workingDirectory 要求、meta 新增（error 在 rc2 已有）、both 移除、retained runtime 与代码恢复入口 |
| 0.2.1-rc.3 | 当前运行时、spill-policy、真实 preset-ptc 组合和重放 |

矩阵每一行都覆盖额外非 surface sourceEventSeqs 的 replay/fork，以及同一 run_code 内 canonical value 与 dispatch append 的可见窗口；不能只在 rc.3 验证这两项。rc.1 只有在实际执行后才能写入动态验证结果。

真实组合验证要求：

1. 从打包产物安装到一次性测试 profile，不使用仓库源码路径冒充已安装包。
2. 通过 Loader/app 启动测试组合，完整复制 preset-ptc，只替换 compaction 引擎行；保留 mode:ptc、command-compact 和 tool-result-pruner。
3. 用 keyless scripted provider 或可重放记录产生一个 run_code，至少包含两个 nested 调用和一个较大结果。
4. 断言 recall/search 出现在 PTC SDK declarations 中，nested 调用收到当前 agent，instant 而非 basic 被实际挂载。
5. 执行 /compact 后检查模型可见 checkpoint、dispatch 恢复、sourceEventSeqs、spill preview 和 Session replay。
6. 验证 standard 仍按预期工作，bundle 的 client carrier 不挂载第二个引擎。
7. 真实 GUI、真实模型和 persistent REPL 的结果分别记录，不用单元测试或类型检查代替。若这些项目未执行，发布说明继续保留未验证限制。

实施完成后更新 CHANGELOG.md，准确列出行为变化、canonical value 扩展、文档承诺收窄和已验证版本；不把这些计划条目提前写成已完成。

## 6. 文件级变更清单

| 文件 | 计划变更 |
|---|---|
| src/recall.js | 安全整数验证、MAX_RECALL_ENTRIES、dispatch result、协作式取消、durable content 说明 |
| src/search.js | 可选 signal、事件循环取消检查、日志时序说明 |
| src/tool.js | hits/entries/seqs canonical 输出、signal 传递、工具描述修正 |
| src/compiler.js | run_code description、nested 工具行、recoverySeqs 与分块 marker、共享 one-line helper、MAX_RECALL_ENTRIES、编译修订号 |
| src/ptc.js | 新增内部 dispatch 发现、配对、TOOL_OUTCOME_UNKNOWN 处理和 referencedSeqs 索引 |
| src/index.js | 建立并传递 PTC 索引，返回可选 referencedSeqs |
| src/region.js | checkpoint.sourceEventSeqs 追加引用，shadow 数据保持不变 |
| types/compiler.d.ts | PTC 索引结构、CompileEntry.recoverySeqs、MAX_RECALL_ENTRIES、可选参数、CompileNode 的 tool role 与 toolCallId |
| types/index.d.ts | CompiledRegion.referencedSeqs 可选字段 |
| types/region.d.ts | compile hook 的可选 referencedSeqs |
| types/recall.d.ts、types/search.d.ts | 末尾可选 signal、MAX_RECALL_ENTRIES 与更新后的恢复语义 |
| test/ptc.test.js | 真实 PTC bridge、结构化组合、日志时序和基础 replay |
| test/recall.test.js | 非安全数字、dispatch result、canonical 字段和取消 |
| test/compiler.test.js | run_code 与 nested 行、字段顺序、hide/elision |
| test/engine.test.js、test/region.test.js | referencedSeqs、sourceEventSeqs、shadow 不变和失败括号 |
| test/pruner.test.js | 外层 run_code pruner 与 nested dispatch 的边界 |
| test/types/compat.ts | 新公共类型和向后兼容的可选参数 |
| package.json | check:syntax 增加 src/ptc.js；不新增依赖、exports 或版本范围 |
| README.md、README.zh-CN.md | PTC 激活、dispatch 恢复、spill 和日志时序限制 |
| CHANGELOG.md | 实施验证完成后的实际变更记录 |
| scripts/check-package.mjs | 仅在打包检查需要显式覆盖新 PTC 场景时调整；现有测试发现机制优先复用 |

明确不修改 cordis.patch.yml 的组合语义，不新增宿主层引擎兜底，不修改 client 设置页，除非实现中发现独立的回归证据。

## 7. 验收标准

只有全部满足以下条件，才可把本计划标记为实施完成：

1. 所有非安全数字引用均快速失败，测试无需依赖外层 timeout。
2. 默认 PTC 检查点可从自身文本跟随到每个 nested 结算；phase A/B elision 后 recoverySeqs 仍保留该能力，超过 MAX_RECALL_ENTRIES 的 marker 也可逐块恢复，不再需要预先知道关键词或猜测 seq 范围。
3. type:"result" 对 dispatch 的恢复包含 name/arguments/content/isError，且 pruner provenance 的既有负例全部继续通过。
4. PTC 程序可以完全通过结构化字段完成 search → recall。
5. dispatch 保持 log-only，shadowedSeqs/token 计量不变，直接或经前序 checkpoint 的引用链完整，replay/fork 结果一致；TOOL_OUTCOME_UNKNOWN 的 start-only 历史也能压缩和重放。
6. spill preview 和日志延迟被准确描述并有回归测试；文档不再承诺无法提供的 pre-spill canonical value 或同程序强一致读取。
7. 默认测试、语法/类型、打包和版本矩阵通过；真实 PTC 组合实际挂载 instant。
8. Native 行为、output.render、官方 pruner、设置页和 bundle carrier 无回归。
9. README 与 CHANGELOG 只声明真正执行过的验证，未执行的真实模型/GUI 项目明确保留限制。

## 8. 风险与回退

| 风险 | 控制方式 | 回退方式 |
|---|---|---|
| nested 行使 checkpoint 过大 | 复用 cap/elision，新增大量 nested fan-out 测试 | 若仍无法缩小则拒绝该 checkpoint 并保留原 surface，不引入未定义的聚合格式 |
| 旧日志的 dispatch 配对不完整 | 正常完成调用严格配对；TOOL_OUTCOME_UNKNOWN 允许 start-only，其他重复/错配仍失败 | 保留原 surface，不提交残缺 checkpoint，也不伪造 settle |
| sourceEventSeqs 增加影响消费者与元数据规模 | 与 shadowedSeqs 分离，升序去重，运行大 fanout、replay/fork/UI/查询及非法引用测试 | 不按文本 cap 截断 provenance；append 失败只保留错误括号，不提交 checkpoint |
| canonical 字段增加内存占用 | 文本沿用 maxRecallTokens，条目数量受 MAX_RECALL_ENTRIES 限制，Native render 不重复输出 | 可减少 hits/entries 中的展示副本，但 seq/kind 等结构化标识必须保留 |
| 自定义 compile hook 被破坏 | referencedSeqs 与 PTC 参数均可选，缺省为空 | 旧 hook 无 PTC 行仍按原路径编译 |
| 不同 DSH 版本行为漂移 | rc1/rc2/alpha5/rc3 隔离验证，不升级默认 lock | 收窄文档中的兼容声明，不用依赖范围掩盖失败 |
| 协作式取消无法中断单个正则 | 明确保证粒度，不宣称硬 deadline | 后续另评正则执行隔离，不与本次修复混合 |

## 9. 建议实施提交顺序

1. test: add PTC bridge fixtures and unsafe-seq regressions
2. fix: validate recall selections and observe cancellation
3. feat: compile and recall PTC dispatch history
4. feat: expose structured recall and search results
5. docs: clarify spill and PTC log visibility
6. test: verify PTC presets across supported DSH versions
7. docs: record verified compatibility and changelog

每个实现提交只在自己的文件范围内工作，并在下一阶段开始前运行对应聚焦测试。最终发布提交必须位于真实组合与版本矩阵完成之后。

## 10. 本计划自身不包含的内容

本次计划文档提交不实现上述代码，不提升版本号，不更新兼容性声明为“已支持 PTC”，也不宣称真实 GUI/模型/profile 已验证。它只固定问题、设计决定、实施顺序和验收标准，供后续实现与审查使用。
