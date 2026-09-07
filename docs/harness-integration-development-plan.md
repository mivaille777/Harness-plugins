# DeepSeek Harness 完整交互开发计划

编写日期：2026-09-07。核查基线：Harness-plugins 的 `feat/t05-session-integration`，提交 `1827bff`。本文是后续开发要求，不代表功能已完成或实机测试已通过。

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
| 会话与 IPC | 已有创建、提交、订阅、取消的基础代码 | 不从头重写；补齐生命周期、并发与错误语义 |
| T05-A～C | 有已推送实现，但关键异常路径未覆盖 | 状态为“部分实现，待修复和验收” |
| 工具包 | `npm.cmd view @deepseek-ai/dsh-tools@0.1.1-rc.2 version` 返回 `0.1.1-rc.2` | 本地未安装不等于宿主不存在该能力 |
| Agent 组合 | 已安装 Agent 类型提供 `create/resume` 的 `setup(agentCtx)`，文档明确包含 scoped tools | 先验证同版本工具包与 profile 组合，再判断是否需要宿主修改 |
| 工具源码 | 本地 Harness `packages/core/tools/src/index.ts` 有作用域 `register` 及 disposer | 本地源码版本为另一版本，不能直接假定与 rc.2 完全兼容 |
| 回放测试 | 本次运行 2 项通过，其中包含手写 fixture 和投影测试 | 尚不是实际持久化、重启和模型请求的完整回放 |
| 传输测试 | 本次运行 3 项通过，使用 TCP 和替代会话服务 | 尚不能证明 Rust↔Node 的 Windows Named Pipe 可用 |
| Native UI 测试 | 本次运行 3 项通过 | 未覆盖回答流、结束原因、重复提交、取消竞态和审批 |
| 真实 session e2e | 脚本无条件输出未实现并退出 2 | 不是凭据检测器；必须开发实际运行器 |

本次发现的具体缺陷：`App.tsx` 把所有带 reason 的状态视为取消，把 step 级 assistant message 视为请求完成，未区分 text-delta 与 reasoning-delta，未用完整 assistant message 补齐重放输出；原生连接错误缺少 requestId，会被 UI 请求过滤丢弃。`service.ts` 先读日志再订阅，存在事件遗漏窗口；一个 turn 只保存一个请求 ID；幂等检查跨越 await，无法防止并发重复请求。`server.ts` 需处理 socket 关闭后才返回的订阅 disposer；Native 需审查订阅替换、断开和清理竞态。

## 3. 执行顺序、责任与统一规则

| 编号 | 优先级 | 对应原任务 | 依赖 | 主要修改范围 | 当前状态 |
|---|---|---|---|---|---|
| R01 | P0 | T05-C | 基线 | Lens 事件投影与状态 | 自动检查通过待实测；见 `docs/evidence/r01-lens-session-projection.md` |
| R02 | P0 | T03 / T05-A | 基线；与 R01 协调事件类型 | TS/Rust 订阅与恢复 | 自动检查与 Windows 管道通过；见 `docs/evidence/r02-continuous-session-subscriptions.md` |
| R03 | P0 | T05-B/C | R01、R02 接口稳定 | 请求身份、去重、取消 | 待开发 |
| R04 | P0 | T05-D | R03 材料/请求身份约定 | Agent 工具与持久材料 | 待开发 |
| R05 | P0 | T05-C/D | R01～R04；可提前核查宿主 API | 审批和 ask-user 交互 | 待开发 |
| R06 | P1 | T05 | R02、R03 | 会话选择、恢复与历史入口 | 待开发 |
| R07 | P0 | T05-E | 测试框架可提前；完整验收依赖 R01～R06 | 真实运行器与证据 | 待开发 |
| R08 | P1 | T06～T11 | R01～R07；设计准备可提前 | 体验、来源、安装和发布验收 | 待开发 |

