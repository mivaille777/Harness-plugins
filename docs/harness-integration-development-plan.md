# DeepSeek Harness 完整交互开发计划

编写日期：2026-09-07。原始核查基线为 Harness-plugins 的 `feat/t05-session-integration` 提交 `1827bff`；当前执行基线为 R03 提交 `00ccb6a`。本文是后续开发要求，不代表未列出证据的功能或实机测试已经通过。

本文是根目录 [harness-plugins task.md](../harness-plugins%20task.md) 中 T05 的详细执行补充，并衔接 T06～T11。有关 T05-A～C 的完成状态、T05-D 的阻塞判断以及后续执行顺序，以本次核查后的本文为准；原任务的隐私、架构及产品目标继续适用。

## 1. 最终目标与验收范围

用户从浏览器选择材料，主动打开 Lens，确认来源和范围后发送问题；Harness 在正常 Agent 会话中处理消息、调用工具、请求审批并生成回答；Lens 正确呈现进度、结果、错误及停止操作。用户能够继续追问、切换会话、在完整 Harness 界面核对历史，并在断线或重启后恢复同一任务。

完整交互必须满足以下可验证事实：

1. Native 只负责采集、IPC 和界面；模型调用、工具策略及持久日志由 Harness 拥有。
2. 请求、输入材料、工具读取和回答均可追溯到同一会话及实际宿主执行事实。
3. 新选区、另一会话、旧连接和迟到事件不会污染当前回答。
4. 正常完成、取消请求、取消确认、模型失败、等待审批和连接中断分别显示；无法确定提交结果时明确标记“状态未知”。
5. 临时缓存清除和程序重启后，已确认的材料及历史仍可从 Harness 日志重建。
6. 自动测试、真实 Windows 管道验证、真实模型验证和人工交互验收分别记录，不能相互代替。

交付分为两道门槛：R01～R07 达成“可靠 Harness 交互闭环”；R08 及原手册有关安装、性能、人因和发布验收达成“可日常使用的产品”。额外应用 Provider 不阻塞首个浏览器闭环；支持范围必须如实公布。

## 2. 基线事实与必须纠正的判断

| 项目 | 核查结果 | 对后续开发的约束 |
|---|---|---|
| 会话与 IPC | 已有创建、提交、订阅、取消、连续事件回放和 Native 订阅代次 | 不从头重写；继续补齐请求身份、审批、历史和真实闭环 |
| T05-A | R02 已通过自动检查和实际 Windows Named Pipe 测试 | 保留真实管道证据；后续协议变化必须重跑受影响的契约与管道测试 |
| T05-B/C | R01 已完成回答投影自动检查；R03 已完成请求身份、去重、未知提交恢复和取消竞态自动检查及 Windows 管道验证 | 可进入 R04；真实模型与可见窗口仍由 R07 验收 |
| 工具包 | `npm.cmd view @deepseek-ai/dsh-tools@0.1.1-rc.2 version` 返回 `0.1.1-rc.2` | 本地未安装不等于宿主不存在该能力 |
| Agent 组合 | 已安装 Agent 类型提供 `create/resume` 的 `setup(agentCtx)`，文档明确包含 scoped tools | 先验证同版本工具包与 profile 组合，再判断是否需要宿主修改 |
| 工具源码 | 本地 Harness `packages/core/tools/src/index.ts` 有作用域 `register` 及 disposer | 本地源码版本为另一版本，不能直接假定与 rc.2 完全兼容 |
| 回放测试 | R01/R02 已覆盖回答投影、连续订阅、cursor 和双 session 的无密钥场景 | 尚不是实际持久化、进程重启和真实模型请求的完整回放 |
| 传输测试 | R02 已用真实 Node 服务与 Rust 客户端在 Windows Named Pipe 连续传递 100 个事件并并发执行请求 | R03 或后续修改提交/回执协议时必须重跑该测试 |
| Native UI 测试 | R01/R03 已覆盖回答正文、结束原因、连接错误、listener 生命周期、重复提交、未知提交恢复和取消竞态 | 尚未覆盖真实 Tauri 窗口、审批、历史选择及完整视觉状态 |
| 真实 session e2e | 运行器已区分 L1 无密钥、L2 真实模型和 L3 可见窗口；当前仅有 L1 实际证据 | 继续补齐 L2/L3 前置并记录独立 PASS/FAIL/NOT RUN |

R01 已处理正文/推理分离、step 完整消息校准、turn 终态、连接错误和 listener 生命周期。R02 已处理历史与实时事件连续性、确认 cursor、订阅代次、背压、异步关闭释放及 Windows 管道验证。R03 已处理一个 turn 的多请求归属、并发幂等、持久回执、未知提交安全恢复、全局唯一 ID 和完成/取消竞态。R04 已完成自动化、跨语言和 Windows Named Pipe 验证：Protocol V3 固定提交材料，Agent scope 中注册工具，并从 durable turn 解析材料。当前开发入口是 R05；真实 profile 工具调用、可见 Tauri 窗口和完整进程重启仍由 R07 验收。

### 2.1 距离完整交互的剩余差距

下表是后续 Codex 判断任务是否真正完成的权威差距清单。代码存在、测试脚本存在或 UI 能显示静态状态，都不能单独关闭一项差距。

| 差距 | 当前缺失事实 | 关闭差距所需交付 | 证据门槛 |
|---|---|---|---|
| G01 会话绑定工具 | 自动化实现已完成，但尚无受支持 profile 中真实工具调用与 durable 结果记录 | R04 的实机 profile 验证 | 真实 ToolRuntime、跨语言和 Windows Pipe 自动测试；R07 真实 profile 中工具可见并留下日志 |
| G02 宿主交互 | Lens 尚不能可靠呈现和答复审批/ask-user | R05 的待办投影、答复 IPC、重复/过期/断线处理 | 未批准前执行体未调用；允许、拒绝和过期均与宿主日志一致 |
| G03 会话历史 | Lens 尚无经过验证的新建、切换、历史恢复和完整 Harness 入口 | R06 的 session.list、恢复投影、会话隔离和导航 | 双会话、重启、删除/失败恢复测试；Lens 与 Harness 历史一致 |
| G04 真实闭环 | `test:session:e2e` 与 `test:lens:e2e` 已是可失败运行器，但真实模型和可见窗口尚未执行 | R07 的 L2/L3 隔离 profile、真实模型和原生窗口证据 | 每一步 PASS/FAIL/NOT RUN；真实模型、Named Pipe、浏览器选区和截图分别记录 |
| G05 来源与交互品质 | 用户尚不能完整核对范围/来源，中文、可访问性和视觉状态未形成产品级基线 | R08.1/R08.2 的来源控制、设计系统、键盘/焦点和视觉基线 | 上下文/a11y/视觉测试及 Narrator、DPI、多屏人工证据 |
| G06 性能与人因 | “感知增强”尚无冻结方法和真人数据支持 | R08.3 的性能基线、代表任务、匿名数据和报告 | 本地指标可复现；真人结果含样本、限制和原始匿名数据 |
| G07 安装与发布 | 尚无干净环境安装、升级、卸载和同一候选 SHA 的发布证据 | R08.4/R08.5 的安装诊断、兼容矩阵和候选清单 | 干净 Windows smoke；所有报告和产物指向同一候选 SHA |

浏览器选区主路径关闭 G01～G04 后，才达到“可靠 Harness 交互闭环”。关闭 G05～G07 后，才达到本文所说的“可日常使用的产品”。T08 的额外应用 Provider 不在这两个必需门槛内，除非发布范围明确加入某个 Provider。

## 3. 执行顺序、责任与统一规则

| 编号 | 优先级 | 对应原任务 | 依赖 | 主要修改范围 | 当前状态 |
|---|---|---|---|---|---|
| R01 | P0 | T05-C | 基线 | Lens 事件投影与状态 | 自动检查通过待实测；见 `docs/evidence/r01-lens-session-projection.md` |
| R02 | P0 | T03 / T05-A | 基线；与 R01 协调事件类型 | TS/Rust 订阅与恢复 | 自动检查与 Windows 管道通过；见 `docs/evidence/r02-continuous-session-subscriptions.md` |
| R03 | P0 | T05-B/C | R01、R02 接口稳定 | 请求身份、去重、取消 | 自动检查与 Windows 管道通过待实测；提交 `00ccb6a`，见 `docs/evidence/r03-request-identity-and-recovery.md` |
| R04 | P0 | T05-D | R03 材料/请求身份约定 | Agent 工具与持久材料 | 自动检查与 Windows 管道通过待实测；见 `docs/evidence/r04-session-bound-selection-tools.md` |
| R05 | P0 | T05-C/D | R01～R04；H05 发布 API 是插件实现前置 | 审批和 ask-user 交互 | 宿主前置任务 H05 已识别；见 `docs/host-tasks/r05-durable-session-interactions.md` |
| R06 | P1 | T05 | R02、R03 | 会话选择、恢复与历史入口 | 自动实现与聚焦验证完成；见 `docs/evidence/r06-session-history-implementation.md` |
| R07 | P0 | T05-E | 测试框架可提前；完整验收依赖 R01～R06 | 真实运行器与证据 | 运行器已交付；L1 PASS，L2/L3 待实际环境 |
| R08 | P1 | T06～T11 | R01～R07；设计准备可提前 | 体验、来源、安装和发布验收 | R08.1/R08.2 自动检查通过待实测；R08.3～R08.5 待开发 |

