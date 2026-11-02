# 0.4.0 管理面板与按 Preset 双向工具注册施工计划

- 日期：2026-11-02
- 状态：已实施（2026-11-02；实施结果与未验证事项见第 14 节）
- 目标插件版本：0.4.0（由 0.3.0 提升一个 0.x）
- DSH 开发基线：0.2.1-rc.5，commit b830ec950faba0a46dda564be3e2d854afed94f1
- 当前基线：工作区已完成 rc.5 开发锁定图升级；177 项 checkout 测试与 169 项隔离 artifact 测试通过
- 实施范围：管理面板、按 preset 启用/禁用 recall companions、发布与迁移材料；不包含压缩算法调整

## 1. 背景与问题界定

当前 bundle 的 Host patch 同时安装四类行：全局 recall/search 工具、全局 /recall 命令、设置桥接行和 Client 承载行。由此产生两个结果：Plugins 页的管理面板可以全局工作，但 recall/search 与 /recall 也会被所有 Agent 继承，无法只服务于用户指定的 preset。

0.4.0 需要把管理控制与工具可见性分开，并在管理面板中提供双向操作：

1. 用户能从当前 preset roster 中选择一个或多个 preset 并保存；目标 preset 的现有 Agent 和后续创建的 Agent 都获得 recall/search 与 /recall。
2. 用户取消选择并保存后，对应 Agent 的这些注册被释放；schema 展示、查找和执行路径都不再把它们视为可用工具。
3. Agent 在首个回合前切换 preset 时，注册状态随实际 preset 迁移；插件卸载、Agent 销毁和配置清空都有对称清理。
4. 管理面板与原有压缩设置继续可用，工具控制配置的保存不改变压缩参数，也不要求修改用户的 preset YAML。

静态地把 dsh-compaction-instant/tool 放进 preset 的 config.plugins 能解决声明式可见范围，却不能单独提供面板上的即时启用/禁用。AgentPresetRegistry.readDocument() 又是只读接口，通用 Config Editor 不是任意 preset 子行的写入 API。因此本计划不实现 YAML 编辑器，而采用“持久化目标状态 + Host 控制器按 Agent scope 注册”的结构。

已核对的 rc.5 接口依据：

| 接口 | 用途 |
|---|---|
| ctx.agents.list() / get(id) | 覆盖插件启动或 HMR 前已经存在的 Agent，以及 preset 切换事件中的目标 Agent |
| agentPresets.composedPreset(agent.ctx) | 读取 Agent 实际绑定的 preset，而不是仅凭显示名或持久事件猜测 |
| agent/created / agent/disposed | 覆盖未来 Agent 的注册和销毁清理；created 监听器在排队输入释放前执行 |
| agent-preset/selected | 在首个回合前的 preset 切换后重新协调注册 |
| agent.ctx.tools.register() | 在最近 Agent scope 注册 recall/search，并取得精确 disposer |
| agent.ctx.commands.register() | 在同一 Agent 范围注册 /recall，并取得精确 disposer |
| remote.agentPresets.list() | 给 Client 面板提供当前 preset roster、默认标记和 broken 状态 |
| volatile Config + configForms | 持久化启用 preset 集合，并让 Host 与 Client 共用现有设置写入路径 |

## 2. 目标与成功标准

### 2.1 功能目标

- 管理面板新增“历史恢复工具 / Recall companions”区域，列出当前 preset roster，允许勾选、取消、保存、放弃和重置。
- 新配置默认空数组，即升级后不向任何 preset 自动注册工具。用户必须显式启用。
- 启用和禁用都作用于已经存在的 Agent；未来 Agent 由 agent/created 自动覆盖。
- recall/search 与 /recall 作为同一组 companion 同步注册和注销，避免出现只有模型工具或只有人类命令的半状态。
- 非目标 preset 没有这些工具；Host 全局工具层也不再由本 bundle 注册它们。
- 原有引擎设置面板、设置持久化、instant 引擎和静态 tool/command 子路径导出保持可用。

### 2.2 验收标准