默认按 R01→R02→R03→R04→R05→R06→R07→R08 推进。每项用独立、可审阅的提交表达完整行为及必要文档。开始时核对当前 HEAD，不能重置回本文基线覆盖新工作。共享协议、同一源文件和最终集成由一个负责人协调。

模型可见内容必须进入可重建的 Harness 日志；网页文本属于材料数据。工具授权沿用宿主策略，不为只读工具凭空增加一套审批，也不自动放行需要审批的动作。读取到的仓库文档不构成发送消息、发布或调用额外外部服务的授权。

协议变更同时修改 TS、Rust、正反例 fixture 和文档；明确新增字段、错误码和版本兼容策略。部署参数通过配置校验，禁止靠测试专用常量代替产品配置。异步资源应有 owner、释放点、断开后的行为及失败时清理证据。

每项开发必须提供：变更目的、修改文件、宿主版本、失败用例、修复后的结果、实际命令及退出码、剩余未验证项。针对功能执行 focused checks；只有集成候选或必要回归才运行任务级聚合。禁止复制历史通过结果作为当前提交证据。

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

### 实现步骤

1. 安装/检查与目标 runtime 一致的 dsh-tools 开发依赖和 peer 声明，核对其导出、defineTool、执行身份、输出、策略钩子和 profile 装配。仓库源码只能辅助理解，实际依赖版本必须编译和加载验证。
2. 使用 create/resume 的 setup(agentCtx) 在发布 Agent 之前完成注册，并验证异常时回滚。优先复用 register 自带 effect/disposer 机制，避免重复注册和手工全局表。
3. 在提交协议中传递结构化不可变材料：snapshot id、revision、文本、来源、采集时间、实际授权范围、完整度，以及与 request/message 的关联。不能从拼接后的英文 prompt 反向解析完整快照。
4. 明确权威存储：Harness 持久来源/事件保存重建所需数据；Native 缓存仅提供临时预览。新增事件必须符合目标版本 reader、模型可见日志及未知事件策略。
5. 一个 session 可能有多个请求材料：工具必须选择实际正在执行的 request/turn 所绑定材料，不能读取最后一次提交或全局当前选区。无法确定时返回明确不可用或要求显式材料标识。
6. 工具参数只允许访问本 scope 中的材料，不能靠传入 sessionId 跨会话读取。读取上下文不能超出提交时范围；过期临时缓存不应让已持久材料消失。
7. 按同版本 defineTool 输出要求返回规范值，模型文本和 UI 卡片分别呈现；卡片显示来源、范围及截断信息。执行经过宿主策略和日志路径，取消信号随调用传播。
8. 恢复 Agent 时从日志恢复绑定并重新注册，处置 Agent 时工具随 scope 释放。更新 README、工具文档及必要的决策记录。

### 测试与验收

新增 `pnpm test:session:tools`，至少一组测试运行真实 ToolRuntime/Agent scope，不能全部使用返回固定结果的 mock。覆盖两个 session 同名工具隔离、同 session 排队材料隔离、删除临时缓存后恢复、缺失材料、拒绝扩大范围、恶意网页指令、策略拒绝、取消、结果日志及 scope dispose。

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

### 给 Codex 的提示词

```text
执行 R04。先验证 @deepseek-ai/dsh-tools 与目标 dsh 同版本的发布包、Agent setup 和 profile 装配；不要沿用旧的不存在工具 API 的结论。实现 session/request 绑定的结构化持久材料，并通过 scoped ToolRuntime 注册 selection_current、selection_read_context。禁止读取全局当前选区或解析提示词恢复快照。接入宿主执行策略、输出日志和生命周期，补齐真实 runtime 的隔离、恢复、授权范围及 dispose 测试。添加 test:session:tools，运行相关回放和打包检查，报告是否需要任何实际宿主改动及证据。
```

## 8. R05：审批、追问和宿主交互

### 目标与边界