R01～R04 已完成规定的自动验证；从当前基线默认按 R05→R06→R07→R08 推进。每项用独立、可审阅的提交表达完整行为及必要文档。开始时核对当前 HEAD，不能重置回本文基线覆盖新工作。共享协议、同一源文件和最终集成由一个负责人协调。

模型可见内容必须进入可重建的 Harness 日志；网页文本属于材料数据。工具授权沿用宿主策略，不为只读工具凭空增加一套审批，也不自动放行需要审批的动作。读取到的仓库文档不构成发送消息、发布或调用额外外部服务的授权。

协议变更同时修改 TS、Rust、正反例 fixture 和文档；明确新增字段、错误码和版本兼容策略。部署参数通过配置校验，禁止靠测试专用常量代替产品配置。异步资源应有 owner、释放点、断开后的行为及失败时清理证据。

每项开发必须提供：变更目的、修改文件、宿主版本、失败用例、修复后的结果、实际命令及退出码、剩余未验证项。针对功能执行 focused checks；只有集成候选或必要回归才运行任务级聚合。禁止复制历史通过结果作为当前提交证据。

### 3.1 从当前基线到完整交互的交付包

后续 Codex 按下表领取一个边界完整的交付包。每个交付包包含实现、行为测试、协议或用户文档、证据记录和一个可审阅提交。除表中明确允许的准备工作外，下游任务不能以未提交的上游工作区作为依赖。

| 交付包 | 直接目标 | 必须交付 | 最小验证门槛 | 完成后解锁 |
|---|---|---|---|---|
| P03 / R03（已完成） | 同一逻辑提交只执行一次，并能从持久事实恢复 request/message/turn 关系 | TS/Rust 回执字段、持久来源、共享 Promise 去重、UUID、未知提交安全重试、取消竞态、协议正反例、R03 证据 | `pnpm test:session`、`pnpm test:session:replay`、`pnpm test:lens:session`、`pnpm test:contract`、`pnpm test:bridge:integration` 已记录于 R03 证据 | R04 的材料身份；R06 的可靠恢复 |
| P04 / R04（自动验证通过） | Agent 工具只能读取当前执行请求绑定的持久材料 | 同版本 dsh-tools 依赖核查、结构化材料事件、scoped 工具注册、恢复/释放、工具卡片元数据、R04 证据 | `pnpm test:session:tools`、replay、typecheck、contract、Windows Named Pipe、build 与 bundle 检查 | R05 工具审批；R07 工具真实闭环 |
| P05 / R05 | Lens 能准确呈现并处理宿主审批与 ask-user 待办 | 先完成并发布 H05 durable interaction seam；再交付能力矩阵、IPC、TS/Rust fixture、决策 UI、重复/过期/断线处理、R05 证据 | H05 focused tests；发布后新增 `pnpm test:session:interaction` 并运行 tools、lens:session、protocol | R07 审批真实闭环 |
| P06 / R06 | 用户能选择、恢复和核对同一 Harness 会话历史 | session.list 接线、新建/切换/恢复、日志重建、草稿/材料隔离、经验证的完整会话入口、R06 证据 | 新增 `pnpm test:session:history`，并运行 replay、lens:session | R07 重启与历史验收 |
| P07 / R07 | 用真实 dsh profile 和模型证明端到端闭环 | 可失败 e2e 运行器、隔离 DSH_HOME、前置检测、超时清理、真实日志断言、截图/录屏索引、R07 报告 | 运行器自身测试、`pnpm test:session:e2e`、`pnpm check:task5`；真实前置缺失时退出 2 并列出 NOT RUN | “可靠 Harness 交互闭环”里程碑 |
| P08-A / T06 | 用户可控制材料范围并核查回答来源 | 授权范围、revision 校验、预算/截断、来源 UI、安全渲染、失败降级 | 新增 `pnpm test:context-expansion`，并更新 replay | 可信的上下文扩展 |
| P08-B / T07 | 完成中文、本地化、可访问性、设计系统与视觉状态 | 类型化设计变量、双主题、键盘/焦点、稳定滚动、响应式布局、错误/空/审批状态视觉基线 | 新增 `pnpm test:ui:a11y`、`pnpm test:ui:visual`，运行 Lens 原生 e2e；人工核查 Narrator、DPI、多屏 | 可日常使用的 Lens 界面 |
| P08-C / T09 | 证明本地响应性能与被测场景中的“感知增强”效果 | 冻结的评估方法、性能基线、匿名任务数据、正确率/耗时/误触/负荷报告 | 新增 `pnpm test:perf`、`pnpm test:human-factors:fixtures`、`pnpm report:human-factors` | 有限范围的人因结论 |
| P08-D / T10 | 在干净 Windows 环境完成安装、诊断、升级和卸载 | 安装产物、profile 版本核查、可操作诊断、数据保留/清理规则、安装证据 | 新增 `pnpm test:installer`，执行隔离环境 smoke | 发布候选 |
| P08-E / T11 | 用同一候选 SHA 汇总发布证据 | 兼容矩阵、已知限制、测试报告、证据索引、发布候选清单 | 新增 `pnpm check:release`；所有必需证据指向同一候选 SHA | 用户授权后的发布操作 |

T08 的 Word、PDF 或其他应用 Provider 是可选并行包。只有用户明确选择目标应用、测试环境和支持范围后才进入首个发布候选；未完成的可选 Provider 不阻塞浏览器闭环，也不能写入支持列表。

### 3.2 单个交付包的 Codex 执行规则

1. 开始前读取当前 `git status`、HEAD、目标章节、相关源码和测试，确认前置任务的证据提交可达；保留用户已有修改。
2. 先用最小失败用例固定用户可观察行为或跨进程事实，再实现修复。纯类型边界可先写契约 fixture；不能用与实现同源的常量比较代替行为测试。
3. 修改范围限于该交付包及其必需接口。发现上游 Harness 缺口时，记录准确版本、API 位置、复现用例和最小宿主改动；不能用插件侧猜测或第二套状态源绕过。
4. 协议变化在同一提交更新 TS、Rust、有效 fixture、无效 fixture、路由、调用方和文档。新增模型可见材料时必须提供 Harness 日志重建测试。
5. 运行本章节列出的 focused checks。命令失败时先区分产品断言、工具链、环境前置和真实外部服务；不得吞掉失败或把 SKIP 记录为 PASS。
6. 在 `docs/evidence/` 写本任务证据，记录工作目录、HEAD、未提交状态、工具版本、命令、退出码、测试数量和证据等级。截图必须来自实际运行的软件，并附对应 SHA、场景和窗口/DPI 条件。
7. 更新本文件和根任务书的状态。状态只能从“开发中”进入“自动检查通过待实测”或“已验收”；缺少真实模型、Windows UI 或真人证据时保留对应 NOT RUN。
8. 提交前执行 `git diff --check` 并审阅完整差异。推送后比较本地 HEAD 与远端分支 SHA；交接写明下一交付包和仍未满足的前置条件。

每次结束向用户或下一位 Codex 输出：完成的行为、修改文件、接口变化、实际命令和退出码、自动/Windows/真实模型/人工证据等级、未验证项、证据路径、提交 SHA 和下一任务。不得只写“测试通过”或“任务完成”。

### 3.3 跨任务身份与数据契约

R04～R07 必须复用下表中的身份关系。若实际 Harness API 使用不同名字，可在适配层映射，但不能省略语义或让客户端猜测。

| 身份/数据 | 权威来源 | 使用任务 | 不变量 |
|---|---|---|---|
| `sessionId` | Harness session | R04～R07 | 所有材料、请求、交互和历史查询都限定到同一 session scope |
| `requestId` | Lens 首次提交前生成，Harness 持久确认 | R04～R07 | 重试复用；与提交内容和 delivery mode 冲突时拒绝 |
| `messageId`、`turnId`、`stepId` | Harness 日志 | R04～R07 | 只依据持久事件建立关系；一个 turn 可关联多个 request |
| `snapshotId`、`revision`、`documentId` | Selection Provider 捕获事实 | R04、R06、R08.1 | 材料不可因全局新选区变化；扩展前校验文档与修订 |
| `authorizedScope`、`actualScope`、`completeness` | 用户提交与 Provider 结果 | R04、R08.1 | 工具不得读取超出授权范围的内容；截断和缺失必须显式 |
| `interactionId` | Harness interaction/approval 服务 | R05、R07 | 答复幂等且受 session 和宿主权限约束；客户端不自造状态 |
| `subscriptionId`、`generation`、`cursor` | Bridge 与已投影持久事件 | R06、R07 | 旧代事件不得污染新订阅；只有确认投影的持久 seq 推进 cursor |

协议中新增必需字段或改变语义时使用新的显式协议版本；不要在旧版本下静默改变严格 fixture。版本升级必须在一个交付包内同步 TS schema、Rust enum/struct、有效与无效 fixture、Native 调用方、服务器路由和协议文档，并重新运行契约及 Windows Named Pipe 检查。

### 3.4 每个交付包的固定执行阶段