| 场景 | 必须观察到的结果 |
|---|---|
| 初始升级 | 全局及所有未启用 preset 均无 recall/search 和 /recall；管理面板仍显示 |
| 启用 ptc | 当前及未来 ptc Agent 获得两个工具和一个命令；standard 等对照 preset 不获得 |
| 禁用 ptc | 当前 ptc Agent 的注册被释放，后续 Agent 也不再获得；无需重选 preset 或重启 Host |
| preset 切换 | Agent 离开已启用 preset 时注销，进入已启用 preset 时注册 |
| PTC | 目标 Agent 的 PTC SDK 能继续完成 search → recall；普通工具不作为模型直接入口出现 |
| 设置隔离 | 修改 checkpointCap 等引擎字段不重注册工具；修改工具 preset 列表不改引擎字段 |
| 清理 | Agent 销毁、控制器卸载和配置重置均释放对应注册，无残留闭包或重复注册 |
| 发布物 | 0.4.0 tarball 在干净 rc.5 图中安装、导入、执行并通过全部回归 |

## 3. 非目标与约束

1. 不修改、生成或覆盖 standard、ptc 或任何自定义 preset 的 config.plugins，不引入整列表覆盖所带来的升级维护成本。
2. 不改变 preset revision，不调用 recompose 来实现工具开关；实际注册位于每个 Agent 的最近 scope，面板管理的是“按 preset 生效的目标状态”。
3. 不把管理面板改成每 preset 一份压缩配置。原有 compaction-instant 设置仍是 profile 级，并继续共享给所有 instant 引擎。
4. 不改变 recall/search 的模型 schema、canonical output、执行逻辑和 durable session 格式，不改变压缩引擎。
5. 取消注册不等于取消正在执行的调用。已经开始的 recall/search 或 /recall 按自身 signal 和生命周期结束；禁用只阻止后续展示、查找与执行。
6. 不新增自定义 RPC 作为首选路径。preset roster 使用现有 remote.agentPresets.list()，配置写入使用现有 configForms。
7. 不在 system-prompt/assemble 中增删工具或提示文本；工具可见性统一由 registry 的 scope 和 tools/change 驱动。
8. 静态 dsh-compaction-instant/tool 与 /command 导出保留，供高级用户自行组合；文档需要避免同一 Agent 同时混用静态和面板动态注册。

## 4. 总体设计

### 4.1 注册职责拆分

| 模块/行 | 所在层级 | 职责 | 不承担的职责 |
|---|---|---|---|
| compaction-instant（settings） | Host/profile | 原有压缩参数 namespace 和设置桥接 | 不注册工具，不保存 preset 勾选状态 |
| compaction-instant-preset-tools（新增 preset-tools） | Host/profile | 保存启用 preset 集合，按 Agent 实际 preset 注册/注销 companions | 不在 Host 全局层注册 recall/search，不修改 preset YAML |
| compaction-instant-client | Host/profile + Client | 承载 Plugins 页；新增 preset 列表和勾选 UI | 不直接操作 Agent，不直接调用 tools.register |
| dsh-compaction-instant/tool | 子路径模块 | 提供 recall/search definition、配置解析和静态 apply | 不决定 preset，不读取面板状态 |
| dsh-compaction-instant/command | 子路径模块 | 提供 /recall definition 和静态 apply | 不决定 preset，不读取面板状态 |
| instant engine | 各 preset 的 compaction isolate group | 压缩与读取原 compaction-instant 设置 | 不参与工具开关 |

### 4.2 Host patch 目标形态

删除 Host 层的 tool-recall 与 command-recall，新增控制器行，保留原设置和 Client 承载：

```yaml
- insert:
    - id: compaction-instant
      name: dsh-compaction-instant/settings
    - id: compaction-instant-preset-tools
      name: dsh-compaction-instant/preset-tools
    - id: compaction-instant-client
      name: dsh-compaction-instant
      config:
        carrier: true
```

preset-tools 的 Config 使用独立 namespace compaction-instant-preset-tools：

```js
export const SETTINGS_NAMESPACE = "compaction-instant-preset-tools";
export const Config = z.object({
  presets: z.array(z.string()).volatile()
});
```