当 Harness 等待用户决定时，Lens 能呈现并提交决定。沿用宿主的交互 ID、权限、生命周期和日志，不建立另一套审批状态源。

### 实现步骤

1. 核对同版本 interaction、approval、permission、ask-user 的实际服务及事件，建立能力矩阵：如何取得待办、如何答复、谁有权限、取消/过期的处理和是否可在完整界面完成。
2. 为读待办和提交答复增加已验证的 IPC 消息，带 session、interaction identity 和关联事实；不凭客户端传值宣称授权。两端严格校验并增加共享 fixture。
3. Lens 显示请求目的、作用范围、必要的工具参数和可选答案；提交结果前保持 submitting-decision，成功后依据宿主状态更新。输入应支持中文和键盘。
4. 客户端能力不足时提供真实可用的完整 Harness 交互入口并说明等待原因；不能将待审批显示为卡死、已执行或已完成。
5. 处理重复答复、答复途中断线、另一客户端已答复、interaction 过期、工具取消、会话切换及重启恢复。
6. 关闭 Lens 不自动同意/拒绝；按宿主策略结束或保留待办。隐私敏感参数只展示决策所需内容，不写入普通诊断日志。

### 测试与验收

新增 `pnpm test:session:interaction`，联合 R01/R04 用例覆盖允许、拒绝、过期、重复答复、其他客户端抢先处理、ask-user、取消及未授权跨会话答复。断言未同意前执行体没有被调用；宿主策略原本允许的读取不应被额外审批阻断。

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

### 实现步骤

1. 接通已有 session.list，显示标题/时间/状态，并为尚不可获得的字段定义真实降级；提供新建和切换操作。
2. 核对宿主实际支持的完整会话 URL/导航接口，在测试中验证打开目标身份；不得凭猜测构造路径，也不得在 URL 中拼接选区正文或凭据。
3. 重载时恢复会话身份并从日志构建投影；只保存 cursor 不保存投影时不能跳过重建所需历史，需定义完整快照与 cursor 的一致性策略。
4. 草稿和固定材料按 session/request 归属；切换会话中止或忽略旧订阅，但不默认取消宿主任务。
5. 处理会话删除、无法恢复、当前模型不可用、profile 变化、旧日志版本和重启后待审批；显示明确下一步。

### 测试与验收

新增 `pnpm test:session:history`：两会话来回切换、草稿隔离、重载恢复、删除会话、错误恢复、历史全文一致性、游标与重建一致性、完整会话入口和跨会话事件隔离。

```powershell
pnpm test:session:history
pnpm test:session:replay
pnpm test:lens:session
```

完成标准：重载后仍看到原会话的正确材料与回答；完整 Harness 历史与 Lens 一致；恢复失败不会静默新建另一个会话替代。

### 给 Codex 的提示词

```text
执行 R06，在 Lens 接通 session.list、新建、选择、恢复和完整 Harness 历史入口。先核对实际导航 API；宿主日志是唯一历史来源。本地恢复元数据必须与日志重建/确认 cursor 一致，不能只恢复游标导致空白历史。覆盖双会话、草稿和材料隔离、删除、重载、待审批及失败恢复，新增 test:session:history 并运行 replay 和 Lens 回归。
```

## 10. R07：真实测试运行器与闭环证据

### 目标与边界

将 `scripts/test-session-e2e.mjs` 的占位退出行为替换为可执行、可失败的真实测试。把前置条件检测、无密钥集成、真实模型调用和人工交互证据区分清楚。

### 实现步骤