后续 Codex 对 R04～R08 的每个独立交付包都按以下阶段推进，并在证据文档中逐项勾选。

1. **基线确认：** 记录工作树、HEAD、远端分支、Harness/依赖版本和本任务前置证据；发现用户未提交修改时保留并避开冲突。
2. **API 核查：** 读取实际安装版本的类型、运行时代码和 profile 配置；将可用能力、缺口和拟采用的扩展点写进任务证据。
3. **失败用例：** 先添加能在修改前失败的最小行为测试或跨语言 fixture；记录失败原因，确认它对应用户可观察问题。
4. **最小实现：** 只修改本任务拥有的模块及必需接口；持久事实由 Harness 管理，Native 只做采集、IPC 和呈现。
5. **负路径：** 补齐跨 session、重试、取消、断线、重启、越权、恶意材料和资源释放场景中与本任务相关的部分。
6. **Focused checks：** 运行本章节命令并记录退出码；协议或 Rust bridge 变化时追加契约与 Named Pipe 集成测试。
7. **产品证据：** 若任务要求真实 profile、原生窗口、模型或人工核查，实际执行并绑定 SHA；前置缺失则标记 NOT RUN。
8. **交接与同步：** 更新证据、任务状态和用户文档，审查 diff，提交并按已有授权推送；比较本地与远端 SHA 后写下一任务入口。

## 4. R01：回答投影与请求状态

### 目标与边界

让 Lens 正确呈现一个请求的正文、执行阶段和终态。范围是 `native/src/App.tsx`、`native/src/api/bridge.ts`、抽取后的状态/投影模块及必要的 TS 事件字段。此项不完成工具审批、不重写采集 Provider、不添加独立模型客户端。

### 实现步骤

1. 阅读已安装 LLM `StreamChunk`、SessionEvent 和结束原因定义，建立类型化事件适配；记录未知宿主事件的可观测处理方式。
2. 从组件抽取纯投影逻辑，输入包含会话、请求、turn、step、block、序号及连接代次等实际可获得字段；缺失字段通过上游协议补齐，禁止从相邻消息猜测。
3. 仅将 text-delta 追加为正文；reasoning-delta 不混入正文，工具参数不作为答案文字。用 step/block 标识区分多个回答片段。
4. assistant/message 用于校准该 step 的完整内容，支持没有先前 delta 的恢复场景；不得把整条消息重复追加到已显示 delta 后面。
5. 请求终态以关联的宿主结束事实为准；工具调用后的 assistant message 不能提前结束整个请求。结束原因按目标版本显式映射。
6. 状态至少表达 idle、submitting、queued、streaming、cancelling、completed、cancelled、error、connection-lost、submission-unknown；审批状态由 R05 补齐。终态是否允许日志校准与迟到片段的处理需分别定义。
7. 将连接错误与请求事件分开处理；session 级连接错误无需伪造 requestId。注册 Tauri listener 完成后才开始依赖它的订阅，处理组件先卸载、listen Promise 后返回时的释放。
8. 产品文案进入类型化字典；状态转换通过适量 aria-live 播报，正文每个 token 不触发播报。保留用户草稿和固定材料。

### 测试与验收

新增 `pnpm test:lens:session`，必须覆盖：正文/推理混合流、多 step 工具循环、正常完成与用户取消区别、纯完整消息恢复、重复片段、错误缺少 requestId、旧 session 事件、listen 延迟及卸载。真实宿主类型作为 fixture 依据，禁止使用不存在的 chunk 类型掩盖适配问题。

```powershell
# 新增后执行
pnpm test:lens:session
# 已存在
pnpm --dir native test
pnpm --dir native build
```

完成标准：每种终态有测试；正常回答不会显示为取消；恢复后的正文与完整持久消息一致；旧事件和推理片段不能污染正文。用例中至少证明当前已知错误在修复前会失败。

### 给 Codex 的提示词

```text
执行 docs/harness-integration-development-plan.md 的 R01。先核对目标 Harness 的 StreamChunk、step 和 turn/end 类型，修复 Lens 完成/取消误判、推理混入正文、缺失 requestId 的连接错误被忽略以及完整消息无法恢复的问题。抽取可测试的纯状态投影，保留草稿和固定材料，处理 listener 的异步注册与卸载。添加 test:lens:session，覆盖真实事件类型和异常顺序；运行该命令、Native UI 回归和构建。报告证据及仍依赖 R02/R03 的行为，不将通过 UI 单测描述为真实模型闭环。
```

## 5. R02：连续订阅、恢复与资源释放

### 目标与边界

保证历史回放与实时事件连续，重连可恢复，关闭不会泄漏。修改 `src/session/service.ts`、`src/bridge/server.ts`、`native/src-tauri/src/bridge.rs` 及前端订阅适配。保持请求/响应和事件管道的读取权明确。

### 实现步骤

1. 优先使用宿主原子快照/订阅能力；若不存在，先注册实时监听并缓冲，再读取持久及活跃 session 事件，记录一致性高水位，按 seq 合并并去重。必须验证存储刷新滞后，不可假定 readSession 已包含全部 live events。
2. 只有本地投影成功接收的持久事件 seq 才可成为恢复 cursor；非持久状态提示不得推进持久游标。若会话身份或历史世代改变，游标不能复用。
3. `session.subscribed` 必须先于此次订阅的回放；前端按 subscription generation 忽略旧连接的事件。明确顺序、重复事件、缺号和非法 cursor 的处理。
4. 缓冲和写队列配置上限并实现背压；超出上限显式断开并提供从确认游标恢复的路径，不静默丢事件。
5. 记录 socket closed 状态；异步 subscribe 在 close 后返回时立即释放 disposer，不再加入已失效集合。回放失败或监听建立失败也必须释放已注册监听。
6. Native 订阅替换、连接关闭与任务完成使用同一生命周期约束；旧任务中止、已完成句柄移除、并发 disconnect 不得遗留新 reader。必要时提供独立 unsubscribe 命令。
7. 审查服务器 idle timeout 与长时间模型等待的关系，选定心跳或订阅专用空闲策略。心跳帧只能由该订阅的唯一 reader 分派，不能与流抢读。
8. 主动断开、意外断线和采集暂停各自有明确语义；恢复不自动重发状态未知的 prompt。

### 测试与验收

扩展 `pnpm test:session:transport` 和 `pnpm test:session:replay`：快照 await 期间插入事件、存储落后、重复/缺号 seq、历史起点 cursor、两个 session、订阅确认顺序、close 早于 subscribe 返回、订阅替换、超过 idle 时长的模型等待、半帧及背压超限。

完善已存在的 `pnpm test:bridge:integration`：使用真实 Node 服务及 Rust 客户端跨 Windows Named Pipe 交换至少 100 个确定性事件，期间同时 ping/提交请求；验证帧顺序、关闭后客户端数及监听数回落、无悬挂。该命令当前能力须先检查，不能仅因脚本存在就记为通过。

```powershell
pnpm test:session:transport
pnpm test:session:replay
pnpm test:bridge
pnpm --dir native build
pnpm test:rust
pnpm test:bridge:integration
```

完成标准：恢复后的 seq 和投影与连续运行基准一致；正常关闭与故障关闭均释放资源；100 事件实机证据注明 Windows、Node、Rust 版本和 SHA。TCP 替代测试保留作为快速回归，但不能承担管道验收。

### 给 Codex 的提示词

```text
执行 R02，消除读取历史后才注册监听的漏事件窗口，并覆盖存储刷新落后于活跃 session 的情况。实现确认 cursor、订阅代次、去重、背压和异步关闭释放；审查 Rust 独立 reader、替换和 disconnect 竞态。为长时间无事件等待明确空闲策略。补齐 TCP focused tests 与真实 Windows Rust↔Node Named Pipe 测试，连续发送至少 100 个事件并同时执行请求。逐项报告自动与实机证据；遇到环境限制时写明未验证，不用 TCP PASS 替代管道 PASS。
```

## 6. R03：请求身份、并发幂等与取消

### 目标与边界

同一逻辑提交只执行一次，多个请求能准确关联实际执行，取消和重试不影响其他请求。范围包含提交 API、持久来源、RequestTurnTracker、Native ID 生成和 Lens 提交控制。

### 实现步骤

1. 使用不依赖毫秒时间唯一性的 ID，区分 transport id、逻辑 request id、message id、turn/step 和 subscription id。逻辑 request id 在第一次发送之前生成，重试复用同一值。
2. 明确幂等作用域、期限、内容一致性和重启语义。在第一个 await 前保留 in-flight 记录或共享 Promise；相同 ID/相同内容返回同一结果，不同内容或错误 session 明确冲突。
3. 回执需关联 request、宿主 message 和接受状态。只有队列事实时不能承诺已持久化或已完成；核对宿主 checkpoint 与 inbox 事件的实际保证。
4. UI 同步锁住重复触发，覆盖双击和 Enter；首次创建 session 的并发动作不能各自生成意外会话。是否允许用户主动排队需产品规则明确，不能用隐藏丢弃替代队列。
5. 调查同 turn 批量输入和 steer 中途加入的语义，表达一对多/多对一关联或明确限制插件提交方式。不能继续用 Map<turn, single request> 覆盖旧身份；单输入在某 turn 出现不代表输出只响应该输入。
6. 消息进入、取消未运行 inbox、正常执行结束分别从日志中识别；read/replay 不应从“下一条回答”推断归属。
7. 取消动作先进入 cancelling，收到宿主事实后终结；处理完成先于取消响应、取消失败、排队请求被清理以及迟到 token。现有 session.cancel 是会话级操作，UI 必须体现实际影响，不能称为单请求取消。
8. 发送后断线进入 submission-unknown，提供查询/恢复；仅在有可核查幂等保证时重发。重启后没有去重证据时不自动创建新请求替代原请求。