缺省 presets 经 schema 解析为 []。该行为已在 rc.5 开发图中用同类 volatile string array 验证。配置中的 id 在协调时去重；空字符串和未知 id 不产生注册，也不自动改写用户配置。控制器只硬依赖 agents、agentPresets、tools 和 commands；settings 缺失时仍能按组合中的静态 config 工作，只是没有面板在线编辑。

### 4.3 为什么采用 Agent-scope，而不是面板改写 YAML

面板改写 preset 声明需要完整替换 config.plugins，并处理未来官方 preset 变化、已有会话保留旧 revision、写入冲突和回滚。动态 Agent-scope 路径直接使用现有注册接口，能在当前 Agent 上对称启用和禁用，同时保留用户声明。

该设计的语义需要准确写入文档：preset 是控制器筛选 Agent 的条件，实际贡献位于 Agent scope。它不表示 preset 的 YAML 中新增了 tool-recall 行。

## 5. Host 双向控制器

### 5.1 状态与协调算法

新增 src/preset-tools.js，复用 tool.js 的 defineRecallTool/defineSearchTool/resolveConfig 和 command.js 的 defineRecallCommand/resolveConfig。控制器为每个 Agent 保存：

```text
agent -> {
  presetId: composedPreset(agent.ctx) ?? null,
  registered: boolean,
  disposers: Tool/command disposer[]
}
```

reconcileAgent(agent) 每次读取最新 config.presets.get() 和 composedPreset(agent.ctx)，计算 desired = presets.includes(presetId)。只有实际状态变化时才操作：

- desired=true 且当前未注册：创建 recall、search、/recall 三个注册并保存 disposers。
- desired=false 且当前已注册：按相反顺序释放全部 disposers，并清除记录中的注册状态。
- desired 与当前状态一致：完全 no-op，不发 tools/change，不重建定义。

reconcileAll() 遍历 ctx.agents.list()，并移除已不在活动集合中的残留记录。面板保存引擎参数、其他 namespace 更新和重复事件不得导致工具重注册。

### 5.2 生命周期事件

| 触发 | 行为 |
|---|---|
| 控制器启动/HMR | 读取当前配置，reconcileAll() 覆盖已存在 Agent |
| agent/created | 对新建 Agent 执行 reconcileAgent；异常隔离并记录，不能让 companion 失败回滚整个会话创建 |
| agent/disposed | 清理该 Agent 的记录和控制器持有的 disposer；agent.ctx 自身清理作为第二道保障 |
| agent-preset/selected | 通过 agents.get(sessionId) 找目标，再按 composedPreset(agent.ctx) 协调，避免只信事件负载 |
| settings/document-updated | 仅当 ns 为 compaction-instant-preset-tools 时 reconcileAll() |
| 控制器卸载 | 注销全部事件监听，并释放所有仍持有的 Agent 注册 |

所有 Agent-scope 注册除记录精确 disposer 外，还纳入对应 agent.ctx.effect；控制器自身 ctx.effect 负责全量清理。不能只依赖 Agent 销毁，因为插件卸载可能发生在 Agent 存活期间。

### 5.3 注册失败与并发语义

一次启用包含三个注册。若中途失败，已创建的注册必须在 catch 中回滚，记录保持未注册状态并输出带 preset/session 上下文的日志；后续相关配置或生命周期事件可以重试，不建立定时重试循环。

禁用时应尝试释放全部 disposer，即使其中一个失败也不能遗留其余注册。重复设置事件、重复 created/disposed 通知和相同 preset 的重复选择都必须幂等。

注册和注销是同步状态变更。它们影响后续 schema assembly 和执行查找；已经开始的模型请求不会被改写，已经开始的工具调用也不会被取消。

## 6. 管理面板

### 6.1 Roster 与配置读取

Client 通过 ctx.get("remote")?.agentPresets 可选接入 roster 服务，不让它缺失时拖垮整个原压缩面板。面板挂载或用户点击刷新时调用 remote.agentPresets.list()，不通过轮询监听 roster。显示 name（缺省回退 id）、id、默认标记和 broken 原因；服务不可用时只禁用或隐藏新区域。