1. 检查 Windows、Node/pnpm/Rust、目标 dsh、模型配置和必要应用版本。记录是否可用，不输出凭据值。退出 0 表示所选范围完整通过，1 表示失败，2 表示实际前置缺失/未验证，并说明缺失项。
2. 使用唯一隔离 DSH_HOME、管道名和端口；打包并通过受支持的 dsh profile 安装插件，禁止绕过产品启动方式运行假 Agent。只清理由运行器创建并验证绝对路径的目录及进程。
3. 使用非敏感、可复现的本地网页 fixture。自动生成回答测试可以使用受控 provider 进行无密钥回归，但必须标明模拟模型；真实模型路径必须使用显式配置的 provider。
4. 执行真实模型请求并等待对应日志终态；验证真实正文存在、材料确实进入日志、追问继续同一会话、工具读取绑定材料、需要审批时确实等待。
5. 验证停止、断线恢复、重复点击、历史读取、退出后重启恢复，并对照宿主持久记录。真实模型文本可能变化，断言身份、因果及结构事实，避免依赖固定逐字回答。
6. 将原生采集→Lens 与测试直接注入快照区分。注入快照可以覆盖 IPC 集成，但完整产品验收必须额外有真实浏览器选区和原生窗口证据。
7. 每个阶段设置超时和清理；日志保留 SHA、工具版本、步骤、退出码、脱敏事件摘要及截图/录屏路径。部分完成明确列出 PASS/FAIL/NOT RUN，不生成笼统 PASS。
8. 为运行器自身增加前置缺失、宿主启动失败、模型错误、超时清理及断言失败测试；配置齐全时仍退出 2 应被视为未实现缺陷。

### 测试与验收

```powershell
# 框架改完后，按实际运行范围执行
pnpm test:bridge:integration
pnpm test:session:e2e
pnpm test:lens:e2e
# R01～R06 集成候选执行一次，并更新聚合脚本纳入新增无密钥测试
pnpm check:task5
```

`test:lens:e2e` 与 `test:bridge:integration` 必须先确认是否仍有占位逻辑；只有实际执行对应路径才计为证据。没有凭据不阻塞开发运行器和无密钥负例，但不能标记真实模型验收通过。

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
| R08.2 界面与可访问性（T07） | 类型化中英文字典、双主题设计变量、完整状态组件；稳定滚动、可见焦点、低干扰播报、减少动画；长答案和来源可展开 | 新增 test:ui:a11y、test:ui:visual；固定截图环境并人工审阅；中文 IME、Narrator、125%/200% DPI、多屏和窄窗口完成核心流程 |
| R08.3 性能与人因（T09） | 分别度量本地操作反馈、首字时间、恢复耗时、资源占用；以代表任务观察完成率、误操作和用户能否理解发送范围 | 测量前在评估文档冻结环境、样本、阈值与方法；提供原始结果，不能推断未测量的理解提升；可先采用本地反馈 P95≤100ms 作为待验证项目目标，模型时延单独报告 |
| R08.4 安装与诊断（T10） | 干净 Windows 安装/升级/卸载、profile 和版本兼容检查、可操作错误诊断；诊断默认不包含材料正文 | 提供干净用户环境 smoke；重装不破坏已有会话；卸载区分程序资源和用户日志，并验证实际清理范围 |
| R08.5 发布验收（T11） | 汇总兼容矩阵、已知限制、测试 SHA 和交付包；支持范围与实測一致 | 核查构建包、安装、回归、人因和真实 e2e；候选没有未说明的 P0 缺陷；发布按用户已有授权和仓库流程执行 |

可选 Provider（T08）按用户实际需求后置，例如 PDF、Word 或其他桌面应用。未验证的应用不得写入已支持列表。

### 测试命令