### 测试与验收

扩展 `pnpm test:session`、`pnpm test:session:replay`、R01 的 `pnpm test:lens:session`：Promise.all 并发同 ID、内容冲突、同时间 ID、双 session、多个输入同 turn、steer、queued cancellation、完成/取消竞态、提交写出后断线、重启、TTL 到期。

```powershell
pnpm test:session
pnpm test:session:replay
pnpm test:lens:session
pnpm test:protocol
```

完成标准：重复操作不会增加实际提交次数；未知结果不会诱发无依据重发；日志回放给出相同请求执行事实；取消后不会由旧事件重新切回 streaming。

### 给 Codex 的提示词

```text
执行 R03，先写清 request/message/turn 的真实映射及 queue/steer/取消语义。修复毫秒 ID、跨 await 的幂等窗口和单 turn 关联覆盖；补齐提交前 UI 同步锁、未知提交状态及安全恢复。不要将会话级取消呈现为只取消当前请求。用并发、批量同 turn、steer、取消/完成竞态和重启回放测试证明行为，运行 session、replay、lens:session、protocol 检查。若宿主存在具体缺口，以同版本 API 和失败用例证明后再提出独立宿主修改。
```

## 7. R04：会话绑定材料与选区工具

### 目标与边界

将 `selection_current`、`selection_read_context` 注册到正确 Agent scope，工具读取用户已经提交并持久化的材料。此项只读取已授权、已保存的范围；页面重新抓取和扩大范围属于 R08/T06。

### 预计修改面与禁止范围

- 依赖与装配：`package.json`、`pnpm-lock.yaml`、`src/index.ts`、`cordis.patch.yml`。
- 材料和工具：`src/session/` 下的持久材料适配、工具定义及其测试；需要时新增独立模块，避免继续扩大单个 service 文件。
- 跨进程契约：仅在结构化材料无法通过现有 V2 表达时修改 `src/bridge/`、`native/src-tauri/src/protocol.rs`、`native/src/api/bridge.ts` 和共享 fixture；必需字段变化必须升级协议版本。
- UI：只接入提交时的结构化材料和工具结果卡片所需字段；不在 R04 实现审批决策、历史选择、全文扩展或整体视觉重构。
- Harness 仓库：默认不修改。只有同版本发布 API 的可复现缺口阻止正确作用域或日志时，才另建边界清晰的宿主任务。

### 实现步骤

1. 安装/检查与目标 runtime 一致的 dsh-tools 开发依赖和 peer 声明，核对其导出、defineTool、执行身份、输出、策略钩子和 profile 装配。仓库源码只能辅助理解，实际依赖版本必须编译和加载验证。
2. 使用 create/resume 的 setup(agentCtx) 在发布 Agent 之前完成注册，并验证异常时回滚。优先复用 register 自带 effect/disposer 机制，避免重复注册和手工全局表。
3. 在提交协议中传递结构化不可变材料：snapshot id、revision、文本、来源、采集时间、实际授权范围、完整度，以及与 request/message 的关联。不能从拼接后的英文 prompt 反向解析完整快照。
4. 明确权威存储：Harness 持久来源/事件保存重建所需数据；Native 缓存仅提供临时预览。新增事件必须符合目标版本 reader、模型可见日志及未知事件策略。
5. 一个 session 可能有多个请求材料：工具必须选择实际正在执行的 request/turn 所绑定材料，不能读取最后一次提交或全局当前选区。无法确定时返回明确不可用或要求显式材料标识。
6. 工具参数只允许访问本 scope 中的材料，不能靠传入 sessionId 跨会话读取。读取上下文不能超出提交时范围；过期临时缓存不应让已持久材料消失。
7. 按同版本 defineTool 输出要求返回规范值，模型文本和 UI 卡片分别呈现；卡片显示来源、范围及截断信息。执行经过宿主策略和日志路径，取消信号随调用传播。
8. 恢复 Agent 时从日志恢复绑定并重新注册，处置 Agent 时工具随 scope 释放。更新 README、工具文档及必要的决策记录。

建议拆成四个可审阅增量：先完成同版本 API 探针和依赖装配；再定义材料模型与持久事件；随后注册工具并接入策略/日志；最后补齐 Native 提交、恢复和结果呈现。每个增量都应编译，但 R04 只有四部分组合通过后才完成。

### 测试与验收

新增 `pnpm test:session:tools`，至少一组测试运行真实 ToolRuntime/Agent scope，不能全部使用返回固定结果的 mock。覆盖两个 session 同名工具隔离、同 session 排队材料隔离、删除临时缓存后恢复、缺失材料、拒绝扩大范围、恶意网页指令、策略拒绝、取消、结果日志及 scope dispose。

| 增量 | 目的与实现 | 该增量的验证 |
|---|---|---|
| R04-I1 API/依赖 | 安装精确 rc.2 包，编译最小 Agent setup/ToolRuntime 探针，记录 profile 装配 | `pnpm typecheck`、`pnpm build`；探针无法装载时保留错误和版本 |
| R04-I2 材料持久化 | 定义结构化材料与 request/message 关系，升级需要的协议并写入 Harness 日志 | `pnpm test:protocol`、`pnpm test:session`、`pnpm test:session:replay`；协议变化追加 `pnpm test:contract` 与 Named Pipe |
| R04-I3 作用域工具 | 在 Agent setup 注册、执行、记录、取消和 dispose 两个工具 | 新增 `pnpm test:session:tools`，使用真实 runtime 覆盖双 session、排队和恢复 |
| R04-I4 Native/产物 | 提交结构化材料，呈现来源/截断卡片，验证 bundle 装配 | `pnpm test:lens:session`、`pnpm --dir native build`、`pnpm verify:bundle` |
| R04-I5 真实可见性 | 在支持 profile 中确认工具名称、调用、结果及日志 | R07 运行器或独立实机步骤；未执行时 R04 状态写“自动验证通过待实测” |

```powershell
# 新增后执行
pnpm test:session:tools
# 已存在
pnpm test:session:replay
pnpm typecheck
pnpm build
pnpm verify:bundle
```

完成标准：在真实支持的 dsh profile 中能看到工具且只能读取绑定材料；另一个 session 和新选区不改变返回值；工具结果可从宿主日志重建。同版本接口适配验证失败才可标记具体阻塞，不能沿用旧文档的笼统“宿主缺少工具能力”。

**2026-09-08 自动验证状态。** R04 已安装同版本 `@deepseek-ai/dsh-tools@0.1.1-rc.2`，把严格 V3 `material` 写入 durable 用户消息，在 create/resume 的 `setup` 注册 `selection_current` 和 `selection_read_context`，并让 Native 重试保留同一快照。`test:session:tools` 使用真实 ToolRuntime 和 Agent scope 覆盖隔离、缺失材料、策略拒绝、取消和 dispose；Protocol、session、replay、Lens、Rust、bundle 和实际 Windows Node/Rust Named Pipe 检查均已通过。受支持 dsh profile 的真实工具调用、模型、可见 Tauri 窗口和进程重启尚未运行，因此 R04 状态保持“自动检查与 Windows 管道通过待实测”；完整命令和限制见 R04 证据。

### 给 Codex 的提示词

```text
执行 R04。先验证 @deepseek-ai/dsh-tools 与目标 dsh 同版本的发布包、Agent setup 和 profile 装配；不要沿用旧的不存在工具 API 的结论。实现 session/request 绑定的结构化持久材料，并通过 scoped ToolRuntime 注册 selection_current、selection_read_context。禁止读取全局当前选区或解析提示词恢复快照。接入宿主执行策略、输出日志和生命周期，补齐真实 runtime 的隔离、恢复、授权范围及 dispose 测试。添加 test:session:tools，运行相关回放和打包检查，报告是否需要任何实际宿主改动及证据。
```

## 8. R05：审批、追问和宿主交互

### 目标与边界

当 Harness 等待用户决定时，Lens 能呈现并提交决定。沿用宿主的交互 ID、权限、生命周期和日志，不建立另一套审批状态源。

**2026-09-08 API 核查结果。** 发布运行时 `0.1.1-rc.2` 的 approval 和 user-questions 均不提供可恢复 pending interaction、公开 response id、待办查询或原子答复；后者还限制为单 provider。插件不能诚实完成 R05，先执行并发布 [H05：会话持久交互宿主能力](host-tasks/r05-durable-session-interactions.md)。详见 [API 审计](evidence/r05-host-api-audit.md) 与 [决策记录](decisions/2026-09-08-r05-requires-host-owned-interactions.md)。

### 预计修改面与禁止范围