- broken preset 不允许新增启用，但已存在的配置允许取消。
- roster 中已消失但仍存于配置的 id 显示为“当前不可用”，允许移除； roster 读取不得隐式清理配置。
- roster 读取失败保留当前已保存配置和草稿，显示可重试错误，不把失败解释为空列表。
- 只读连接可查看配置和 roster，但勾选、保存和重置禁用。

### 6.2 勾选、保存与重置

新区域使用独立的 configForms.get("compaction-instant-preset-tools") 和控制器，不与原 CardController 的字段草稿混合。保存时将勾选集合排序后作为一个 presets 数组写入；重置通过 unset 恢复 schema 默认 []，从而禁用全部动态注册。

该区域有独立的保存、放弃、重置和错误状态。保存表示目标配置已持久化，Host 控制器负责实际 Agent 注册。0.4.0 不承诺在 UI 展示每个 Agent 的实时注册成功计数；失败日志仍需可诊断。

原 compaction-instant 表单与新区域可以放在同一 Plugins 页，但两个 namespace 的读取、保存和错误状态相互独立。控制器行被禁用或 namespace 未 served 时，只隐藏工具配置区域，不影响原压缩设置区域。

### 6.3 样式与可访问性

沿用当前 Plugins 页的字段、按钮、hint、错误和只读样式。每个 preset 使用原生 checkbox 和关联 label；保存/刷新/重置有明确按钮文本，异步操作期间禁用重复提交。无需新增视觉体系或独立页面。

## 7. 分阶段实施

### 阶段 0：固定基线与测试夹具

1. 保留当前 rc.5 锁定图和既有未提交升级，不回退到 rc.3。
2. 为控制器测试建立真实 Context、ToolRuntime/Commands registry、scope 和 FakeAgentPreset/Agents 服务；Agent 的 session 继续使用现有测试工具创建。
3. 把当前全局注册行为作为对照断言记录下来，再开始删除 Host 行。

交付：可区分全局、目标 Agent scope 和对照 Agent scope 的测试夹具。

### 阶段 1：实现 Host 控制器与组合拆分

1. 新增 src/preset-tools.js、types/preset-tools.d.ts 和 package exports/icon 映射。
2. 实现配置 schema、启动协调、事件监听、注册事务和双向 disposer 生命周期。
3. 修改 cordis.patch.yml：删除 tool-recall/command-recall，插入 compaction-instant-preset-tools。
4. 保留静态 tool/command 模块和现有 apply 测试，确保高级组合路径未受损。
5. 添加 test/preset-tools.test.js，覆盖第 9 节的 Host 场景。

交付：不依赖 Client 即可通过配置完成启用、禁用和未来 Agent 注册的 Host 功能。

### 阶段 2：实现管理面板

1. 在 src/client.js 中可选接入 remote.agentPresets 并实现 roster store。
2. 新增独立 preset 配置控制器及 checkbox 列表，接入保存、放弃、重置和刷新。
3. 处理 broken、未知 id、只读、加载失败和 namespace 未 served。
4. 扩展 test/client.test.js；原有压缩设置测试必须保持通过。

交付：用户仅通过 Plugins 页即可完成双向管理，无需手改 preset YAML。

### 阶段 3：0.4.0 版本与迁移材料

1. 将 package.json 和 package-lock.json 的版本提升为 0.4.0；同步 migration 测试和 cordis.patch 注释。
2. 将当前 Unreleased 的 rc.5 升级内容归入 0.4.0，新增“默认不再全局注册 recall companions”的行为变更说明。
3. 更新中英文 README：面板启用步骤、默认空列表、双向语义、现有/未来 Agent、静态组合替代路径和升级迁移。
4. peer/engines 默认保持现状；实施时核对接口并运行既有兼容矩阵，只有发现实际不兼容才按最小必要范围收窄并单独记录。0.4.0 的已验证 DSH 目标只写实际通过验证的版本，不把 rc.5 验证自动外推为所有旧版本验证。
5. 更新 scripts/check-package.mjs 的 patch 与 exports 断言，确保发布包包含控制器且 Host patch 不含全局 tool/command 行。

交付：版本、文档、迁移说明和发布断言一致。

### 阶段 4：自动验证与真实组合验收