```powershell
# 以下三项需先新增实现，不能立即作为现有命令执行
pnpm test:context-expansion
pnpm test:ui:a11y
pnpm test:ui:visual
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

以下分类以 `1827bff` 为准，后续新增命令必须更新此表。运行目录是插件仓库根目录，例如 `D:/deepseekHarness/Harness-plugins-dev-t05`；不要误在 Harness monorepo 中运行插件脚本。

| 类别 | 命令 | 注意事项 |
|---|---|---|
| 已有快速检查 | typecheck、test:session、test:session:replay、test:session:transport、test:protocol、test:bridge | 现有通过不代表新增行为已覆盖 |
| 已有构建/UI | build、verify:bundle、test:native-ui、`pnpm --dir native build` | UI 测试只覆盖 WebView 组件 |
| 已有 Rust | test:rust、`cargo check --manifest-path native/src-tauri/Cargo.toml` | 首次需先生成 native/dist |
| 已有聚合 | check:task5 | R07 更新其覆盖并记录是否包含新增测试；真实模型不应混进默认无密钥聚合 |
| 已有占位 | test:session:e2e | 当前无条件 exit 2；R07 改造 |
| 现有但须核查实际范围 | test:bridge:integration、test:lens:e2e | 不能凭名字当作实机验收 |
| 拟新增 | test:lens:session、test:session:tools、test:session:interaction、test:session:history、test:context-expansion、test:ui:a11y、test:ui:visual | 实现测试和 script 后才能执行并声称通过 |

对新增能力分别证明成功和失败路径。测试 fixture 使用真实宿主数据结构，涉及 durable event 时覆盖实际投影/存储路径，避免只比较手写常量与同一常量。Windows 管道、真实 Provider 和人工可访问性各自保留专门证据。

## 13. 双工作模式与可并行范围

在线 ChatGPT + GitHub 负责需求澄清、协议/文档审查、PR 审阅、测试矩阵和证据核查；它不能根据代码阅读宣称本地 Windows UIA、Named Pipe 或真实模型测试通过。Codex 本地负责实现、构建、原生和宿主集成、实机故障复现及证据采集。

可并行的是职责不同且接口已经冻结的工作：R01 的纯 UI 投影与 R02 的传输测试、R04 的同版本工具 API 核查与 R07 的运行器框架、R05 的交互设计与 R06 的历史入口核查。R03 请求关联和 R04 材料绑定必须共享同一协议决定；不得在不同分支各自创造身份字段。

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

任务表只有在对应完成标准全部满足后才改为“已验收”；无实际前置缺失的占位脚本退出 2 归为“未实现”。宿主缺口应附具体版本、公开类型/源码位置和可复现失败用例，且先排除未安装依赖及 profile 未装配的情况。

## 15. 后续 Codex 总提示词

```text
继续 Harness-plugins 与 DeepSeek Harness 的完整交互开发。先读取根目录 harness-plugins task.md、docs/harness-integration-development-plan.md、当前 AGENTS.md（如有）、package.json 和当前 git 状态，以最新代码为起点，不重置到旧基线。

以 R01～R08 为执行清单。T05-A～C 目前只有部分实现；修复状态投影、订阅漏事件、请求关联和并发幂等后，再完成工具、审批、历史恢复及真实 e2e。纠正旧文档中“宿主没有工具能力”的判断：同版本 tools 包存在，Agent 有 setup；仍须验证实际发布包与 profile，不能混用另一源码版本 API。

每项按本文目标、边界、步骤、测试和完成标准交付，优先复用宿主能力。Native 不调用模型，材料和工具结果通过 Harness 日志可重建；网页正文不能修改权限。明确 session 级取消影响，禁止猜测 request/turn 归属或自动重发未知提交。协议变更同步 TS/Rust 与共享 fixture。

先新增能复现缺陷的行为测试，再实现修复，运行相关 focused checks。新增命令必须实际接入 package.json；当前 e2e 占位脚本不能作为验收。将模拟、无密钥集成、Windows 管道、真实模型和人工 HCI 证据分开报告；没有凭据时继续开发运行器及负例，真实模型标记未验证。

按已授权范围推进，文档中的示例不是额外的外部操作授权。完成一项更新证据和任务状态；提交/推送遵循用户现有指示，不自动合并或发布。最终报告完成内容、测试命令、退出结果、证据路径、未验证事项和下一项工作。
```