- 宿主能力：H05 在 DeepSeek Harness 仓库新增并发布 session-owned interaction seam；插件不得复制宿主权限判断。
- 插件适配：仅在 H05 发布并装配到目标 profile 后，新增 `src/session/` 交互投影/答复模块或在现有 service 中加入很薄的适配。
- 协议与 Native：`src/bridge/protocol.ts`、router/server、Rust protocol/bridge、`native/src/api/bridge.ts` 及 fixture。
- Lens：`native/src/App.tsx`、投影模块、类型化文案和交互测试；复杂组件可拆分到 `native/src/components/`。
- 不在 R05 新增独立审批数据库、自动批准策略、额外网页权限、会话历史页或模型调用路径。

### 实现步骤

1. 按 H05 任务书实现 stable interactionId、durable pending/terminal event、session query、原子答复、取消/expiry 和 restart 语义；先完成宿主失败用例与发布。
2. 核对发布 H05 的实际服务、事件、权限和 profile 装配，建立 plugin consumption probe；本机主仓库较高版本源码不代替发布证据。
3. 为读待办和提交答复增加已验证的 IPC 消息，带 session、interaction identity 和关联事实；不凭客户端传值宣称授权。两端严格校验并增加共享 fixture。
4. Lens 显示请求目的、作用范围、必要的工具参数和可选答案；提交结果前保持 submitting-decision，成功后依据宿主状态更新。输入应支持中文和键盘。
5. 客户端能力不足时提供真实可用的完整 Harness 交互入口并说明等待原因；不能将待审批显示为卡死、已执行或已完成。
6. 处理重复答复、答复途中断线、另一客户端已答复、interaction 过期、工具取消、会话切换及重启恢复。
7. 关闭 Lens 不自动同意/拒绝；按宿主策略结束或保留待办。隐私敏感参数只展示决策所需内容，不写入普通诊断日志。

实现顺序为：H05 失败探针与发布 → plugin consumption probe → 待办只读投影 → 幂等答复命令 → Lens 决策组件 → 断线/过期/另一客户端竞态。只读投影通过不能视为“审批已完成”，必须证明决策确实改变宿主待办并控制执行体。

### 测试与验收

新增 `pnpm test:session:interaction`，联合 R01/R04 用例覆盖允许、拒绝、过期、重复答复、其他客户端抢先处理、ask-user、取消及未授权跨会话答复。断言未同意前执行体没有被调用；宿主策略原本允许的读取不应被额外审批阻断。

| 增量 | 目的与实现 | 该增量的验证 |
|---|---|---|
| R05-I1 能力核查 | 用实际 rc.2 类型和运行时确认待办读取、答复、权限和事件 | 编译/运行最小探针；证据记录可用/缺失 API，不以文档名称代替 |
| R05-I2 交互契约 | 增加只读投影与幂等答复 IPC，TS/Rust 严格校验身份 | `pnpm test:protocol`、Rust fixture/contract；协议变化追加 Named Pipe 集成 |
| R05-I3 Lens 决策 | 呈现工具目的、范围、参数和 ask-user 选项，支持键盘/中文 | `pnpm test:lens:session`，覆盖焦点、提交中、错误和会话切换 |
| R05-I4 竞态恢复 | 处理重复、过期、断线、另一客户端和重启后的权威状态 | 新增 `pnpm test:session:interaction`，断言执行次数和最终日志 |
| R05-I5 真实审批 | 从实际 profile 触发需审批工具并完成允许/拒绝 | R07 真实 e2e；缺少该证据时不得写“完整审批闭环” |

```powershell
pnpm test:session:interaction
pnpm test:session:tools
pnpm test:lens:session
pnpm test:protocol
```

完成标准：用户可以从 Lens 或验证过的完整 Harness 入口处理真实待办；答复只执行一次，拒绝不会触发工具执行，重启后状态与宿主一致。

### 给 Codex 的提示词

```text
执行 R05，先核对目标版本的宿主审批和 ask-user API，再实现待办投影与答复 IPC。沿用宿主身份、授权和状态；不要维护独立审批数据库。补齐重复/过期/断线/另一客户端已答复和取消场景，不能绕过宿主策略或对所有只读动作新增强制审批。添加 test:session:interaction，并运行工具、Lens 和协议回归；交付实际可操作的 UI 或已验证的完整 Harness 入口。
```

## 9. R06：会话选择、历史与恢复

### 目标与边界

用户能够新建、选择和恢复会话，在 Lens 与完整 Harness 界面核对同一历史。宿主日志是历史唯一权威；本地保存当前会话、确认游标、草稿等恢复元数据，不建立第二套对话记录。

### 预计修改面与禁止范围

- 查询与恢复：`src/session/service.ts`、需要时新增 projection/history 适配；复用 session-query，不在插件中复制 SessionStore。
- IPC：现有 `session.list` 路由及必要的 create/select/open 命令，连同 TS/Rust/Native 类型和测试 fixture。
- Lens：会话选择器、空态/恢复态、草稿归属和经过验证的完整 Harness 入口。
- 本地持久化只允许保存恢复元数据；不得将回答正文另存为第二份权威历史，也不得把恢复失败自动掩盖为新会话。

### 实现步骤

1. 接通已有 session.list，显示标题/时间/状态，并为尚不可获得的字段定义真实降级；提供新建和切换操作。
2. 核对宿主实际支持的完整会话 URL/导航接口，在测试中验证打开目标身份；不得凭猜测构造路径，也不得在 URL 中拼接选区正文或凭据。
3. 重载时恢复会话身份并从日志构建投影；历史通过有界页面读取，每页返回原始日志高水位，Native 从该高水位续订。只保存 cursor 不保存投影时不能跳过重建所需历史，需保持历史与 cursor 的一致性。
4. 草稿和固定材料按 session/request 归属；切换会话中止或忽略旧订阅，但不默认取消宿主任务。
5. 处理会话删除、无法恢复、当前模型不可用、profile 变化、旧日志版本和重启后待审批；显示明确下一步。

实现顺序为：日志投影一致性测试 → session.list/create/select → 重载恢复 → 完整 Harness 导航 → 删除、版本和 profile 失败路径。R06 不等待 R05 才能开发基础选择器，但带待办的重启恢复验收必须使用已合入的 R05 身份契约。

### 测试与验收

`pnpm test:session:history` 覆盖历史投影、分页读取、冷 session 不 resume、列表状态、无效游标和订阅恢复；Native 的 `pnpm test:lens:session` 覆盖历史合并、命令转发、选择切换、旧代事件隔离和失败状态。双 session 删除、完整 Harness 导航、真实重载和待审批恢复仍归 R07/H05 的实机验收。

| 增量 | 目的与实现 | 该增量的验证 |
|---|---|---|
| R06-I1 历史投影 | 从宿主日志重建 Lens 状态并与连续投影比较 | `pnpm test:session:replay`，覆盖完整历史、cursor 和缺失/重复事件 |
| R06-I2 会话操作 | 接通 list/create/select，按 session 隔离订阅、草稿和材料 | 新增 `pnpm test:session:history`，覆盖双 session 快速切换和旧事件 |
| R06-I3 重载恢复 | 持久化最小恢复元数据，重启后先重建再续订 | history/replay 测试覆盖进程级缓存清空、删除和恢复失败 |
| R06-I4 完整入口 | 使用实际支持的导航能力打开同一 Harness 会话 | 自动验证目标 identity/URL；实际窗口步骤确认打开内容与 Lens 一致 |
| R06-I5 交互状态 | 恢复等待审批、模型不可用和 profile 变化 | 联合 `pnpm test:session:interaction` 与 `pnpm test:lens:session` |

```powershell
pnpm test:session:history
pnpm test:session:replay
pnpm test:lens:session
pnpm test:contract
pnpm test:bridge:integration
```

这些命令证明插件内的历史投影、分页协议、Native 命令和 Windows 管道行为。产品级完成标准仍要求真实 profile 重载后看到原会话的正确材料与回答，并在完整 Harness 历史中核对一致；恢复失败不会静默新建另一个会话替代。

### 给 Codex 的提示词

```text
执行 R06，在 Lens 接通 session.list、新建、选择、恢复和完整 Harness 历史入口。先核对实际导航 API；宿主日志是唯一历史来源。本地恢复元数据必须与日志重建/确认 cursor 一致，不能只恢复游标导致空白历史。覆盖双会话、草稿和材料隔离、删除、重载、待审批及失败恢复，新增 test:session:history 并运行 replay 和 Lens 回归。
```

## 10. R07：真实测试运行器与闭环证据

### 目标与边界

将 `scripts/test-session-e2e.mjs` 和 `scripts/test-lens-e2e.mjs` 的占位退出行为替换为可执行、可失败的真实测试。把前置条件检测、无密钥集成、真实模型调用和人工交互证据区分清楚。当前实现已经提供 L1 profile smoke 和 L3 驱动协议；真实模型及真实窗口仍需实际执行。运行器的固定取舍见 [R07 decision](decisions/2026-09-08-r07-layered-runners.md)，执行结果见 [R07 evidence](evidence/r07-session-e2e.md)。

### 预计修改面与禁止范围