1. 运行 npm ls --all、npm run check、npm test、npm run check:package 和 git diff --check。
2. 在隔离 rc.5 安装物上执行新增双向注册测试，不只验证源码目录。
3. 在实际 Web profile 安装 0.4.0 候选包，使用一个已启用 preset 和一个对照 preset 验证第 2.2 节；使用新会话验证持久化，使用当前会话验证无需重选的启用/禁用。
4. 检查 Plugins 页保存、重置、刷新、只读与错误状态；确认原压缩设置和 instant 引擎行为未改变。
5. 验证后恢复测试 profile 的用户状态。真实部署、Host 重启或模型请求若未执行，必须在交付中明确列出。

## 8. 文件级变更清单

| 文件 | 计划变更 |
|---|---|
| src/preset-tools.js（新增） | volatile 配置、Agent/preset 协调、注册与注销、事件和卸载生命周期 |
| types/preset-tools.d.ts（新增） | 新模块公开类型 |
| src/tool.js / src/command.js | 保持 definition 和静态 apply；仅按复用需要做最小注释调整 |
| src/settings.js | 保持原压缩 namespace，不接收 preset 勾选状态 |
| src/client.js | roster 读取、preset 勾选区域、独立配置控制器和状态展示 |
| cordis.patch.yml | 移除全局 tool/command 行，新增 preset-tools 控制器，保留 settings/client |
| package.json / package-lock.json | 版本 0.4.0、新子路径导出与锁文件同步；不新增运行时依赖作为默认方案 |
| test/preset-tools.test.js（新增） | Host 双向、幂等、切换、未来 Agent、失败回滚和卸载测试 |
| test/client.test.js | roster、保存/重置、只读、错误和 namespace 独立性测试 |
| test/ptc.test.js / test/recall.test.js | 保留现有回归，补充目标 scope 下的 PTC search → recall 验证 |
| test/migration.test.js | 0.4.0 版本、Host patch 形状和默认行为断言 |
| scripts/check-package.mjs | 新导出、图标、无全局 companion 行和隔离安装断言 |
| README.md / README.zh-CN.md / CHANGELOG.md | 0.4.0 功能、迁移、验证范围和限制 |
| docs/plans/2026-11-02-preset-tool-registration.md | 实施完成后更新状态与未验证事项，不改写旧计划的历史基线 |

## 9. 测试矩阵

### 9.1 Host 自动测试

- 默认空配置：全局、目标和对照 scope 均无 companions。
- 对已有 Agent 启用：注册两个工具和 /recall，对照 Agent 不注册。
- 对未来 Agent 启用：created 后立即可见； disposed 后记录和注册清理。
- 禁用与重置：精确 disposer 被调用，schema/get/execute 的可见性一致移除。
- preset 切换：旧 preset 注销，新 preset 按配置决定注册；事件负载与实际 composedPreset 不一致时以后者为准。
- 无关设置更新和重复事件：definition/disposer 身份与调用次数不变，没有重复 tools/change。
- 注册中途失败：已创建部分回滚；Agent 创建不被 companion 错误阻断。
- 控制器卸载：全部活动 Agent 清理，之后不再响应事件。
- 未知/空 id：不注册、不抛错、不自动删除持久配置。
- PTC 目标 scope：SDK 中出现 search/recall，结构化 search → recall 程序继续通过。

### 9.2 Client 自动测试

- roster 成功、失败、刷新、默认标记和 broken 原因。
- 勾选只改变草稿；保存后写入排序数组；放弃恢复原草稿。
- 重置 unset 后得到默认空数组；只读时所有写操作禁用。
- 已消失的 preset id 可见且可移除；加载失败不清空配置。
- preset-tools namespace 未 served 或 remote.agentPresets 不可用时隐藏/禁用新区域，原压缩表单仍工作。
- 引擎表单与 preset 配置的保存互不串字段、互不覆盖草稿。

### 9.3 真实验收

至少选择 ptc 作为启用目标、standard 作为对照，或选择两个等价的自定义 preset。通过实际 Tool/Command 可见性和一次真实 search → recall 验证注册结果，不能只以 checkbox 或配置行存在作为成功依据。禁用后再次检查同一 Agent，证明双向路径都生效。