- 运行器：`scripts/test-session-e2e.mjs`、`scripts/test-lens-e2e.mjs`、必要的 helper 和固定非敏感网页 fixture。
- 聚合与配置：`package.json`、受支持的测试 profile/patch、证据目录及 README；配置不得写入真实密钥。
- 产品代码只允许修复运行器暴露的真实缺陷；不要在 e2e 脚本内重实现 session、ToolRuntime、审批或日志逻辑来制造通过。
- 不得使用直接调用内部函数的方式代替受支持的 `dsh --profile` 应用启动，不得把 mock provider 的成功写成真实 DeepSeek 模型 PASS。

### 实现步骤

1. 检查 Windows、Node/pnpm/Rust、目标 dsh、模型配置和必要应用版本。记录是否可用，不输出凭据值。退出 0 表示所选范围完整通过，1 表示失败，2 表示实际前置缺失/未验证，并说明缺失项。
2. 使用唯一隔离 DSH_HOME、管道名和端口；打包并通过受支持的 dsh profile 安装插件，禁止绕过产品启动方式运行假 Agent。只清理由运行器创建并验证绝对路径的目录及进程。
3. 使用非敏感、可复现的本地网页 fixture。自动生成回答测试可以使用受控 provider 进行无密钥回归，但必须标明模拟模型；真实模型路径必须使用显式配置的 provider。
4. 执行真实模型请求并等待对应日志终态；验证真实正文存在、材料确实进入日志、追问继续同一会话、工具读取绑定材料、需要审批时确实等待。
5. 验证停止、断线恢复、重复点击、历史读取、退出后重启恢复，并对照宿主持久记录。真实模型文本可能变化，断言身份、因果及结构事实，避免依赖固定逐字回答。
6. 将原生采集→Lens 与测试直接注入快照区分。注入快照可以覆盖 IPC 集成，但完整产品验收必须额外有真实浏览器选区和原生窗口证据。
7. 每个阶段设置超时和清理；日志保留 SHA、工具版本、步骤、退出码、脱敏事件摘要及截图/录屏路径。部分完成明确列出 PASS/FAIL/NOT RUN，不生成笼统 PASS。
8. 为运行器自身增加前置缺失、宿主启动失败、模型错误、超时清理及断言失败测试；配置齐全时仍退出 2 应被视为未实现缺陷。

运行器分三层交付：L1 无密钥进程/协议集成，L2 真实 profile 与模型会话，L3 浏览器选区和可见 Tauri 窗口。L1 使用本地确定性 OpenAI-compatible SSE，只验证隔离 profile、bundle 装配、插件启动输出和 durable session 文件，不能写成真实模型 PASS。L3 驱动必须报告真实 Tauri 窗口、Chrome/Edge 真实选区、必需状态和 PNG 截图；静态页面或直接注入被运行器拒绝。L1 可以在缺少 API key 时通过；R07 总体完成仍要求 L2/L3 的实际证据。三层使用相同候选 SHA，但分别记录环境、步骤和退出结果。

### 测试与验收

| 层级/增量 | 目的与实现 | 验证与退出语义 |
|---|---|---|
| R07-I1 前置与清理 | 检测 Windows、dsh、profile、模型配置，分配隔离目录/pipe 并注册 finally 清理 | 运行器单测覆盖缺失、启动失败、超时和残留；缺实际前置退出 2 |
| R07-I2 L1 无密钥集成 | 以受支持进程入口验证 bundle、IPC、日志、重连和回放 | runner tests、`pnpm test:bridge:integration`；断言失败退出 1 |
| R07-I3 L2 真实会话 | 启动真实 profile/provider，验证回答、追问、工具、审批、停止和历史 | `pnpm test:session:e2e`；完整执行通过才退出 0，模型错误退出 1 |
| R07-I4 L3 原生交互 | 浏览器真实选区，经 Native/Tauri Lens 完成主流程并截图；驱动报告须包含 `application: tauri`、`realWindow: true`、`realSelection: true`、浏览器、状态、断言和 PNG 路径 | `pnpm test:lens:runner`、`pnpm test:lens:e2e` 加人工观察；静态网页或直接注入不能替代 |
| R07-I5 候选报告 | 汇总相同 SHA 下的日志、截图、版本、PASS/FAIL/NOT RUN | `pnpm check:task5` 和证据完整性检查；任何缺项保持对应状态未完成 |

```powershell
# 框架改完后，按实际运行范围执行
pnpm test:bridge:integration
pnpm test:session:e2e
pnpm test:lens:e2e
# R01～R06 集成候选执行一次，并更新聚合脚本纳入新增无密钥测试
pnpm check:task5
```

`test:lens:e2e` 与 `test:bridge:integration` 必须先确认是否仍有占位逻辑；当前两个入口均为可执行运行器，但只有实际执行对应路径才计为证据。没有凭据不阻塞开发运行器和无密钥负例，但不能标记真实模型或可见窗口验收通过。

完成标准：真实 Windows Node↔Rust 管道成功；真实模型会话成功；浏览器选区→回答→追问→工具/审批→停止→完整历史→重启回放各步骤有证据。任何跳过导致对应验收项保持未完成。

### 给 Codex 的提示词

```text
执行 R07，将 test:session:e2e 从无条件 exit 2 改成真正的运行器。使用隔离 DSH_HOME、打包 bundle 和受支持的 dsh profile，实际检测前置条件并记录 0/1/2 的区别。无密钥集成、真实模型与原生采集证据必须分开。实现超时清理与失败断言，验证请求、日志、工具、审批、取消、重连和重启回放。不要输出密钥，也不要用模拟返回证明真实模型通过。运行集成候选检查并给出逐步 PASS/FAIL/NOT RUN 报告。
```

## 11. R08：上下文、交互品质与产品交付

### 目标与边界

以 R01～R07 的可靠语义为基础，使用户看得懂材料范围、等待原因和下一步，并在真实 Windows 环境中稳定使用。此项按下列子项交付，原 T06～T11 保留完整约束；不把外观调整当成会话问题的修复。

| 子项 | 目的与实现方法 | 验证和完成标准 |
|---|---|---|
| R08.1 来源与范围（T06） | 显示来源、实际范围和截断；按需请求 local/section/page 并校验 snapshot/revision/document；扩展内容及授权事实持久化 | 新增 test:context-expansion；页面切换、Unicode 截断、范围越权、缺失来源和失败降级都有负例；预览与实际模型输入一致 |
| R08.2 界面与可访问性（T07） | 类型化 locale 字典（仅管理界面文案，不提供翻译产品动作）、双主题设计变量、完整状态组件；稳定滚动、可见焦点、低干扰播报、减少动画；长答案和来源可展开 | 新增 test:ui:a11y、test:ui:visual；固定截图环境并人工审阅；中文 IME、Narrator、125%/200% DPI、多屏和窄窗口完成核心流程 |
| R08.3 性能与人因（T09） | 分别度量本地操作反馈、首字时间、恢复耗时、资源占用；以代表任务观察完成率、误操作和用户能否理解发送范围 | 测量前在评估文档冻结环境、样本、阈值与方法；提供原始结果，不能推断未测量的理解提升；可先采用本地反馈 P95≤100ms 作为待验证项目目标，模型时延单独报告 |
| R08.4 安装与诊断（T10） | 干净 Windows 安装/升级/卸载、profile 和版本兼容检查、可操作错误诊断；诊断默认不包含材料正文 | 提供干净用户环境 smoke；重装不破坏已有会话；卸载区分程序资源和用户日志，并验证实际清理范围 |
| R08.5 发布验收（T11） | 汇总兼容矩阵、已知限制、测试 SHA 和交付包；支持范围与实测一致 | 核查构建包、安装、回归、人因和真实 e2e；候选没有未说明的 P0 缺陷；发布按用户已有授权和仓库流程执行 |

### 11.1 R08.1：上下文范围、来源和安全呈现

**目的。** 让用户在提交前知道将发送什么，在回答后知道依据来自哪里；扩大上下文必须由明确授权触发。

**实现方法。** 在 R04 材料模型上加入 `authorizedScope`、`actualScope`、来源位置、revision、预算、截断原因和完整度。支持 selection/local/section/page 的能力协商；Provider 只能返回它实际支持的范围。扩展请求校验 snapshot、document 和 revision，页面已经变化时要求重新选择。发送预览和模型日志从同一规范化材料生成。模型 Markdown 使用受限渲染，外链只接受允许协议并由用户动作打开；网页中的提示语始终作为不可信材料。

**测试方法。** 新增 `pnpm test:context-expansion`，覆盖范围授权、页面切换、revision 冲突、Unicode/字节/模型预算截断、Provider 部分能力、失败降级、危险链接和恶意网页指令；更新 `pnpm test:session:replay`，对比预览与日志中的实际模型输入。原生浏览器 fixture 验证选区、邻近段落和页面范围的来源位置。

**完成标准。** 默认选择不会读取全文；任何扩展都能追溯到用户授权；来源变化不会混料；截断与缺失对用户可见；无法扩展时原选区仍可使用。不得用启发式采集 confidence 表示答案正确率。

**2026-09-09 实现切片。** 已在插件侧完成第一段可验证能力：SelectionSnapshot 可携带已捕获的 pageText；Bridge V3 提供 `selection.expand`/`selection.expanded`，按 snapshot id、revision、scope、完整度和截断标记返回有界的 selection/local/section/page 预览；TS、Rust、共享 fixture、路由、Tauri command 和 Lens API 已同步。Lens 以折叠面板显示来源上下文，用户选择可用范围并按下 **Load context** 后才请求预览；提交仍只发送固定 selection。当前切片没有自动抓取全文、没有把扩展上下文写入模型请求，也没有完成页面变化/document 校验、上下文持久化或真实浏览器 page Provider；这些验收项继续保持未完成。自动化和窗口证据见 [R08.1 context expansion evidence](evidence/r08-context-expansion.md) 与 [R08 UI evidence](evidence/r08-ui.md)。

**给 Codex 的提示词。**

```text
执行 R08.1。基于 R04 已持久化的材料身份实现 selection/local/section/page 范围授权、revision 校验、预算与截断、来源核查和安全渲染。预览与模型日志必须由同一规范化材料生成；网页正文永远是数据，不能改变工具或权限策略。新增 test:context-expansion 并更新 session replay，覆盖页面变化、越权、Unicode 截断、Provider 降级、恶意链接和失败后继续使用原选区。交付来源 UI、预算说明、自动证据和实际浏览器 fixture 证据。
```

### 11.2 R08.2：人因驱动的界面、可访问性和视觉系统

**目的。** 降低工作记忆负担和误操作，让用户始终看懂当前材料、会话、系统状态和可执行的下一步，同时形成一致、克制且高级的视觉界面。

**实现方法。** 建立类型化设计变量和 locale 字典（仅管理界面文案，不提供翻译产品动作），统一色彩、字号、间距、圆角、层级、动效及明暗主题。信息层级固定为材料与来源、问题/草稿、执行状态、回答与工具、下一步操作；详细日志和长来源采用渐进披露。主要动作保持稳定位置和清晰命名，危险或不可逆动作与常用动作分离。即时本地反馈目标 P95 不超过 100 ms，模型等待显示阶段和停止入口。流式回答只在用户接近底部时自动跟随，用户上滚后保持阅读位置。所有操作可由键盘完成，焦点顺序可预测，焦点环可见；状态变化使用低干扰 live region，逐 token 不播报。支持 reduced motion、高对比度、125%/200% DPI、窄窗口和多屏。

**测试方法。** 新增 `pnpm test:ui:a11y`，用可失败的名称、角色、焦点、键盘、对比度和 live-region 断言；新增 `pnpm test:ui:visual`，在固定主题、语言、DPI、窗口和数据 fixture 下生成基线。扩展 Native 组件测试覆盖中文 IME、双击防重、Esc、停止、审批、断线、长回答、长来源和滚动锚定。实际 Tauri 窗口用 `pnpm test:lens:e2e` 截取关键状态，并人工核查 Narrator、多屏和 DPI。

**完成标准。** 核心流程无需鼠标；焦点不丢失或跳到后台窗口；错误信息说明原因与恢复动作；颜色不是唯一状态信号；在目标窗口尺寸没有遮挡、横向溢出或不可达操作；视觉截图来自实际候选软件并经过人工审阅。

**给 Codex 的提示词。**

```text
执行 R08.2。先盘点 R01～R07 的全部真实状态，再建立类型化 locale 字典（只管理界面文案，不加入翻译动作）、设计变量和状态组件。按材料→问题→状态→回答/工具→下一步形成稳定信息层级，使用渐进披露控制复杂度。实现键盘流程、焦点管理、低干扰播报、滚动锚定、reduced motion、双主题和 DPI/窄窗适配。新增 ui:a11y 与固定环境 ui:visual 测试，扩展 Native 行为测试，并用实际 Tauri 窗口采集 idle、streaming、approval、error、history 等截图。不得用静态 mock 页面代替产品证据。
```

### 11.3 R08.3：性能基线与“感知增强”人因评估

**目的。** 用可重复数据证明系统减少理解任务中的切换、漏读和误发，并明确结论只适用于被测场景。

**实现方法。** 先冻结评估协议：硬件、Windows/浏览器版本、候选 SHA、任务材料、基线工作流、增强工作流、成功定义、计时点、样本和排除规则。系统指标分为本地操作反馈、Lens 打开、提交确认、首个模型可见输出、完成、断线恢复、内存和 CPU；模型网络时延单独报告。人因指标至少包括任务完成率、完成时间、关键事实遗漏、错误来源引用、误操作、发送范围判断正确率、恢复成功率和主观负荷。形成性测试可用少量代表用户发现问题；任何总体效果结论都需预先确定样本或功效依据。匿名记录任务结果，不保存无关网页正文、凭据或身份信息。

**测试方法。** 新增 `pnpm test:perf` 运行固定本地工作负载并输出机器可读原始结果；新增 `pnpm test:human-factors:fixtures` 校验任务、评分表和匿名数据 schema；`pnpm report:human-factors -- --input <path>` 只能读取显式传入的真实数据，输入缺失、空数据或无匹配候选 SHA 时失败。报告基线与增强条件的分布、差值、异常值处理、缺失数据和限制，不只给平均数。

**完成标准。** 性能测试可在相同环境复现；每个数字有明确起止点和样本数；“感知增强”结论由实际对照任务支持；未测量的理解提升、长期效率或其他应用范围不得外推。发现严重误发、范围误解或不可恢复错误时，返回相应功能任务修复后重测。

**给 Codex 的提示词。**

```text
执行 R08.3。先写并冻结性能与人因评估协议，再实现测量，不要先看结果后调整成功标准。分别测本地反馈、模型时延、恢复和资源占用；准备基线/增强的代表任务、评分规则和匿名数据 schema。新增 test:perf、test:human-factors:fixtures 与 report:human-factors，确保缺失或空输入会失败。用真实参与者数据时报告样本、分布、差值、限制和候选 SHA，只对实际测量的浏览器场景下结论。
```

### 11.4 R08.4：安装、诊断、升级和卸载

**目的。** 让非开发环境能够安装并定位故障，升级不破坏会话，卸载行为与用户数据保留选择一致。

**实现方法。** 产出签名策略明确的 Tauri 安装候选和版本匹配的 npm bundle/profile patch。首次启动检查 Harness、Node/runtime、Named Pipe、Native Host/浏览器扩展和版本兼容，错误提示包含可执行修复步骤。诊断导出默认脱敏，不包含选区正文、模型密钥和完整会话内容。升级前后验证 session 格式、配置和注册项；卸载分别处理程序文件、Native Host 注册、扩展连接和用户日志，不删除未明确选择的数据。

**测试方法。** 新增 `pnpm test:installer` 驱动隔离用户目录的安装/启动/诊断/升级/卸载 smoke，并检查遗留进程、管道、注册项和文件范围。至少在干净 Windows 用户环境执行一次实际安装；开发目录直接启动不能替代安装证据。安装包、bundle、Harness 版本和报告记录 SHA/哈希。

**完成标准。** 干净环境能完成浏览器选区主路径；缺少依赖时得到准确诊断；覆盖安装、上一候选升级和卸载；保留/清理的数据与 UI 说明一致；重复安装不会创建冲突注册或僵尸进程。

**给 Codex 的提示词。**

```text
执行 R08.4。生成版本一致的 Tauri 安装候选、npm bundle 和受支持 profile，完成首次启动诊断、升级与卸载。诊断默认脱敏并给出可操作修复，不记录选区正文或凭据。新增 test:installer，在隔离用户目录覆盖安装、启动、依赖缺失、升级、卸载、注册项和残留进程；再在干净 Windows 用户环境执行实际 smoke。所有产物与证据绑定同一 SHA 和哈希。
```

### 11.5 R08.5：集成验收和发布候选

**目的。** 将已验证的范围冻结为一个可审查候选，保证代码、安装包、测试、截图、限制和支持矩阵指向同一事实。

**实现方法。** 建立 release manifest，记录插件 SHA、Harness/依赖版本、Node/Rust/Windows/浏览器矩阵、安装包与 bundle 哈希、协议版本、迁移要求和已知限制。聚合检查只调用已经存在且有明确责任的命令；真实模型、原生窗口、真人研究和安装 smoke 作为外部证据索引，不伪装成普通单元测试。逐项核对隐私、日志、资源清理、错误恢复、无障碍和支持声明。P0 缺陷必须修复，P1/P2 需明确影响、规避方法和是否阻止候选。

**测试方法。** 新增 `pnpm check:release`，验证工作树、版本、生成物、manifest、必须证据、链接和 SHA 一致性，并运行经批准的 focused 聚合。候选只运行一次必要的集成组合；失败修复后生成新候选并重跑受影响证据。发布或合并等不可逆外部操作遵循用户当前授权和仓库规则。

**完成标准。** 没有未说明的 P0；所有必需命令为 PASS，环境缺失项目不会被误写为 PASS；支持矩阵只列实际测试范围；冒烟、单元、e2e、人因、安装和截图报告可由 reviewer 复查；候选 SHA 与远端及产物一致。

**给 Codex 的提示词。**

```text
执行 R08.5。冻结一个候选 SHA，生成 release manifest、兼容矩阵、已知限制和证据索引。新增 check:release 验证版本、产物哈希、证据链接和 SHA 一致性，并聚合已存在的必要检查。分别审阅单元、无密钥集成、Named Pipe、真实模型、原生窗口、人因和安装证据；NOT RUN 不得记作 PASS。修复阻断缺陷后更新候选并重跑受影响范围。交付可审查的发布候选；合并或发布按用户授权执行。
```