## 10. 升级、兼容与回退

0.4.0 是有行为变化的 0.x 版本：从旧版升级后，原 Host 全局 tool/command 行被移除，新控制器默认 presets=[]，因此 recall companions 默认关闭。升级说明必须引导用户进入 Plugins → dsh-compaction-instant，在目标 preset 上启用并保存；不需要编辑 preset YAML。

已有 compaction-instant 设置、session 日志和 compaction checkpoint 不迁移。新 preset-tools 配置独立持久化，重置只清空工具启用列表，不清除压缩参数。

回退可以重新安装 0.3.0，或在紧急修复包中恢复 Host tool/command 行。回退不涉及数据格式；但应提醒用户 0.3.0 会恢复全局可见性。

rc.5 是当前唯一已验证的新功能基线。若继续保持更宽的 engines/peer 范围，需要至少核对接口在声明版本中的存在性，并按项目既有矩阵执行回归；未通过前不在 README 中把这些版本列为 0.4.0 的已验证目标。

## 11. 主要风险与控制

| 风险 | 控制 |
|---|---|
| 升级后用户误以为工具消失 | 0.x 版本说明、默认关闭的显式提示和面板迁移步骤 |
| 插件卸载但 Agent 仍存活，工具残留 | Agent 记录 + agent.ctx.effect + 控制器全量 disposer 三层清理 |
| 无关设置保存造成工具目录反复变化 | reconcile 按实际状态 no-op，只在注册需求变化时操作 |
| preset 选择事件与真实绑定不一致 | 以 composedPreset(agent.ctx) 为最终判断 |
| 同名静态/动态注册混用 | 文档要求二选一；动态记录幂等，卸载后继承状态可由 registry 正常恢复 |
| roster 陈旧或 broken | 手动刷新、保留草稿、允许取消旧配置，不隐式清空 |
| 保存成功但个别 Agent 注册失败 | 注册事务回滚并记录详细日志；UI 不宣称逐 Agent 成功计数 |
| 禁用被误解为取消执行 | 文档明确只影响后续可见性和执行，不中断已开始调用 |

## 12. 建议提交顺序

1. chore: update the development baseline to DSH 0.2.1-rc.5（对应当前工作区升级）
2. feat: add preset-scoped recall companion controller
3. feat: manage recall companions from the plugins page
4. test: verify bidirectional preset registration and packaged artifacts
5. docs: prepare the 0.4.0 migration and release notes
6. chore: release 0.4.0

每一步保持可审查；不要把版本提升、控制器、UI 和真实 profile 状态修改混成一个不可区分的变更。

## 13. 本计划自身不包含的内容

本计划只确定 0.4.0 的设计、文件边界、实施顺序和验收方式，不实施版本修改、控制器、Client 功能、插件安装、profile 配置写入或 Host 重启。实际交付时需要重新报告测试数量、真实组合覆盖和仍未验证的环境。


## 14. 实施结果（2026-11-02）

本节只记录本次实施的事实、与计划的出入和仍未验证的事项；第 1–13 节保持计划当时的判断，不据结果回改。

### 14.1 交付内容

| 文件 | 结果 |
|---|---|
| `src/preset-tools.js`（新增） | 实现 volatile `presets` 配置、Agent/preset 协调、事务式注册与回滚、`agent/created`/`agent/disposed`/`agent-preset/selected`/`settings/document-updated` 监听、控制器卸载清理 |
| `types/preset-tools.d.ts`（新增） | 导出 `name`、`inject`、`Config`、`SETTINGS_NAMESPACE`、`resolveConfig`、`readServedPresets`、`apply` 与 `PresetToolsConfig` |
| `cordis.patch.yml` | 删除 `tool-recall`/`command-recall`，插入 `compaction-instant-preset-tools`，保留 settings 与 client carrier 行 |
| `src/client.js` | 新增 `PresetToolsController` 与"历史恢复工具"区域（清单、勾选、刷新、重置、保存、放弃、只读、缺失/损坏状态），与引擎表单共享页面但使用独立 namespace 控制器；页面按各自 namespace 是否 served 分别渲染 |
| `test/preset-tools.test.js`（新增） | 12 项 Host 场景 |
| `test/client.test.js` | 由 7 项扩展到 22 项，原引擎用例全部保留 |
| `test/migration.test.js`、`test/types/compat.ts`、`scripts/check-package.mjs` | 版本、Host patch 形状、新导出/图标、无全局 companion 行的断言 |
| `package.json` / `package-lock.json` | 版本 0.4.0、`./preset-tools` 与 `./preset-tools/icon` 导出、`check:syntax` 增加新文件；新增 `@deepseek-ai/dsh-scope` 开发依赖（仅测试使用，无运行时依赖） |
| `README.md` / `README.zh-CN.md` / `CHANGELOG.md` | 0.4.0 功能、默认关闭、启用步骤、双向语义、静态替代路径与验证范围 |