可选 Provider（T08）按用户实际需求后置，例如 PDF、Word 或其他桌面应用。未验证的应用不得写入已支持列表。

### 测试命令

```powershell
# 以下命令需由对应子任务先实现并注册，不能在存在前声称通过
pnpm test:context-expansion
pnpm test:ui:a11y
pnpm test:ui:visual
pnpm test:perf
pnpm test:human-factors:fixtures
pnpm report:human-factors -- --input <匿名数据路径>
pnpm test:installer
pnpm check:release
# 已存在；实际原生 e2e 能力按 R07 验证
pnpm test:native-ui
pnpm --dir native build
pnpm test:lens:e2e
```

性能、人因、安装 smoke 的命令由实现时注册并写入 package.json 和评估说明；在实际存在前只能标为拟新增，不能捏造通过记录。

### 给 Codex 的提示词

```text
执行 R08，并分别交付来源范围、设计系统/可访问性、性能人因、安装诊断和发布验收。沿用原 T06～T11 的要求，不改变 R01～R07 的请求、材料和审批语义。先保证中文、错误状态、焦点和稳定滚动，再完善视觉。新增上下文、a11y 和视觉测试，人工核查 Narrator、DPI、多屏、长答案及安装流程。测量前冻结人因评估标准，报告实际结果与限制；可选 Provider 独立安排，不阻塞已声明浏览器范围的交付。
```

## 12. 命令可用性与检查策略

以下分类以执行基线 `00ccb6a` 和当前 package scripts 为准，后续新增命令必须更新此表。运行目录是插件仓库根目录，例如 `D:/deepseekHarness/Harness-plugins-dev-t05`；不要误在 Harness monorepo 中运行插件脚本。

| 类别 | 命令 | 注意事项 |
|---|---|---|
| 已有快速检查 | typecheck、test:session、test:session:replay、test:session:transport、test:protocol、test:bridge | 修改请求或协议行为后重新记录受影响命令；旧通过结果不继承 |
| 已有构建/UI | build、verify:bundle、test:native-ui、test:lens:session、`pnpm --dir native build` | `test:lens:session` 是 WebView/投影自动测试，不是实际 Tauri 窗口证据 |
| 已有 Rust | test:rust、`cargo check --manifest-path native/src-tauri/Cargo.toml` | 首次需先生成 native/dist |
| 已有聚合 | check:task5 | R07 更新其覆盖并记录是否包含新增测试；真实模型不应混进默认无密钥聚合 |
| R07 运行器 | test:session:e2e | L1 可执行并已通过；L2 需要真实模型授权，缺少前置时退出 2 |
| 已有 Windows 管道集成 | test:bridge:integration | R02 已验证实际 Node/Rust Named Pipe；提交/回执或 Rust bridge 变化后必须重跑 |
| R07 运行器 | test:lens:e2e | 接受真实 Tauri/浏览器驱动报告；缺少驱动或窗口前置时退出 2 |
| 已注册/拟新增 | `test:context-expansion`、`test:ui:a11y`、`test:ui:visual` 已注册；`test:session:tools`、`test:session:interaction`、`test:session:history`、`test:perf`、`test:human-factors:fixtures`、`report:human-factors`、`test:installer`、`check:release` 待实现 | 已注册命令需记录当前实现切片的 focused 结果；其余命令实现并注册后才能执行和声称通过 |

对新增能力分别证明成功和失败路径。测试 fixture 使用真实宿主数据结构，涉及 durable event 时覆盖实际投影/存储路径，避免只比较手写常量与同一常量。Windows 管道、真实 Provider 和人工可访问性各自保留专门证据。

## 13. 双工作模式与可并行范围

在线 ChatGPT + GitHub 负责需求澄清、协议/文档审查、PR 审阅、测试矩阵和证据核查；它不能根据代码阅读宣称本地 Windows UIA、Named Pipe 或真实模型测试通过。Codex 本地负责实现、构建、原生和宿主集成、实机故障复现及证据采集。

可并行的是职责不同且接口已经冻结的工作。当前建议按下表分配在线审查和本地实现；一名开发者同时占用多个工作区时仍需按依赖顺序合入。

| 工作线 | 可立即进行 | 必须等待 | 文件所有权与交付 |
|---|---|---|---|
| 本地 Codex：会话主线 | 从已完成 R03 的基线依次完成 R04、R05 | R05 运行工具审批前等待 R04 | `src/session/`、`src/bridge/`、共享协议、工具与交互测试；交付可运行提交和本机证据 |
| 本地 Codex：UI/历史线 | 基于已提交事件 fixture 设计 R06 页面和 R05/R07 状态占位 | 合入真实提交、审批和历史行为前等待对应协议 | `native/src/`；不得与会话主线同时改同一协议或 App 接线文件 |
| 本地 Codex：运行器线 | 核查 dsh profile、隔离目录、前置检测和清理设计 | 真实断言等待 R04～R06；真实模型执行等待凭据 | `scripts/test-session-e2e.mjs`、固定网页 fixture、证据模板；不得用模拟路径宣告 L 级通过 |
| 在线 ChatGPT + GitHub | 审查已推送 SHA 的协议、测试矩阵、HCI 状态和 PR 差异；准备 R05/R08 评审清单 | 无法执行本机 Windows、Tauri、真实模型或凭据测试 | 输出带 base/head SHA 的审查报告，不直接声称本地命令通过 |
| 实机/人工验收 | 准备非敏感 fixture、DPI/多屏/Narrator 场景和截图命名规则 | 等待对应候选 SHA 可运行 | 只记录实际软件行为；截图、日志和报告都绑定候选 SHA |

R03 请求关联和 R04 材料绑定必须共享同一协议决定；R04 工具身份和 R05 审批身份也必须在合入前联合审查。不得在不同分支各自创造身份字段。

每个实现分支独立 worktree，不共用 DSH_HOME、管道名或测试端口。交接必须包含 base SHA、目标 SHA、修改文件、协议变更、实际执行命令、输出证据和未验证项。合入后的集成负责人验证组合结果；不把两个分支各自的 PASS 当作组合 PASS。本文描述并行组织方式，不要求后续 Codex 自动创建任务或派生代理。

## 14. 证据模板与状态更新

每次完成一项，在提交/PR 或项目约定的证据文档中记录以下字段；日志、截图只引用可访问且已脱敏的文件。若后续采用新的目录规范，应在此补充，避免多处重复维护事实。

```text
任务：R0x
状态：待开发 / 开发中 / 自动验证通过待实机 / 已验收 / 具体阻塞
插件 SHA / Harness 版本 / 包版本：
运行环境：Windows 版本、Node、pnpm、Rust、浏览器、DPI
实现范围与未实现范围：
已修复的失败场景：
命令、工作目录、退出码、关键结果：
真实管道 / 模型 / 人工交互：分别 PASS / FAIL / NOT RUN
日志、截图或录屏路径：
已知限制及下一步：
```

任务表只有在对应完成标准全部满足后才改为“已验收”；退出 2 表示真实前置缺失或尚未验证，运行器本身的缺陷应使用失败测试和退出 1 表达。宿主缺口应附具体版本、公开类型/源码位置和可复现失败用例，且先排除未安装依赖及 profile 未装配的情况。

## 15. 后续 Codex 总提示词

```text
继续 Harness-plugins 与 DeepSeek Harness 的完整交互开发。先读取根目录 harness-plugins task.md、docs/harness-integration-development-plan.md、当前 AGENTS.md（如有）、package.json 和当前 git 状态，以最新代码为起点，不重置到旧基线。

以 R01～R08 为执行清单。R01 的回答投影已通过自动检查，R02 的连续订阅和 R03 的请求生命周期已通过自动检查与 Windows Named Pipe 验证，R04 已在 `5ec3a8a` 完成自动化和 Windows Pipe 验证。R05 先完成并发布 H05 会话持久交互宿主能力，再做插件审批适配；R06 的独立部分可在其 API 核查后并行推进，随后完成真实 e2e。不要混用主仓库较高版本源码与 rc.2 profile；真实发布 profile 仍须在 R07 验证。

每项按本文目标、边界、步骤、测试和完成标准交付，优先复用宿主能力。Native 不调用模型，材料和工具结果通过 Harness 日志可重建；网页正文不能修改权限。明确 session 级取消影响，禁止猜测 request/turn 归属或自动重发未知提交。协议变更同步 TS/Rust 与共享 fixture。

先新增能复现缺陷的行为测试，再实现修复，运行相关 focused checks。新增命令必须实际接入 package.json；运行器只有在真实路径执行并满足对应断言后才能作为验收。将模拟、无密钥集成、Windows 管道、真实模型和人工 HCI 证据分开报告；没有凭据时继续开发运行器及负例，真实模型标记未验证。

按已授权范围推进，文档中的示例不是额外的外部操作授权。完成一项更新证据和任务状态；提交/推送遵循用户现有指示，不自动合并或发布。最终报告完成内容、测试命令、退出结果、证据路径、未验证事项和下一项工作。
```