### 14.2 与计划的实现差异

1. **仍在激活中的 Agent scope 采用延迟注册。** Cordis 中 fiber 处于加载态（state 1）时创建的 effect 会在激活提交时被丢弃，直接注册会静默失效。控制器先检查 `agent.ctx.fiber.state`，未激活时改为等 `fiber.await()` 落定后重试，并用 pending 集合避免重复注册。正常路径（`agent/created` 在 scope 已激活后触发）仍是同步注册。
2. **写操作在控制器内也有只读守卫。** 除 UI 禁用外，`toggle`/`save`/`reset` 在只读连接上直接返回，避免绕过组件仍能写入。
3. **清单读取时机落在页面首次注入。** `apply` 阶段不请求 roster；slot 的 `inject()` 首次被调用（面板挂载）时读取一次，之后只在用户点击刷新时再读，符合"不轮询"的约束。
4. **测试夹具需要 `@deepseek-ai/dsh-scope`。** 计划要求真实 scope；该包因此成为固定开发依赖，并在 `test/types/compat.ts` 中同时校验新模块的公开类型。

### 14.3 自动化验证

在 Linux / Node **24.22.1**、锁定 rc.5 图上执行并通过：`npm ls --all`、`npm run check`（语法 + 严格声明）、`npm test`（**200** 项全部通过）、`npm run check:package`（`dsh-compaction-instant-0.4.0.tgz` 隔离安装，**192** 项产物测试）、`git diff --check`；同一检出测试在 Node **24.19.0** 上复跑亦为 200/200。第 9.1 与 9.2 节列出的场景均已覆盖，包括 PTC 目标 scope 的结构化 search → recall 程序。

### 14.4 未执行或未验证

1. **未安装到真实 profile。** 按本次任务要求（"不要动现在安装的插件"），第 7 节阶段 4 第 3、4 项未执行：没有把 0.4.0 候选包安装进 Web profile，没有在真实 Plugins 页操作，没有重启宿主，也没有发出真实模型请求。因此第 9.3 节的真实组合验收与第 2.2 节中依赖真实 Host 的行（例如"无需重选 preset 或重启 Host"的端到端观察）仍为未验证状态。
2. **未重跑更早版本的隔离图。** rc.1 / rc.2 / alpha.5 / rc.3 没有为 0.4.0 重新执行；`engines.dsh` 与 peer 范围按计划保持现状，但 README 与 CHANGELOG 只把 rc.5 写成 0.4.0 的已验证目标。
3. **未做 GUI 层验证。** 浏览器半侧只有 VM 中的工厂/组件/store 测试，没有真实 Chromium 的样式与可访问性检查。
4. 0.4.0 是 0.x 行为变更版本：升级后 companion 默认关闭，回退到 0.3.0 会恢复全局可见性；这两点已写入 CHANGELOG 与 README，但未在真实部署上演练回退。

### 14.5 部署记录（2026-11-02）

用户要求升级实际安装后执行了文件级部署，尚未重启宿主：

1. profile 以 `link:/home/andyk/.dsh-local-plugins/dsh-compaction-instant` 安装本包，因此把工作区的 0.4.0 文件（`src`、`types`、`assets`、`package.json`、`cordis.patch.yml`、README、CHANGELOG、LICENSE）同步到该目录，保留其 `node_modules`；0.3.0 的副本备份在 `/tmp/dsh-compaction-instant-0.3.0-backup`。profile 的依赖声明未改。
2. `~/.dsh/profiles/web/cordis.patch.yml` 增加 `compaction-instant-preset-tools` 行，预选已把引擎行替换为 `dsh-compaction-instant` 的四个 preset。首次写入误用了 profile 的行 id（`preset-standard-instant` 等），而控制器比较的是 preset 的 `config.id`（`standard-instant`、`ptc-instant`、`chat-assistant`、`cordis-ptc`），两者不一致导致没有任何注册；2026-11-02 晚已按 `config.id` 修正并重新通过 `--dump-config` 校验。
3. `dsh --profile web --dump-config` 通过：组合树包含 `compaction-instant`（settings）、`compaction-instant-preset-tools`（带 presets 配置）与 `compaction-instant-client`，不含 `tool-recall`/`command-recall`；四个 preset 的引擎行仍为 `dsh-compaction-instant`。
4. 运行中的宿主进程仍加载 0.3.0 模块，文件升级要重启宿主后生效。重启后的 Plugins 页操作、真实模型请求、PTC 目标 scope 与回退演练仍未验证。

### 14.6 部署后修复与真机验证（2026-11-02 至 11-03）

第一次重启后控制器没有任何注册，日志给出唯一错误：

    register-error … Error: cannot get property "commands" without inject

Cordis 按"访问方 fiber 是否声明依赖"解析服务。Agent 作用域的父级（agent-loop）只声明了 `tools`，因此 `agent.ctx.commands` 被拒绝；事务在第三个注册处回滚，先成功的 `recall`、`search` 也一并撤销。修复方式是在 Agent 作用域上挂一条 `inject: ["tools", "commands"]` 的子 fiber，三个注册都在它的 `apply` 内完成：子 fiber 继承 Agent 的作用域标记，注册落进 Agent 自己的层，卸载该 fiber 即整体释放。用真实的 `@deepseek-ai/cordis` 与 `dsh-commands` 做了最小复现——`scope.ctx.commands` 抛出同一条错误，注入子 fiber 能登记成功，`commands.list` 验证命令只落在目标作用域层、作用域释放后清空。

面板问题是同一守卫的另一种表现。浏览器模块没有在自身 fiber 声明 `remote.agentPresets`，经 `ctx.get("remote")` 取得服务后再做属性访问时被拒绝，`refresh()` 同步抛出，清单状态停在 `idle`，界面只画已保存的 id 且不留任何错误提示。修复方式是用 `inject: ["remote", "remote.agentPresets"]` 的子 fiber 解析清单服务，并附直接读取兜底与挂载后重试。

测试同步收紧：控制器夹具的父级改为只注入 `tools`，复现生产条件；回滚用例改用 command-injected 子 fiber 预置同名命令。全量 200 项测试与类型检查通过。

第二次重启（2026-11-03 01:04）后的现场证据：

1. 日志记录 `apply presets=["chat-assistant","cordis-ptc","ptc-instant","standard-instant"]`；
2. 本会话 `reconcile … desired=true` 之后紧接 `registered … tools=recall,search command=recall`；
3. `host/Tool.listTools` 返回的 46 个工具中包含 `recall`、`search`；
4. 本会话实际调用 `recall` 读取 checkpoint 1、调用 `search` 命中 19 条，PTC 绑定与执行路径均成立。

清单在服务解析后正常渲染，四个系统自带预设原先回退成裸 id（`standard`、`ptc`、`minimal`、`cordis`）。按官方预设页面的做法补了一组本地化名称（标准模式、PTC 模式、极简模式、创造模式；英文为 Standard / PTC / Minimal / Creator mode）：仅当条目没有自带 `name` 且 id 命中这四个内置 id 时替换，自定义预设仍显示声明里的名称。

临时诊断代码（面板的 `debug` 行与 `/tmp` 日志写入）已从工作区移除并同步到部署目录；运行中的宿主仍加载带诊断的版本，下一次重启后为干净版本。浏览器面板在强刷后的清单渲染与勾选保存仍需一次页面级确认；回退演练与更早版本的隔离图未重跑。
