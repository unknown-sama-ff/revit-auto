> 发布副本说明：本机路径、模型名称及运行标识已匿名化。原始私有证据未随源码发布；历史验收不代表当前会话授权或完整业务认证。

# 开发进度与验收边界（含历史记录）

## 2026-10-14 流程重构索引

本次只整理开发流程、验收编排和任务排序，不修改 Revit 模型、不自动保存、不自动重启、不创建新的模型写入计划，也不改变历史验收结论。当前唯一机器可读任务来源是 [capability-task-queue.json](capability-task-queue.json)；旧段落保留为历史证据，不能替代队列中的当前状态。

统一生命周期为：登记 → 契约 → 核心实现 → 模拟测试 → 隔离编译 → 只读实机基线 → 预览 → 确认 → 单次执行 → 原生回读 → 保存/重开 → 归档。新实机运行使用 `acceptance/runs/<runId>/`，阶段文件和字段见 [development-flow.md](development-flow.md) 与 [mcp/run-evidence.schema.json](../mcp/run-evidence.schema.json)。旧 identity、revision、planId、PNG 和生命周期 attempt 仅作历史记录，不能复用。

当前最优先的工作顺序是基础数据只读合批、建筑主体、结构、机电/电气、文档、生命周期和发布。生命周期自动保存/重启继续保持 blocked；后续只使用用户手动保存/重开。已完成但待标准归档的受限结果包括 E101 视口标签、AL1 配电盘表移动、图纸只读诊断和批量 PNG 导出；整图 `wholeSheetLayoutAccepted=false` 继续有效。

本轮新增 `mcp/readonly-batch.mjs`，把同一 Revit 进程、插件 MVID 和文档 identity/revision 下的显式只读 scope 合并为一个 baseline，同时保留每项能力的独立结果。模拟测试和边界校验通过；真实 Revit 基线暂未生成，因为当前受限执行环境访问 `runtime/bridge.json` 返回 EPERM。`foundation.current-session-readonly-batch` 继续保持 blocked，不能用历史会话证据替代当前批次。

2026-10-14 后续加速：只读批次写入器已收紧到真实的 `acceptance/runs/<runId>/` 目录，校验 manifest/baseline 身份并拒绝符号链接和覆盖；baseline 独占创建、manifest 原子替换，常规失败清理本轮新文件。批次在任何 Revit 查询前预检全部 scope 契约和两个文档 pin，拒绝未宣告 `readonly-query-pins` 的插件、冲突 pin 以及回包中的写入/保存/重启/重试副作用标记；脏文档只能得到 `unknown`。`bridge.info` 自身重复探测已移除，只读 scope 可在明确环境变量下复用短期插件信息缓存，批次结束仍复核宿主。search、inspect、type.resolve、view.get、room.get、audit.run 及族审计分页已接入可选 identity/revision pin。基线归档 helper 现在严格校验 run/task identity、前后文档与计数、插件 pin、逐项 scope 状态、全零副作用计数，并由完整 scope 与保存状态推导 `accepted`；新增反例测试覆盖失败 scope、脏文档、taskId 漂移和路径边界。历史跟踪的两份 acceptance 证据被明确列为遗留例外，新生成私有证据仍被发布卫生测试拦截。归档候选的 E101 与 AL1 状态已对齐任务队列为 `visual-accepted`，仍明确标注没有原始 runId 和专属关闭重开证据，不生成虚构 run。桥接边界、只读批次、pin 契约和 run scaffold 定向测试 **56/56** 通过；CoreTests **272/272** 通过；全量 MCP 回归 **881 项：881 通过、0 失败、1 项设计跳过**。2026-10-14 已定位本机实际 Revit 2027.3 安装目录 `D:\revit 2027\Autodesk\Revit 2027`（API 文件版本 `27.3.0.28`），并在 `v27/bin/acceptance-20261014-readonly-pins/` 完成版本化隔离编译（0 警告、0 错误）和安装 `CheckOnly`；首次构建因默认 NuGet 用户配置不可读失败，改用仓库工作区内的临时 .NET 用户目录后通过，未更改系统配置。该具体构建尚未注册或实载，MVID `74768b8f-4d68-402a-a50e-46c185df3425`、DLL SHA-256 `9D3D665EB169338CEEDBE094A8A4E5830BB0DF459C4FA1276F52D263C9477FD0`。尝试生成注册 PREPARED 请求时，现有 `runtime/bridge.json` 受 ACL 拒绝访问，因此注册申请未生成、注册清单未改变；需在桥接权限恢复后再准备具体申请。基础只读实机基线仍需对该具体 DLL 完成复审/注册、用户手动重启并在正常桥接会话创建新 runId。本轮没有读取桥接凭据、写模型、保存或重启。

2026-10-14 MCP 回归环境修复：`mcp/tests/revit-api-version.test.mjs` 原先启动临时 Roslyn fixture 时继承用户级 `%APPDATA%\NuGet\NuGet.Config`，当前 ACL 拒绝该读取，导致 fixture 初始化失败并连带 25 项 API 版本门禁测试全部失败。在测试临时目录生成空包源 NuGet 配置并将 `APPDATA` 只传给 fixture `dotnet run` 和门禁 `dotnet msbuild` 后，原受限环境下该文件 **25/25** 通过，无需访问全局配置或外部包源。改动不触碰产品配置或 Revit。修复后全量 MCP **882 项：881 通过、0 失败、1 项环境跳过**；CoreTests **272/272**；`git diff --check` 通过。队列层级和依赖审查通过；历史 archive candidate/runId 及柱类型复制未分类附加元素等边界保持原状。当前插件注册仍受 `runtime/bridge.json` ACL 阻塞，未注册、未连接 Revit、未改模型。

2026-10-14 契约证据补强：只读批次 baseline 现在保存本次 `listTools` 实际参与校验的工具描述及规范化 SHA-256；归档器重新计算哈希，确认 `revit_context_get` 和所有 scope 工具都属于该快照、仍声明只读并支持 identity/revision pin。新增篡改工具名、注解和哈希的拒绝测试；`readonly-batch`、pin MCP 和发布卫生定向测试 **21/21** 通过。最终全量 MCP **883 项：882 通过、0 失败、1 项环境跳过**；CoreTests **272/272**。该改动只强化验收证据可追溯性，不改变查询、写入、保存或重启边界。

2026-10-14 参数表入口统一：旧 `revit.import.preview` 的 CSV/TSV/XLSX/JSON 表格分支不再直接调用 `importInput` 后裸建计划，改为复用 `previewParameterImport`。因此旧入口与 `revit.workflow.run(name=imports.parameter_table)` 共享 context identity/revision 前置核验、预览响应检查、创建后状态复核和已知 plan 单次取消；DWG/图片仍保持候选只读路径，不直接创建原生计划。新增旧入口 SDK 回归覆盖明确预览、stale revision、上下文漂移取消及无 confirm/commit/save；注册规划 **57/57**，参数/候选/行级导入定向 **74/74** 通过。最终全量 MCP **886 项：885 通过、0 失败、1 项环境跳过**；CoreTests **272/272**；`git diff --check` 通过。尚未注册插件、未重启 Revit、未修改模型。

## 2026-10-12 项目目标确认

用户明确两阶段目标：**先实现与旧项目功能对等，再优化实现为完整的 Revit 自动化助手**。总路线见 [project-roadmap.md](project-roadmap.md)。当前优先完成旧版来源矩阵的迁移与适用验收；完整助手为第二阶段扩展目标。本次只明确目标，不变更下述实现、部署或验收状态。

## 2026-10-12 当前核验状态

- 2026-10-13：图纸诊断新版插件已注册并实载，MVID `cffd0d77-6aac-49e4-a2e8-41260bb56e35`，`sheet-layout-diagnostics` 能力可用。当前测试副本 `sample-lighting-model-验收-v031.rvt` 的 `AI-E102-REUSE`（2296031）和 `E101`（1042869）完成实机只读诊断；两张图纸均 `complete=true`、未知几何 0、正面积相交候选 0，E102 越界 0，E101 越界 1。revision=0、未修改、可写，19 个类别的完整 ID 范围及完整 context 前后稳定。没有计划、确认、保存、重启或生命周期调用；`wholeSheetLayoutAccepted=false` 仍待 PNG 视觉验收。证据在 `acceptance/sheet-layout-AI-E102-REUSE-20261013.json.verified.json` 与 `acceptance/sheet-layout-E101-20261013.json.verified.json`。
- 2026-10-13：新增受控 `move_viewport_label` 操作，支持明确的未旋转视口标签偏移和可选引线长度，要求完整原生标签边界和可写状态，禁止与其它写操作混用；提交前/后均核对内容框、类型、旋转、图纸关系和标签回读。Revit 2027.3 隔离编译 0 警告/0 错误，CoreTests 267/267，相关 MCP 定向测试 100/100。该构建尚未注册或实机加载，未创建预览、未确认、未写入模型；E101 越界标签和 `wholeSheetLayoutAccepted=false` 仍待实机预览与 PNG 视觉验收。
- 2026-10-14：视口标签构建已注册、重启实载，E101 视口 `2290439` 经过三次单独预览/确认链后最终保存。最终 revision=3、`isModified=false`，标签偏移 `(20,-25,0) mm`、引线 `100 mm`；内容框保持不变。保存后只读版面诊断 complete=true、unknown=0、out-of-sheet=0、intersection=0，E101 PNG 4096×2896 导出成功。右侧 `AI-ARCH` 轴网文字仍侵入标题栏，因此 `wholeSheetLayoutAccepted=false` 继续保留。

- 恢复版 DLL 已完成一次获准注册切换并实际加载 `controlled-titleblock-change`、`controlled-structural-columns`、`explicit-grid-geometry` 和 `batch-view-image-export`。保存后重开核验通过，134 项完整原生范围和 29 项柱/轴网范围一致；证据保存在私有 `runtime/parity-postregistration-reopen-verified-1791626912602.json`。
- `AI-E102-REUSE` 的 AL1 表格已经向右移动一次并保存于 X=398.5/Y=568 mm，119 项电气快照不变。禁止重复执行此移动或对当前位置累加 30 mm。移动回滚、图框/柱/轴网独立写入和整个模型副作用仍未验收。
- 后续两张图纸 `AI-E102-REUSE`/`E101` 的只读原生批量 PNG 导出受限场景通过，实际尺寸为 4096×2893/4096×2896；134 项完整范围、29 项柱/轴网范围、文档状态和 RVT 哈希不变。AL1 左侧签字栏已避开，右侧 notes/legend 与 E101 轴网名称仍存在版面重叠，`wholeSheetLayoutAccepted=false`。
- 新增只读 `revit_sheet_layout` 已读取图框、视口、明细表/配电盘表，以及按 `ElementOwnerViewFilter` 限定到图纸的 `TextNote`、`IndependentTag` 注释边界；未知边界保留为 `unknown` 并令报告 `complete=false`。Revit 2027.3 API 隔离编译 0 警告/0 错误，CoreTests 258/258、图纸版面定向 MCP 15/15；图纸诊断构建已获批准、注册并实载，MVID 为 `cffd0d77-6aac-49e4-a2e8-41260bb56e35`。2026-10-13 已完成 `AI-E102-REUSE` 与 `E101` 实机只读诊断；当前证据为 complete=true、unknown=0、intersection=0，E101 越界 1，`wholeSheetLayoutAccepted=false` 保持。
- 电气回路下一步已补齐只读证据层：新增既有负载/开关创建回路的独立结果核验和保存边界核验，覆盖精确成员、配电箱集合、回路数量增量、成员快照与 `saved=false`；定向回路/核验测试 24/24 通过。尚未注册新 DLL 或提交该既有成员回路实机写入，`electrical.circuit` 仍为 implemented-not-accepted。
- 已补齐 `mcp/electrical-circuit-acceptance.mjs` 的 `probe`/`discover`/`prepare`/`verify`。本轮修复客户端工具名、非 JSON 错误披露及指定桥接配置的子进程透传；候选扫描严格分页、每批 inspect 不超过 100，数量与原生统计核对，畸形成员/连接器和非实例保持 excluded。48/48 定向测试通过，涵盖实际 CLI/SDK mock 通道、空集合、分页、取消及完整文档状态漂移。脚本不确认、不保存、不重启、不自动重试；先前桥接配置的沙箱权限限制已解除，真实只读查询已完成。
- 当前副本的两轮真实 `discover` 完整结果一致：扫描 49 个灯具、8 个照明设备和 1 个配电箱，与原生类别计数吻合；可用未分配灯具为 0、开关为 1、配电箱为 1。49 个灯具均为已分配 FamilyInstance；读前后完整 document、counts、activeView、selectedElementIds 和插件指纹不变，revision=0/isModified=false。私有证据为 `acceptance/circuit-candidate-readonly-*.json`。没有生成回路预览；`electrical.circuit` 既有成员写入验收仍待合适负载，图纸诊断只读范围已实载并完成，`wholeSheetLayoutAccepted=false` 保持。
- 后续建筑类型复制及成功回执容量保护源码已实现，CoreTests **222/222 通过**；该构建获准单次注册、实载及注册前已读范围保存重开核验通过，注册回执独立审查全部通过。后续具体柱类型复制计划已经用户批准并单次提交，`typeCopyExecutionAccepted=false`；整体功能对等迁移和稳定发布目标尚未完成。
- 本次只复制既有 300×450 mm 柱类型为新测试类型 500×500 mm，没有放置实例。plan.confirm=1，原生计划 committed；用户手动保存及关闭重开后的已读范围核验均通过，新 identity、revision=0/isModified=false、同已核验文件摘要。源 27 项参数及既有 134/29/236/24 范围不变，类型集合只增目标，源 300×450/new 500×500 mm 与 AL1 位置稳定，`readScopePersistenceVerified=true`；所有恢复/保存/重开探针均未再次 Confirm。最新原生逻辑依赖已证实新类型与额外 Element 关联，但其用途/类别/有效 owner view 仍未获证实，`additionalElementPurposeVerified=false`、classification=unresolved，全局 `closeReopenPersistenceVerified=false`、`typeCopyExecutionAccepted=false`、`allModelSideEffectsVerified=false`，回滚验收仍 pending。
- 后续独立只读 `revit_element_dependencies` 源码双审、CoreTests **233/233**、MCP 全量 **714/714**、实际 Revit 2027.3 API 隔离编译 0 警告/0 错误及 CheckOnly 通过。拟用申请获本次具体批准并只 Confirm 一次注册后，用户手动重启的实载、已保存范围和原生关系读取核验通过，当前为 `ELEMENT_DEPENDENCIES_LOADED_SAVED_SCOPES_AND_NATIVE_RELATION_READS_VERIFIED`；模块指纹与获准 DLL 一致、`bounded-element-dependencies` 已加载。四根关系与33项关系范围两轮读取一致，`nativeRelationshipVerified=true`；`additionalElementPurposeVerified=false`、baselineAvailable=false，额外元素仍 unresolved，全部验收边界不变。
- 本地测试副本生命周期构建此前已获准注册并实载，历史编译及纯测试结果保留。多次实机启动未完成，用户随后明确停止自动保存/重启工作，当前保持暂停开发和不执行；生命周期能力存在于已加载模块不代表自动重启验收通过，也不恢复旧计划。

生命周期历史设计和停止规则见 `local-test-copy-lifecycle.md`；当前按用户要求继续插件功能迁移，使用手动保存和重开，不恢复自动保存、自动重启或许可证排查。

以下记录保留各历史阶段的当时状态；已过期计划和旧会话身份不可复用，当前状态以上述核验及文末最新记录为准。

## 已有实机证据
- v0.3.3 的 identity 与连接器能力感知查询已通过测试副本检查。
- OFF1-01 注释写入及重复确认保护通过；结果记录在 acceptance/write-v033-20261003-034913.json.verified.json。
- 执行期回滚尚未验证。此前一个计划被 stale_plan 拒绝，另一个计划 ec819a7fb18f3bdab492900acf728fc7 已过期；它们都不能算回滚成功。

## v0.3.4 本轮新增
- 有界事务变更日志：事务名称、added/modified/deleted 元素 ID、revision、历史完整性标记。
- stale_plan 返回预览版本、当前版本和期间的变更历史，保留原有严格版本校验。
- 原生类型解析：缺失/歧义返回候选，不自动选第一个。
- 读取原生房间边界；按明确行列数、安装高度和边距生成布灯预览。
- PNG 视图证据导出：不激活视图、不修改模型、不保存 RVT。
- 新功能能力预检查：旧 DLL 未加载时给出清晰的“需要重启加载”错误，而不是 unknown_method。
- 官方只读 MCP 代理增加真实 SDK 转发测试（使用 mock 上游）；官方组件仍未安装，不冒充接入成功。

## 还需真实验收
- 重启 Revit 后确认版本 v0.3.4、变更历史、房间边界读取和类型解析。
- 在独立副本完成有效的聊天批准回滚计划。
- 从自然语言需求生成少量灯具/回路/导线/图纸计划，获批准后提交，检查真实模型和图像证据。
- 获取 Autodesk Public MCP Read 安装组件并核验版本。官方文档明示技术预览支持 2027.2，本机为 2027.3；不擅自回退 Revit、不装来源不明组件，也不把保护代理 mock 测试当官方联调。

完整目标仍未完成。编译、单元测试和工具发现不能替代实机验收或官方 MCP 接通。

## 最新自动化验证
- v0.3.4：编译 0 警告、0 错误。34 项核心测试 + 64 项 Node 测试通过（98 项）。
- MCP 实际可发现 17 个工具。新模块包括 RoomService、TypeService、ViewEvidenceService 和 room-lighting 布局器。
- 类型/房间布局与 PNG 导出的实机验证仍待新版加载；模型写入没有在本轮自动提交。
- 当前运行插件最后核验仍为 v0.3.3，清单已指向 v0.3.4；不强制关闭 Revit。


## 后续完成的代码与最新验证
- 增加 lighting-scene 组合器：房间布灯可选配电箱回路、导线、新视图和明细表；不猜配电箱连接器。
- 搜索支持 exact mark/room number，并返回标记、房间号和 viewFamily；直接 plan_create 可绑定 expectedRevision。
- 新增 5 项 SDK 房间预览链路测试、5 项照明组合器测试、2 项自然语言查询契约测试和1项完整场景 SDK 转发测试。
- 最新 Node 测试：77 项通过；最后独立编译 0 错误 0 警告。核心测试上次完整验证为34项，本轮没有以此声称新的实机能力已加载。
- 实际运行状态仍为 v0.3.3，测试副本有未保存内容。已过期的 ec819a7fb18f3bdab492900acf728fc7 不可执行，也不自动替代为新写入计划。
- 完整目标仍未满足：真正回滚与场景建模待有效聊天批准；新DLL待用户保存并重启；官方Public MCP待真实安装及受支持版本核验。


## 2026-10-03 当前实机证据（v0.3.4）
- Revit 2027.3 build 27.3.0.28 已加载 RevitAuto v0.3.4；确认 `confirmationMode=chat`、`requiresRevitConfirmation=false`、原生会话身份匹配策略和连接器能力感知策略。
- 测试副本 `acceptance/models/sample-lighting-model-验收-v031.rvt` 连续五次上下文读取稳定：identity `bdc92c33783d823e21649b0ca8166820`、revision 0、未修改；模型统计为 44 灯具、7 照明设备、1 配电箱、3 回路、51 导线。
- 已完成只读自然语言建模前置验收：房间 103（办公室1 103）边界可布局、照明类型“无装饰暗装照明设备/300x1200”解析到 2287444、开关类型“照明开关/单极”解析到 2288543；导出当前照明平面 PNG，模型未写入、未保存。证据：`acceptance/lighting-survey-v034-20261003-pid32464.json`。
- 已生成新的执行期回滚预览，planId `df84b33f330d3318fe7eb8bfc27f3517`，状态仍为 pending，尚未提交；必须等待聊天确认后执行。证据：`acceptance/rollback-v034-20261003-pid32464.json`。
- 临时开发输出编译 0 警告、0 错误；核心安全/生命周期测试 34 项通过；MCP/SDK 测试 77 项通过。运行中 DLL 未被覆盖。

## v0.3.5 开发变更（待重启实机验收）
- 保留旧版照明族的实际放置语义：当前项目的“无装饰暗装照明设备/300x1200”是 `WorkPlaneBased`，新版计划在类型已读取确认后使用显式 `placementMode=legacyPoint`，不再错误地把它当作普通 OneLevelBased 族拒绝；计划预览会说明这不是宿主绑定承诺。
- 照明场景组合器扩展为可选的显式开关、开关控制导线、照明平面图、灯具明细表、配电盘明细表和图纸/视口；墙体、面向、坐标、标题栏、纸面位置和配电箱连接器均必须由助手先读取并写入预览，不自动猜测。
- 配电盘明细表使用原生 `name` 字段创建，避免把视图名称误当成普通可写参数。
- v0.3.5 临时开发输出编译 0 警告、0 错误；Node MCP/SDK 测试 85 项通过；核心测试 34 项通过。以上新增写入路径尚未在 Revit 实机提交，需重启加载 v0.3.5 后验收。
- 新回滚预览已重新生成（旧预览已过期）：planId `f5c85e556ceee7a8e83ebd0c3fa28416`，有效至 2026-10-03 17:17:27（北京时间），仍待聊天确认；当前 v0.3.4 运行实例未发生模型修改。
- v0.3.5 已安装到 Revit 2027 插件清单，但必须在保存后重启 Revit 才会替换当前已加载的 v0.3.4；旧版 2025 文件未改动。
- 更新了 MCP 健康检查、官方只读代理、发现脚本和使用文档的版本标记至 v0.3.5；官方 Public MCP 仍未安装，发现脚本明确返回 NOT_INSTALLED，未用自定义代理冒充官方联调。


## 2026-10-03 照明执行与验收修正（v0.3.5，尚未实机加载）
- 修正 legacyPoint 执行分支：改为与旧版 place-lighting.csx 相同的 XYZ+symbol+StructuralType 重载，不再误用带标高重载。创建后原生 XYZ 偏差超过1毫米即回滚；这不是宿主/标高关联承诺。
- legacyPoint 仅适用于已核验的 WorkPlaneBased 照明族，禁止同时传宿主；在旧 DLL 缺少能力时，MCP 会明确拒绝创建计划，不会静默忽略新增字段。
- 按旧版保留导线拐点高度来源，并在执行期调用原生 Wire.AreVertexPointsValid；导线失败仍整组回滚。
- 扩展只读模型证据：实际 typeId、hostId、标高/视图、回路名称与成员、导线端点互连引用和顶点、明细表字段、图框类型及纸面位置。不可查询端点保持未知。
- 新增 lighting-acceptance.mjs / lighting-verification.mjs：只准备预览和检查已执行结果，不包含自动提交；不以数量增加、图片存在或 pending 计划冒充验收通过。
- 最新本轮验证：独立 v0.3.5 编译0警告0错误，37项核心测试和101项Node/SDK测试通过。其中业务验证器用合成证据测试，新增写入路径仍须真实验收。
- 先前 f5c85e556ceee7a8e83ebd0c3fa28416 的有效期已过（2026-10-03 17:17:27，北京时间），未收到聊天批准、未执行；不自动刷新或复用。
- 官方支持范围在官方浏览器文档再次核验，独立组件仍缺失；证据在 acceptance/official-support-check-20261003.json，不冒充官方接通。

- 实际安装清单已只读核验指向新版035 DLL；当前进程仍运行034。旧计划原生状态确认为 expired，receipt=null。真实能力拦截检查通过且 revision/isModified 未变，证据在 acceptance/staged-v035-readonly-guard-20261003.json。


## 2026-10-03 v0.3.5 已加载后的真实预览
- 运行实例PID35792、Revit27.3.0.28、插件0.3.5、7项原生能力已核验；当前测试副本identity a639db1a4911ee22eaebf5c60881cbbc，revision0，未修改。
- 房间边界、类型、墙体线段、开关宿主、配电箱端口和图片导出已完成真实只读核验。照明场景采用当前实际开关类型 THS_开关_单级开关/单控（2093409），不猜用旧脚本参考族。
- 回滚测试新计划 245de41437b9e99266e592be113b60f5：OFF1-02改注释→删除→访问失败，待聊天确认。基线记录acceptance/rollback-v035-20261003-pid35792.json。
- 照明场景新计划 6bbb49be2ce6cb8cb7d869fd3fb3ffe8：办公室103新增4灯、1开关、AL1新增回路、5导线、1视图、1灯具表、1图纸/视口，共15个创建操作；保留现有模型，不重建已有AL1配电盘明细表。记录acceptance/lighting-scene-v035-20261003-pid35792.json。
- 两项都是原生验证后的待确认预览，尚未执行。不保存RVT，执行后必须检验真实收据、参数、关联与图片，不以预览成功冒充业务验收。

- 用户于旧计划过期后确认两项测试；18:35只读核验时旧计划均expired且receipt为空。未绕过到期检查。新预览 ea645e53ea224a05526bcd319fd2cdae 与 05adf6abaadd594ca5d90f057698220e 的操作及模型基线逐项比对完全相同，仍待新有效预览的聊天确认；记录 acceptance/preview-refresh-r2-20261003.json。


## 2026-10-03 真实执行期回滚已通过
- 已批准的回滚计划 ea645e53ea224a05526bcd319fd2cdae 仅提交一次，前2步真实执行，第3步因删除后访问失败。原生收据rolledBack=true；独立核验恢复精确电气基线，验收PASS，未保存模型。证据 acceptance/rollback-v035-20261003-pid35792-r2.json.verified.json。
- Revit随后产生TransactionRolledBack事件：revision0→1，added/modified/deleted均为空，isModified=false。已真实验证变更历史能解释旧预览失效；没有绕过修订号保护。
- 之前并列生成的照明计划绑定revision0，回滚后未被提交。更新后的照明计划 3c7dd58dffdc7e5ea8a55bc44c5fa5de 绑定revision1，逐项比对操作与原预览完全相同，模型数量基线相同；仅待该新预览批准，不再重做回滚。
- 后续验收顺序必须为回滚执行→完整核验→照明预览→聊天批准→照明执行；不得并列生成跨事务的预览，再以“模型没变”为理由绕过revision。


## v0.3.6 确认等待窗口修复（已安装，尚未加载）
- 用户再次确认照明时，r3计划已于2026-10-03 19:02:52到期；19:07只读核验确认模型修订号仍1且元素数量未变。没有提交照明写入。
- 用真实PlanLifecycle代码新增“等待聊天确认30分钟”回归测试，先复现plan_expired，再修复通过。默认预览有效期改为120分钟；私有planLifetimeMinutes允许15..480分钟，仍有明确到期边界。
- 保留文档身份/修订号、一次聊天确认、重复提交保护、取消、单事务执行、完整回滚和不保存RVT。没有复活或强行提交已过期计划。
- v0.3.6编译0警告0错误，44项核心测试、101项Node/SDK测试通过。实际安装清单已核验指向chat-036 DLL；私有配置已核验120分钟，不显示令牌。
- 当前Revit进程35792仍加载0.3.5，新等待策略须用户完全退出并重启Revit才会加载。回滚实机验收已PASS，不再重做；照明和官方MCP真实联调仍未完成。


## 2026-10-03 v0.3.6 两小时策略已真实加载
- 原生bridge核验版本0.3.6、plan-lifetime-policy已加载、planLifetimeMinutes=120；进程PID57272，测试副本identity 9a15d1c0c1f3cfdccab04a744fb48909，revision0、未修改。
- 7项现有族/宿主/配电箱/导线/视图/图框资源再次核验。照明预览 60e0d5e2648c1517b7599dab41f0f35c 已原生验证并返回两小时有效期，expiresAtUtc=2026-10-03T13:35:15.4242099Z。操作及模型数量基线与先前照明方案逐项比对一致。
- 本轮仅查询和生成预览，未提交照明修改或保存RVT。回滚验收已于v0.3.5真实通过，不重做。当前待新会话这份有效照明预览的聊天批准。


## 2026-10-03 v0.3.6 照明实际写入完成，视觉出图仍需优化
- 已批准计划 60e0d5e2648c1517b7599dab41f0f35c 提交一次，原生事务committed，15项操作完成，warnings为空，saved=false。
- 新增4灯、1开关、1回路、5导线、1视图、1灯具表、1图纸/视口。计数44→48灯、7→8开关、3→4回路、51→56导线、2→3图纸；回路编号4、连接AL1、5个成员准确。
- 原生参数/坐标/宿主/连接器/明细表/纸面XY核验15项PASS。证据 acceptance/lighting-scene-v036-20261003-pid57272.json.verified.json。
- 修正核验器误把Viewport.GetBoxCenter返回Z=23毫米当作纸面偏移的问题；实际纸面X=420、Y=280符合预览。保留原始Z证据，模型安装高度检查仍严格。新增实际数据回归先红后绿；Node/SDK测试105项通过。未为此修改或移动视口，无须重启插件。
- 视觉检查另行记录为NEEDS_VIEW_CONFIGURATION：新视图/图纸灯具符号未正确显示，现有电气视图能显示新旧灯具。视图范围、类别显示和裁剪的具体原因尚待只读API扩展及诊断；不能把文件导出或参数PASS冒充完整出图验收。证据 acceptance/lighting-scene-v036-20261003-pid57272.json.visual-review.json。
- 当前真实建模执行链路已跑通，但完整目标尚未达成：专业出图显示仍需改善，官方Public MCP真实接通仍未完成。不得自动保存当前有新建元素的模型或重启丢失修改。


## v0.3.7 视图查询/配置已安装（尚未实机加载）
- 用户保存后只读核验：原有48灯、8开关、4回路、56导线和3图纸保留，isModified=false；本轮未提交模型写入。
- 新增原生ViewConfigurationService、view.get和configure_view受控操作，复用显式成功视图的范围、矩形裁剪和照明类别规则；目标Electrical与纸面居中可明确指定，不修改参考或模型元素。
- 接入房间照明newView.referenceViewId，避免未来忽略视图显示设置；验收器兼容修改操作并保留像素核验要求。
- 新编译产物chat-037与真实安装清单已核验，仍保持120分钟审批窗口。51核心测试与115Node/SDK测试通过。
- 当前运行DLL仍需人工重启后读取新旧视图的原生范围/类别规则，生成并批准一份设置-only预览后再实机修图；目前不声称灯具显示问题已修好。

- 2026-10-03核实Autodesk官方MCP下载渠道：账号Products and Services → Revit → View Details → Extensions（2026-09-07官方支持文章）。明确Read-Tools配置、安装前客户端配置备份、2027.2限定与本机2027.3兼容性未验证；证据 acceptance/official-acquisition-20261003.json。获取渠道已明确，组件安装和实机接通仍未完成。


## 2026-10-03 v0.3.7 真实视图诊断与待确认修正
- PID57124加载0.3.7，测试副本保存状态isModified=false，48灯/8开关/4回路/56导线保留；本轮无模型写入。
- 原生范围诊断：新视图顶部约2300毫米，低于3000毫米灯具高度；参考视图顶部4000毫米。四个照明类别均未隐藏。参考视图灯具范围内候选48，新视图仅1，明确定位视图范围问题，不是族/元素缺失。
- 修正预览 37cb056d5181cd2ccdc7ad914f3b84ef 已验证：仅配置目标2295719和视口2295745，复制参考770796的有效范围/矩形裁剪/精细显示及照明类别规则，目标规程Electrical，视口纸面420/280。参考视图和完整电气基线在预览前后不变。
- 当前仍为PREVIEW_ONLY，等待聊天批准；有效至2026-10-03T15:47:37.4848496Z。执行后还需原生设置核验和PNG视觉核验，不提前宣称显示已修好。


## 2026-10-03 视图范围修正真实执行并通过
- 37cb056d5181cd2ccdc7ad914f3b84ef已获聊天批准并提交一次，committed、完成1项、创建0元素、只修改2295719和2295745、无警告、不保存。
- 原生设置核验和完整电气基线不变检查通过；参考视图未变。新视图范围内灯具候选由1变48，PNG真实确认灯具符号已显示。
- 修正验收器平面CropBox.Z误判：Autodesk明确平面裁剪Z无实际意义；X/Y裁剪及实际viewRange各平面高度仍严格检查。保留原始Z，真实证据回归先红后绿，Node/SDK118项通过。
- 图纸整体仍未通过视觉验收：部分视图内容偏出纸面。读取Revit2027新定位参数得知旧box center为420/280，但新视口锚点仍ViewOrigin，实际VIEW_POSITION_X/Y=0。尚需验证锚点与位置一致性修复，不凭猜测宣称成图完成。
- 已生成视口-only预览f4aa131ea62220d5477a76ea7987c918，设置VIEW_ANCHOR=Center、实际X=420mm/Y=280mm，3项参数操作仅涉及2295745；待聊天批准，不需再重启。

- 视图修正已提交，灯具显示PNG验收通过；图纸仍偏左下。新增v0.3.8只读Viewport框/标签框/投影变换诊断，避免继续猜锚点。需要重启加载后再读2295745的实际box/label/projection；不自动移动或保存。

- v0.3.8已读到视口框/投影，证明锚点420/280但图纸视觉仍偏左下。v0.3.9新增只读图纸UV边界、图框BoundingBox和所有视口边界，用于计算纸面坐标系差异；不自动猜移动。需要重启加载。

## 视口中心修正最终验收
- v0.3.9 已加载并完成图纸UV/图框/视口几何诊断。A1图框实际范围 U=348.5..1189.5、V约-1..593，真实中心 U=769、V=296。
- 视口中心修正计划已提交一次，视口2295745锚点为Center、纸面中心为769/296；只改变视口，未改变模型元素。
- 最终图纸PNG：C:\src\revit-auto\exports\d59b00314fe52e913e7a04cc969dcb5a\view - 图纸 - AI-E035 - AI-V035 办公室1照明验收图.png；图纸内容已居中，灯具符号和导线可见。
- 当前模型元素数量保持48灯、8开关、4回路、56导线、3图纸；视口修正后模型为未保存状态，需用户手动保存测试副本。
- 官方 Autodesk Read-Tools MCP 仍未安装，整体目标尚未完成。

## 2026-10-04 官方 MCP 最终本机审计
- 扫描用户常见下载目录、项目目录、Program Files/ProgramData Autodesk 目录后，官方 Read-Tools 可执行文件仍不存在。
- `mcp-server-for-revit-1.0.0.tgz` 已只读解包确认是 GitHub 社区项目 `mcp-servers-for-revit/mcp-servers-for-revit`，MIT/npx/WebSocket 方案，包含 `send_code_to_revit` 等旧社区工具；它不是 Autodesk Public MCP，不能冒充官方组件或替换统一写入通道。
- Autodesk ODIS 缓存和已安装2027组件未发现可运行的官方 RevitMcpServer.Stdio.exe；没有运行或安装未知包。
- 本地新版自然语言建模链路、真实回滚、照明建模、视图修正和验收证据已完成；总目标仅剩官方 Read-Tools 获取/安装/联调，该步骤需要用户从 Autodesk Account 获取官方安装包或完成账户授权，当前没有可安全替代的本地动作。

## 2026-10-03 Codex 社区版 MCP 实际接入验收
- 已将本机 Codex 配置最小合并为 `revit-custom` stdio 节点，修改前生成了可恢复备份；没有注册 Autodesk MCP、旧 WebSocket MCP 或 `send_code_to_revit`。
- `codex mcp get revit-custom` 已确认 command 为本机 Node，args 指向 `mcp/revit-custom.mjs`，startup timeout 为120秒。
- Codex CLI 已真实发现并调用 `revit_context_get` 和 `revit_type_resolve`，不是 mock：当前项目 identity `50aaf1ce4bbf307097f604a66787ca49`、revision 1、`isModified=false`，解析“视图标题/视图标题”为类型 4169。
- 只读烟测没有调用 `revit_plan_confirm` 或 `revit_import_commit`，模型写入数为0；灯具48、照明设备8、配电箱1、回路4、导线56、图纸3的计数保持不变。
- Claude Code 专用配置只包含 `revit-custom`，配置检查通过；Revit 插件和2025配置未改动。
- 证据：`acceptance/codex-mcp-20261003.json`。配置脚本和 fixture 回归测试：`install-codex-revit-custom.ps1`、`tests/test-codex-mcp-config.ps1`。
- 最新 Node/MCP 测试仍为118项通过、0失败。Codex 会话报告了两个与本次 MCP 无关的旧配置字段被忽略，但不影响发现和只读烟测。

## 2026-10-03 建筑通用建模首轮真实验收
- 在同一测试副本中通过社区版 MCP 生成并经聊天确认执行 `architecture.build` 计划 `79cc790ed97ca4a9df215f600e4ff0a2`。
- 成功创建2条轴网、4面墙、1块楼板、1樘门、1樘窗和1个房间；总计10项计划操作，warnings为空，Revit无二次确认。
- 原生核验：门 `AI-ARCH-DOOR-01` ID 2295767 正确宿主墙2295751；窗 `AI-ARCH-WINDOW-01` ID 2295769 正确宿主墙2295753；房间 `AI-ARCH-001` ID 2295770 位于1F并成功封闭，面积约15㎡。
- 模型统计由9轴网/9墙/5门/12窗/1楼板/6房间变为11轴网/13墙/6门/13窗/2楼板/7房间；照明、电气计数保持48灯、8照明设备、1配电箱、4回路、56导线。
- revision由1变为2，`isModified=true`，插件不自动保存；等待用户保存测试副本后继续建筑视图、明细表和图纸预览。
- Revit原生变更日志记录了21个added、6个modified、4个deleted系统级变化；请求的10项引用和类别计数已核对，完整证据见 `acceptance/architecture-scene-20261003.json`。

## 2026-10-03 建筑视图、明细表和图纸真实验收
- 在已保存的建筑测试副本上，经聊天确认提交计划 `41d8886d7cc01311e0415fc6cefce7ea`，成功创建建筑1F平面视图、房间明细表、A1图纸、视口、明细表视口和房间标记，共6项操作，无警告、无Revit二次确认。
- 原生核验：视图2295811为1F楼层平面、比例1:100；明细表2295821包含编号/名称/面积字段；图纸2295825为AI-A040；视口和明细表视口位置分别为420/350和650/120毫米；房间标记2295836位于新建房间内。
- 导出PNG并完成视觉核验：建筑平面、测试房间、房间标记、房间明细表和AI-A040标题栏均可见。证据：`acceptance/architecture-drawing-20261003.json` 和对应 exports PNG。
- revision由2变为3，当前 `isModified=true`，导出不保存RVT；需要用户再次保存测试副本后，建筑首轮目标才算保存完成。

## 2026-10-04 泵房机电首轮真实验收
- 在已保存的测试副本上，经聊天确认提交计划 `c218f26957ae178954bdfa5cdc016802`，成功创建1个水泵、1段冷冻水管、1段送风管和1个1F机电平面视图，共4项计划操作，warnings为空、无Revit二次确认。
- 原生搜索核验：泵 `AI-PUMP-01` ID 2295837、类型 `水泵/水泵`；管道2295838类型 `THS_内外壁热镀锌钢管`、系统类型665532、80毫米、Z=500；风管2295841类型 `THS-镀锌钢板（风管）`、系统类型691266、600x400毫米、Z=2500；视图2295843为1F FloorPlan、比例1:100。
- 计数由11个机械设备、0段管道、12段风管变为12个机械设备、1段管道、13段风管；revision由0变为1，当前未保存。
- 视图PNG已导出，但默认视图范围没有覆盖测试坐标，未把像素显示误判为通过；连接器验收未执行，因为选定水泵类型没有可读取的原生连接器。
- 针对新元素的inspect请求遇到Revit连接关闭，未重复提交计划；plan_get、搜索、上下文计数和导出证据均已核对。完整证据：`acceptance/pump-room-scene-20261004.json`。


## 2026-10-04 显式局部裁剪开发（v0.3.10已安装待加载）
- 用户已批准开发cropBounds，保持仅聊天确认与统一写入；官方MCP继续不接入。
- 新增MCP/C#严格XY矩形校验、原生平面/坐标框架校验、目标裁剪设置与执行后回读校验；旧插件缺少explicit-crop-bounds能力时计划不转发。
- 使用独立net10.0-windows-v27-chat-0310输出，保留039 DLL；插件清单已备份并指向0.3.10，没有改客户端配置，没有关闭Revit。
- 已完成测试先红后绿，编译0警告0错误、57项核心测试与130项Node/MCP测试通过。实际运行仍为0.3.9（PID17572）。
- 只读核对保存状态：documentIdentity=203454726b0018753dfeba77c5ef9593、revision=2、isModified=false；设备12/管道1/风管13，其余计数保持；本轮模型写入和保存均为0。
- 纠正此前诊断：AI-V041的裁剪开关原先为false，不能从旧CropBox最大X断定被裁掉；风管2500毫米超过顶部2300毫米已确认。泵的族类型无连接器不能证明实例无连接器。之前证据中的管径/系统值来自计划，inspect断连尚未核验这些原生参数。
- 本轮只完成开发/安装，不宣称实机裁剪或设备连接验收通过。重启加载后需以新上下文重新预览，获批准后仅修目标视图并做原生/PNG核验。
- 证据：acceptance/explicit-crop-development-0310-20261004.json；用法：docs/explicit-crop-bounds.md。


## 2026-10-04 v0.3.10实机加载与泵房视图新预览
- 真实桥接确认0.3.10、PID36592、explicit-crop-bounds已加载；测试副本身份75ad3b06b5e219ddbd785053040d0f6e、revision0、isModified=false。
- 新计划05ef8cb4b5b0eb275115dc6e8cdb24e7仅含1项configure_view：目标2295843，参考770350；复制顶部4000毫米/视图范围/精细线框显示，指定Mechanical规程，显式裁剪X32000..38000、Y16000..22000毫米。
- 预览后原生源/目标设置与全部类别计数均不变，无警告、无模型写入。尚待聊天批准，不声称显示已修好。
- 预览证据：acceptance/pump-view-crop-v0310-20261004-05ef8cb4b5b0eb275115dc6e8cdb24e7.json。

## 2026-10-04 泵房视图局部裁剪真实验收通过
- 计划 `05ef8cb4b5b0eb275115dc6e8cdb24e7` 已经用户聊天确认并提交；仅修改视图2295843，无创建元素、无警告、无Revit二次确认、未保存RVT。
- 原生核验：目标顶部4000毫米、切面1200毫米、Mechanical规程、Fine、Wireframe；CropBox active=true、visible=false、X32000..38000、Y16000..22000、Z保留原生值；参考视图770350未改变。
- 模型计数保持：机械设备12、管道1、风管13，照明/建筑数据不变；PNG显示水泵、冷冻水管和送风管均可见。
- revision由0变为1，当前isModified=true，需要用户保存副本。证据：`acceptance/pump-view-crop-v0310-20261004-05ef8cb4b5b0eb275115dc6e8cdb24e7.json.verified.json`，PNG位于`exports/dbe0a76a68ea8209f9ba9b8ed7d7128c/`。
- 本轮只完成视图显示验收，不宣称管道系统连接或管件连接通过；设备连接仍需单独读取真实FamilyInstance连接器后再预览。

## 2026-10-04 泵管道 inspect 稳定性修复（v0.3.11待重启加载）
- 真实只读检查已确认水泵2295837有两个圆形管道连接器：2和3，均未连接；供水/回水管径原生参数均为100毫米。
- 现有管道2295838的inspect请求仍会导致Revit连接提前关闭，未猜测其连接器编号、未执行连接计划。
- 修复RevitQueryService连接器查询：ConnectorManager获取、ConnectorSet遍历、单个Connector读取均有隔离异常保护；异常返回只读诊断字段，不再丢失整个inspect响应或中止桥接连接。
- 新输出v0.3.11：`v27/bin/Release/net10.0-windows-v27-chat-0311/RevitAutoV27.dll`；编译0警告0错误；57项核心测试、131项Node/MCP测试通过；v0.3.10仍在运行，已保留并备份清单。
- 当前模型identity `75ad3b06b5e219ddbd785053040d0f6e`、revision1、isModified=false；本轮模型写入和保存均为0。
- 下次重启加载v0.3.11后，再对2295838执行只读inspect；只有拿到真实管道连接器ID、端点和系统域，才生成管道连接预览。证据与输出目录沿用acceptance及v27/build-connector-0311.log。

## 2026-10-04 管道连接器枚举保护二次修复（v0.3.12待重启加载）
- 已确认当前运行版本为v0.3.11，插件能力列表正常；水泵2295837可稳定读取2/3号圆形未连接管道连接器；管道2295838仍在ConnectorSet枚举阶段中断桥接。
- v0.3.12进一步把ConnectorSet枚举器本身纳入异常边界，枚举失败返回`connectorReadStatus=enumeration-failed`只读诊断，不再关闭整个inspect连接。
- v0.3.12编译0警告0错误，57项核心测试、131项Node/MCP测试通过；已保留0311 DLL并备份清单，下一次Revit启动加载0312。
- 当前新会话documentIdentity=f4a48671647db87a79437c78237adfc3、revision=0、isModified=false；没有模型写入。`changes.get`使用旧identity会被正确拒绝，未绕过身份校验。
- 0312加载后先只读inspect管道2295838；成功获得真实连接器后再生成连接计划，失败则记录诊断并不猜ID、不写模型。

## 2026-10-04 管道 inspect 参数读取保护（v0.3.13待重启加载）
- v0.3.12已加载但管道2295838 inspect仍中断；水泵2295837可正常读取，说明问题可能发生在管道参数枚举/参数值读取，而非单纯ConnectorSet枚举。
- v0.3.13新增ParameterSet获取、参数枚举、单个参数值读取的逐项异常隔离；失败返回parameterReadStatus/parameterReadError，不丢失整条inspect响应。
- v0.3.13编译0警告0错误，57项核心测试、131项Node/MCP测试通过；0312 DLL保留并备份清单，下一次Revit启动加载0313。
- 当前会话模型未修改；没有连接计划、没有模型写入、没有自动保存。
- 0313加载后先检查2295838；成功后记录管道真实连接器，仍需新预览和聊天确认才能连接。

## 2026-10-04 Pipe安全降级（v0.3.14待重启加载）
- v0.3.13仍无法安全读取管道2295838的连接器集合；为避免Revit原生Pipe Connector API继续中断桥接，v0.3.14对Pipe inspect采用安全降级：返回管道端点证据，明确`connectorsSupported=false`、连接器ID未知，不再调用危险的Pipe连接器集合枚举。
- v0.3.14编译0警告0错误，57项核心测试、132项Node/MCP测试通过；0133 DLL保留并备份清单，下一次Revit启动加载0314。
- 该降级不会伪造连接器，也不会允许连接计划绕过真实ID；泵房连接验收仍停在只读端点/连接器能力边界，必须有真实连接器证据才写入。
- 当前模型没有新增计划、写入或保存。


## 2026-10-04 v0.3.15安全Pipe inspect验收
- v0.3.15已加载（PID33524）；Pipe2295838 inspect不再中断，返回最小安全结果：端点(34500,18000,500)到(37000,18000,500)，connectorReadStatus=pipe-safe-minimal，connectorsSupported=false，连接器ID未知。
- 水泵2295837真实连接器2/3均为DomainPiping且未连接；连接器位置已读取。当前泵原生供回水管径100毫米，现有管道预览使用K_CHWS系统/80毫米，系统分类和管径也不兼容，未生成连接计划。
- 结论：查询稳定性目标通过；管道连接目标尚未通过。下一步需要确定性连接器解析能力（按Domain/Shape/Point匹配，唯一匹配才允许预览），并使用兼容的循环供水系统和100毫米管径。证据：acceptance/pump-pipe-inspection-v0315-20261004.json。

## 2026-10-04 确定性连接器解析开发（v0.3.16待重启加载）
- 用户已确认下一步。新增只读API `revit.connector.resolve`：按elementId、domain、shape、项目坐标point和toleranceMm匹配；只允许唯一匹配返回connectorId，零匹配/多匹配/能力不可用均返回状态，不猜测。
- Pipe采用有界原生Lookup探测，不枚举不稳定ConnectorSet；FamilyInstance/其他MEP曲线保留安全读取。新增native feature `connector-resolution`，旧插件在请求前拒绝，不静默忽略。
- v0.3.16编译0警告0错误，57项核心测试、134项Node/MCP测试通过；当前v0.3.15仍运行，0316输出和清单已备份，下一次Revit启动加载。
- 连接计划尚未生成；当前系统/管径兼容性仍需使用解析结果确认：泵为循环供水、供回水100毫米，现有管道计划为K_CHWS/80毫米，不直接连接。

## 2026-10-04 v0.3.17确定性连接执行链开发完成（待重启实机验证）
- 已通过只读解析验证：水泵2295837连接器2/3，现有管道2295838连接器0/1；解析使用DomainPiping/Round/项目点位/2毫米容差，均为唯一匹配。
- 新增严格Connector criteria：连接操作两侧必须二选一使用真实ID或criteria；新建Pipe/Duct引用禁止预测端口ID，预览按端点唯一匹配，执行再读原生连接器。
- 直接连接执行增加域、形状、系统分类、圆形直径、轴向、占用状态和执行后IsConnectedTo校验；不兼容时整组失败回滚。
- 修复非有限原生数值导致JSON响应崩溃：NaN/Infinity变为未知参数诊断，序列化失败返回有效错误封套；新增57核心/140 MCP测试全通过。
- v0.3.17已编译并清单指向下次加载；当前运行仍为v0.3.16，没有生成连接计划、没有模型写入。重启后先读取四个连接器的方向/直径/系统分类，再按兼容性决定是否生成100毫米循环供水路线预览。
- 当前水泵供回水原生100毫米/循环供水，旧管道预览80毫米/K_CHWS；不会直接连接这两个不兼容对象。

## 2026-10-04 泵管连接计划执行失败并完整回滚（v0.3.17）
- 用户在聊天中明确批准计划 a8ed98599d30270fa5c0460bdafd3a23，提交同一未变更计划一次。完成第1项创建管道，第2项 connect_elements 被执行期系统分类校验拒绝：Direct piping system classifications differ. 没有自动重试、替换计划或绕过校验。
- 原生收据：status=failed、rolledBack=true、completedOperationCount=1、failedOperationIndex=2、createdElementIds为空。完整基线核验恢复：水泵/原管道所有返回参数、真实连接器状态与点位、管道搜索几何、管件列表、全部类别计数、当前视图和保存状态；比较采用现有normalizedItem消除无语义的ConnectorSet返回顺序变化，没有删除真实字段差异。
- 当前identity=4d9728c7527d82c479e4afadd0069969、revision=1、isModified=false；TransactionRolledBack触发revision从0到1，任何后续计划都须重新基于当前版本生成，不复用旧批准。
- 泵房连接目标尚未完成。只读检查1887577和665532类型均显示“循环供水”分类；因此不能把执行期差异直接断言为类型名字不兼容，应增加双方实际分类/元素ID的可读诊断并核对新建管道状态，保留安全拒绝。
- 另发现原路线第8项弯头与第9项变径都使用pumpRoute4同一终点(34500,18000,500)，且第8项会消耗/移动该端口。下一份路线必须消除此端口重复占用，而不是按原几何继续重试。
- 本轮没有提交其他模型写入，没有自动保存/关闭Revit。证据：acceptance/pump-connection-v0317-a8ed98599d30270fa5c0460bdafd3a23.baseline.json.verified.json，状态PASS_FULL_ROLLBACK_CONNECTION_NOT_PASSED。

## 2026-10-04 v0.3.18 泵管连接失败修复（待重启加载）
- 复现并定位上一次失败：执行期比较了新建管道连接器的即时 `Connector.PipeSystemType`，未优先采用计划指定的原生 `systemTypeId`；新管道尚未加入系统时该即时值可能为Undefined，导致错误拒绝。v0.3.18在执行期使用计划指定的PipingSystemType/SystemClassification作为新建管道证据，并保留冲突时拒绝。
- 新增原生PipingCompatibilityService/Rules：连接器即时分类、元素原生分配系统类型和计划系统类型分层取证；错误收据带causeCode/causeDetails，便于定位双方元素/端口。
- 新增ConnectionPortClaims和MCP validatePortReservations：同一原生端口、同一新曲线端点不能被多个弯头/变径/连接操作重复消费；原失败路线的route4终点重复使用会在预览阶段拒绝。
- 预览/执行均保留域、形状、直径、方向、占用和执行后连接状态检查；不绕过Revit约束，不自动重试旧计划。
- v0.3.18编译0警告0错误，77项核心测试、149项Node/MCP测试通过；已安装供下次加载，当前运行仍为v0.3.17。模型未新增写入。
- 修正后的下一条路线应删除route4重复端口设计：route1垂直、route2水平、route3垂直、route4水平到既有管道端点；弯头只使用各段不同端点，末端再做变径。必须重新预览和聊天确认。

## 2026-10-04 v0.3.19端口预留执行修复（待重启加载）
- 已定位上一份修正路线的执行失败原因：运行中的v0.3.18在预检查和执行阶段共用端口预留状态，第二次验证同一水泵端口3时误报 `connector_already_reserved`；这不是模型端口真实重复占用。
- v0.3.19移除执行阶段的重复登记，端口重复保护只在计划预览校验阶段执行；同一计划中的真实端点仍由MCP预检阻止，执行器只使用当前事务中真实连接器。
- v0.3.19同时保留新建管道的计划系统类型证据，避免未入系统的新Pipe即时分类为Undefined导致错误拒绝；实际分类冲突、未知分类、管径/方向/占用不匹配仍拒绝并回滚。
- 当前失败计划adb5e77b04eb2dedaf9854a9c19bf27e已由v0.3.18执行失败并完整回滚；revision由0增至1，模型保存状态为false。不得重试旧planId，必须基于重启后的当前identity/revision重新预览。
- v0.3.19编译0警告0错误，77项核心测试、149项Node/MCP测试通过；输出：`v27/bin/Release/net10.0-windows-v27-chat-0319/RevitAutoV27.dll`。清单已指向下次启动加载，当前运行仍为v0.3.18。
- 下一步：用户重启加载v0.3.19后，读取当前identity/revision与水泵/管道连接器，再生成新的不重复端口路线预览；不自动执行、不复用旧确认。

## 2026-10-04 v0.3.20端口状态与系统证据修复（待重启加载）
- 复现并定位v0.3.18连接失败的第二个问题：ModelExecutor预检查阶段与执行阶段共用端口预留状态，执行同一操作再次登记水泵端口3，误报connector_already_reserved；v0.3.20移除执行阶段重复登记，端口重复只在PlanRules/ConnectionPortReservationRules预检阶段拒绝。
- 新建Pipe/duct的执行期系统分类使用计划指定的原生systemTypeId证据，连接器即时Undefined不会错误拒绝；真实系统分类冲突/未知仍拒绝。
- 原路线已由预检测试固定为失败：route4同一端点被弯头和变径重复占用，不能再次使用。
- v0.3.20编译0警告0错误，77项核心测试、149项Node/MCP测试通过；输出目录`v27/bin/Release/net10.0-windows-v27-chat-0320`，清单当前仍指向0318，下一步安装清单到0320并由用户重启。
- 上次计划adb5e77b04eb2dedaf9854a9c19bf27e已完整回滚，当前模型未修改；不得复用旧planId/旧identity/旧确认。

## 2026-10-04 v0.3.20 已加载与泵房连接新预览（待聊天确认）
- 已通过实际加载程序集和 `revit.bridge.info` 双重核对：运行版本为 v0.3.20（PID 6060），Revit 2027.3 / Build 27.3.0.28；确认模式为 chat，`requiresRevitConfirmation=false`。本轮无需再重启。
- 当前测试副本文档为“sample-lighting-model-验收-v031”，会话 identity 为 78092abd667c891bbbeb8886f80fdbc9，revision=0，isModified=false。这些会话字段仅用于本轮验收，切换/重启后必须重新读取。
- 唯一原生连接器解析核对了水泵 2295837 端口 3（200 mm）和管道 2295838 端口 0（80 mm）。两端均明确未连接且 peers 为空，轴线分别为 +Y、-X；双方原生系统分类为 SupplyHydronic。没有把未知连接状态当作未连接。
- 新预览 1ef6505cbc0cd1356857dc0371bdc5d7 已通过校验，9 项操作：4 段 200 mm 管道、3 个弯头、1 个 200→80 mm 变径和 1 次水泵直连。采用现有管道的原生 systemTypeId=665532 与 pipeTypeId=1887580；路线依次为 +Y、-X、-Y、+X，各弯头和变径使用不同端点。
- 已保存完整原生基线与预览证据到本机 acceptance/pump-route-v0320-78092abd667c891bbbeb8886f80fdbc9-r0.baseline.json 和对应 .preview.json。预览前后 identity、revision、类别数量、活动视图、保存状态、水泵/管道/类型的原生 inspect 结果和管件列表均一致，状态为 PASS_PREVIEW_NO_MODEL_MUTATION_AWAITING_CHAT_APPROVAL。
- 本轮重新运行 77 项核心测试、149 项 Node/MCP 测试，全部通过；日志为 v27/core-piping-0320-recheck.log 与 v27/node-piping-0320-recheck.log。测试通过不能替代模型提交后的真实连接验收。
- 计划仍为 pending，尚未获批、尚未执行。不得复用上次失败计划或旧确认。聊天确认后仅提交同一有效 planId 一次，核对完整回执、管道/管件数量、连接 peers、原生系统分类与管径；异常必须核对回滚证据，不自动重试或保存。
- 此路线仅作功能验收；未进行碰撞、维修净距、水力计算或工程合规验收。管件生成时 Revit 可能修整连接端点，最终几何必须再次读取，不能用计划坐标冒充成品坐标。验收基线及模型路径受 .gitignore 保护，不进入公开仓库。

## 2026-10-04 v0.3.20 泵房连接真实提交验收通过（待用户保存）
- 用户在聊天中明确批准“确认泵房连接测试”后，核对同一计划仍为 pending、文档 revision 仍为 0、变更历史为空；仅调用一次 confirm，执行计划 1ef6505cbc0cd1356857dc0371bdc5d7，不复用旧批准、不增加 Revit 确认。
- 回执 committed，9 项操作全部完成，新增 8 个元素：4 段管道和 4 个管件（3 弯头、1 变径），无警告，saved=false。文档 revision=1、isModified=true，等待用户手动保存。
- 使用提交后的实际 inspect、唯一端口解析、原生系统参数与 peers 逐项核验，17 项检查全部通过。真实链路为水泵→route1→elbow1→route2→elbow2→route3→elbow3→route4→reducer→既有管道，每一侧连接状态与对应物理 peer 均可查询并一致。
- 4 段新增管道实际直径均为 200 mm、原管道仍为 80 mm；全部管道的原生类型 1887580、系统类型 665532 和 SupplyHydronic 分类符合预览。3 个弯头两端为 200 mm，变径两端为 200/80 mm。水泵另一端口 2 与原管道远端口 1 的完整 inspect 状态保持不变。
- 当前实际管道为 5 段、管件为 4 个，元素 ID 集合精确匹配原始管道加提交回执中的新增元素。其他已统计类别的元素数量未改变，活动视图未改变。没有用类别数量不变冒充其他元素全部参数不变。
- 提交后读取实际几何确认，Revit 原生弯头/变径修整了新增管道端点；核验记录保留实际坐标，未用计划输入替代原生结果。
- 原生结果证据：acceptance/pump-route-v0320-78092abd667c891bbbeb8886f80fdbc9-r0.committed.json，状态 PASS_COMMITTED_NATIVE_PIPING_CONNECTION；保留完整回执、inspect、系统/直径、物理拓扑与事务历史。
- 已导出并查看既有 AI-V041 泵房机电验收平面 PNG，水泵、回折管道、3 弯头及变径均显示；导出没有模型事务或自动保存。图像和 visual.json 仅为本机证据，受 .gitignore 保护。
- 重要边界：回折管段与水泵存在平面投影重叠，不能以连接/显示成功宣称三维无碰撞或维护净距合格。本轮仅通过真实建模与系统连接功能验收，后续须单独检查并预览任何避让修改。

## 2026-10-04 v0.3.20 用户手动保存核验与后续缺口
- 用户报告已保存后，以只读查询复核当前文档：revision=1、isModified=false；模型文件存在并更新。保存前后的目标元素、管道/管件集合和规范化原生 inspect 数据一致，7 项保存核验通过。没有关闭、重开或由助手保存项目；未声称已独立通过磁盘重开持久化验收。
- 本机证据追加到 acceptance 中对应 .saved.json，状态 PASS_MANUAL_SAVE_AND_NATIVE_CONNECTION_PRESERVED。测试副本、导出图和原生参数详情继续被 .gitignore 排除；本轮仓库提交只包含开发文档。
- 对当前模型运行只读审计后发现 8 条流动方向/流量计算警告，包括 CHWS 1。已提交路线物理连通不代表水力计算或设备流向设计通过；没有修改设备族流向或隐藏/删除警告。
- 复现了现有审计返回的语义问题：unconnectedMechanicalPorts 实际输出全部设备端口，包含 7 个明确已连接端口。源码 RevitQueryService.Audit 直接 SelectMany(Connectors) 而未按可用状态过滤，属于审计结果缺陷；尚未修复、尚未要求用户重新加载 DLL。
- 下一阶段建议首先补齐只读泵房核查：修复“未连接/已连接/未知”三态分类，再按明确元素范围做三维实体碰撞取证。包围盒仅用于候选筛选或明确标为保守维护包络候选，不能冒充精确间距；未知/缺失几何不判通过，净距由用户提供，不擅自套用规范数值。
- 路线避让、设备流向或参数修改仍须单独形成新建模预览并获聊天批准；当前保存成功不构成任何新模型修改授权。

## 2026-10-05 v0.3.21 审计三态修复（待重启加载）
- 修复 `revit.audit.run` 的设备端口审计语义：`unconnectedMechanicalPorts` 现在只包含原生连接状态明确为 false 的端口；新增 `connectedMechanicalPorts` 和 `unknownMechanicalPorts`，分别表示明确已连接和无法可靠读取的端口。
- 新增 `mechanicalPortAudit` 元数据：返回总端口数、实际扫描数、是否因 300 条安全上限截断以及 `connected|unconnected|unknown` 分类协议。未知状态不再被猜测成未连接。
- bridge.info 新增能力 `mechanical-port-audit-tristate`；旧版 DLL 调用审计时会在发送模型请求前返回 `feature_not_loaded`，要求保存并重启加载 v0.3.21。
- v0.3.21构建0警告、0错误；核心测试81项、Node/MCP测试153项全部通过。输出目录为 `v27/bin/Release/net10.0-windows-v27-chat-0321`。
- 当前Revit仍运行v0.3.20，本轮只修改代码/测试/文档，没有修改模型，也没有自动重启Revit。已核对本机安装清单和目标DLL版本，清单指向0321，保存后需手动重启并重新读取当前文档 identity/revision。
- 碰撞、维护净距和CHWS 1流向警告仍未自动修复；必须先通过新版只读审计重新确认三态结果，再设计独立的三维几何核查。

### v0.3.21 安装核验与兼容契约补测
- 已只读检查 `%APPDATA%/Autodesk/Revit/Addins/2027/RevitAutoV27.addin`，目标程序集存在且 FileVersion=0.3.21.0；未关闭或重启当前 Revit，实际运行版本仍为0.3.20。
- 在当前旧插件上运行新 bridge 的只读审计试探，收到 feature_not_loaded，且审计调用前后 identity、revision、保存状态、类别数量保持一致；isModified=false。此结果只证明旧插件能力拦截正常，不表示新版原生三态审计已经实机验收。
- 新增核心测试覆盖 `supported=true` 但连接值为空的未知状态；补充模拟 stdio MCP 往返测试，验证三态原生证据、警告与截断元数据完整保留、审计只读注解及旧插件响应被阻止。完整回归最终为81项核心/153项Node-MCP测试通过。
- 下一步只需用户手动重启Revit加载v0.3.21，读取新identity/revision和三态审计，核对当前水泵已连接端口归入connected、未使用端口归入unconnected，未知诊断独立保留，且查询不修改模型。通过后再进入只读三维碰撞和净距检查开发，不复用之前的写入确认。

## 2026-10-05 v0.3.21 实机三态审计验收通过
- 用户重启并加载 v0.3.21 后，bridge.info 和 `revit.audit.run` 实际返回新版能力；当前文档重新打开后的 identity 为 `61290613d9d030b2530dd2d8012cc154`，revision=0，isModified=false。
- 当前模型机械端口总数52，明确未连接45，明确已连接7，未知0，扫描未截断。三组键集合互斥且完整；查询前后 identity、revision、类别数量、活动视图和选择集保持不变。
- 水泵2295837端口3正确进入 connected，peer为新增管道2295855端口0；水泵端口2正确进入 unconnected。保存后的管道/管件ID及规范化原生inspect证据在重启后仍保持一致。
- 结果状态：`PASS_NATIVE_TRISTATE_AUDIT_AND_REOPEN_PERSISTENCE`。未知状态只由核心/模拟契约覆盖，本次真实模型没有未知连接器，未人为制造异常。
- 当前仍有8条Revit流向/流量警告，包括 CHWS 1；三态端口审计通过不代表水力计算、流向、碰撞或维护净距通过。没有修改模型或自动保存。
- v0.3.21审计阶段完成。下一阶段进入三维碰撞/维护净距只读核查设计；任何避让移动仍须独立预览和聊天确认。

## 2026-10-05 v0.3.22 局部只读碰撞核查实现（待重启实机验收）
- 用户批准设计后实现 revit_collision_check / revit.collision.check。当前identity/revision严格核对；输入数值、类别、模型实例和排除表均拒绝猜测或非法项。
- 查询使用原生局部包围盒筛选、实例变换和完整实体布尔相交。精确碰撞、保守净距候选、未知/截断证据严格分开；不创建临时模型元素，不开事务、不移动设备、不修改/保存RVT。
- 组内目标排除规则明确：目标组不互检；当前水泵与回折管段应分单目标调用，只显式排除已核验的正常邻接构件，避免全部路线被漏检。
- 几何/布尔失败、未知边界、工作量上限不能生成无碰撞结论；报告明确不含链接模型、保温或fabrication parts，未按任何规范擅自指定维护净距。
- 已通过100项核心验证/判定测试、166项Node/MCP测试，Release编译0警告0错误；这些单元和模拟契约测试不等于新版原生几何实机验收。
- 新增可重复的只读验收脚本，读取最新会话状态，检查目标/排除元素原生数据、类别数量、活动视图、选择集及保存状态不变；真实报告仍待用户手动重启新版后读取。
- 独立输出目录v27/bin/Release/net10.0-windows-v27-chat-0322，旧2025和0321程序集保留。当前运行v0.3.21，不热替换、不自动关闭Revit。下一步核对安装清单和旧能力门控，然后用户重启实机验收。

### v0.3.22 安装和门控核验
- 已安装并只读复核 Revit 2027 清单，目标程序集 FileVersion=0.3.22.0；原0.3.21及2025文件保持，当前进程仍为0.3.21。
- 新stdio会话能发现 revit_collision_check，注解为只读/非破坏；旧Revit能力缺失时在转发碰撞请求前拒绝，identity、revision、数量、视图与保存状态不变。只证明门控和工具发现，不证明新版原生碰撞核查通过。
- 基于当前已重开测试副本和真实 inspect peers，为水泵、既有管道、四段新增管道及四个管件准备10个单目标局部输入；每份只显式排除实际已连接邻接构件。输入和准备证据仅存本机acceptance且被Git排除，不让用户手写JSON，不复用旧会话身份。
- 当前isModified=false；没有自动保存、关闭Revit或变更模型。用户手动重启并加载0.3.22后，先复核当前ID与邻接关系，再运行clearanceMm=0原生几何实机验收。维护净距正值仍等待用户提供。


## 2026-10-06 v0.3.22 实机验收收尾与 v0.3.23 诊断增强
- 跨日继续时Revit进程已变更，旧b62ea...会话报告不作为当前结论；重新读取当前3c8e... identity、revision=0、isModified=false，比较重开后的原生路线参数/几何/端口一致，然后重新完成10项局部单目标只读检查。
- 唯一去重碰撞为水泵2295837与变径2295876，交集约948.7 mm³；唯一未知为水泵2295837与回折管2295869，双向Boolean失败。没有把 reciprocal 两次观测当成独立碰撞，也没有以查询契约通过冒充无碰撞验收。
- 10次查询每次15项契约检查通过，汇总核验9项通过；未截断，原生目标参数/连接/几何、5段管道和4个管件精确ID集合、数量、视图、选择集和保存状态不变；过期identity、错误revision、重复ID、缺失元素的4项原生保护测试被正确拒绝。原有8条流向警告未清除。
- 最小Boolean复现两次稳定unknown，当前错误只返回异常类型，缺少根因上下文。v0.3.23只补充受限原生异常消息、失败solid索引/数量及边界，不改变相交算法、未知判定或模型，不增加自动重试。
- 新增可选collision-boolean-diagnostics原生能力；现有0.3.22碰撞只读查询保持兼容，但新details必须以实际原生加载能力核验。消息清洗/截断、无堆栈、数据透传和unknown判定均有回归覆盖。
- 105项核心测试、168项Node/MCP测试通过；v0.3.23独立Release编译0警告/0错误。输出目录net10.0-windows-v27-chat-0323；实际原生诊断仍待用户手动重启后验收，未宣称布尔失败根因或路线避让已经完成。
- 本地acceptance保留新会话汇总与最小复现证据，不提交模型/密钥/导出数据。净距未提供，仍只用0检查，任何避让仍需新预览和聊天批准。

### v0.3.23 安装核对与旧查询兼容
- 已安装并复核本机 Revit 2027 清单，目标程序集为0323且FileVersion=0.3.23.0；没有关闭或重启Revit，实际运行仍为0.3.22。
- 在旧原生0.3.22上用更新后的bridge读取已知Boolean未知对，collision-check查询继续兼容；没有冒充已取得collision-boolean-diagnostics新能力。7项兼容/只读核验通过，模型identity/revision、类别计数、目标原生数据和已保存状态保持不变。
- 新版新增原生诊断的实机验证尚未运行；需要用户手动重启0323，重新读取当前会话身份和原生目标，再检查details是否给出失败实体上下文。真实碰撞、Boolean未知、维护净距及流向问题仍不能标为已修复。


## 2026-10-06 v0.3.23 原生诊断实机验收完成（碰撞/未知仍在）
- 用户重启后，实际版本0.3.23、进程22140，当前测试副本新会话identity=eb42136e1c97e2adcd4515669f63ba61，revision=0、isModified=false。保存路线与上一会话原生数据一致，没有复用旧身份。
- 最小复现两次稳定返回有限原生details，9项核验通过：管道0号实体与水泵15号实体触发原生InvalidOperationException，双方实体总数1、100。原生消息为通用可能原因，不断言已确认具体面/边或变换问题。
- 实际stdio MCP链路进一步核对三个相关目标，11项核验通过，客户端收到完整diag数据。双向实体碰撞约948.7 mm³，同一未知对双向索引15/0与0/15一致；只读调用没有改变完整路线参数/几何/端口、数量、视图、选择集或保存状态。
- 本机acceptance保留独立原生复现和stdio结果，新版功能不是只由mock测试通过；未声称已在Claude或Codex界面分别手动调用。当前确认碰撞、Boolean未知、维护净距和8条流向警告仍未修复。
- 本轮没有修改DLL、自动重启、移动几何、写入或保存模型。后续避让预览需要先明确既有接管是否允许调整；任何预览通过也不代表未知或工程合规已经验收。

## 2026-10-06 泵房右侧避让新预览（待聊天批准，未写模型）
- 用户同意预览范围可调整现有80毫米管道近端；该答复只授权准备候选，不是执行授权。重新读取当前文档identity/revision、保存状态、原生水泵接口和原管远端，确认与已保存路线数据一致。
- 使用现有v0.3.23能力生成候选，无新DLL或重启：旧左侧回折路线改为右侧X=35000，水泵位置/接口不变，四段200毫米管与80毫米管径、原生类型1887580及供水系统类型665532保持。
- 原80毫米管近端拟由X=34500移至36000（Y=18000、Z=500），远端(37000,18000,500)保持；原2500毫米管拟以1000毫米同型同系统管替换。执行器不直接编辑管道端点，因此需删除/重建9个主元素（原4管4件及80毫米管），新5管4件；元素ID/IFC GUID改变，系统实例名称/ID不保证保持，仅系统类型/分类保证待核验。
- 原生计划54932df033f37fd1c646370e373ba90a处于pending，共19操作。模型identity、revision=0、计数、目标原生数据、保存状态、视图/选择集在预览前后不变，未调用confirm。
- 预览提示9个附属依赖；已读取原生类别，均为管道/管件中心线。主元素9个、已见中心线9个属于本候选的删除影响披露，仍不以GetDependentElements替代实际Doc.Delete/事务回执范围。执行后需核对真实删除、新元素、原生系统、双向peers及其他类别不变。
- 本地保留独立baseline、reviewed-candidate、native-preview、dependency-inspection和pre-confirm-baseline；另采集建筑/机电/视图等类别ID集合和117个电气元素原生基线，用于核对执行副作用/回滚。证据不进入仓库。
- 候选没有实体预演，仍未证明新路线无碰撞或维护净距/流向合格；净距未提供，不擅自选择标准。必须聊天展示替换方式、ID变化、中心线依赖和执行后验收条件，再仅对同一未过期计划取得一次批准后执行。不自动保存/重试；文档/计划变化需重新预览，不复用范围同意。


## 2026-10-06 右侧避让已提交并完成原生局部验收（待用户保存）
- 用户聊天批准“确认执行右侧避让预览”。执行前9项校验确认同一planId、operations、identity/revision、有效期和完整原生基线不变；同一54932df033f37fd1c646370e373ba90a仅发送confirm一次。
- 19操作committed，新增5管4件；实际删除旧9主元素和9中心线与预览披露范围精确一致，真实新增9主元素与9原生中心线已inspect。回执保留9条预览删除依赖提示，不误称无警告。
- 新原生链路为2295837→2295879→2295885→2295882→2295890→2295887→2295895→2295892→2295902→2295899，双向peers可读且一致。4段200mm、末端80mm、3个200mm弯头和200/80mm变径核验通过，类型1887580/系统665532/SupplyHydronic保持。
- 水泵位置/type/mark、未使用端口2保持；原80管近端改到(36000,18000,500)，远端(37000,18000,500)保持，管ID与IFC GUID按预览重建。其他已声明类别ID集合/计数不增删，117电气元素原生ID/参数/关系与基线保持。23项原生核验通过。
- 事务历史除了批准路线还更新水泵、系统浏览器、既有供水系统及3个无类别内部记录；有真实inspect证据，但内部记录没有前值参数基线，明确不声称全部内部数据不变。
- 水泵与新9个主元素的10项单目标局部碰撞复查全部完成：0交集、0未知、未截断，查询没有额外revision变更。结论只针对声明范围与体积阈值，排除真实正常邻接；不包含链接/保温加工件，不宣称维护净距或水力合格。原Boolean失败对象已经替换，未更改或声称修复几何算法。
- 导出并查看既有AI-V041泵房平面，新右侧路线显示正常；未修改视图或保存。15项最终汇总检查全部通过，本机保留回执、原生拓扑/删除范围、电气基线、10项碰撞报告、事务历史和图像证据。
- 当前revision=1、isModified=true；等待用户手动保存，不再重复确认或写入。8条流向/流量警告仍在。后续保存核验和维护净距/系统流向工作仍需分别推进。


## 2026-10-06 用户已保存右侧避让副本（验收收尾）
- 已只读核实当前测试副本isModified=false、identity=eb42136e1c97e2adcd4515669f63ba61、revision=1，7项保存核验全部通过。保存前后新路线完整原生参数/几何/peers、计数、视图、选择集一致；文件存在并已更新。
- 保存后再次运行10项单目标局部实体核查（仅排除正常邻接，clearanceMm=0），0碰撞、0未知、未截断；11项复核通过，管道/管件ID集合、117个照明电气元素原生参数和关系、保存状态不变，无新增模型事务。
- CHWS 1系统实例仍为2295840/type665532；8条原有流向/流量警告保留，没有修改水泵族流向或清除警告。
- 本轮没有再次confirm、自动保存、关闭/重开项目或更新DLL；新路线保存验证不冒充独立重开持久化验收。保存与碰撞报告保留本机acceptance，不上传模型/密钥/图像证据。
- 右侧避让“预览→聊天批准→一次提交→原生连接/局部碰撞核验→用户保存”已完成；维护净距毫米数待用户提供，系统流向与水力计算仍待进一步只读诊断。任何后续模型修改需要新的当前预览及聊天批准。


## 2026-10-07 300 mm 路线净距候选初筛完成
- 助手选择300 mm作为保守开发初筛值，明确不是工程规范。对已确认的10个路线实例按当前identity/revision逐个只读筛查，0碰撞、0未知、complete且无截断，模型保存状态稳定。
- 共8条有向包围盒候选，去重后4对，都是新路线相邻管段；没有外部候选对象报告。候选不等价于精确测距/维护空间验收，不能据此声明精确净距≥300 mm或规范合规。
- 筛查没有移动或保存模型，当前isModified=false。原有8条流向/流量警告保留。

## 2026-10-07 CHWS 1 流向/流量警告只读诊断
- 对当前已保存右侧路线运行只读 `revit.audit.run`、水泵2295837、系统2295840和10个路线实例inspect；当前isModified=false、revision=1，未修改或保存模型。
- Revit仍返回8条警告：PA1—PA6、CHWS1、SA1均为“无法计算流量，因为流动方向不匹配”。当前路线的水泵端口3→2295879→完整新链路→2295902→2295899→既有系统端口关系均可读且连通，系统类型665532/SupplyHydronic保持；水泵端口2明确未连接。
- 现有MCP只能可靠读取连接器方向、peers、管径、系统类型和审计警告，不能从当前接口证明PipingSystem全部成员的流向规则、设备流向属性或Revit流量求解器的具体失败成员。因此不猜根因、不改流向参数、不清除警告。
- 下一步需新增只读“系统流向诊断”能力：读取指定PipingSystem成员、MEP系统/设备关系、每个管件/管段连接器方向和可读流量/流向参数；未知属性保持unknown。先做单元/契约测试和实机只读验收，再决定是否准备任何系统修改预览。
- 当前没有用户提供规范或流向设计意图；任何改变设备流向、系统类型、连接拓扑或泵接口都必须另行预览并聊天确认。


## 2026-10-06 系统流向诊断接口实现（待重启实机验收）
- 新增只读 `revit.flow.diagnose` / MCP `revit_flow_diagnose`，读取指定PipingSystem的PipingNetwork成员、基础设备连接器、连接器Direction/Flow（属性不可用时保留unknown）、系统GetFlow/GetStaticPressure/GetVolume错误和identity/revision。没有事务、Set、Save或写入路径。
- 0.3.23独立flowdiag构建目录编译0警告/0错误；105项核心测试、168项MCP原有测试保持通过，新增2项MCP流向契约测试通过。由于当前Revit锁定活动0323 DLL，没有热替换；实际调用返回feature_not_loaded且模型未改变。
- 已注册bridge capability `flow-direction-diagnostic`，清单下一次安装/重启后加载。当前需要用户保存后重启Revit，再对系统2295840运行实机只读诊断；不能复用旧会话identity。
- 实机诊断后再决定是否生成流向修正预览。没有用户提供流向设计意图前，不更改设备流向、系统类型或连接。

## 2026-10-07 流向诊断部署路径修正（待重启加载）
- 用户重启后实际仍为0.3.23，但bridge.features没有flow-direction-diagnostic；当前Revit加载的是旧chat-0323输出，模型identity为新会话、isModified=false。
- 已确认独立flowdiag-test构建0警告/0错误；安装清单已改指向 `v27/bin/Release/net10.0-windows-v27-flowdiag-test/RevitAutoV27.dll`。这不会热替换当前内存程序集，必须再次手动重启后才能生效。
- 当前没有执行模型写入或保存；下一次重启后只读调用revit_flow_diagnose(systemId=2295840)，重新读取新identity/revision，不复用旧会话。

## 2026-10-07 CHWS 1 原生系统流向诊断完成
- 流向诊断版已实际加载：v0.3.23 flow-direction-diagnostic，当前新会话identity=e7212526e912d47569d14735a0985b11，revision=0，isModified=false。
- `revit.flow.diagnose(systemId=2295840)` 返回CHWS 1系统成员10个：水泵2295837、5段管道/4件新管路；PipingNetwork读取成功，BaseEquipmentConnector可读取，成员peers闭包与当前链路一致。
- 系统原生计算：GetFlow可调用但结果为0；GetVolume可计算；GetStaticPressure不支持并返回错误。成员可读连接器全部Direction=Bidirectional、Flow=0，水泵端口3连接新路线，端口2明确未连接，末端80毫米管远端仍未连接。
- Revit仍报告CHWS 1流向不匹配，且警告没有failingElementIds。当前证据能确定“系统拓扑可读、连接存在、流量求解为0/方向未被原生确定”，不能确定具体根因是水泵族流向设置、系统边界/设备配置还是项目设计意图缺失；没有修改任何流向或系统参数。
- 诊断查询前后identity/revision和保存状态稳定。下一步若要修正，必须先明确设计意图（泵接口应为供水还是回水、系统是否应形成闭环/连接另一泵口、是否允许改族流向），再生成专门预览；不能把Bidirectional/0流量自动改成In/Out。

## 2026-10-07 泵房 A/B 规划模式实现
- 用户确定规则：明确需求使用A（`planningMode=explicit`）；模糊说明先询问并返回缺口（`planningMode=ask`）；用户明确允许AI推断时保留B（`planningMode=assisted`），必须列出假设并标记candidateOnly。
- 新增 `mcp/planning-mode.mjs` 与 `revit_workflow_run` 契约：ask不创建plan、不写模型；explicit生成正常可审阅预览；assisted生成带假设的候选预览，仍需聊天确认，不从测试夹具警告推断工程意图。
- 更新CLAUDE.md和natural-language-workflows.md，明确澄清后重新读取context/revision，不能复用旧会话授权。
- 完整MCP回归175项通过，核心105项通过；当前只改客户端规划契约/文档，没有修改Revit模型或插件DLL。

## 2026-10-07 旧版功能矩阵与受控工作流注册表
- 新增 `mcp/workflow-registry.mjs`：登记24个旧版能力/脚本来源、领域、planningModes、所需查询、影响类别、破坏级别、回滚策略、核验策略和迁移状态。
- 新增 `mcp/workflow-adapter.mjs`：统一从注册表调用已启用工作流的现有结构化操作构建器；普通MCP客户端不接触.csx路径、任意C#或脚本执行。
- 新增 `revit_workflow_list` 只读接口；`revit_workflow_run` 改为先通过注册表白名单。未迁移工作流返回 `workflow_migration_pending`，不创建计划、不修改模型。
- 当前启用并复用现有安全结构化引擎：lighting.full、lighting.place、architecture.build、pump_room.build、audit；其余旧版电气细分、房间/洞口/楼梯/图纸、泵房细分、族加载、导入、保存核验和诊断脚本已登记但明确阻塞，避免“看似支持、实际未迁移”。
- 明确保留Revit 2025独立回退；新版只支持Revit 2027.3/.NET 10；A/B规划模式继续生效：explicit直接预览、ask只提问、assisted列假设并candidateOnly。
- MCP完整回归182项通过；本轮没有修改Revit模型或插件DLL。下一阶段按矩阵逐项实现适配器，优先把旧版高频照明/电气/图纸能力拆成可验收的受控工作流。

## 2026-10-06 旧版功能对等迁移第一阶段启动
- 根据复盘确认：新版目标是“旧版成熟能力 + 新版安全MCP执行层”，不是重新发明全部业务能力。采用脚本注册表+适配器，旧.csx/ModelBuilder仅作为迁移来源，不开放任意脚本/C#给Claude/Codex。
- 新增 `mcp/workflow-registry.mjs`，登记24项旧版能力及legacySources、domain、planningModes、inputSchema、requiredQueries、operationBuilder、affectedCategories、destructiveLevel、rollbackPolicy、verificationPolicy、acceptanceStatus、enabled。
- 新增 `mcp/workflow-adapter.mjs`，统一调用现有结构化operation builder；新增 `revit_workflow_list` 只读接口；`revit_workflow_run`先过白名单，pending工作流返回workflow_migration_pending，不创建计划。
- 当前enabled为lighting.full、lighting.place、architecture.build、pump_room.build、audit；其余19项已登记但阻塞，避免“登记即假装已支持”。Revit 2025继续独立回退，注册表运行边界为Revit 2027.3/.NET 10。
- planningMode explicit/ask/assisted与旧版迁移注册表组合：明确需求生成预览，模糊需求只提问，用户允许推断时带假设生成candidateOnly预览；所有写入仍预览→聊天确认→单事务→原生核验→手动保存。
- 注册表专项测试16项通过，完整MCP回归182项通过，核心105项通过。当前只改MCP和文档，没有修改Revit模型或插件DLL。
- 下一阶段按功能矩阵优先迁移electrical.circuit、electrical.wire、electrical.sheet，再做architecture.rooms/openings/stairs和泵房细分适配器；每项完成后才把registry.enabled改为true并提供实机验收证据。

## 2026-10-07 第二批功能对等迁移：电气与房间
- `electrical.circuit`、`electrical.wire`、`electrical.sheet` 已从 pending 移到 enabled，统一映射到 create_circuit/create_wire/create_schedule/create_sheet/create_view_plan/configure_view/place_viewport；旧版固定数量/固定路径假设不复制。
- `architecture.rooms` 已从 pending 移到 enabled，映射 create_room 与通用 tags/views/schedules/sheets/viewport操作；旧rooms.csx的固定点位不硬编码，输入必须由当前context/用户约束提供。
- openings/stairs/documentation及其他旧版细分继续pending，不能通过workflow.run创建计划。
- 专项registry测试和完整MCP回归185项通过；核心105项保持通过；未修改Revit模型或DLL。下一步为这些已启用适配器建立Revit 2027副本实机验收，全部通过后才能标记implemented-and-accepted。

## 2026-10-07 第三批建筑对等迁移：房间与门窗开口
- `architecture.rooms` 和 `architecture.openings` 已从 pending 移到 enabled；房间工作流支持显式房间点位、编号/名称以及后续文档对象；开口工作流使用显式门窗族类型、宿主、标高和点位，旧脚本固定墙坐标不迁移。
- `workflowOperations` 新增 `architecture.rooms` 与 `architecture.openings` 分支；所有操作仍进入同一结构化校验和计划预览，不开放旧脚本直接执行。
- architecture.stairs、architecture.documentation、pump_room细分、族加载和导入仍pending；不能因注册而宣称已迁移。
- 完整MCP回归186项通过，核心105项保持通过；没有修改Revit模型或DLL。下一步为房间/门窗和此前电气工作流准备Revit 2027副本实机验收基线。

## 2026-10-07 第四批建筑对等迁移：图纸/明细表
- `architecture.documentation` 已从 pending 移到 enabled；映射现有 create_view_plan、configure_view、create_schedule、create_panel_schedule、create_sheet、place_viewport 操作，旧版固定图纸坐标不自动猜测，导出只作为只读验证。
- 现已启用工作流：lighting.full、lighting.place、electrical.circuit、electrical.wire、electrical.sheet、architecture.build、architecture.rooms、architecture.openings、architecture.documentation、pump_room.build、audit。
- architecture.stairs、泵房细分、族加载、导入、保存核验和诊断脚本仍登记但blocked，普通MCP客户端不能直接调用旧脚本。
- 完整MCP回归187项通过，核心105项保持通过；本轮没有修改Revit模型或DLL。下一步为已启用电气/房间/门窗/文档适配器准备Revit 2027副本实机验收矩阵。

## 2026-10-07 族库审计真实适配与逐源功能矩阵
- 中断后保留原工作区修改，补齐families.audit真实只读适配器；统一workflow.run不再只返回提示，与revit_families_audit共用auditFamilies。新增工作流expectedRevision透传，拒绝nested identity/revision冲突。
- 按当前项目原生family精确筛选FamilySymbol，带每族/全局预算和分页；found/missing/partial/not_scanned严格区分。分页后复核身份/revision，未知/断开不重试、不创建计划、不加载文件或保存模型。
- 机器可读矩阵覆盖51个.csx及ModelBuilder共52来源，并测试源文件集合完全一致。发现并披露ModelBuilder.Build为占位，openings.csx实际门窗；外部模板/RFA审计、特殊事务探针和固定路径SaveAs不冒称已迁移。
- 213项完整Node/MCP测试通过，包括纯函数、安全分页、身份/版本变化及实际stdio模拟测试；不以源码正则通过代替原生验收。
- 当前原生Revit+真实stdio MCP完成12项族目录检查：水泵1型、子母门4型、照明配电箱28型及故意缺失名称；直接工具和统一工作流结果一致，错误revision被拒绝，模型identity/revision/计数/保存状态/视图/选择集不变。
- 仅check-families.csx的当前项目只读目录能力有accepted证据；families.audit工作流仍部分迁移，外部族文件审计、族加载和其余40个重设计来源未完成。全部写入仍需具体新预览聊天批准；本批没有修改RVT或活动DLL。

## 2026-10-09 回路名称原生写入范围核验
- 用户聊天批准的原预览在身份/revision、未过期状态和读取基线复核后，仅提交一次；无第二次 Revit 确认、无自动重试、无自动保存。
- 现有回路负荷名称成功写入测试标记，5 根关联导线的只读线路负荷名称派生更新；逐项读取快照验证仅这些名称字段变化，其他电气字段和元素集合不变，回路成员及配电箱分配不变。
- 配电系统值与原值相同，原生操作为 no_change，未执行参数写入；不能将该结果宣称为不同配电系统写入验收。两个额外原生元素的预读/后读可读快照保持不变，不认证整个模型所有副作用。
- 当前项目有未保存变更，等待用户手动保存再复查；不关闭或重启软件。私有完整证据位于 Git 忽略的 runtime，不上传。新回路创建、适配器回滚和完整功能对等仍未验收。

## 2026-10-09 回路适配器安全补齐与保存核验阻塞
- 用户报告已保存后，仅进行一次当前测试副本只读核验；接口仍返回 isModified=true，核验在保存状态检查处停止，未自动保存或再次提交原计划。原因尚未确认，不把用户操作错误或插件错误当作已证实结论；保存后验收仍待后续人工状态确认。
- 修复回路名称/配电系统值类型错配、Set.add 重复 ID 校验、自动编号冲突及跨回路负载/开关互斥预留；拒绝配电箱兼任开关。未知或畸形成员列表不能当未分配，已有系统的负载及开关不得静默重分配。
- 两种配电系统输入都读取目标原生类型和可写参数基线，统一 before/beforeHasValue/after/noOp 披露；配电盘表限定已有执行器字段并检查配电箱。电气连接器域不是 PowerCircuit 分类或工程容量认证。
- 按 legacyScript 精确修正功能矩阵误关联，建筑项恢复建筑描述；名称测试只记范围受限的实机证据，保持 implemented-not-accepted，保存/回滚/完整旧版场景未虚报通过。
- 11 项回路单元测试、7 项新增实际 stdio SDK/模拟桥接契约测试及矩阵纠错测试纳入完整回归：500 项全部通过，git diff --check 无错误。未改本轮活动 DLL，无需重启 Revit；未写入/保存模型、提交或上传私有证据。
- 下一步：用户确认当前测试副本保存状态后只读复查，再准备独立回路新建/回滚预览；任何新写入仍须审阅并批准对应新计划，不沿用旧授权。等待人工动作时停止轮询。

## 2026-10-09 当前副本保存核验通过与回路回滚预览
- 用户再次确认保存当前副本后，只读检查 isModified=false、原 saved.verify 结果为 saved=true，原提交收据一致，电气快照及回路/配电箱/配电类型范围与执行后结果一致。只认证当前会话无待保存变化及已读结果，不认证磁盘全内容或关闭重开持久性。
- 原保存核验遇到连接器枚举顺序差异：新增 canonicalInspectionItems，只排序参数、连接器、peers、原生电气成员/系统 ID 这些已知无序列表；保留重复项、未知字段、unsupported 状态和有序几何。五项回归保证真实连接/参数/支持状态差异仍失败，不修改原始证据。修复后真实只读保存核验通过。
- 完整 MCP 回归 505/505 通过；无活动 DLL 更新、无模型写入、自动保存、关闭或重启。
- 创建了仅预览的三步现有回路执行期回滚测试：临时改名、删除测试回路，再写已删除回路触发第3步失败，期望前2步及派生名称/成员/配电箱关系整组恢复。已披露5个成员、5根相关导线及原生依赖警告，但依赖查询不认证精确删除级联。预览前后全电气和额外范围快照/身份/revision/保存状态不变。
- 该新预览待用户具体聊天批准，尚未提交；私有 planId、原生 ID、模型路径及完整基线仅在 Git 忽略的 runtime 保存。原授权不能复用。停止等待用户确认，不轮询、不自动重试；过期或版本变化必须重新预览并重新批准。

## 2026-10-09 回路执行期异常回滚实机核验通过
- 用户明确批准当前回路回滚预览后，复核原 pending 计划未过期、当前测试副本 identity/revision/路径/保存状态以及电气和额外范围基线一致，仅确认提交一次。没有创建替代计划、复用授权、第二次 Revit 弹窗、自动保存或失败重试。
- 原生回执明确 completedOperationCount=2：临时回路改名、删除回路已执行；第3步访问已删除回路发生 execution_failed / invalid_operation，rolledBack=true。这是执行期回滚而不是预览拒绝。
- 独立读取电气快照与基线原始数据完全相等，规范化比较也相等；额外范围原生快照恢复。回路负荷名称、成员、配电箱关系及5根关联导线恢复，电气元素集合、当前视图与选择集不变，isModified=false；不要求无意义的再次保存。
- revision 递增一个回滚事件是变更日志行为，不代表残留模型修改。原生 TransactionRolledBack 事件不提供完整元素证据，captureComplete=false；验收证据来自独立基线读取，不宣称整个模型副作用或磁盘/关闭重开持久性已核验。
- 名称源矩阵追加范围受限回滚证据，保持 implemented-not-accepted：新回路创建、更换实际不同配电类型、完整旧版分组/编号场景和发布总目标仍未完成。完整私有证据位于 Git 忽略的 runtime；本轮未覆盖活动 DLL、关闭或重启 Revit。

## 2026-10-09 新回路创建验收准备
- 当时测试副本保存状态为 `isModified=false`；只读扫描确认现有灯具均已分配，不能拿已有负载重复创建回路。选择明确审阅的真实空房间、已核验 WorkPlaneBased 灯具类型和既有配电箱，实际 ID 和点位只存放私有 runtime。
- 当时生成仅预览的 `lighting.full` 计划：按明确点位放置1个灯具（legacyPoint），再创建具备明确成员/负荷名称/配电箱的新回路；不创建导线、不保存。预览前后 identity/revision、计数、当前视图和选择集不变。
- 新增只读创建后核验器及4项回归测试，检查 receipt 稳定引用、灯具原生类别/类型/坐标/标记、ElectricalSystem、成员/配电箱双向关系、元素集合和无导线/自动保存；准备了单次提交脚本但未运行。
- MCP 完整回归 **509/509 通过**；没有修改活动 DLL 或 Revit 模型。该预览必须获得本次具体聊天批准，不能复用回路改名或回滚授权；等待用户明确回复后才提交一次。

## 2026-10-09 新回路创建与保存后核验完成
- 用户明确批准新回路创建预览后，仅提交一次；创建一个灯具和一个回路，未创建导线、未自动保存、未重试。具体计划和元素 ID 仅保留在私有 runtime。
- 原生核验确认灯具类型、标记和 XYZ 与预览一致；回路为 `ElectricalSystem`，负荷名称符合请求，成员仅为该灯具，配电箱分配正确。灯具数量和回路数量各增加 1，导线数量未增加。
- 用户手动保存后，保存后只读核验通过：identity/revision 保持一致，`isModified=false`，`saved=true`，计划状态为 `committed`，提交后的原生范围与回执一致。
- 该证据只覆盖一个明确灯具接入一个既有配电箱的受限新回路场景；不同配电系统写入、完整旧版批量回路规则、导线/配电盘明细表联动、关闭重开持久性和全模型副作用仍未验收。下一步优先做不同配电系统写入或 `electrical.sheet`，仍遵循预览→聊天确认→单事务→原生核验→手动保存。

## 2026-10-09 创建验收器补齐与后续状态变化
- 先用公开验收器接口复现“缺失保存证据仍通过”和“存在计划外回路成员仍通过”两项失败测试，再修复为严格要求有效保存上下文、准确两项操作/创建结果、精确成员关系和完整必需计数；没有修改活动 DLL 或再次写入 Revit。
- 回路 `summary.name` 为原生编号，计划名称写入负荷名称；增加回归，不能混同。合成测试 ID 与实际验收 ID 分离；私有完整证据继续在 Git 忽略的 runtime。
- 随后的实际只读查询发现一次“设置墙工具”事务，revision 增加且 `isModified=true`。119项电气快照与提交后独立证据一致；历史保存核验通过不意味着当前仍已保存。当前最新记录明确为 `READBACK_VERIFIED_CURRENTLY_UNSAVED`，不自动保存、不绕过版本保护，也不认证全模型副作用。
- 全量 MCP 回归 **514/514 通过**，差异格式校验通过；历史真实保存证据也通过新增保存后验收器。迁移矩阵明确本次走 `lighting.full` 新元素引用路径，不冒称 `electrical.circuit` 既有未分配成员建回路或完整旧版能力已经验收。
- 下一项图纸迁移已完成只读资源准备：当前图框类型、已有图纸、配电盘表及其原生配电箱关系可读取。配电盘表不能仅从 `OST_Views` 查询结果判断存在性，明确名称查询后独立 inspect 已读到真实表；未创建新计划，也未修改已有图纸。后续优先验证复用已有表在新图纸出图的实际应用路径，仍保留表创建分支单独验收。当前副本有新的未保存状态，先等待用户手动保存；不自动轮询或重启。

## 2026-10-10 图纸复用预览中断恢复
- 读取原迁移目标和中断记录后，找到中断前已经成功生成的 electrical.sheet 预览；先查询原生计划状态，确认仍为 pending、未过期且操作与原记录一致，没有重新创建或提交计划。
- 恢复时测试副本 revision 为 6、isModified=false；119 项电气元素快照、4 张已有图纸以及配电箱、源配电盘表、参考图纸和图框类型的原生范围与预览基线一致。只读恢复证据保留在 Git 忽略的 runtime。
- 当前具体预览为新建一张图纸并放置既有配电盘表，两项操作；不重建表。已准备带一次性提交记录的执行脚本，但未运行；须先获得用户对这一具体预览的聊天批准。
- 执行后将独立核对 PanelScheduleSheetInstance 的图纸/表关系和位置、图框与纸面边界、已有图纸、电气元素集合及事务变更证据，再导出 PNG 检查版面。原生图纸的普通 viewport 列表不包含配电盘表实例，不能将空列表误判为未放置。
- 配电盘表实例包围框与完整单元格内容尚无查询证据；未完成 PNG 目视、手动保存和保存后复查前，不标记图纸迁移或完整旧版出图功能已验收。本轮没有修改 RVT、自动保存、重启或覆盖活动 DLL。

## 2026-10-10 图纸属性与表格规划模式补齐
- 对照旧 create-sheets.csx，补齐 electrical.sheet 的 sheetChanges（已有图纸名称/编号）与 viewChanges（非模板 ViewPlan 名称/比例）。仅生成限定 built-in set_parameter；分批读取准确参数原值、存储类型和可写/支持状态，返回 before/after/noOp。修改编号时有界分页读取原生目录并检查目标与新图纸冲突，不临时重编号或沿用 fixture 规则。
- 真实只读预检发现 VIEW_SCALE 为只读标签，因此按本机 RevitAPI 枚举和实际可写参数证据改为 VIEW_SCALE_PULLDOWN_METRIC；四项元数据基线在当前副本预检通过。该预检没有创建新计划、提交操作或保存 RVT，不是原生写入验收。
- 封闭图纸创建/配置行字段，拒绝配置中会被原生忽略的名称/比例、纸点双套坐标以及 levelId/level 混用。普通注册规划不再把缺失 path/isModified 的两次 undefined 当成稳定保存状态；明确空路径的新项目仍可规划。
- 修复 imports.parameter_table 登记 ask/assisted 却固定 explicit 的落差；统一工作流与 direct parameter preview 均透传模式/假设。ask 不读来源、不访问 Revit、不创建计划；assisted 要求非空假设并披露候选字段，缺失表格数据不推断。返回问题前和创建预览后均复核上下文；pending/planId/identity/revision 无效时只取消已知计划一次，超时不自动重建。
- 图纸单元、导入单元、stdio SDK 契约和已有注册表/矩阵定向 114/114 通过，完整 MCP 回归 561/561 通过。独立审查发现的坐标歧义及未知保存状态均已补回归。差异格式检查通过；新代码不需要替换活动 DLL。
- 原图纸复用预览仍 pending，本轮没有获得该预览的聊天执行批准，没有确认或重建；当前原生证据 revision=6、isModified=false。私有原生 ID、完整范围和模型路径只存 Git 忽略的 runtime。
- 完整目标仍有实质缺项：独立视口/明细表移动、图框更换及批量高分辨率导出；旧建筑结构柱及 top-level 行为尚缺受控迁移；轴网名称和专用几何读回待补；表格整体结构校验尚缺逐行完整错误定位；2027.3 精确版本范围门禁与直接构建检查待补。写入/回滚/手动保存、干净安装、双客户端和稳定开源发布仍需逐项实证，不能由本轮模拟回归证明。

## 2026-10-10 图纸复用单次提交与失败版面记录
- 用户明确确认原图纸复用预览后，复核原计划未过期、文档 identity/revision/路径/保存状态、119 项电气范围和原图纸基线，只确认提交一次。原生收据 committed，完成新图纸和既有配电盘表放置两项操作，revision 从 6 到 7；没有自动保存、重建计划或失败重试。
- 新图纸、图框、PanelScheduleSheetInstance 的归属/源表关系及请求纸点均读回一致；119 项电气元素、源配电箱/源表/参考图纸和四张既有图纸快照一致。PNG 导出成功，但表格左侧压到图框签字栏，明确记为版面失败；指定锚点正确不等于版面通过，不自动移动。
- 原验收脚本在附带元素检查处遇到 The viewport is not on a sheet。逐 ID 只读探针将其隔离到自动新建的内部未上图纸 Viewport；主创建范围已核验。其他内部修改元素只有事后读取，不能认证全部副作用。完整原始回执、逐项探针与 PNG 仅在 Git 忽略的 runtime/exports 保留。
- 只读检查器源码已补 SheetId 无效与 HasViewportTransforms 前置条件；返回明确不支持状态，不虚构零边界或投影。四项纯逻辑回归覆盖未上图纸、无投影、普通视口和意外错误传播。隔离输出构建通过（0 警告/0 错误）；运行 DLL 未替换，未部署或重启。
- 当前 latest 原生保存证据仍 isModified=true；已请求用户手动保存测试副本，后续须收到“已保存”再只读复查。等待时不轮询，不将历史保存结果挪用于当前事务。版面问题须新的明确预览与聊天批准才能修正。

## 2026-10-10 中断的软件改动完成与隔离验证
- electrical.sheet 与 architecture.documentation 接通严格 placementMoves：明确既有 placementId/sheetId/viewId 与纸面 XY，检查原生关系/旧位置，原生预览和执行再次检查，拒绝固定与图框修订表，执行后回读关系和位置。禁止重复移动或与 configure_view 重定位同一实例冲突。drawing-placement-move 原生能力门禁保证旧运行插件创建计划前拒绝；该新操作尚无实机写入验收。
- Excel/CSV mapping 收集各行映射、转换和结构错误，附行号及可识别字段路径；任何错误返回空 operations，保留合法早期引用。修复字符串 dependencies 被按字符验证的问题，并支持明确 JSON 数组；跨行端口互斥仍由共享验证器提供首个错误，不声称穷举所有跨行冲突。
- 构建/部署辅助和直接 MSBuild 均要求确切匹配的 RevitAPI/RevitAPIUI 27.3.x 文件与程序集版本；本机实际 API 对只读验证通过，2025/27.2/27.4/混用/伪造/未知等 fixture 被拒绝。Revit 2025 独立资产保持不变。
- 完整 MCP 回归 628/628、C# CoreTests 177/177 通过。实际 2027.3 API 隔离编译 0 警告/0 错误；差异格式检查通过。没有覆盖活动 DLL、提交、推送或上传私有证据。
- 迁移与发布总目标未完成：本次图纸版面失败、手动保存待核验、内部副作用未知；图框更换、批量高分辨率导出、旧建筑结构柱/轴网补齐、大量原生写入回滚/保存重开、干净安装、双客户端和稳定发布仍需推进。不能由源码/模拟回归或本次受限创建证据标记功能完整验收。

## 2026-10-10 图纸复用手动保存后核验通过
- 收到用户“已保存”后，仅运行一次只读保存后复查；revision=7、isModified=false，verification.saved 返回 saved=true。原计划仍 committed，操作及完整收据与提交时相等，没有重复提交、自动保存或轮询。
- 新图纸/配电盘表实例、四项源范围、119 项电气快照和四张既有图纸均与提交后证据一致。只认证当前会话保存状态和已读范围，不认证关闭重开持久性或全部内部副作用；PNG 签字栏重叠问题仍使版面验收失败。
- 已核对运行插件不具备 drawing-placement-move；隔离编译包的安装 CheckOnly 检查通过。未修改插件注册、凭据或客户端配置，未部署或重启。修正表位置须先另行授权加载新插件，再生成新预览并独立聊天确认。

## 2026-10-10 获准更新 2027 插件注册
- 用户明确回复“允许注册”后，校验已准备 DLL、拟用清单及原注册清单的 SHA-256，确认拟用清单只改变 Assembly 字段；仅更新当前用户 2027/RevitAutoV27.addin，保留并核验原清单备份。
- 更新后注册清单哈希和目标 DLL 路径读回一致；私有桥接设置哈希及 2025 插件清单快照保持一致。未改客户端配置、未保存或写入 RVT、未覆盖运行中的旧 DLL、未自动重启。完整注册请求、一次性尝试记录与收据留在 Git 忽略的 runtime。
- 当前状态为 REGISTERED_MANUAL_RESTART_PENDING；注册写入完成不代表新 DLL 已加载。等待用户手动重启 Revit 并重新打开同一测试副本后，才读取构建/能力及保存结果；期间不轮询、不重复注册。后续表格移动仍须新的预览和独立聊天批准。

## 2026-10-10 新插件加载、重开范围核验与表格移动预览
- 用户报告已重启后，只读核验加载模块指纹与已注册 DLL 相符，drawing-placement-move 已出现。相同测试副本路径，isModified=false、计数与保存后相同；identity 和 revision 是会话状态，重开后为新 identity/revision=0。旧创建计划不可用，不重新创建或提交。
- 新图纸/表实例、源范围、119 项电气快照和四张原图纸均通过重开后的已读字段复查。新版普通 viewport 查询增加两个 true 支持状态字段，首次严格比较在此停止且未创建计划；核对仅此两项新增披露、旧几何/投影完整及全部其他字段一致后继续。受限兼容比较的合成正反检查保留在私有脚本，不扩大公共 canonicalInspectionItems 的忽略范围。
- 原报错的内部未上图纸 Viewport 已可读取，明确 geometrySupported=false/viewport_not_on_sheet，验证修复生效。其他内部元素事后可读不补出不存在的创建前基线，不能认证全模型副作用或全数据磁盘持久性。
- 生成了独立的新表格移动预览，仅将当前复用实例向右 30 mm，Y/Z 不变；原生预览披露旧/新位置和非 no-op，预览前后模型保存状态/revision/电气/原图纸/源范围不变。未确认、提交或自动保存；准备了一次性尝试记录和受限核验脚本但未运行，仍须用户批准这一具体新预览。PNG版面、移动回滚及移动后保存验收待推进。

## 2026-10-10 已确认表格移动的中断恢复与保存核验
- 用户提供损坏会话记录、具体“确认执行表格移动测试”授权及继续指令。旧执行器在身份断言处退出，未创建 attempt/execution；旧计划已于北京时间 06:15 过期且当前会话不可用，不重提旧计划。
- 严格恢复比较旧 119 项电气快照、四项源范围（包括图框类型）、四张既有图纸、新图纸/表实例与九项原生范围；保留当前 schema 全字段，未剔除 geometry/projection。额外读取合并后的 134 项完整原生快照作为本次 before/after 基线。
- 当前等价预览绑定新 identity/revision，操作、警告和旧位置/绝对目标与旧预览一致；保留原 X=398.5/Y=568 mm 目标，不对当前位置累加。若已在目标、第三位置或范围变化即停止。按用户已确认的同一具体移动只提交一次，wx attempt 保护禁止自动重试。
- 原生 committed 一项操作，X 从 368.5 到 398.5 mm、Y/Z 不变；native event 只修改该实例，没有新增/删除。134 项完整读取仅位置变化，119 项电气快照和元素集合一致。PNG 表格完整位于图框内，左侧签字栏重叠已消除；右侧原有注释栏拥挤仍存在，整张图纸质量未认证。
- 用户手动保存后一次只读核验通过：revision=1、isModified=false、verification.saved=true，提交收据及全部已读范围一致。没有自动保存、关闭或重启软件。当前移动测试及当前会话保存核验通过；移动回滚、移动后关闭重开与整个模型副作用仍未验收。公开文档只记录范围和结果，模型路径/原生 ID/完整证据仍在 Git 忽略目录。

## 2026-10-10 图框、结构柱/轴网与批量高清导出源码迁移
- 新增单操作 `change_titleblock_type`，electrical.sheet 与 architecture.documentation 共用 titleBlockChanges 严格输入和完整原生预读。明确已有实例/图纸/已激活 ViewBased 类型，披露类型替代和依赖；执行后核对位置、旋转、类型、图纸图框集合和已有关联元素，异常整组回滚。已知只读不可用返回 supported=false，不使普通批量 inspect 整批失败；未知异常和取消仍传播。
- architecture.build 新增显式 columns，要求既有 TwoLevelsBased 结构柱类型、底层/顶层、两项偏移和 XY。预览披露实际类型激活，回执记录相关类型写入；原生回读类别/类型/约束/偏移/位置/旋转，未知值和非有限数不能认证为零。轴网要求明确唯一名称及水平直线，inspect 读取完整 Line/Arc 及不可用状态。该阶段尚未迁移的建筑类型复制随后已用专用操作实现，不自动沿用旧脚本的 500x500 固定尺寸；后续类型复制构建尚未注册或实机验收。
- 新增只读 `revit_view_export_images`，1..20 唯一视图、默认 4096 像素/300 DPI、受控本地目录、完整预检、实际 PNG 尺寸和每视图文件映射；identity/revision/路径/保存状态始终核对，部分失败保留证据而不重试。
- 新能力由 controlled-titleblock-change、controlled-structural-columns、explicit-grid-geometry 和 batch-view-image-export 精确门禁。旧运行插件拒绝转发；门禁、统一入口、畸形数据、原生替代与读取策略均有回归。
- 最终 Node/MCP 全量 **666/666 通过**；C# CoreTests **192/192 通过**；实际本机 2027.3 API 的隔离输出编译 **0 警告/0 错误**，安装 CheckOnly 与差异格式检查通过。版本夹具首轮受沙箱 NuGet.Config 读取限制，授权本机测试后全量通过，不把首次环境失败隐藏成代码通过。
- 未修改插件注册、运行 DLL、客户端配置或桥接凭据；未自动保存/关闭/重启 Revit，未提交或上传私有模型与证据。当前副本最终仍 isModified=false。新构建的图框/柱/轴网/高清导出原生实机执行、回滚、保存重开仍待加载后逐项验收；迁移和稳定发布总目标尚未完成。输入与验收边界见 drawing-architecture-parity.md。

## 2026-10-10 续接复核与最终构建注册准备

- 重新读取原完整迁移计划及中断恢复证据。当前副本仍 revision=1、isModified=false；134 项保存后完整范围严格比较通过，另捕获 29 项柱/轴网原生旧 schema 基线。既有移动只提交一次，未重提或累加位移。后续新 schema 必须明确核验新增字段，不能剔除旧 geometry/projection 或把新增信息假装历史已验收。
- families.load 补齐目录读取后和计划创建后的 identity/revision/path/isModified/可写项目复核；计划必须返回非空 planId、pending 及正确 pins。仅取消已知计划一次，保留主错误和未知取消状态；新 RFA/replace/回滚/保存重开仍未原生验收。修正 openings/load-families 两条矩阵与实际适配能力的错配，不提升为完整 accepted。
- 本次 MCP 全量 **676/676 通过**；矩阵纠错后聚焦 **6/6 通过**。原生源码未再改动，保留已通过的 C# **192/192** 与 2027.3 隔离构建证据，没有重复构建或替换运行 DLL。
- 新增独立 registration-switch.ps1：Prepare 只写私有拟用清单/请求，Confirm 绑定独立审阅的请求 SHA-256、DLL SHA-256/MVID、实际清单缓冲字节和旧基线；只改变当前用户 2027 清单 Assembly，CreateNew attempt/原字节备份/排他写入/回读。桥接内容及 ACL、2025 清单和客户端配置前后核验。独立复审补齐请求篡改与路径哈希后字节变化保护，**10/10 组临时注册夹具通过**，不把夹具视为真实部署。
- 最终 parity DLL CheckOnly 通过，已生成并只读复核具体 PREPARED 申请。Prepare 时清单/运行模块仍为旧构建，没有本次 attempt/receipt 或注册写入；之后用户批准一次具体切换并手动重启，匹配 DLL 及四项能力已实际加载，保存后 134 项完整范围与 29 项柱/轴网范围重开核验通过。该批准不授权图框/柱/轴网模型写入，各自仍须有效预览。私有申请、哈希及真实模型基线仅存 Git 忽略的 runtime。

## 2026-10-10 建筑类型复制与常规成功回执容量补强（注册前历史记录）

- `architecture.build`/`architecture.openings` 的严格 `typeCopies` 生成专用 `duplicate_architecture_type`，明确既有源类型、精确新名、匹配类别和两个原生参数 ID/名称/毫米值。保护源及新类型免于同计划修改、删除、通用复制和族加载；源类型放置保护同时覆盖 numeric `symbolId` 与原生解析的 `family`/`type` 名称别名。专用复制引用只可用于此前同类别的放置 symbol，不可借作宿主、标高、视图或实例元素。
- 源完整快照在事务开始前捕获；尺寸回读、源身份/激活/参数、新类型身份/名称/类别/放置方式和复制放置结果在 `Regenerate` 后及常规事务 `Commit` 前核验。`Commit` 原生处理完成后、事务组仍可回滚且尚未 `Assimilate` 时再次读回，避免仅认证提交前状态。
- 复制门窗要求有限 XYZ 和原生旋转，以三维距离 1 mm 核对明示位置。`rotationDegrees` 按创建后原生初始角度的增量执行，以规范化角差 1e-6 rad 核对；窗台高度参数造成明示位置偏移、未知值或非有限证据均失败回滚。
- 常规事务在事务组结束前预检完整成功执行回执及未来 `plan.get` 的 UTF-8 响应封装，原生事件预算与换行计入 16 MiB 桥接上限，超限拒绝并回滚，不截断业务证据。实际原生事件捕获保留到 `Assimilate` 后；容量保护不覆盖 `StairsEditScope` 与失败回执。提交后若交付失败，保持真实 committed 状态并要求查询同一 planId，禁止重建或重试写入。
- CoreTests **222/222 通过**，定向独立复核未发现阻断项。新构建保持隔离，尚未注册、未调用模型写入、未保存 RVT；真实复制/放置、强制失败回滚及保存重开仍待验收。上述源码验证不升级整体迁移为“已迁移并验收”。

## 2026-10-10 两张图纸原生批量 PNG 导出受限验收

- 使用当前实载恢复版的只读 `revit_view_export_images` 导出 `AI-E102-REUSE` 与 `E101`，请求 4096 像素及 300 DPI，实际 PNG 为 4096×2893 和 4096×2896。每张图纸与唯一 PNG 映射一致，完整解码及非空内容检查通过；没有创建或提交模型计划。
- 导出前后完整 134 项原生范围和 29 项柱/轴网范围一致，文档 identity/revision/isModified 与 RVT 文件哈希不变。只递归把 `-0` 规范化为 `0`，保留全部字段、几何/投影和列表顺序，不扩大快照忽略范围。完整证据留在私有 `runtime/parity-batch-export-1791628307673.json` 与 `runtime/parity-batch-export-visual-1791628445571.json`。
- 目视确认 AL1 已避开左侧签字栏，但复用图纸右侧 notes/legend 文字重叠，`E101` 的 AI-ARCH 轴网名称侵入标题栏，`wholeSheetLayoutAccepted=false`。只认证这两张图纸的原生 PNG 导出受限场景；图框、整图版面和完整批量高清能力仍未验收，修正需要独立预览与具体聊天确认。
- MCP 最终全量 **694/694 通过**，失败、跳过、取消均为 0，耗时约 32.982 秒；已只读核对最终日志结尾。此前全量 692/692 与新增两项负零比较后的定向 27/27 通过。`tests/RegistrationSwitchTests.ps1` 的 **10/10 组临时注册夹具通过**，不代表真实注册或加载。新 DLL 的 CheckOnly 通过，保持隔离且尚未注册；不把安装预检或源码测试写成新构建已加载。

## 2026-10-10 建筑类型复制构建注册前基线与申请复核

- 独立只读审查 `mcp/prepare-parity-baseline.mjs` 后执行一次。历史 134 项完整范围及 29 项建筑范围与既有保存证据一致；另取得计数类别及图框的 236 个实例、结构柱/门/窗/图框的 24 个类型完整集合和原生快照，分页集合及全部读取字段前后严格比较通过。只规范化负零及既有已声明无序集合，保留几何、投影与未知字段。证据为私有 `runtime/parity-architecture-copy-predeployment-1791629054042.json`。
- 当前测试副本仍 revision=0、isModified=false，RVT 文件摘要和加载模块指纹前后相同；AL1 保持此前已保存的绝对位置。仅认证已读范围，不认证所有模型副作用，不重复移动。
- `registration-switch.ps1 -Mode Prepare` 已生成建筑类型复制隔离构建的具体申请。根代理与独立审查均核对请求摘要、DLL SHA-256/MVID、基线摘要、当前与拟用清单；清单只改变 Assembly 字段，桥接文件及 ACL、runtime ACL、2025 清单集合、两个客户端配置保护快照均一致。
- 本次申请仍为 PREPARED，没有 attempt/receipt/backup 或真实注册。本次建筑类型复制构建与先前获准并实载的恢复版不同，需针对该具体申请取得聊天批准后才能单次切换，再由用户手动重启并打开同一测试副本，严格核验新模块及完整读取范围。类型复制/放置、强制失败回滚、图框更换及版面修复仍须分别生成有效预览并完成原生验收。

## 2026-10-10 建筑类型复制构建获准注册，待手动重启核验

- 用户明确批准本次具体建筑类型复制构建注册后，仅调用 Confirm 一次且成功，回执为 `REGISTERED_MANUAL_RESTART_PENDING`。当前用户 2027 注册清单仅切换 Assembly，保留原字节备份；未重试或沿用前次恢复版注册授权。
- 根代理核验备份、当前清单与拟用清单一致，桥接内容及 ACL、2025 清单、客户端配置和注册前模型基线保持一致；注册后的独立复审仍在进行。具体请求、构建指纹、清单和模型信息保留在私有证据中。
- 没有模型写入、自动保存、自动关闭或重启。等待用户手动重启并打开同一测试副本后，再只读核验新 DLL 模块、`architecture-type-copy` 能力和完整保存范围；不轮询、不重复注册。注册完成不代表新 DLL 已加载或类型复制、放置、回滚与保存验收完成，受限 PNG 版面问题仍待另行修复。
- 用户随后报告已经手动重启并打开同一测试副本，根代理正在进行新 DLL 模块、能力与完整范围的只读核验；此时仍为已注册、实载待核验，尚未发布核验通过结果。

## 2026-10-10 建筑类型复制构建实载与保存重开已读范围核验通过

- 用户手动重启并打开同一测试副本后，`mcp/verify-parity-reopen.mjs` 仅作只读探针。实际加载模块指纹与获准构建一致，`architecture-type-copy` 能力出现；新 PID、新文档 identity 与重开会话相符，revision=0、isModified=false。
- 134 项完整范围、29 项柱/轴网范围、236 个实例集合和 24 个类型集合均与注册前基线一致，完整 schema 的两轮读取核验通过；RVT、注册请求、基线、DLL 和清单摘要全部一致，AL1 保存后的绝对位置不变。私有证据为 `runtime/parity-architecture-copy-reopen-1791635994866.json`，状态为 `ARCHITECTURE_COPY_LOADED_SAVED_REOPEN_READ_SCOPES_VERIFIED`；只认证已读范围，不宣称全模型副作用核验完成。
- 注册回执的独立审查全部通过。此次重开探针未创建或确认模型计划、自动保存或自动重启；`typeCopyExecutionAccepted=false`，复制/放置、强制失败回滚及图框等模型测试仍待各自有效预览和具体聊天批准，注册授权不代替模型写入授权。
- 两张 PNG 的受限导出证据继续有效，`wholeSheetLayoutAccepted=false`；右侧 notes/legend 和 E101 轴网名称侵入标题栏的问题仍待另行修复，不重复移动 AL1。

## 2026-10-10 单操作结构柱类型复制测试仅预览（执行前历史记录）

- `mcp/prepare-architecture-copy-test.mjs` 按旧 `architecture.csx` 已明确的 300×450→500×500 mm 测试意图，精确匹配既有 `混凝土-矩形-柱` 的 `300 x 450 mm` 类型。预览只有一个 `duplicate_architecture_type`，新名为 `AI-PARITY-COLUMN-500x500-TEST`，原生 b=300/h=450 mm 改为新类型 b=h=500 mm；没有实例放置或修改源类型的操作。
- 源类型 27 项参数完整读取；134 项完整范围、29 项柱/轴网范围、236 个实例和 24 个类型集合、源族完整 schema、已绑定摘要、文档状态及桥接指纹前后一致。私有证据为 `runtime/architecture-type-copy-preview-1791636415385.json`，状态为 `TYPE_COPY_PREVIEW_ONLY_COMPLETE_READ_SCOPES_VERIFIED`。
- plan.create=1、plan.confirm=0，预览返回 pending，未提交模型写入或保存。该具体预览仍待用户聊天批准，独立实际预览证据审查通过；有效期截至北京时间 2026-10-10 22:46:57。执行前仍须有效期、identity/revision 和原生基线复核，禁止盲目重试或沿用注册授权。
- `typeCopyExecutionAccepted=false`。原生复制结果、源类型保护、强制失败回滚及人工保存后的复查仍未验收，源码测试、预览通过与已加载状态均不能代替执行验收；PNG 版面状态仍为 `wholeSheetLayoutAccepted=false`。

## 2026-10-10 柱类型复制单次提交与只读恢复核验（保存前历史记录）

- 用户明确回复“确认执行柱类型复制测试”后，原预览只 Confirm 一次，原生计划 committed、completedOperationCount=1；创建目标结构柱 FamilySymbol，没有放置实例、自动保存或失败重试。原执行记录为 `runtime/architecture-type-copy-execution-10310f25cbc69db629bcb1db01c7e021.json`，状态 `COPY_SUBMITTED_NOT_FULLY_VERIFIED_DO_NOT_RETRY`。
- 提交后验收器把 `architectureCopyVerification` 的外层包装误作平铺结果，断言 `undefined !== 1` 停止；随后只读恢复又遇到 400 项受限 context 类型样本不含新类型，不能把样本当完整类型集合。这些是验收器读取问题，不能据此把 committed 写成失败或重新提交。修正读取原生嵌套包装与样本边界后，定向回归 **6/6 通过**；原执行证据保持原字节，恢复只读核验其绑定摘要，不改证据、不重跑 Confirm。
- `mcp/verify-architecture-copy-result.mjs` 的完整只读读回确认新类型族/名称/类别/放置方式正确、b/h≈500 mm（原生读数约 500.00000000000006，0.01 mm 容差内），源类型 27 项参数及激活状态保持不变。原有 134 项完整范围、29 项柱/轴网范围、236 个实例和 24 个类型快照与源族完整 schema 均一致；分页类型集合仅增加目标类型，由 24 变为 25。AL1 原保存位置不变。
- 原生事件捕获报告目标类型和一项额外 Element 新增，无修改或删除。额外元素与新类型同名，但没有可读类别、有效 owner view 或已证实的关联；当前受控查询接口未暴露所需通用依赖证据，分类保持 `unresolved`，不因同名或事件捕获完整而推断其用途安全。`allModelSideEffectsVerified=false`、`typeCopyExecutionAccepted=false`；副作用、强制失败回滚及完整功能验收尚未完成。
- 完整恢复证据为 `runtime/architecture-type-copy-readback-1791638159095.json`，状态 `COPY_PRIMARY_AND_EXISTING_SCOPES_VERIFIED_ADDITIONAL_ELEMENT_UNRESOLVED_MANUAL_SAVE_PENDING`。后续 `runtime/architecture-type-copy-resume-1791638428447.json` 只读续接核验源/新/额外元素、原 committed 计划及磁盘摘要仍一致，状态 `COPY_RESUME_STATE_UNCHANGED_MANUAL_SAVE_PENDING`；两次恢复均 confirmationCalls=0、modelWritesRequested=false。
- 当时仍同会话 revision=1、isModified=true，RVT 磁盘摘要与提交前及恢复证据相同，尚未保存此次新类型。已请求用户手动保存并回复“柱类型复制已保存”，该历史阶段尚未收到回复或运行保存核验；manualSaveVerification 和 rollbackVerification 当时均 pending。没有自动保存、关闭或重启，不重复移动 AL1；PNG 版面继续 `wholeSheetLayoutAccepted=false`。
- 当时已准备 `mcp/verify-architecture-copy-save.mjs`，绑定原预览、执行及最终只读恢复证据的固定 SHA-256，仅在用户报告本次手动保存后运行。核验同会话保存状态、原 committed 收据、两轮完整已读范围与分页集合、源/新尺寸、AL1 位置及新 RVT 文件摘要；语法和格式检查通过，该历史阶段尚未连接实机执行保存复查。即使该复查通过，额外元素归属、重开持久性和完整副作用验收仍须单独处理。

## 2026-10-10 柱类型复制手动保存后当前会话核验通过（关闭重开前历史记录）

- 用户明确报告本次柱类型复制已手动保存后，一次运行 `mcp/verify-architecture-copy-save.mjs` 只读探针成功，状态 `SAVED_CURRENT_SESSION_COPY_SCOPES_VERIFIED_ADDITIONAL_ELEMENT_UNRESOLVED`。同文档 identity、revision=1，isModified=false，`verification.saved` 返回 saved=true；原 committed 计划及收据保持一致，原预览/执行/恢复证据绑定摘要未变。
- 完整 134 项范围、29 项柱/轴网范围、236 个实例、24 个旧类型、源族 1 项、新类型 1 项及额外元素 1 项两轮读回均与提交后证据一致；分页类型集合仍仅新增目标类型至 25 项，源 27 项参数、新类型 b/h≈500 mm 和 AL1 保存位置不变。新 RVT 文件摘要与未保存阶段不同，保存探针前后稳定；固定证据绑定及当前文件摘要已离线复核。
- 私有证据为 `runtime/architecture-type-copy-manual-save-1791641393933.json`，manualSaveVerification=`current-session-verified`；confirmationCalls=0、modelWritesRequested=false、automaticSave=false，没有重复 Confirm、新建计划、自动保存、关闭或重启。
- 额外元素分类仍 `unresolved`，没有新增归属或依赖证据；`typeCopyExecutionAccepted=false`、`allModelSideEffectsVerified=false`、`closeReopenPersistenceVerified=false`，rollbackVerification 仍 pending。当前保存状态及已读范围复查不等于磁盘全部内容、关闭重开、额外元素安全或完整功能验收；PNG 整图版面仍 `wholeSheetLayoutAccepted=false`，其它模型测试仍须各自有效预览和具体批准。
- 当时已准备并独立复审 `mcp/verify-architecture-copy-reopen.mjs`，语法检查通过，该历史阶段尚未运行。脚本绑定本次保存证据及原预览/执行/恢复摘要，待用户手动关闭并重开同一副本后要求新文档 identity、revision=0/isModified=false、同路径和同 RVT 摘要，再两轮比较完整已读范围与分页集合。允许同进程关开或手动重启，旧计划仅从不可变证据离线核对，不重新创建、提交或读取旧会话计划。成功也只认证已读范围的持久化，额外元素及完整副作用验收继续保留限制。

## 2026-10-10 柱类型复制保存重开的已读范围持久化核验通过

- 用户手动关闭并重开同一测试副本后，只运行一次 `mcp/verify-architecture-copy-reopen.mjs` 只读探针，状态 `SAVED_REOPEN_COPY_READ_SCOPES_VERIFIED_ADDITIONAL_ELEMENT_UNRESOLVED`。新文档 identity、revision=0、isModified=false，RVT 文件摘要与已核验的手动保存文件相同且本次前后稳定。
- 完整 134 项范围、29 项柱/轴网范围、236 个实例、24 个旧类型、源族 1 项、新类型 1 项及额外元素 1 项两轮读取与保存证据一致；完整 schema 与分页集合核验通过，类型集合仍仅增加目标类型至 25 项。源类型 300×450 mm、新类型 500×500 mm、源 27 项参数及 AL1 保存位置不变；固定保存证据绑定、归档计划、完整已读范围和当前文件摘要已离线复核。
- 私有证据为 `runtime/architecture-type-copy-saved-reopen-1791641871255.json`，`readScopePersistenceVerified=true`。旧会话计划只从不可变记录离线核对，不向新会话读取、重建或提交；confirmationCalls=0、planCreationCalls=0、modelWritesRequested=false、automaticSave=false。
- 只认证已读取范围的持久化，不能推及全部 RVT 文件或全模型安全。额外元素仍 `unresolved`，全局 `closeReopenPersistenceVerified=false`、`typeCopyExecutionAccepted=false`、`allModelSideEffectsVerified=false`，rollbackVerification 仍 pending；没有新增额外元素归属/依赖证据。其它模型测试仍须各自有效预览及具体批准，PNG 整图版面继续 `wholeSheetLayoutAccepted=false`。

## 2026-10-10 只读元素依赖查询源码与注册准备（PREPARED 历史阶段）

- 新独立逻辑 API `revit.element.dependencies` 和 MCP 工具 `revit_element_dependencies` 只收集原生逻辑 dependents 及 Family 的类型成员，不扩充既有 inspect 快照。`bounded-element-dependencies` 门禁、严格 identity/revision/1..20 个唯一正安全整数 ID 请求、未知与已知空证据区分、前后文档状态保护及 UI 线程 JSON 冻结均已实现。每列表 4096 ID、请求总 16384 ID、完整 UTF-8 响应封装 2 MiB 的上限超出即拒绝，不截断；没有事务、删除探测、激活、计划创建/确认、保存或文档打开路径。详见 `drawing-architecture-parity.md` 和 `superpowers/specs/2026-10-10-element-dependencies-design.md`。
- 源码双审通过；CoreTests **233/233**、MCP 全量 **714/714**。首次编译使用的默认 API 路径不存在而失败；随后使用本机实际 Revit 2027.3 API 隔离编译 **0 警告、0 错误**，CheckOnly 通过，两份日志均保留，首次环境失败未被成功日志覆盖。
- 新保存模型 fresh baseline 和拟用清单的只读独立审查通过。该历史阶段具体新 DLL 注册申请为 **PREPARED**，未注册或加载，原运行 DLL 不变；本次申请需独立具体批准，先前建筑复制注册批准不适用。此时尚无真实原生依赖关系证据，额外元素仍 unresolved，模型验收状态不升级。

## 2026-10-10 只读依赖查询构建获本次批准并单次注册（实载前历史阶段）

- 用户本轮明确批准本次具体注册申请后，父代理只调用 Confirm 一次成功，当时状态 `REGISTERED_MANUAL_RESTART_PENDING`。当前用户 2027 清单仅切换 Assembly；原字节备份、受保护配置和保存后模型基线核验一致。请求、构建指纹、清单与模型信息保留在私有证据中，没有模型写入、自动保存、自动关闭或重启。
- 该历史阶段已请求用户手动重启并打开同一已保存测试副本，尚未收到当次回复；没有轮询或重复注册。当时运行中仍为建筑复制 DLL，本查询没有真实原生关系证据，先前重启不能代替本次实载核验；后续本次实载和关系结果见下文。
- 关系证据不能证明额外元素无害、全依赖图、净模型差异、回滚或全模型副作用，也不能补出复制前的额外元素基线。额外元素仍 `unresolved`，`typeCopyExecutionAccepted=false`、`allModelSideEffectsVerified=false`、全局 `closeReopenPersistenceVerified=false`，rollbackVerification 仍 pending；既有 `readScopePersistenceVerified=true` 只限已读范围，PNG 整图版面保持 `wholeSheetLayoutAccepted=false`，AL1 不重复移动。

## 2026-10-10 只读依赖查询实载及原生逻辑关系范围核验通过

- 用户手动重启后，实际模块指纹与本次获准 DLL 匹配，`bounded-element-dependencies` 已加载；新会话 revision=0/isModified=false。完整 134 项范围、29 项柱/轴网、236 个实例、24 个旧类型、源族、新类型和额外元素两轮读回与保存基线一致，文档状态及 RVT 文件摘要前后稳定，源 27 项参数和 AL1 X≈398.5/Y≈568 mm 不变。私有证据为 `runtime/element-dependencies-loaded-1791644043265.json`，状态 `ELEMENT_DEPENDENCIES_LOADED_SAVED_SCOPES_AND_NATIVE_RELATION_READS_VERIFIED`；`loadedModuleVerified=true`、`savedReadScopesVerified=true`、`readScopePersistenceVerified=true`。
- 离线复核两轮依赖响应及33项关系范围原始结构一致。134项完整范围和236项实例范围的原始读取有无序列表顺序差异，按既有完整规范化（参数、连接器/peers、电气 systemIds/memberIds 排序，-0→0）后一致，保留字段、重复项、未知状态和有序几何；不是删除字段后的比较或原始 JSON 字节相等结论。
- 显式查询源类型、源族、新类型和额外 Element 四个根，两轮原生响应一致且列表完整未截断。源类型的逻辑 dependents 为 2 项（含自身及一个既有元素）；源族为 33 项，FamilySymbol 成员为 6 项并包含源类型/新类型。新类型与额外元素的逻辑 dependents 各为 2 项，均包含自身与对方，API 自引用保留；非 Family 的族成员证据仍 not_family/count=null，不解释为零类型。33 项关系范围另作两轮完整 inspect，前后一致。
- `dependencyEvidenceComplete=true`、`nativeRelationshipVerified=true`、familyIncludesSourceAndCopy=true，只认证明确原生逻辑关系列表和族成员关系。额外元素仍为无类别的 Element，typeId/ownerViewId/levelId 为原生 -1；`additionalElementPurposeVerified=false`、baselineAvailable=false、classification=unresolved。关系、同名及源类型也有类似既有关系的现象不能证明额外元素无害，也不能补出复制前基线。
- confirmationCalls=0、planCreationCalls=0、modelWritesRequested=false、automaticSave=false、automaticRetry=false，没有新建计划、重复 Confirm、自动保存或重启。`typeCopyExecutionAccepted=false`、`allModelSideEffectsVerified=false`、全局 `closeReopenPersistenceVerified=false`，rollbackVerification 仍 pending；实例放置及完整模型副作用未验收，PNG 整图版面仍 `wholeSheetLayoutAccepted=false`，AL1 不重复移动。
- 用户随后明确选择允许仅当前本地测试副本的自动保存/重启流程，尚未实现或执行；不能将这份受限选择记作自动保存成功、自动重启完成或任意项目的默认许可。本次插件实载仍来自用户手动重启，该选择不改变独立依赖查询的只读契约。

## 2026-10-11 本地测试副本生命周期实现、最终验证及具体申请准备

- 按已批准设计实现 7 个独立生命周期接口、严格固定配方/会话保护、队列租约、原生事件证据、持久单次动作标记及跨进程许可。监督器核验备份、正常自然退出、新进程握手和重开后两轮完整范围；未知结果、弹窗、取消、超时、文件/配置变化均撤销后续动作，不自动重试、点击、强杀或恢复备份。普通模型计划仍不自动保存。
- 独立复核补齐启动时间字符串保持、取消发生在 marker 落盘期间及启动 RPC 待回执期间的停止门禁、成功返回后的单调截止检查、启动与握手及 continuation 共用预算。启动结果不能证明时保留 `launchOutcome=unknown`，不得重新启动或打开。实际 PowerShell helper 要求 **7.5+**，本机 **7.6.5**；UTF-8 管道保留中文路径。
- 实际只读检查发现 Revit 打开的 RVT 拒绝普通 `Get-FileHash`/`FileShare.Read`；原生及 helper 改为共享只读句柄，保留同一 handle 的最终路径、Win32 identity、大小和写入时间前后比较，并以 fresh path handle 检测同路径替换。共享 writer 锁及中文路径夹具通过，不改变模型、ACL或 Revit 文件锁。
- 最终 **CoreTests 255/255**；MCP 全量 **794 项：793 通过、0 失败、1 项实际 CIM 烟测隔离**。实际 CIM/隐藏 helper 烟测已独立通过；监督器模拟覆盖 no-op/dirty-save、重复 attempt、文件/进程/端口/模块漂移、日志破坏、未知结果、取消和截止后成功回执。最终日志为 `acceptance/lifecycle-final-sharedread-core-tests.log`、`lifecycle-final-sharedread-mcp-tests.log`。先前因真实端口权限或并行负载超时的一项失败日志保留，生产 helper 15 秒预算没有放宽。
- 使用实际 Revit **27.3.0.28** 隔离构建 `v27/bin/Release/net10.0-windows-lifecycle-final-sharedread-20261011/`，**0 警告/0 错误**；安装 `CheckOnly` 通过，日志为 `acceptance/lifecycle-final-sharedread-build.log`、`lifecycle-final-sharedread-install-check.log`。DLL SHA-256 为 `27f3096a0c6b2d1f885decdb95a91d81a6661519c3a88138327466993c5f0a4f`，MVID `24cb2862-77a4-491c-adcb-5fe2e493b4a1`。
- 最终实际 OS 只读证据 `acceptance/lifecycle-supervisor-os-readonly-1791650898731.json` 确认固定中文模型磁盘字节、配置、进程、保留句柄与端口一致，save/exit/launch/open 全为 **0**；证据 SHA-256 `f153706ed79407df375cc1807c9a0cc2131ca03b09097426a1befd094be7b378`。这不是自动保存、退出或重开实机验收。
- 新 fresh baseline `runtime/local-test-copy-predeployment-1791650530410.json` 完整两轮比较 134 项、29 项柱/轴网、236 个实例、24 个旧类型、源族/新类型/附加元素/33 项关系范围、完整类别/类型成员及四根依赖；文档 identity/revision/保存状态与 RVT 字节稳定。29 个固定读取配方的依赖参数仅保留 elementIds，会话由原生独立 pin 保护。
- 最终申请为 **PREPARED**，`runtime/registration-switch-request-7b5af9072678f5b409374c2cae22a146.json`，申请 SHA-256 `47201BC4B7BB1B29826D3FCEB454D581EF0D3ABD96514FD827DD2C005FE58E98`。独立复核证据 `runtime/registration-switch-independent-native-review-7b5af9072678f5b409374c2cae22a146.json` 验证 request/DLL/MVID/baseline 摘要、仅 Assembly 清单差异、bridge bytes/ACL、runtime ACL、2025 清单和客户端配置；attempt/receipt/backup 不存在。旧 `209aa314bef5438ba476c69915c2d11c` 申请仅作历史，已被此新申请替代，禁止 Confirm。
- 本轮没有注册、Save、Exit、Launch、Open 或模型 Confirm。具体构建注册仍需本次申请的独立批准，首次加载生命周期能力仍需一次人工重启；加载后另做具体生命周期预览和批准。真正的保存写入分支及 ExternalEvent 打开、正常退出均未实机验收。`additionalElementPurposeVerified=false`、`typeCopyExecutionAccepted=false`、`allModelSideEffectsVerified=false`、rollback pending 及 `wholeSheetLayoutAccepted=false` 保持原限制；AL1 不重复移动。

## 2026-10-11 生命周期具体构建获准单次注册（首次加载待核验）

- 用户回复“批准注册这份具体构建”后，仅一次执行最终 `7b5af9072678f5b409374c2cae22a146` 申请的 Confirm，使用已审申请 SHA-256 `47201BC4B7BB1B29826D3FCEB454D581EF0D3ABD96514FD827DD2C005FE58E98`；回执为 **REGISTERED_MANUAL_RESTART_PENDING**。未注册旧 superseded 申请、未自动重试。
- 根代理和独立注册后复核均确认一次 attempt/receipt 绑定本次聊天批准，原清单备份摘要匹配，安装清单等于拟用字节、仅 Assembly 改变；新 DLL SHA/MVID、fresh baseline、bridge bytes/ACL、runtime ACL、2025 清单和客户端配置均一致。回执 SHA-256 `e85221f94f25bcee4321317c951a5ea68677716745f5a2d510a3259436ca0881`；独立证据 `runtime/registration-switch-independent-postregistration-review-7b5af9072678f5b409374c2cae22a146.json`，SHA-256 `062e1206a400b9da03690b14fae6eb36392bcfcf7a69af1d19df6ea2014006c1`。
- 注册后只读 bridge/context及 RVT 摘要核验表明旧进程仍加载依赖查询 DLL，文档 revision=0/isModified=false，当前文档与注册基线一致，保存字节未变。证据 `runtime/lifecycle-registration-current-readonly-1791653198946.json`；`newModuleLoaded=false`、`manualBootstrapRequired=true`，注册不能计为实机加载完成。
- 本阶段 save/exit/launch/open 全为 0，没有模型 Confirm、自动保存或重启。旧插件没有生命周期能力，首次加载须用户人工重启并重新打开同一已保存测试副本；之后只读核验新 MVID、能力及完整保存范围，再准备具体自动流程预览。所有附加元素用途、整体副作用、回滚及 PNG 版面限制保持原状。
- 首次重启后的只读探针 `mcp/verify-lifecycle-loaded.mjs` 已编写、根代理静态复核及语法检查通过；仅在用户报告重启重开后带 `--user-reported-reopened` 运行。绑定本次 request/receipt/DLL/基线/固定登记，仅五种只读查询，两轮完整范围、新 PID/文档 identity及保存字节核验，无 lifecycle.prepare、模型计划或任何生命周期动作；当前尚未运行。

## 2026-10-11 生命周期插件实载核验及具体预览

- 用户报告已手动重启 Revit 并打开同一已保存测试副本后，`mcp/verify-lifecycle-loaded.mjs --user-reported-reopened` 只读核验通过。实际 MVID `24cb2862-77a4-491c-adcb-5fe2e493b4a1`、PID `32624` 和批准构建一致；29 个固定读取配方、两轮完整范围、依赖关系、文档会话及 RVT 字节摘要一致。证据为 `runtime/local-test-copy-lifecycle-loaded-1791664869517-2f21887f-b5d2-4d63-a107-62c5b502edf5.json`，状态 `LOCAL_TEST_COPY_LIFECYCLE_LOADED_SAVED_READ_SCOPES_VERIFIED`。探针没有模型写入、计划创建/确认、保存、退出或启动。
- 只读 `Prepare` 已生成当前本地测试副本的具体生命周期请求，operationId `a04e766bf8bca0d4ebae691981ca780e`，请求 SHA-256 `af89d67308df818cc2af08beb6ff1c0cc2fed3b8f81fa9a9883931a339ff6a25`，有效期至北京时间 `2026-10-11 04:52:42`，`saveAction=noop_already_saved`。请求绑定当前 PID/文档 identity/保存文件摘要和固定 29 配方；当前未执行 Execute，后续需针对这份具体预览取得聊天批准。附加元素、柱类型复制完整副作用、回滚和 PNG 整图版面限制保持不变。

## 2026-10-11 生命周期具体预览执行停止于启动未知

- 用户明确批准 operation `a04e766bf8bca0d4ebae691981ca780e` 后仅执行一次。no-op 保存、58 项固定读取、RVT 摘要 `f418b4f4520e0f87999e63cab4d3ccf22ac4399850d53fc12a8a0f77616e7a62`、正常退出、退出码 0、端口释放和 `shutdown_closed` 均通过；没有真实模型改动。
- 单次启动请求已落盘为 `launch-attempt`，随后 PowerShell OS helper 返回 `os_inspection_failed`。监督器永久停止并记录 `launchOutcome=unknown`；没有 `launch-observed`、`continuation`、`open_saved_copy_once` 或重试。当前 Revit 已退出、桥接端口未占用。该 operation 不得继续或重试；需用户手动重新启动 Revit 并打开同一测试副本，之后重新生成新的具体预览。备份和完整状态链保留在私有 `runtime/lifecycle-a04e766bf8bca0d4ebae691981ca780e-*` 文件中。

## 2026-10-11 手动恢复后重新生成生命周期预览

- 用户已手动重新启动 Revit 并打开同一测试副本。新的只读加载探针再次通过，MVID `24cb2862-77a4-491c-adcb-5fe2e493b4a1`、29 个固定读取配方、保存范围和 RVT 摘要一致；本次证据为 `runtime/local-test-copy-lifecycle-loaded-1791665728952-8b4e4440-3f09-41ed-abeb-572f03870140.json`。
- `Prepare` 已生成新的具体预览 operation `f9a2b6b3363ee68a76ef2de1ef84e110`，请求 SHA-256 `06337398d34484961b025c21c0b9d280dbc34deac2ce569fb87e82fab99f61f1`，有效期至北京时间 `2026-10-11 05:06:31`，`saveAction=noop_already_saved`。它绑定 PID `28324`、文档 identity `fdfd51b92de621b024d08e19c5bf0118` 和同一保存文件；旧 operation 的停止状态不会被复用，当前尚未执行。

## 2026-10-11 启动器自动化修复及新预览

- 为解决上次 `os_inspection_failed`，启动器在 `Process.Start` 时固定 `Revit.exe` 工作目录，移除启动 RPC 中的提前 `Process.Handle` 访问，并在 helper 响应中加入受限错误类型、脚本行号和消息；监督器只把诊断写入外部状态记录，保留永久停止和单次启动门禁。定向生命周期监督器测试 **59 项：58 通过、1 项按环境跳过**，PowerShell 语法检查通过。
- 修复后只读 `Prepare` 生成 operation `7fc4ebc54c8467011bda8a52cbd5306e`，请求 SHA-256 `cfcc020d9e4bb8bf86068866b40acdd893a8afa88f30eef503840e4c73439f71`，有效期至北京时间 `2026-10-11 05:16:53`，绑定 PID `28324`、文档 identity `fdfd51b92de621b024d08e19c5bf0118`、MVID `24cb2862-77a4-491c-adcb-5fe2e493b4a1` 和稳定 RVT 摘要，`saveAction=noop_already_saved`。该预览尚未执行。

## 2026-10-11 新生命周期预览执行停止及锁竞态修复

- 用户批准并执行 operation `7fc4ebc54c8467011bda8a52cbd5306e` 一次。`BACKUP_VERIFIED`、`SAVE_VERIFIED`、58 项固定读回、`EXIT_POSTED`、`OLD_PROCESS_EXITED`、退出码 0、`shutdown_closed`、端口释放和原 RVT 摘要均通过；监督器随后在单次空 Revit 启动前的 OS helper 检查停止，终态 `STOPPED`，`reason=os_inspection_failed`，`launchOutcome=unknown`。具体错误为 PowerShell 第 160 行读取仍由监督器持有的 `runtime/local-test-copy-supervisor.lock` 时发生共享冲突。未写入模型，未留下 `launch-observed`/continuation，未打开文件，未自动重试；该 operation 永久不可重试。
- 已修复为“持有锁句柄负责互斥，关闭的 per-operation lease 文件负责 helper 读取”：新增 `lifecycle-<operationId>-supervisor-lease.json`，helper 不再读取被占用的 `.lock`，`finally` 同时清理两者。定向监督器测试 **60 项：59 通过、1 项按环境跳过**；PowerShell 语法检查通过。
- 后续必须人工恢复 Revit 并重新打开指定测试副本，再生成新的具体预览和批准。旧 operation `7fc4ebc54c8467011bda8a52cbd5306e`、以及更早的 `a04e766bf8bca0d4ebae691981ca780e`、`f9a2b6b3363ee68a76ef2de1ef84e110` 均禁止重试；AL1 表格移动、柱类型复制和 PNG/图框迁移不在本次生命周期流程中重复执行。

## 2026-10-11 恢复后新生命周期预览

- 用户报告已重启并打开同一副本。`mcp/verify-lifecycle-loaded.mjs --user-reported-reopened` 只读核验通过：MVID `24cb2862-77a4-491c-adcb-5fe2e493b4a1`、29 项固定配方、完整保存范围和 RVT 摘要一致；`modelWritesRequested=false`、`confirmationCalls=0`、`lifecycleActionCalls=0`。
- 新 `Prepare` 生成 operation `2d80cae3e36ad798674b23111fa60d7b`，请求 SHA-256 `9228226b5deca8c417546f4577f67506eeb57def7a29fab9509fcbe06b13bdda`，北京时间 2026-10-11 20:33:16 到期，绑定 PID `26220`、文档 identity `e7547203e3713868aca160b14046350d`、revision `0`、`isModified=false` 和 RVT SHA-256 `f418b4f4520e0f87999e63cab4d3ccf22ac4399850d53fc12a8a0f77616e7a62`；`saveAction=noop_already_saved`。当前仅有只读预览，尚未执行。

## 2026-10-11 生命周期预览过期停止

- 用户在 20:42:57（北京时间）确认执行 operation `2d80cae3e36ad798674b23111fa60d7b`，但其有效期已于 20:33:16 结束。监督器返回 `STOPPED` / `lifecycle_supervisor_rejected`，在任何保存、退出、启动或打开动作前停止。
- 只生成了 `supervisor-000001` 与 `supervisor-stop` 记录；没有 backup、save、exit、launch 或 open 证据，当前 Revit 会话保持运行，锁已清理。该 operation 不可续期或重试，必须重新 Prepare 并在新的十分钟窗口内确认。
- 当前 Revit 会话未关闭，随后重新执行只读 `Prepare` 成功：新 operation `5823fbbb45c81a063bb4ba005ba20cab`，请求 SHA-256 `ba79d0a1eb465d47283aadabe17c1077a7edbf625c9f0d79bc256c62e73c47f6`，北京时间 2026-10-11 20:56:25 到期，29 项固定配方，`saveAction=noop_already_saved`。新预览尚未执行。

## 2026-10-11 第二次授权连接失败及 ShellExecute 修复

- operation `5823fbbb45c81a063bb4ba005ba20cab` 的备份、`SAVE_VERIFIED`、正常退出、`OLD_PROCESS_EXITED`、端口释放和原 RVT 摘要均通过。新 Revit 只启动一次，未完成生命周期插件握手即崩溃，监督器以 `STOPPED / lifecycle_supervisor_rejected` 终止，没有 `launch-observed`、continuation 或打开副本证据；不重试。
- `journal.0066.txt` 在 20:51:00 记录 `License initialization complete`，20:51:30 记录 `VendorCode 22: Unable to connect with a Licensing component`。`AdskLicensingService.log` 同时记录授权 Agent 等待连接超时 30 秒。服务本身原先显示 Running，但 Agent 通道未建立；截图为 Autodesk 通用崩溃报告，不能单独证明许可证过期。
- 已在 21:00（北京时间）重启 `AdskLicensingService`，只读状态为 `Running / Automatic`。当前没有 Revit 进程；需用户手动启动 Revit 验证许可证状态并重新打开测试副本，之后重新 Prepare 生命周期预览。
- operation `b7bd7c51266d64598a8097449c096223` 随后执行一次：备份、`SAVE_VERIFIED`、`EXIT_POSTED`、`OLD_PROCESS_EXITED`、退出码 0、端口释放和文件摘要均通过；新 Revit 启动后未完成握手即停止。`journal.0068.txt` 再次记录授权初始化完成后 `VendorCode 22 / Unable to connect with a Licensing component`，父进程为 `pwsh.exe`。没有 `launch-observed`、continuation 或打开副本证据，未写入模型，旧 operation 不可重试。
- 启动器已改为 Windows ShellExecute (`UseShellExecute=$true`)，保留固定 Revit 工作目录、单次启动和进程/端口/MVID 门禁，避免 PowerShell 子进程路径干扰 Autodesk Licensing Agent。定向监督器测试 **60 项：59 通过、1 项按环境跳过**；PowerShell 语法检查通过。
- 后续需用户手动启动 Revit 并重新打开同一测试副本，再生成新的具体生命周期预览；不得复用 `b7bd7c51266d64598a8097449c096223`。

## 2026-10-15 建筑主体原生回读增强（代码完成，未实机验收）

- 按已批准方案，墙、楼板、全部受控墙宿主门窗新增原生回读规则；保留既有类型/标高解析路径与原始输入证据，缺失或不一致时进入既有事务组回滚路径。
- 逐项读回后在事务提交前后再次复核；inspect 新增 architecturePrimary 快照。快照失败返回不支持，最终回执仍明确不证明全部副作用、保存持久化、视觉或工程合规。
- 新增统一 runId/taskId/planId 的离线回滚证据校验器，使用 captured 状态、UTC 时间、attemptId 和嵌套原生 receipt；不调用桥接、不保存、不重启、不重试。未知/截断或不完整独立快照不能提升验收状态；未提交创建的事件 ID 覆盖可不完整，原样保留该标记，以独立快照证明捕获范围恢复，绝不提升为全模型副作用通过。
- CoreTests 280/280；完整 MCP 909 项：908 通过、0 失败、1 跳过。隔离 Revit 2027.3 编译 0 警告、0 错误。当前具体 DLL 为 bin/Release/architecture-primary-readback-20261015T152625Z/RevitAutoV27.dll，SHA-256 为 5C1A2E120D0AE9F506031CE168C5D245C848596B355EC92DD64BEE09D96A9B20。
- 当前状态最多为 compiled。建筑主体仍依赖新的只读基线；墙/楼板输入轮廓 Z 与 ProjectElevation 的实际关系、成功写入、失败回滚、人工保存/重开及 PNG 均未在本轮实机验收。能力范围和旧来源验收结论不变。
- 本轮没有注册插件、创建 Revit 计划、确认或写入模型、保存或重启；后续进入插件加载时先提示用户。详见 docs/architecture-primary-readback.md。

## 图纸元数据与放置联合只读预检（Node 代码完成）

- electrical.sheet 的 metadata 与 placement 预检现在对显式 ID 求并集，每批最多 100 个，只读取一次并在当前调用内共享结果。模拟共享图纸/视图场景从两次 inspect、5 个请求 ID 减为一次、3 个唯一 ID；101 个放置共享图纸/视图为 103 个唯一 ID，批次为 100＋3。
- 独立 placement inspect 仍每次读取新数据；共享复核是纯函数，没有跨调用缓存。原放置 scope、安全标记和 drawing_placement_scope_unknown 错误码保留，批次返回后尊重取消状态。
- 统一规划器仍检查读取前后的 identity/revision/path/isModified；变化时在预览创建前停止。图框和视口标签独立操作限制、architecture.documentation 输入范围保持不变。
- 定向回归 55/55；新增联合预检流程回归通过；完整 MCP 917 项：916 通过、0 失败、1 项跳过。独立复审通过。
- 本批只改 Node 模块和文档，未改 C#、未编译/注册 DLL、未调用真实桥接或模型计划、未保存/重启。任务保留既有 compiled，仅本次预检增强达到 core-tested，不提升实机验收结论；当前 Revit runId 仍为空。
- 下一切片为文档元数据/放置/图框的提交前后原生回读；旧 AL1/E101 操作不重放。详见 docs/sheet-inspection-preflight.md。

## 图纸放置提交前后回读（代码完成，未实机验收）

- `move_drawing_placement` 现在记录单项 placement，在事务提交前和提交后重读类别、sheet/view 关系、纸面 XY 与原生 Z 证据；超过 1 mm 或关系变化时回滚。
- 回执新增 `documentationVerification`；只证明本次 placement 原生字段回读，副作用、保存持久化和 PNG 视觉状态保持 false。元数据参数、图框更换、新建图纸/放置仍待接入。
- CoreTests 283/283；相关 MCP/规划回归 96/96；Revit 2027.3 隔离编译输出 `bin/Release/documentation-placement-readback-20261016T041128Z/RevitAutoV27.dll`，0 警告、0 错误，SHA-256 为 `C37B24FCB939521F36B570E2FDCB2DC9C2E588645C4891C10628D4537082FE9D`。
- 本轮没有注册插件、创建或确认 Revit 计划、写模型、保存或重启；文档任务仍为 `compiled`，实机 placement 回读、回滚、保存重开和视觉验收待后续新 runId。

## 图纸元数据提交前后回读（代码完成，未实机验收）

- 四项既有元数据参数 `SHEET_NUMBER`、`SHEET_NAME`、`VIEW_NAME`、`VIEW_SCALE_PULLDOWN_METRIC` 已接入 setter 后、事务提交前和提交后的原生值复核；未知类型、目标类别或值变化会回滚。
- 回执新增 `documentationMetadataVerification`，副作用、保存持久化和视觉状态保持 false。新建图纸/视图、图框更换仍未接入同一回读闭环。
- CoreTests 285/285；文档 placement/metadata/注册规划回归 82/82；Revit 2027.3 隔离编译 0 警告、0 错误，DLL 为 `bin/Release/documentation-metadata-readback-20261016T042756Z/RevitAutoV27.dll`，SHA-256 为 `8D729FE15B3714F05C21B670FADFAB4FE44B069565065DA4E4625100A2CB559`。
- 本轮未注册插件、未调用 Revit、未创建或确认计划、未写模型、未保存或重启；文档任务仍为 `compiled`，元数据实机回读、回滚、保存重开和视觉验收待新 runId。

## 图框类型更换提交前后回读（代码完成，未实机验收）

- 图框更换现在记录受控单操作，在事务提交前和提交后复核 ViewBased 图框实例、所属图纸、目标类型、完整图框成员、位置/旋转和依赖存在性。
- 回执新增 `documentationTitleBlockVerification`，不提升副作用、保存持久化和视觉验收。图框仍保持独立单操作，旧图纸/AL1/E101 证据不重放。
- CoreTests 285/285；文档与注册规划相关回归 82/82；完整 MCP 919 项：918 通过、0 失败、1 跳过。隔离 Revit 2027.3 编译 0 警告、0 错误，DLL 为 `bin/Release/documentation-titleblock-readback-20261016T043448Z/RevitAutoV27.dll`。
- 本轮没有注册插件、调用 Revit、创建或确认计划、写模型、保存或重启；文档任务仍为 `compiled`，图框实机回读、回滚、保存重开和视觉验收待新 runId。

## 2026-10-16 图纸创建与放置原生回读扩展（代码完成，最新构建待重验）

- `create_sheet`、`place_viewport` 以及由源视图类型决定的普通视口、明细表和配电盘表放置现已接入原生创建回读。回读记录 `ViewSheet` 的图框实例/类型成员和请求类型；放置回读分别要求 `Viewport`、`ScheduleSheetInstance` 或 `PanelScheduleSheetInstance`，并核对图纸归属、源视图归属和纸面 XY。该结果只认证当前事务内的原生字段。
- 图框类型更换在 `ChangeTypeId` 返回新实例时继续使用新实例 ID 绑定提交前后回读；`OperationReceipt` 保存结果实例 ID 和回读绑定，避免把 FamilySymbol 类型 ID 当成图框实例 ID。
- 回执继续明确 `nativeReadbackVerified=true` 之外的 `sideEffectsVerified=false`、`persistenceVerified=false`、`visualVerified=false`。保存/关闭重开、PNG 视觉和全模型副作用不因代码回读通过而提升。
- 当前工作树尚需重新运行 CoreTests 并重新隔离编译；已有 `bin/Release/documentation-creation-readback-20261016T000000Z/RevitAutoV27.dll`（SHA-256 `6B6AF367E67E76BD11224E86B418342BDF3149BE1CD241173CED14B86700176A`）不包含最近追加的放置类别映射与图框回执规则，不能注册或作为最新实机构建。
- 本轮没有注册插件、重启 Revit、调用桥接、创建模型计划、确认、写模型、保存或重开。`documentation.sheet-metadata-and-placement` 继续保持 `compiled`；下一步为当前源码 CoreTests/类别映射测试、版本化隔离编译、哈希记录，然后再提示用户加载新 DLL 并手动重启进入只读基线。

## 2026-10-16 图纸创建与放置原生回读扩展（最新源码已验证）

- 当前源码 CoreTests **292/292** 通过；新增 `ExpectedPlacementClass` 回归覆盖普通视图、`ViewSchedule` 和 `PanelScheduleView`，并保留未知视图回退到 `Viewport` 的封闭规则。
- Revit 2027.3 隔离编译 **0 警告、0 错误**，具体 DLL 为 `v27/bin/Release/documentation-creation-readback-20261016T-final/RevitAutoV27.dll`，MVID `a47f13ad-fd6b-457a-a764-16bbf3d53d20`，SHA-256 为 `E9475D51AC979DEEDA5066F8909D700A3C11032BEDBC5A096C32255672D517EB`；安装 `CheckOnly` 通过且未更改配置或清单。
- 图纸 placement、创建回读、图框及规划定向回归 **38/38** 通过。当前状态仍为 `compiled`：尚未注册这份具体构建、尚未重启 Revit、尚未调用桥接、创建计划或修改模型；没有提升到 `readonly-accepted`。
- 进入实机前需以该 DLL 为唯一候选取得注册复审，用户手动加载并重启 Revit 后创建新 `runId`，先做只读基线，再按 metadata、placement、titleblock、创建图纸/放置和标签拆分单能力验收。旧 identity、revision、planId、runId 和 AL1/E101 结果不复用。

## 2026-10-16 文档回读构建已注册，等待人工重启实载

- 用户对上述具体 DLL 回复“批准”后，重新核对 SHA-256 `E9475D51AC979DEEDA5066F8909D700A3C11032BEDBC5A096C32255672D517EB` 与 MVID `a47f13ad-fd6b-457a-a764-16bbf3d53d20` 完全匹配，且没有该候选的历史注册 attempt。
- 注册请求 `ff8b9d2a513b5503e0a935b05415b547`，独立复核的请求 SHA-256 为 `4046D11C225CB015F5ECC7E1C0507D92BA6F4FF847F2B4D84370E41CB0F8C29F`。仅 Confirm 一次，仅切换当前用户 Revit 2027 清单的 Assembly 路径；原清单备份、安装清单回读、DLL 指纹及受保护配置前后核验通过。受限环境对用户清单的读取由已授权受控权限提升完成，未修改 ACL。
- 私有回执 `runtime/registration-switch-receipt-ff8b9d2a513b5503e0a935b05415b547.json`，SHA-256 `5FDFD4EAB1E5F1FDA07F8FA871EBEC28C12E8BEAB667EB640DB4FC759B7DA3FB`，状态 `REGISTERED_MANUAL_RESTART_PENDING`。`attemptCount=1`、`modelWritesRequested=false`、`automaticSave=false`、`restartPerformed=false`。
- 当前任务仍为 `compiled`。尚未核验实际加载的插件，也没有连接 Revit、创建模型计划或修改模型；等待用户手动重启并打开同一已保存测试副本后，以新会话创建 runId 做合并只读基线，不重复注册或重放旧模型写入。

## 2026-10-19 当前会话只读基线已验收

- 修复只读批次把 Revit 参数级 `readOnly=false` 误判为模型副作用的问题；根结果仍拒绝 `readOnly=false`，嵌套真实写入/保存/重启标记继续 fail-closed。批次 CLI 增加获批 MVID 精确锁定。
- 定向只读批次测试 17/17 通过；完整 MCP 测试 921 通过、1 跳过、0 失败。
- 新 run `bf911dae-be0c-4809-a197-342850bb4166` 绑定 Revit 2027.3、MVID `a47f13ad-fd6b-457a-a764-16bbf3d53d20`、PID `45492` 和当前测试副本 identity/revision 0。28/28 个 scope 完整；20 个实例类别页、1,275 项类型目录、282 个原生元素检查和两张图纸原生布局诊断通过。
- 布局诊断范围内未知几何、越界和相交候选均为 0。此项只读原生诊断不等于 PNG 整图视觉验收；视觉仍待验。
- 全程未创建模型计划、确认或写入，未保存、未重启。manifest、baseline、summary 与任务队列已归档；此前失败 run `a3cdd3a9-01e6-4ad1-a310-d5d9af390f00` 保留为 `unknown`。
- 下一项优先推进建筑主体单项原生验收：明确一个墙/楼板/门窗能力，完成当前类型、宿主和坐标语义核对，再用独立 run 验证预览、单次写入、回读与失败回滚。

## 2026-10-19 建筑主体单项只读预检

- 当前 Revit 仍加载已验收 MVID `a47f13ad-fd6b-457a-a764-16bbf3d53d20`，PID `45492`；测试副本 identity `99aa1b4ca8a9bebdf630d34f673515c8`、revision `0`、`isModified=false`。无需重新注册、加载或重启插件。
- `architecture.primary-elements` 新 run `80f8f212-e2dc-447b-af05-80b0229508b9` 的 3/3 只读 scope 通过：标高 `1F_ARC(0.000)` 为 ID 311/elevation 0 mm；墙类型 `F37_加气混凝土砌块墙_100mm` 为 ID 763588/native thickness 100 mm；当前 13 面墙完整读取。
- 同会话已有类别快照显示建筑墙到 X=36,000/Y=14,250 mm，MEP 管线最远到 X=62,000/Y=52,000 mm。为避开现有几何，候选测试点位移至外侧区域：单面 100 mm 墙，(70000,60000,0) 至 (75000,60000,0) mm，height 3000 mm、offset 0、structural=false、flip=false。
- 当前任务仍是 `readonly-accepted`。按单能力流程，先确认上述测试设计，再生成绑定当前 identity/revision 的预览；确认具体 planId 前不写入。成功写入后需另验收原生读回、失败哨兵回滚、用户手动保存/关闭重开及视觉状态。

## 2026-10-19 建筑主体单墙写入已验收

- 新 run `1fde38a1-ac13-4214-a5b9-9f4707603bab` 的 3/3 只读基线通过，绑定插件 MVID `a47f13ad-fd6b-457a-a764-16bbf3d53d20`、Revit PID `45492`、测试副本 identity `99aa1b4ca8a9bebdf630d34f673515c8` 和 revision `0`。
- 预览 plan `463cb44f9cdc459ec8f9aa0d24bfad62` 只有一项 `create_wall`，无警告。用户逐计划批准后只确认一次，回执 `committed`，创建 ID `2296040`。
- 插件原生主体验证及独立回读一致：墙类型 `763588`、标高 `311`、高 `3000 mm`、底偏移 `0`、未翻转、非结构；位置线从 `(70000,60000,0)` 到 `(75000,60000,0) mm`。当前任务提升为 `write-accepted`，此状态只覆盖本次单墙创建。
- 模型当前 revision `1` 且未保存。未自动保存或重启。请用户手动保存并关闭/重开同一副本后，继续持久化回读；视觉、失败哨兵回滚以及楼板/门/窗范围仍未验收。证据位于该 run 的 `manifest.json`、`baseline.json`、`preview.json`、`confirmation.json`、`execution.json` 和 `readback.json`。

## 2026-10-19 单墙手动保存核验通过

- 用户回复已手动保存。只读 `verification.saved` 检查确认测试副本路径与 identity 不变、revision `1`、`isModified=false`；revision 0→1 原生变更历史完整、未截断，墙 `2296040` 的原生快照仍与执行后回读完全一致。
- 已将 `saved.json` 写入 run `1fde38a1-ac13-4214-a5b9-9f4707603bab`。该证据不代表关闭重开持久化，`persistenceVerified=false`；任务仍为 `write-accepted`。
- 用户随后已关闭并重开同一测试副本，持久化证据见下节；本条只记录当时的待办状态。

## 2026-10-19 单墙 PNG 视觉验收

- 当前重开会话只读确认 Revit PID `45492`、插件 MVID `a47f13ad-fd6b-457a-a764-16bbf3d53d20`、文档 identity `b811ce67462646d015583361ccbe58ab`、revision `0`、`isModified=false`；墙 ID `2296040` 的类型、标高、尺寸与端点保持一致，选择集为空。
- 只读导出现有 `AI-V040 建筑验收平面`（ID `2295811`）和 `1F_综合3D`（ID `770918`）的 4096 px / 300 DPI PNG。平面图用作整体上下文；3D 图和局部放大图清楚显示目标位置的独立墙体轮廓，视觉验收只覆盖该墙。
- PNG 与 SHA-256、当前回读和验收决策归档至 `acceptance/runs/1fde38a1-ac13-4214-a5b9-9f4707603bab/visual/`、`visual.json` 和 `summary.json`。任务队列更新为 `visual-accepted`；失败回滚、楼板、门、窗及整体建筑主体验收仍未完成。
- 导出后复核没有模型写入、RVT 保存或重启；无需用户重新加载插件或重启 Revit。

## 2026-10-19 单墙关闭重开持久化验收通过

- 用户关闭并重开同一路径测试副本后，插件 MVID 保持 `a47f13ad-fd6b-457a-a764-16bbf3d53d20`；新 Revit 文档 identity 为 `b811ce67462646d015583361ccbe58ab`、revision `0`、`isModified=false`。这是新会话标识，旧 identity 不复用。
- 墙 ID `2296040` 及 UniqueId 在文件中保留；原生类型 `763588`、标高 `311`、高度 `3000 mm`、零偏移、未翻转、非结构和位置线均与执行回读一致。完整墙列表为 14 项，只有本次批准的新墙；原 13 面墙不变。当前跟踪的其它类别计数无变化。
- 当时 `reopen.json` 标记 `persistenceVerified=true`，任务推进到 `persistence-accepted`；视觉核验尚未进行。随后视觉结果见上节，单墙当前状态为 `visual-accepted`。
- 下一项按任务队列单独验收失败哨兵回滚，再分别推进楼板、门和窗；本次完成后无需重启插件或 Revit。

## 2026-10-19 失败哨兵回滚验收通过

- 独立 run `9796b995-8de6-45ad-a261-b7a283c2dea3`，绑定 Revit 2027.3（27.3.0.28）、插件 MVID `a47f13ad-fd6b-457a-a764-16bbf3d53d20`、PID `45492`、文档 identity `b811ce67462646d015583361ccbe58ab`、revision `0`、`isModified=false`。
- 预览 `c2ea2f6df185f2e2daf08c8a7c09b67c` 含 2 项：`create_wall`（类型 `763588`、标高 `311`、`(70000,62000,0)`→`(75000,62000,0) mm`、高 `3000 mm`、非结构）完成后，`create_room` 在 `(120000,90000) mm` 未封闭区域以 `The requested room is not enclosed.` 失败。
- 原生回执 `status=failed`、`code=execution_failed`、`rolledBack=true`、`completedOperationCount=1`、`failedOperationIndex=2`、`failedOperationType=create_room`、`causeCode=invalid_operation`；revision `0→1`、`isModified=false`。只确认一次，断线后用 `revit.plan.get` 读取同一 planId，没有重试、重建或保存。
- 回读 35 项（14 墙 / 2 楼板 / 6 门 / 13 窗）与基线逐项一致，`verifyArchitecturePrimaryRollback` 通过（`rollbackVerified=true`、`capturedScopeVerified=true`）；原生 `captureComplete`/`elementEvidenceComplete` 保持 `false`，未伪造为安全。
- 同轮修复离线校验器门窗 BuiltInCategory 常量（`OST_Doors=-2000023`、`OST_Windows=-2000014`）；原常量会让真实门窗快照必然失败，合成测试未暴露。定向测试 22/22 通过，真实 35 项快照干跑通过。
- 任务状态仍为 `visual-accepted`（回滚是独立门禁，不提升状态机）；下一项为楼板、门、窗分别单能力验收，建筑主体整体仍未完成。
- 交接给下一次 Codex 会话的说明见 [handoff-2026-10-19.md](handoff-2026-10-19.md)；任务状态与下一步以 [capability-task-queue.json](capability-task-queue.json) 为准。

## 2026-10-19 楼板单能力只读基线与代码复核

- 复核 DeepSeek 交接范围内的门窗 `BuiltInCategory` 常量修正：`OST_Doors=-2000023`、`OST_Windows=-2000014`；离线回滚校验使用真实 35 项快照返回 `rollbackVerified=true`、`capturedScopeVerified=true`。定向回滚测试 22/22 通过；全量 MCP 测试 921 通过、0 失败、1 跳过。原生 `captureComplete=false`、`elementEvidenceComplete=false` 仍如实保留，不能据此声称全模型副作用已验证。
- 楼板新 run `43a57c9c-b876-4d49-a572-668f7755a8be` 的只读基线 10/10 scope 通过，绑定当前 Revit PID `45492`、MVID `a47f13ad-fd6b-457a-a764-16bbf3d53d20`、测试副本 identity `b811ce67462646d015583361ccbe58ab`、revision `1`、`isModified=false`。35/35 既有墙、楼板、门窗原生检查均有支持几何。
- 已有楼板实例使用类型 `F1_建筑楼板_素砼_100mm`（ID `763936`，原生默认厚度 100 mm），位于 `1F_ARC(0.000)`（ID `311`）。全模型实例分页搜索 7,491 项、76 类；172 项具有原生位置摘要，候选矩形 `(77000,63000)` 至 `(81000,67000) mm` 内无已定位实例。其余 7,189 项缺少 Location 摘要，其中包括楼梯及其子构件，故不把这一查询解释成已证明所有几何为空。
- 自动审批在楼板 `revit.plan.create` 请求执行前拒绝了候选区，理由是仍有未定位实例。没有 planId、预览、确认或模型写入。请先确认这组精确坐标用于非写入预览，或指定替代区域；坐标确认后仍会对单个具体 planId 再单独请求聊天批准。
- 只读证据位于该 run 的 `manifest.json`、`scopes.json`、`baseline.json`、`floor-preflight.json`、`primary-snapshot.json` 和 `spatial-catalog.json`。本轮未保存或重启 Revit。

## 2026-10-19 楼板单能力预览待确认

- 用户确认候选坐标后，只创建一份新预览 `2fca41cb0e25ff02d748689494510ec7`，绑定当前文档 identity `b811ce67462646d015583361ccbe58ab`、revision `1`。预览仅有一个 `create_floor`：类型 `763936`（原生默认厚度 100 mm）、标高 `311`、非结构、面积 16 m²，边界 `(77000,63000,0)`、`(81000,63000,0)`、`(81000,67000,0)`、`(77000,67000,0) mm`；无警告。
- 预览调用 1 次，聊天确认 0 次，模型写入 0 次，保存/重启 0 次。当前等待用户对这个具体 planId 批准；确认前不执行。预览证据位于该 run 的 `preview.json`。

## 2026-10-19 楼板计划确认被自动审批拦截

- 用户已多次明确批准执行楼板 plan `2fca41cb0e25ff02d748689494510ec7`。自动审批四次在命令执行前拒绝 confirm，最后一次即使同时提供 UTC 与上海 +08:00 时间也仍按 UTC 日期与本地日期比较为过期；四次都没有发送 Revit confirm。
- 最后一次只读状态为 `2026-10-18T20:41:34Z`（上海 `2026-10-19 04:41:34 +08:00`）：Revit plan 仍 `pending`，文档 identity `b811ce67462646d015583361ccbe58ab`、revision `1`、`isModified=false` 与预览一致。Expiry `2026-10-18T22:28:21.892Z` 对应上海 `2026-10-19 06:28:21 +08:00`；当前 Revit 自身尚未到期，但审批层仍拒绝该写入。
- 没有 attempt marker、`confirmation.json`、`execution.json` 或 readback，confirmCalls=0、模型写入/保存/重启均为 0。停止该 plan 的确认重试，不改用其它通道；需先解决审批层对 UTC/上海日期的判断，再按当时 plan 是否仍有效决定能否继续。若失效，按规则新建 run、重新读基线和预览并重新获得具体 plan 批准。
- 当前只停在已批准但未执行的预览。计划 expiry 按上海时间为 `2026-10-19 06:28:21`；如果届时失效，不复用旧 planId，需重新建立 run、读取新基线和预览并再次取得具体计划批准。模型没有写入、自动保存或重启。

## 2026-10-19 楼板预览归档过期

- 当前检查时间 `2026-10-19T09:50:40Z`（上海 `17:50:40 +08:00`）晚于 plan `2fca41cb0e25ff02d748689494510ec7` expiry `2026-10-18T22:28:21.892Z`（上海 `2026-10-19 06:28:21 +08:00`）。旧 plan 标记为 expired，原预览保留，不执行、不保存、不重启。
- 后续环境检查确认没有运行中的 `Revit.exe`，桥接端口 `8091` 也没有监听；因此 `ECONNREFUSED` 来自 Revit 宿主/桥接当前未启动，而非楼板操作或 plan 内容错误。任务队列记录为 `blocked` 并保留先前 acceptedStates；Revit 打开后必须新建 run、读取新基线和预览，不复用旧 identity、revision 或 planId。

### 离线回归复核

- 楼板/建筑主体验证 MCP 定向测试 **28/28 通过**，包括 floor boundary readback 的循环起点、完整反向顺序和畸形边界拒绝。
- CoreTests 首次使用默认 Windows 沙盒 Temp，在生命周期存储测试写入临时记录时因 `File.Move` 返回 `UnauthorizedAccessException` 退出。仅将本次 dotnet 测试进程的 `TEMP/TMP` 指向仓库 `tests/CoreTests/.tmp` 后重跑，**292/292 通过**；没有修改源代码、系统设置或 Revit。

## 2026-10-19 楼板新会话只读基线与预览

- 用户打开 Revit 与原测试副本后，桥接探测通过：Revit `27.3.0.28`、PID `18024`、插件 MVID `a47f13ad-fd6b-457a-a764-16bbf3d53d20`；新文档 identity `ecd87ddcb273adfd2e3595d868eef060`、revision `0`、`isModified=false`。旧预览已过期，没有复用旧会话绑定。
- 新 run `a8218da0-d1c2-4877-acbf-141ce7891333` 的 10/10 只读基线通过。35 个墙、楼板、门、窗原生快照均有支持；全模型分页搜索 7,491 个实例、76 个类别，172 个可定位实例中，已批准测试矩形内为 0。两块原有楼板边界稳定，类型 `763936` 原生默认厚度 100 mm，1F 标高 `311`。
- 新预览 `a3503d588dfe278a0e9d2f3d9eae6e6b` 仅含一项 `create_floor`：类型 `763936`、标高 `311`、非结构、16 m²，边界 `(77000,63000)` 至 `(81000,67000) mm`；无警告。创建预览 1 次，确认 0 次，模型写入 0 次；当前等待对这个新 planId 的批准。

## 2026-10-19 楼板单项执行与原生回读

- 用户批准的新 plan `a3503d588dfe278a0e9d2f3d9eae6e6b` 在当前 identity `ecd87ddcb273adfd2e3595d868eef060` / revision `0` 下只确认一次。回执 committed，创建主元素楼板 ID `2296043`；文档 revision `1`、`isModified=true`，插件未保存或重启。
- 原生 `architecturePrimaryVerification.nativeReadbackVerified=true`。独立核验确认类型 `763936`、标高 `311`、offset `0`、非结构；Revit 返回的四条边从循环偏移 3 开始，但轮廓与批准的 4 m × 4 m 矩形一致。原有 35 个墙/楼板/门/窗元素快照不变，唯一类别计数变化为 `OST_Floors` 2→3。
- 事务新增 7 个附加元素：SketchPlane、Sketch、4 条轮廓 ModelLine 和 1 条跨方向边缘 ModelLine；原生依赖查询确认它们都属于 floor/sketch 的 8 元素依赖集合。
- 同一事务还报告修改系统元素 `86962`（系统数据）与 `293247`（自动连接跟踪器图元）。它们没有类别和位置；只读参数显示为只读且值未知/空。逻辑依赖结果不能证明这两项修改与楼板无关，也不能证明其内容未变，故 `allModelSideEffectsVerified=false`、任务维持 `blocked`。
- 用户已手动保存；保存后的只读核验结果见下节。本次没有自动保存、自动关闭或重启。

## 2026-10-19 楼板手动保存核验通过

- 用户报告手动保存后，原 run `a8218da0-d1c2-4877-acbf-141ce7891333` 的只读 `verification.saved` 返回 `saved=true`、`isModified=false`、`saveState=no_pending_changes`；文档 identity `ecd87ddcb273adfd2e3595d868eef060`、revision `1`、RVT 路径及 Revit 进程/插件 MVID 均与本次执行相同，变更历史完整且未截断。
- 仍为 committed 的原 plan 和收据保持不变；完整 45 项原生 inspect 与提交后快照逐字段一致，含楼板 `2296043`、7 个楼板草图依赖及系统元素 `86962`、`293247`。没有新计划、确认、模型写入或自动保存。证据追加于该 run 的 `saved.json`。
- 本项仅为当前会话保存状态，后续关闭重开和视觉结果见下一节。

## 2026-10-19 楼板关闭重开持久化与 PNG 视觉验收

- 用户手动关闭并重开同一路径测试副本后，当前文档 identity 更新为 `6998d61394e161463d79ba8bade402e8`、revision `0`、`isModified=false`；插件 MVID 仍与楼板执行时一致。楼板 `2296043` 的原生类型、标高和边界匹配，45 项捕获范围逐字段匹配保存后与提交后快照。持久化为本次楼板单项 `persistence-accepted`，最终记录在 `reopen.json`，独立恢复记录为 `reopen-recovery.json`。初次归档尝试的参数错误原样归档在 `reopen-attempt-error.json`；后续只读恢复核验成功，没有重复保存或模型写入。
- 重开 identity 下只读导出四个既有视图。平面 `AI-V040 建筑验收平面` 的 crop 最大 X/Y 仅约 30,480 mm，不包含目标 77,000–81,000 / 63,000–67,000 mm 区域，因此只作整体背景；两个通用 3D 视图 `{3D}`（ID `1054338`）和 `{三维}`（ID `1847485`）都显示远离主体的 4 m × 4 m 独立水平板件，局部 PNG 可清楚区分它与附近的测试墙。该楼板视觉门槛 `visual-accepted`，PNG、裁图、尺寸和哈希在 run `visual/` 与 `visual.json`。
- 导出前后 RVT 哈希、identity、revision、`isModified` 和活动视图不变；没有创建计划、确认、保存、重启或模型写入。
- 事务修改的系统元素 `86962` 与 `293247` 仍无法分类，故 `allModelSideEffectsVerified=false`、整体 `writeAccepted=false`，`architecture.primary-elements` 继续 `blocked`。下一步先调查这两个元素的原生修改来源与影响；随后再分别推进门、窗单能力验收。

## 2026-10-19 楼板事务系统元素只读取证能力已编译

- 为调查未分类修改元素 `86962`（系统数据）与 `293247`（自动连接跟踪器图元），新增受控 MCP `revit.element.storage_schemas`。它只读取显式元素已附着的 Extensible Storage schema GUID、可解析时的 schema/vendor/application/access 元数据及字段定义；不读取实体值、创建计划、修改模型或保存。identity/revision 固定，单次最多 20 个 ID，GUID/字段/响应设预算，缺失/未加载/拒绝读取保留未知状态。
- TDD 验证：新增 MCP 只读/范围/响应/漂移测试 5/5；旧插件能力门禁测试 33/33；CoreTests 299/299；完整 MCP `npm test` 929 项，928 通过、0 失败、1 跳过。Revit 2027.3.0.28 隔离编译 0 警告、0 错误，精确构建 `install-v27.ps1 -CheckOnly` 通过。
- 具体 DLL：`v27/bin/Release/element-storage-schema-audit-20261019T/RevitAutoV27.dll`，MVID `93750ffe-f3da-4469-a7bf-8cf0f24de70e`，SHA-256 `643286C06FB6E55130FF299BE3AE09D8DDCF893644521007A3EF51CA1386D2F9`。当前仍运行 Revit PID `18024`、旧 MVID `a47f13ad-fd6b-457a-a764-16bbf3d53d20`；新能力没有注册或实载。
- 下一步先批准注册这份具体哈希的 DLL；注册后请用户手动重启 Revit，再基于新 identity/revision 对两个 ID 执行只读 schema 元数据查询。schema 元数据不能恢复提交前字段值，不能单独证明该事务的因果关系或全部副作用无害；在额外证据闭合前任务仍 `blocked`、整体 `write-accepted=false`。本轮没有注册或重启。

## 2026-10-20 注册后实载核验

- Revit 2027.3 PID `29888` 已加载批准构建 MVID `93750ffe-f3da-4469-a7bf-8cf0f24de70e` 与 `element-storage-schema-audit` 能力。针对 `86962`、`293247` 的 identity/revision 固定只读查询在同一验收文件新 identity `a8e6f2e7a0c155cf879df01173dd4cd0`、revision `0` 下完成；两元素均存在，schema enumeration 完整且各为 0 个 schema。证据：`acceptance/runs/a8218da0-d1c2-4877-acbf-141ce7891333/storage-schema-audit.json`。
- 该结果排除了这两个元素具有附着 Extensible Storage schema 定义的可能，但不能证明它们在楼板事务中为何被修改或修改是否有害。原事件记录为一次 `TransactionCommitted`，事务名为“建筑主体楼板单项验收：使用既有100mm建筑楼板类型，在1F创建一块4m×4m非结构楼板。”；执行前没有二者原生快照。保持 `allModelSideEffectsVerified=false`、`writeAccepted=false`、任务 `blocked`。
- 继续路径限定为寻找独立、只读、能直接比较事务前后状态的原生证据或可信 API 语义依据；不重放/重建楼板写入，不重复无信息增益的 schema 查询。

## 2026-10-20 文档版本差异实机验收

- 用户手动重启 Revit 后，插件 MVID `51ec430d-e749-4205-ac99-d4217aead546` 实载，`document-version-diff` 可用。当前文档身份 `6a31e4b3b31b93ca54eca8916b0d91bc`、revision `0`、未修改。
- 直接读取 `.0024.rvt` 的 Revit `BasicFileInfo` 得到事务前版本 GUID `8b2c9938-1fa0-41d2-a8ff-423898411749`、保存次数 51、SHA-256 `0F5180F55F02AA5EDEAF09ECB3720A9BF2F909AAEAD1B79ECEEC60F000B838CE`。当前版本 GUID `756d4e46-dcc0-45cc-ac42-93a1e92971cc`、保存次数 52。
- 只读差异完整返回新增 ID `2296041` 至 `2296048`（楼板及七个草图元素）和修改 ID `86962`、`293247`；非工作共享文档的删除 ID 不可用。新 run `cb2e5c1f-8255-41a9-a8ab-76002a264a01` 已归档，`foundation.document-version-diff` 推进至 `readonly-accepted`。
- 结果只证明这两个系统元素位于版本差异范围，未提供属性变化或因果关系。没有重复创建楼板；`architecture.primary-elements` 仍 `blocked`、`write-accepted=false`。
- 为下一次隔离测试补充 `mcp/floor-side-effect-diff.mjs`：严格比较指定元素的原生参数值快照，要求同一文档 identity/path、单次 revision 变化、执行前已保存且执行后未保存，并拒绝参数范围不完整。4 项定向测试及 MCP 全量 943 项通过（1 项环境跳过）。该比较器只报告显式元素参数差异，不证明因果或全模型副作用。
- 现有自动化只允许操作固定生命周期登记中的测试副本；当前登记仍绑定 `sample-lighting-model-验收-v031.rvt`，没有受控打开 `floor-side-effect-isolated-20261020.rvt` 的入口。因此尚未在隔离副本采集快照或重放楼板操作；原模型未写入，楼板任务仍 blocked。
- 用户随后明确授权 `floor-side-effect-isolated-20261020.rvt` 可用于任意模型写入。为此建立新 run `9dc73255-04f2-4687-a6b6-2c93f8eb1de5`；Revit `BasicFileInfo` 确认副本仍为版本 GUID `8b2c9938-1fa0-41d2-a8ff-423898411749`、保存次数 `51`、非工作共享，文件 SHA-256 与副本基线一致。此为文件级元数据，不代表 Revit 已加载。
- 当前 Revit 桥接仍连接原验收模型 identity `6a31e4b3b31b93ca54eca8916b0d91bc`。尝试启动第二个 Revit 时 Journal `0103` 在授权初始化后报 VendorCode 22，未完成插件握手；该空启动进程已停止，隔离模型未打开或修改。Windows UI 控制运行时不可用，且现有插件没有任意文件打开路由。下一步需要在已运行的 Revit UI 手动打开隔离副本，之后再采集新 identity/revision 下的只读基线并创建单项预览。
- 用户已在 Revit 中打开隔离副本。新 identity 为 `e6aaeef2ca4aa92305a21a1295f7d135`，revision 0；完整楼板类型与既有楼板检查通过，两个系统元素快照已保存。创建楼板预览 `7dc19ec81366301267078b146ce35b91` 获聊天确认并仅确认一次，新增楼板 `2296043` 原生回读通过，revision 变为 1、当前未保存。DocumentChanged 记录新增 8 个元素并修改 `86962`、`293247`；显式参数比较显示两者无变化，但这不证明隐藏状态、因果或全模型副作用。run `711bcd3f-6819-44aa-ab6b-ee85ca06527d` 已归档到待保存/重开/视觉阶段，任务继续 `blocked`。
- 未保存状态下只读导出 `AI-V040 建筑验收平面` 与 `{3D}` 两张 2048 px PNG；两图均非空，但楼板在当前视图中较小/未聚焦，视觉判断记录为 `inconclusive`。RVT 以共享只读句柄复核的磁盘 SHA-256 仍为原始 `0F5180F55F02AA5EDEAF09ECB3720A9BF2F909AAEAD1B79ECEEC60F000B838CE`，Revit 会话为 revision 1、isModified=true。需用户手动保存后关闭重开，完成持久化读取并导出更适合检查的 PNG；未自动保存或重启。
- 用户手动保存后，Revit 状态为同一 identity、revision 1、`isModified=false`；保存文件哈希为 `e360e31ac3611b4804c8a8f8e27c74bea83c3954e4fea8a66f69de3a62320008`，共享句柄两次哈希一致。完整墙/楼板/门/窗类别分页对比显示仅新增楼板 `2296043`，其类型 `763936`、标高 `311`、面积 16 m²、厚度 100 mm 均通过保存后原生回读；其余三类成员不变。持久化仍需关闭重开验证；视觉需重开后再做，旧 PNG 为 `inconclusive`。任务继续 blocked，因为 `86962`、`293247` 仍在原生修改事件里，参数一致不足以证明无隐藏影响。


## 2026-10-21 隔离楼板归档恢复与当前阻塞

- run `711bcd3f-6819-44aa-ab6b-ee85ca06527d` 的 `reopen.json` 已于上海时间 2026-10-20 23:56 记录关闭重开核验：identity `efd320e6c297b71433b97c1ab351a738`、revision `0`、`isModified=false`。楼板 `2296043` 完整快照与保存后记录一致；墙/楼板/门/窗完整范围比较记录通过。本轮把漏更新的摘要及队列同步为该历史范围 `persistence-accepted`，不重复保存或重开。
- 当前隔离文件 SHA-256 为 `392c92767304833f89f919aa8ae61a6ad68dca153ff1b720bcde14f3fe4a0c7c`，最后修改于上海时间 2026-10-21 00:57；不同于重开记录 `e360e31ac3611b4804c8a8f8e27c74bea83c3954e4fea8a66f69de3a62320008`。同目录 `.0002.rvt` 备份与历史摘要完全匹配。该差异不说明模型损坏或具体修改原因；当前没有 Revit 进程、桥接返回 `ECONNREFUSED`，需打开当前隔离副本后重新采集只读范围，旧 identity/revision 不可当作当前会话。
- 两张历史 PNG 的签名、尺寸与 SHA-256 已复核，原目视结论保持 `inconclusive`；没有生成重开后 PNG。楼板事务修改系统元素 `86962`、`293247` 的因果和隐藏影响仍未知，`writeAccepted=false`、`allModelSideEffectsVerified=false`，整体任务继续 `blocked`。
- 归档检查修正 manifest 中 65 位摘要抄录错误（来源为不变的 baseline 摘要），并把预览原始 `expiresAtUtc` 投影到顶层，原文件保存在本 run 的 `history/`。历史 baseline 未保存 MCP 契约快照，此缺口原样登记，不能事后冒充已采集。批准摘要已用 `SHA-256(JSON.stringify(preview.preview, null, 2))` 复算，与预览和确认记录完全一致。恢复证据：`archive-recovery-20261021T145406409Z.json`。
- 下一步：打开隔离副本 → 当前会话只读契约/范围比较 → 既有 3D PNG 导出与视觉检查 → 归档；副作用调查及门、窗仍按各自范围排队。本轮没有创建预览、确认、写模型、保存或重启。


## 2026-10-21 当前会话回读与隔离楼板视觉通过

- 用户打开隔离副本后，当前 Revit PID `36064`、MVID `51ec430d-e749-4205-ac99-d4217aead546`、identity `ef3d7c038e34f919b38a8cba4229b43e`、revision `0`、`isModified=false`。在同一批次完成 8 个只读 scope，并捕获实际 MCP 契约及哈希；证据 `current-session-readonly-20261021T150744631Z.json` 属于当前会话，不能补造为历史 baseline 的契约。
- 当前 3 块楼板、14 面墙、6 樘门和 13 樘窗，共 36 项完整原生 inspect 与保存后快照一致；楼板 `2296043` 的类型 `763936`、标高 `311`、4m×4m 边界、零偏移、非结构属性一致。两个待调查系统元素的完整已读快照也与上次重开一致。当前文件哈希仍为 `392c92767304833f89f919aa8ae61a6ad68dca153ff1b720bcde14f3fe4a0c7c`，不同于历史保存字节；这只证明本次已读范围一致，文件变化原因与全模型等价性仍未证明。
- 以当前 identity/revision 只读导出 `{3D}`（`1054338`）及 `{三维}`（`1847485`）两张 8192 px / 300 DPI PNG，分别为 8192×5060 和 8192×6445。完整图与不缩放局部裁图显示独立水平矩形板面和薄侧边，能与相邻竖向测试墙区分；结合原生位置回读接受楼板 `2296043` 的视觉状态。视觉门槛 `visual-accepted` 仅限该楼板，精确尺寸以原生证据为准；证据 `visual-post-reopen-20261021T150842721Z.json`，历史 `visual.json` 的保存前 inconclusive 结论原样保留。
- 导出前后当前 RVT 字节、identity/revision/保存状态、36 项主元素快照、活动视图/选择集、插件指纹均不变。没有创建预览、确认、模型写入、保存或重启；无需用户再次保存/重开。
- 楼板 `persistence-accepted` 与本次 `visual-accepted` 已归档；`86962`、`293247` 的事务修改因果与隐藏影响仍未知，`writeAccepted=false`、`allModelSideEffectsVerified=false`，整体任务保持 `blocked`。后续门、窗各用独立能力范围推进，不重放这次楼板写入。


## 2026-10-21 单门隔离验收预览待批准

- 新 run `f526ac0b-f23d-4928-acb6-5a9161248695` 使用当前已加载 Revit 2027.3 插件 MVID `51ec430d-e749-4205-ac99-d4217aead546`、PID `36064`，测试副本 identity `ef3d7c038e34f919b38a8cba4229b43e`、revision `0`、`isModified=false`。只读批次接受：墙14、楼板3、门6、窗13；完整 primary 基线 36 项，并检查既有门类型、墙宿主及相关依赖，证据 `baseline.json`。
- 单门候选使用既有门类型 `2222797`（单嵌板玻璃门 1 / 800 x 2100mm，OneLevelBasedHosted）和 1F 标高 `311`，放置于测试墙 `2295752`，点 `(36000,3000,0) mm`，唯一标记 `AI-ARCH-DOOR-TEST-20261021`。该 4 m 测试墙当前没有门，候选与既有 `AI-ARCH-DOOR-01` 分属相邻墙；预览无 warning，只包含一项 `create_family_instance`，影响 `OST_Doors`。
- 预览 planId `0b2c047d409821bec049c832166a071c`，批准摘要 SHA-256 `030db7586ce3e1254923469e2cff68f3acb5a095481c18ad5c5b16c92054d797`，过期 `2026-10-21T17:37:44.6459456Z`。已保存 `preview.json`，未 Confirm、未写入、未保存/重启。需用户在聊天中明确批准这个 planId 后才可单次执行。
- 本单门 run 即使通过，也不自动解除楼板系统元素 `86962`、`293247` 未查明导致的整体 `architecture.primary-elements=blocked`；窗验收仍须单独进行。


## 2026-10-21 单门写入和宿主切口原生回读

- run `f526ac0b-f23d-4928-acb6-5a9161248695` 的门计划 `0b2c047d409821bec049c832166a071c` 获聊天批准并只 Confirm 一次；回执 `committed`，创建门 `2296049`。原生读取确认门类型 `2222797`、宿主墙 `2295752`、标高 `311`、坐标 `(36000,3000,0) mm`、唯一 mark `AI-ARCH-DOOR-TEST-20261021` 正确。门类别从6增至7，墙、楼板、窗类别成员集与本次基线完全一致。
- 原生变更日志只记录 added 门 `2296049` 和 modified 宿主墙 `2295752`，无删除和额外新增。宿主墙的类型、标高、位置、朝向、约束及完整 `architecturePrimary` 几何保持一致；仅原生面积/体积字段变化。面积减少 `1.680 m²`，体积减少 `0.168 m³`，分别匹配 `0.8 m × 2.1 m` 门洞面积和穿越 `0.1 m` 墙厚的体积。其它已检查建筑元素原生快照无变化。本次单门的限定范围写入和回读已接受。
- 文档当前 revision `1`、`isModified=true`，插件未自动保存。请用户手动保存测试副本；随后做只读保存状态核验，再手动关闭重开同一路径，并进行持久性和 PNG 视觉检查。
- `allModelSideEffectsVerified=false` 保留，因为只读覆盖限于建筑主类、门类型和宿主墙。总体 `architecture.primary-elements` 继续 `blocked`：此前楼板操作报告的系统元素 `86962`、`293247` 原因仍未解决。窗单项验收尚未开始。


## 2026-10-22 单门保存重开与视觉验收通过

- 用户回复“好了”后当前会话 identity 已从 `ef3d7c038e34f919b38a8cba4229b43e` 更新为 `af6c5cd5caf6a4eceb0ba193e0dec5cb`，revision `0`、`isModified=false`。`revit.saved.verify` 返回 `no_pending_changes`；37 个墙/楼板/门/窗实例和 7 个相关 WallType/FloorType/FamilySymbol 的完整原生检查与提交记录相符，唯一新增门 ID `2296049`、宿主墙 ID `2295752`；另检查两个楼板观察系统元素，共 46 个检查元素。证据 `saved.json`、`reopen.json`。
- 当前重开会话使用原插件 MVID。只读导出 `{3D}` 和 `{三维}` 的 8192 px PNG；在 `{3D}` 的隔离测试区局部图中可见门扇/门框安装在宿主墙开口中，与原生门 ID、宿主和坐标一致。本单门视觉状态 `visual-accepted`；证据 `visual-post-reopen-door-r2-20261021T155944785Z.json` 和 `visual/` 的原图与局部裁图。导出前后 identity、revision、保存状态、主元素范围、活动视图/选择集未变。
- Revit 对当前 RVT 持有 Windows 文件共享锁，无法取得磁盘 SHA-256；保存状态和声明原生范围的关闭重开比较已通过。没有新的模型写入、保存或重启。
- 单门操作的 write、persistence、visual 门槛已接受。楼板事务对 `86962`、`293247` 的修改原因及隐藏影响仍未查明，故完整建筑主体继续 `blocked`。下一独立候选为窗放置。

## 2026-10-22 单窗只读基线与预览待批准

- 新 run `c38167b0-795c-40f7-a93a-3f331e5270c8` 绑定当前 Revit PID `36064`、插件 MVID `51ec430d-e749-4205-ac99-d4217aead546`、测试副本 identity `af6c5cd5caf6a4eceb0ba193e0dec5cb`、revision `0`、`isModified=false`；只读基线接受，覆盖 37 个建筑实例、7 个相关类型、2 个楼板观察系统元素，门/墙/楼板/窗数量分别为 7/14/3/13。
- 单窗候选使用现有类型 `2285519`（C-3，1200×1800 mm，OneLevelBasedHosted）、测试宿主墙 `2295754`（100 mm，1F，长4m，当时无窗）及标高 `311`；位置 `(32000,3000,1200) mm`，标记 `AI-ARCH-WINDOW-TEST-20261022`。预览 planId `b00457dd56d457b91954c61ad934e5cb`，仅一项 `create_family_instance`、影响 `OST_Windows`、warnings 为空，SHA-256 `da07723ae32c7a4ea162f3d97b97b01f5dacefbc17480788beddd39483fbdf86`，上海时间有效至 2026-10-22 02:23:59.977；此处记录的是当时尚未确认的预览阶段，之后该计划已获批并只确认一次。整体任务仍因楼板系统元素 `86962`、`293247` 的修改原因未明而 `blocked`。


## 2026-10-22 单窗执行与原生回读

- 用户批准的单窗计划 b00457dd56d457b91954c61ad934e5cb 仅 Confirm 一次；回执 committed，创建窗 2296050。类型 2285519（C-3 / 1200×1800 mm）、宿主测试墙 2295754、1F 标高 311、位置 (32000,3000,1200) mm、mark AI-ARCH-WINDOW-TEST-20261022 均通过原生回读。窗类别由13增至14，其他已检查主元素类别及实例未变化。
- DocumentChanged 记录新增窗 2296050 和修改宿主墙 2295754。宿主几何保持一致，面积减少 2.160 m²、体积减少 0.216 m³，匹配 1.2m×1.8m 窗洞通过 100mm 墙；限定范围内无其它元素变化。全模型副作用仍未证明。
- 用户随后手动保存并关闭重开同一隔离副本。重开 identity `008cf16ba56beba595523718468fdf73`、revision `0`、`isModified=false`；`saved.json` 与 `reopen.json` 记录的 47 项声明范围及窗/宿主墙/类型快照与执行回读一致。关闭前没有独立机器快照证明 `isModified=false`，因此该限制已在 run 摘要中保留。
- 重开后导出 `{3D}` 与 `{三维}` PNG，并对局部图核对窗框/窗扇位于宿主墙开口内；视觉证据为 `visual.json` 及 run `visual/` 下两张重开图和局部图。单窗的 write、persistence、visual 门槛已接受；没有自动保存、自动重启或重复确认。
- 楼板系统元素 `86962`、`293247` 的修改原因及隐藏影响仍未解决，`allModelSideEffectsVerified=false`，因此整体 `architecture.primary-elements` 继续 `blocked`；不得重放已完成的楼板、门或窗写入。

## 2026-10-22 楼板副作用当前会话只读跟进

- 当前 Revit 会话 identity `fc24a531d7ed8a7ca356c9f22b0c6f8f`、revision `0`、`isModified=false`。对 `86962`、`293247` 执行了受 pin 保护的 schema 与逻辑依赖只读查询，并在查询前后确认文档路径、identity、revision、保存状态不变。
- 两元素仍为无类别/无类型的原生 `Element`，各自附着 schema 数量为 0；`86962` 的依赖为 `[86962,2289997]`，其中 `2289997` 仅暴露 5 个通用参数且无 schema，`293247` 的依赖仅为自身。该证据不能恢复楼板事务前的内部状态，不能建立修改因果，也不解除整体阻塞。
- 证据：`acceptance/runs/c38167b0-795c-40f7-a93a-3f331e5270c8/floor-side-effect-readonly-followup.json`。本轮没有创建计划、确认、模型写入、保存或重启。

## 2026-10-24 归档交叉检查修复

- 新增 `mcp/acceptance-archive.mjs` 和 `node mcp/acceptance-run.mjs audit <runId>`。离线检查已提交标准写入 run 的 11 份阶段文件及 PNG：除摘要外，独立复核 run/task/plan/attempt、一次确认、预览 identity/revision、前会话/重开会话、插件 MVID 和写入前视觉来源。既有模板补列 `attempt.json`、`visual.json`。
- 单窗归档发现两处 identity 抄录错配，权威更正值均为 `af6c5cd5caf6a4eceb0ba193e0dec5cb`。追加 `archive-review-20261024.json` 记录原值、来源、更正与摘要；原始证据和既有受限验收结论保持。原始归档的离线 audit 仍明确失败，不能将其宣称为全链无误。
- 审查保留两项证据限制：没有关闭前独立机器保存快照，没有完整 47 项重开原始检查对象供离线复算。整体 `architecture.primary-elements` 因楼板副作用继续 `blocked`；只有新增因果证据才恢复该调查，不重复旧查询或写入。
- 本轮只修改 MCP 离线编排和文档，没有修改 C# DLL、注册插件、连接 Revit、创建模型计划、自动保存或重启。无需为本轮改动重新加载插件。
- 验证：全量 MCP 回归 955 通过、0 失败、1 跳过（日志 `.tmp/acceptance-archive-20261024-tests.log`）；最终补齐历史扁平 session 格式和确认 revision/原预览到期时间检查后，归档、原生比较及建筑回滚相关定向测试 49/49 通过。JSON 解析、队列证据引用、更正来源 SHA-256、原始 11 文件摘要不变及 `git diff --check` 均通过；原始归档的两条错配仍如实保留。

## 2026-10-24 房间创建原生回读编译完成

- 在既有 `create_room` 上补齐原生回读：名称/编号按原始字符串、解析后的标高和完整 XYZ、有限正面积、完整 Finish 边界环。边界保留曲线类型与起中终点、长度，最多 1,000 段，超预算拒绝而不截断；不以采样替代精确曲线拓扑或全模型副作用证据。
- 原生预览披露 `NewRoom(Level, UV)` 的标高/XY 定位语义；Z 来自原生项目标高，原始输入和解析结果分别保留。创建后、事务 Commit 前后且事务组仍可回滚时均核验；`revit.inspect` 增加可读取房间快照，未知/未封闭状态不标成功。
- 新能力 `room-creation-readback` 在 MCP 房间预览之前核对，未实载的旧插件不转发房间计划。房间标签、保存/重开、视觉和副作用验收保持各自独立。
- CoreTests 310/310；MCP 全量 960 通过、0 失败、1 跳过；最终预览说明补齐后的相关测试 70/70。Revit 2027.3 隔离编译及安装 CheckOnly 通过，0 警告/0 错误。最终 DLL MVID `ec3b91b2-a859-40dc-a66e-7e7b45685951`、SHA-256 `31F384D9BDD2934E416FA255C01FCAC3C86D826334D7A11FDA241FE95FB21963`，位于 `bin/Release/room-readback-20261023T181039Z/`；首次 NuGet 权限错误及 no-restore 成功日志均保留。
- 任务卡 `docs/architecture-room-readback.md`、队列已更新为代码 `compiled`。本轮未注册、未访问 Revit、未创建模型计划、未写模型、未自动保存或重启；实机验收仍待具体构建获准注册及人工重启后进行，当前先不要重启。

## 2026-10-24 房间回读构建获批并单次注册

- 用户批准后，原构建 SHA-256 `31F384D9BDD2934E416FA255C01FCAC3C86D826334D7A11FDA241FE95FB21963`、MVID `ec3b91b2-a859-40dc-a66e-7e7b45685951` 及 80 项构建来源摘要复核一致。当前隔离副本已保存，243 个实例、26 个相关类型和 2 个观察元素的两轮只读范围一致。
- 请求 `9a3b937d317450d590f831024db39657` 经固定 SHA-256 复核后，只 Confirm 一次；状态 `REGISTERED_MANUAL_RESTART_PENDING`。安装清单只更改 Assembly，原字节备份、桥接和 ACL、旧版 2025 清单、客户端配置及基线均保持；原始私有回执摘要 `D4E751D458C92EA877953E5DCD947C17E2FC78FBDD75170ACED5067A5818DA41`。精简证据位于最终构建目录的 `registration-verification.json`。
- 注册后当前 Revit 文档、活动视图、选择集、计数和实际模块均与注册前一致，运行中仍是旧 MVID `51ec430d-e749-4205-ac99-d4217aead546`。下一步由用户手动重启并重新打开同一隔离副本，先只读核验新版实载；不重复注册，不自动保存/重启，不创建房间计划或写入模型。房间任务仍为 `compiled`，楼板副作用阻塞保持。

## 2026-10-24 房间回读新模块已实载，只读门槛通过

- 人工重启后 PID `43964`，已加载获批 MVID `ec3b91b2-a859-40dc-a66e-7e7b45685951` 与 `room-creation-readback`。同一路径隔离副本新 identity `cde23dd390ac431cc6b7628135cdfd79`、revision `0`、未修改。
- run `3653e000-ba9c-42c3-ab77-f088a5f20ebf` 采集真实 MCP 只读契约及 45 个 scope：243 个实例、26 个相关类型及 2 个观察元素的原有字段与注册前一致；当前两轮完整检查、类别成员和读取前后完整 context 一致。7 个房间新增 `architecturePrimary` 的格式变化被显式记录，新增原生字段与既有参数/点位、独立房间边界查询逐项核验。旧版未暴露的新边界字段不能当作已有历史几何前值。
- 房间任务推进到 `readonly-accepted`，仅代表模块实载和既有房间只读核验。未生成预览、未执行新建房间、未验证其回滚、持久化或视觉，楼板副作用阻塞保持。完整原始结果进入 `baseline.json`，另外记录 `loaded-verification.json` 和 `room-candidate-review.json`，可供复算。
- 当前已知测试围护内已有房间 `2295770`，没有已核实的空闲目标。下一步先准备独立空闲围护夹具，再按各自新 run/预览/批准测试新建房间；不重复注册/重启、不在既有房间点位盲目新增。本轮无模型计划、Confirm、模型写入、保存或自动重启。

## 2026-10-24 房间正向验收的围护夹具方案

- 已将独立四墙夹具纳入队列，放在房间正向写入验收之前。配方 `mcp/acceptance-recipes/architecture-room-enclosure.json` 提供明确四墙几何、现有类型/标高候选、当前基线要求、单次确认和原生回读条件；`docs/room-enclosure-acceptance.md` 记录分步验收。夹具仅含墙，不夹带楼板、房间或标签。
- 候选 X42000–46000/Y1000–5000 mm，墙高 3000 mm，后续房间点位 `(44000,3000,0)`。历史原始范围仅用于离线选址，未认证当前空闲、碰撞或原生回路；静态核对归档于 `acceptance/preparations/room-enclosure-20261024.json`，不作为新的实机 run 或房间写入证据。
- 当前 `revit_context_get` 返回 `ECONNREFUSED`，本机未检测到 Revit 进程，已请用户手动打开隔离副本。此前房间只读验收及所有既有结论保留；没有新预览、Confirm、模型写入、自动保存或重启。

## 2026-10-24 四墙围护夹具进入待批准预览

- 用户手动打开隔离副本后，新 identity `22d226cc445142c9b0dbb578d5d2f566`、revision `0`，实际 PID `29876`，获批房间回读模块 MVID 一致。新夹具 run `b836c349-e3c4-46fd-acf9-d3d5532f0db8` 完整归档 254 实例、29 类型、7 房间及 2 系统观察元素的两轮范围；原有 243 实例/26 类型的全部已捕获字段和类别成员一致，多出范围是管件查询扩展。
- 原基线两个视图查询因错误传入三维视图而失败，原 `unknown` 状态保留；同 run 补充正确的平面设置、三维 inspect 和视图发现，组合只读结论见 `preflight.json`，未重复新建 run。当前平面/三维 PNG 与候选原生位置/边界核对通过选址审查，不代表精确实体净距或空闲原生回路已认证。
- 仅生成一次四墙计划 `ef4eec57aa32d8a4f1ee164fde3929ec`：4m×4m 中心线矩形、100mm 墙、高3m、标高311、非结构、零偏移；无警告，`pending`，上海 2026-10-24 07:16:49 到期。夹具为 `preview-accepted`，房间能力保持 `readonly-accepted`；等待具体 planId 获批。Confirm、模型写入、保存、自动重启均为0。

## 2026-10-24 四墙获批单次提交，系统附加修改保持 blocked

- 四墙具体计划获用户批准后，经完整原计划与只读范围复核，独立 `wx` attempt 后只 Confirm 一次，原生 `committed`。新增 `2296051–2296054`，高3m/100mm墙类型/标高311/中心线/偏移/结构与翻转标志均回读通过，四墙房间边界开关全为1。当前 identity 未变、revision1、`isModified=true`。
- 执行后两轮完整原始快照确认既有254实例、29类型、7房间的全部已捕获字段相同，类别集合只新增四墙。两张执行后 PNG 显示独立围合，限定四墙视觉已接受；没有新建房间、保存或重启。
- 事件记录同时修改系统数据 `86962` 和无类别 Element `2289997`。依赖查询表明后者在前者依赖集合中，历史单墙也修改过同两项，但内部变化因果未证实；尤其本 run 缺 `2289997` 的前快照。夹具整体 `blocked`、`writeAccepted=false`、`allModelSideEffectsVerified=false`；房间保持只读门槛。保存决策待用户，后续房间写入暂停；原计划不可再次 Confirm。完整证据与阶段 summary 已归档于同一 run。

## 2026-10-24 四墙人工保存后只读核验通过

- 用户手动保存后，当前 identity 未变、revision1、未修改。新 `saved-readonly-batch.json` 绑定实际 MCP 契约，完整两轮258实例、29类型、7房间、3系统观察元素的已捕获字段及类别集合与执行后范围一致。`saved.json` 记录人工保存确认和稳定 RVT 文件哈希 `16112056fc6c340abae48eb2fd190b2c8611900eaa1ad10efeb8c2adc1c203d0`。
- 本地只读编排器曾将白名单 `revit_saved_verify` 的 save 子串误拦；已收紧禁止动作匹配并补充正反回归，相关37项测试全部通过，随后真实保存核验通过。无需重新编译、注册插件或重启 Revit。
- 本阶段没有模型写入、Confirm、自动保存或重启。下一步仅请用户关闭重开同一已保存隔离副本；持久化尚未验收，系统86962/2289997因果阻塞仍保留，夹具blocked，房间readonly-accepted。

## 2026-10-24 四墙限定持久化与重开视觉完成

- 用户重开后，新 identity `bb1489862de8cc7120fe0dff233ee14f`、revision0、未修改、PID15556，获批模块一致。完整56 scopes 两轮原始范围与保存快照一致：258实例、29类型、7房间、3系统观察元素；四墙及边界开关保留，限定持久化通过。重开两张 PNG 与执行后图像逐字节一致，限定视觉通过。
- 原保存文件哈希对应现存 `.0007.rvt` 备份；当前同路径 RVT 是另一哈希/较晚修改时间，完整记录在 `reopen-file-lineage.json`，不声称原文件字节一致或推断中间写入原因。界面视图切换单列记录，模型数据未丢弃比较。
- 系统86962/2289997的内部变化因果仍未证实，夹具整体blocked。严格离线归档检查另有11项字段/格式不匹配，原始记录与 audit 失败保留，追加 `archive-review-20261024.json` 不改变原审计结果。限定原生/持久化/视觉结论独立保留，房间仍readonly-accepted。
- 本阶段没有模型计划、Confirm、模型写入、自动保存或重启。无需用户再保存/重开；后续先离线对齐验收编排字段、凭新证据调查系统项，不重放四墙或新建房间。

## 2026-10-24 标准验收记录生产方与契约完成离线对齐

- 新增 `mcp/acceptance-evidence.mjs` 并从 run 入口导出，统一未来预览/批准/attempt/执行/summary 记录和 PNG 元数据：原生预览 payload 摘要语义固定，manifest 在批准前绑定 planId，执行前文档与确认计数字段固定，PNG bytes 从实际文件内容取得。纯数据函数不连接 Revit、不验证聊天身份、不取得独占锁或执行模型命令；调用方仍按原流程保存 wx attempt 和单次 Confirm。
- `run-evidence.schema.json` 补齐 attempt、完整原生预览、documentBefore、计数及 PNG 元数据，归档器识别明确 attempt 类型并保持旧类型的原有绑定检查；不为当前历史缺失字段放宽规则。新增 Schema 2020-12 与真实 run 初始化/生产函数/归档器的模拟闭环和失败测试。相关31项通过，最终 MCP 全量975通过、0失败、1跳过；沙箱模拟套接字/硬链接权限限制导致的首次失败记录保留，正常本地权限下最终复核通过。
- 历史四墙 run 的79项索引源摘要全部未变，原11项 strict audit 发现逐项相同，夹具blocked、房间readonly-accepted、系统86962/2289997因果阻塞及限定持久化/视觉结论均未改。离线证据为 `acceptance/preparations/evidence-contract-alignment-20261024.json`，不为离线修复伪造实机 run。
- 新增契约说明并同步开发流程、MCP说明和基础任务卡；本轮不改 Revit DLL，无需注册或重启，没有真实 Revit 连接、模型预览、Confirm、模型写入、保存或重启动作。


## 2026-10-24 既有轴网创建的最终原生回读补齐

核对发现柱已在事务提交前后复核，故不重复开发。轴网原先仅创建时校验；本次为每个创建的轴网保存原操作副本、原生ID和文档绑定，在全部操作完成后的提交前以及原生提交处理后的事务组归并前重新核对名称和三维端点。允许整段反向，端点距离容差0.01 mm；非有限值、缺失/换类/跨文档和几何漂移均拒绝，走现有整体回滚。最终回执新增gridCreationVerification并参与容量预检，副作用/持久化/视觉/工程合规仍未验证。

CoreTests **316/316**，定向MCP **24/24**，最终全量MCP **978通过、0失败、1跳过**；实际Revit 2027.3 API隔离编译0警告/0错误，安装CheckOnly通过。构建位于`bin/Release/grid-readback-20261024T080246Z`，MVID `95d19406-5368-46b0-ad0b-6e5ca1dfecd2`，SHA-256 `a074a7c7f41c0eda46c8e249219fa755f3dd330c81184236e145b79001d98974`；完整来源和日志摘要见该目录的build-verification.json。未注册或实载本构建，未连接Revit、未创建/确认计划、未改模型、未保存或重启。

任务卡见[structure-grid-readback.md](structure-grid-readback.md)，代码状态保持compiled，旧只读结论不等于新构建实载。其他任务状态不变；四墙历史79项源摘要未变，严格归档仍为原11项，房间/楼板/柱类型复制未知副作用继续保留。当前无需用户重启；后续具体构建注册和人工重启应在需要实机验收时单独处理。


## 2026-10-24 轴网回读构建注册申请待具体批准

新run 5cb9a8c1-1859-44ba-a401-a9d99630729d完成真实注册前只读批次：56个scope、31个类别、258个实例、29个类型、7个房间、3个系统观察元素，两轮及历史已捕获模型字段一致。当前仍为旧房间回读MVID，文档identity 8b779b5115e32423190182b547153c52、revision0、未修改。跨会话房间比较的预期identity差异通过同run追加审查澄清，原错误和原始基线保留，没有重采范围或丢弃模型字段。

82项构建来源及日志摘要复核通过，注册夹具10/10。申请9bf05e3b53f299b0d438f29dc8fa5839已Prepare并独立审查，SHA-256 921FEB2A858656BA26A439ED8369EF5E5D98673D39E8DB348CAE7A6D1147E697；仅拟更改2027插件清单Assembly。实际清单、桥接/ACL、2025清单及客户端配置不变，尚未注册，无注册attempt/receipt，模型计划/Confirm/保存/重启均0。

[任务卡](structure-grid-readback.md)及队列已更新；代码状态compiled，新版未实载，其他任务状态和四墙79项历史源摘要不变。批准该具体申请后才能单次注册，之后再提示人工重启及同副本只读核验；旧房间构建批准不复用。


## 2026-10-24 轴网回读具体构建已单次注册

用户批准申请9bf05e3b53f299b0d438f29dc8fa5839（审查摘要921FEB2A858656BA26A439ED8369EF5E5D98673D39E8DB348CAE7A6D1147E697）后，仅调用注册器一次。回执REGISTERED_MANUAL_RESTART_PENDING；安装清单仅Assembly变化，原备份、桥接/ACL、2025清单、客户端配置和原基线均复核通过。提交前UTC解析和默认文件共享读取的两次保护检查中断均发生在注册器调用前，无attempt/receipt；修正本地编排后按原批准提交，没有提交后重试。

注册后完整context和保存文件摘要不变，PID9360仍加载旧MVID4262fa98-cdee-4fe3-ac6d-64baea205f6e。新MVID4a567d8a-761a-4f34-b034-9f0dffbb59bc待人工重启后实载核验；代码状态compiled，模型计划/Confirm/保存/重启均0。证据见bin/Release/grid-readback-20261024T080246Z/registration-verification.json，完整原始回执保留私有runtime；82项代码来源和四墙79项历史源摘要未变，其他任务状态及系统副作用阻塞不变。

下一步请用户手动重启Revit并打开同一隔离副本，再以新会话做完整只读核验；不重复本次注册或历史模型计划。


## 2026-10-24 轴网回读新构建已实载并通过完整只读核验

用户手动重启并打开同一隔离副本后，新run 10bfec48-9dac-4c6e-a91a-5c0b236dd011核验PID15164、MVID4a567d8a-761a-4f34-b034-9f0dffbb59bc及grid-creation-readback与批准构建一致，原有能力保留。当前identity b2db7d4f19af8e503bdcd25ec80fac04、revision0、未修改。31类别、56个scope完整通过，258实例/29类型/7房间/3系统观察元素两轮及注册前全部已捕获模型字段一致；房间会话字段按各自会话独立核对，未删除几何或未知字段。完整context和磁盘文件在批次前后不变，文件摘要匹配注册前。

structure.grid-creation现为readonly-accepted；只接受实载和声明读取范围，新轴网创建/最终写入回读/回滚/持久化/视觉均未验收。原有副作用阻塞不变，四墙79项历史源摘要和原11项严格归档问题保留。本轮未创建计划、Confirm、注册、保存或重启；无需用户再做保存、重开或重启。下一项是独立具名直线轴网候选/预览，具体计划仍需聊天批准。证据见[任务卡](structure-grid-readback.md)及bin/Release/grid-readback-20261024T080246Z/loaded-verification-20261024.json。


## 2026-10-24 单轴网预览待具体批准

用户继续后，新run 57125ea7-89f9-4424-af53-d11abb6aa538完成57个新只读scope并与实载基线严格比较，通过258实例/29类型/7房间/3观察元素及完整context和磁盘摘要核验。现有11条轴网名称/几何已核验，AI-GRID-T01未占用。仅创建一次计划304756429710d5e3a9ed82a9e8e4e476，pending、无警告；单操作create_grid，(48000,1000,0)至(48000,5000,0) mm，长4000 mm。截止上海时间2026-10-24 18:46:57，原生payload摘要d33811af61ca7f468f0d3ba1b577ff8edf1a6d88f213595f925d29ad8477242c，manifest已绑定。

使用共享预览生产函数，已查询原计划保持pending；无confirmation/Confirm attempt/execution，Confirm和模型写入均0。基准平面PNG4096×3562已查看，拟新增轴网尚未渲染，视觉门槛不升级；初始非标准审核用词原样保留，追加合规的inconclusive视觉记录和审查说明。任务现为preview-accepted，需具体planId聊天批准后才能持久化执行attempt并单次提交；不自动保存/重启，原有副作用阻塞不变。82项代码来源和四墙79项历史源摘要未变。


## 2026-10-24 单轴网已批准并单次提交，GCS副作用未解释

用户批准计划304756429710d5e3a9ed82a9e8e4e476后，同一run 57125ea7-89f9-4424-af53-d11abb6aa538记录实际批准并fsync独占attempt，原生Confirm恰为1，committed后只查询。新轴网2296055、AI-GRID-T01、(48000,1000,0)至(48000,5000,0) mm、长4000 mm及实际既有类型341均回读通过，最终提交后gridCreationVerification成功。初次提交前无序连接器顺序审查中断通过既有集合比较规则在原捕获上解决，无重采/丢字段/重复提交。

完整变更捕获仅新增轴网、无删除或附加新增，另修改GCS跟踪器294479；其历史身份已知，但缺事务前完整快照，当前5个通用参数和自依赖不能解释内部修改。执行后259实例中既有258实例、29类型、7房间、原3观察元素两轮均不变，类别只增轴网、Grid11→12，视图设置及其既有范围稳定。文档revision1、未保存，磁盘字节不变。PNG中轴网可见，但长测试名超出默认圆圈，视觉inconclusive；未自动修复。

任务整体blocked，primaryWriteVerified=true而writeAccepted/allModelSideEffectsVerified/visualAccepted均false，持久化和失败回滚未验收。9份已有标准阶段schema通过，39项源摘要索引，保存/重开未发生，不运行完整归档audit。等待用户决定保留并手动保存同一路径，随后只读保存/重开核验，无需重启；不重放已committed计划或继续写入。82项代码来源、四墙79项历史源摘要及其它任务结论不变。

## 2026-10-24 单轴网手动保存后完整范围已核验

用户选择保留并回复“已手动保存，继续核验”。同run 57125ea7-89f9-4424-af53-d11abb6aa538核验revision1、未修改、原计划committed且回执不变；57scope、259实例、29类型、7房间和4观察元素两轮与执行后快照一致，完整context仅保存状态改变。文件97,009,664字节，SHA-256 c439bedb97acf3b97275a530bfaf7cf950edffa270a43cbd4e3aeb06b2d919ac，批次前后稳定；与保存前摘要不同。saved原始范围和前后文件状态已归档，10份已有标准阶段schema通过。

保存后的当前会话范围已核验，尚未关闭重开，persistenceAccepted=false。GCS294479内部修改、标签超出圆圈和失败回滚门槛不变，任务继续blocked。累计Confirm=1，本次核验无Confirm/保存/重启调用。下一步只需用户关闭并重开同一已保存文件，无需再次保存或重启；不重放已committed计划。

## 2026-10-24 单轴网关闭重开持久化与标准归档完成

用户完成手动关闭重开后，同 run `57125ea7-89f9-4424-af53-d11abb6aa538` 核验新 identity `7f9d2dcbc7adf8a9d23ef9a828155277`、revision `0`、未修改；实际 MVID 仍匹配已批准轴网回读构建。57 个 scope 的两轮读取中，259 实例、29 类型、7 房间、4 观察元素及类别成员、候选视图设置与保存快照一致。轴网 `2296055` 的身份、名称、类型与几何均保持。RVT 97,009,664 字节，重开与保存摘要均为 `c439bedb97acf3b97275a530bfaf7cf950edffa270a43cbd4e3aeb06b2d919ac`；重开原生 PNG 与执行后逐字节一致，已查看，标签超出圆圈的问题仍在。

任务队列新增仅限声明范围的 `persistence-accepted`，整体继续 `blocked`：GCS `294479` 内部修改仍未解释，`writeAccepted=false`、`visualAccepted=false`、`allModelSideEffectsVerified=false`，失败回滚尚未验收。11 份标准阶段记录通过 schema，summary 索引 55 项来源，严格归档审计 0 项发现；离线归档一致性不代表整体验收通过。历史阶段原始字节保留，82 项构建来源及四墙 79 项历史源摘要未变，四墙原 11 项归档问题不改写。

累计 Confirm 仍为 1，本次没有新增计划、Confirm、模型写入、保存或重启。无需用户再保存、重开、注册或重启；下一步凭新的可靠证据调查 GCS，或独立准备标签修复方案并另行批准具体计划，不重复已提交的轴网创建。详细边界和证据见[轴网任务卡](structure-grid-readback.md)。

## 2026-10-24 独立单柱放置进入待批准预览

轴网与其它历史副作用阻塞不变，继续推进已有 `structure.column-placement`。新 run `285f9997-1ff5-45ac-a79b-acb2c567a231` 复用同 MVID/PID、同文档 identity/revision、完整 context 和相同 RVT 字节下的 57 个重开只读 scope，明确来源摘要，另补查 6 个 scope。18 根既有柱、500×500 mm 类型 `2281799`、1F/2F 标高、4 个观察元素及候选视图两轮原生结果一致，没有重复整批读取或注册/重启。

仅创建一次计划 `def401beb0875f01c3aa9b34fe7809d4`：在 `(50000,3000,0)` mm 放置一根既有 500×500 mm 结构柱，1F `311` 至 2F `694`，零偏移、零旋转。类型已激活，不复制或修改类型。有一条约束/激活及副作用核验提示；有效至上海时间 2026-10-24 19:45:42。原生摘要 `3a347a5faf77620f28c0591d38e43e1a490501b001048c0f4e41b8a34bd1462a`。

本地元数据字段/格式断言错误均在已捕获数据和同一已创建计划上恢复，原始错误与字节保留，不重采范围、不重建预览；候选元数据不冒充已完成的原生回读。6 份阶段/审查记录通过 schema，26 项来源摘要归档；完整 context 与磁盘文件未变。任务为 `preview-accepted`，Confirm=0、模型写入=0；待具体计划聊天批准后独占 attempt 并单次执行，再核验原生结果及完整副作用，保存和关闭重开仍由用户手动完成。无需重载插件或重启，详细限制见[柱放置任务卡](structure-column-placement.md)。

## 2026-10-24 单柱已批准并仅提交一次，公开范围保持

用户批准原计划 `def401beb0875f01c3aa9b34fe7809d4` 后，同 run 原计划/摘要、当前 context/文件及 6 项补充范围复核通过，独占 attempt 落盘并 fsync，Confirm 恰为 1。新增柱 `2296056` 的 500×500 mm 类型、1F/2F 约束、零偏移、位置 `(50000,3000,0)` mm 和零旋转原生回读通过；未复制或修改类型。完整执行后两轮范围为 260 实例，原 259 实例、29 类型、7 房间、4 观察元素及视图设置一致，类别只增加一柱；文档 revision1、尚未保存，磁盘字节未变。

原生收据只新增此柱、无删除或附加新增，另修改系统 `86962/293247/294479/2289997`。本次已有它们事务前后完整公开字段快照且一致，但隐藏内部修改原因仍未知，整体副作用与 `writeAccepted` 保持 false，任务 `blocked`。PNG 已查看，新柱方形截面在测试轴网东侧可见，仅接受该柱平面可见性，不升级整图、精确净距或工程合规。

9 份已有标准阶段通过 schema，原预览 summary 字节保留；手动保存/关闭重开、失败回滚及完整归档审计尚未进行。下一步由用户决定保留并手动保存同一路径隔离副本后继续只读保存/重开核验。不得重放该 committed 计划，不自动保存或重启；详见[柱放置任务卡](structure-column-placement.md)。

## 2026-10-24 单柱手动保存后完整范围通过，待关闭重开

用户回复“已手动保存，继续核验”后，同 run `285f9997-1ff5-45ac-a79b-acb2c567a231` 核验原计划仍 committed、原回执不变，当前同 identity、revision1、未修改。57 个 scope 的两轮原始结果与执行后快照一致：260 实例、29 类型、7 房间、4 观察元素及类别/视图范围全部保持；柱 `2296056` 的身份、类型、底/顶约束、偏移、位置和旋转不变。

RVT 97,017,856 字节，SHA-256 `d67efded2e99a9f32af5b3873872fbd1ab022e0dd6a8fde585b50b01d7ac02d1`，读取期间稳定且与保存前不同。保存阶段原始数据及文件状态已归档，10 份已有标准阶段记录通过 schema，执行后 summary 原字节保留。当前会话范围通过不代表磁盘重载，关闭重开尚未验收；4 项系统隐藏内部变化及失败回滚门槛不变，任务继续 blocked，限定柱可见性结论保留。

本次 Confirm/计划创建/模型写入/保存/重启调用均为0，累计 Confirm=1。下一步仅请用户关闭并重开同一已保存隔离副本，无需再次保存或重启；之后只读核验新会话和声明范围，绝不重放已 committed 的柱计划。

## 2026-10-24 单柱关闭重开持久化与标准归档完成

用户手动关闭重开后，同 run `285f9997-1ff5-45ac-a79b-acb2c567a231` 在新 identity `154a06374e17958edf5354d818a118c7`、revision0、未修改的会话核验通过；PID/MVID 保持已批准构建。57 个 scope 的两轮结果中，260 实例、29 类型、7 房间、4 观察元素及类别/视图范围与保存快照一致，柱 `2296056` 的身份和原生约束保持。重开与保存 RVT 均为 97,017,856 字节、SHA-256 `d67efded2e99a9f32af5b3873872fbd1ab022e0dd6a8fde585b50b01d7ac02d1`；新原生 PNG 与执行后逐字节一致，已查看，限定柱可见性通过。

任务队列新增有限声明范围的 persistence-accepted，整体保持 blocked：4 项系统隐藏内部修改仍未解释，writeAccepted/allModelSideEffectsVerified 仍为 false，失败回滚尚未验收。11 份标准阶段通过 schema，62 项来源摘要索引，严格归档审计 0 项发现；离线审计不代替完整副作用验收。历史阶段原字节保留，82 项构建源摘要未变，轴网原审计仍0项、四墙历史原审计仍11项。

累计 Confirm 仍为1，本次无计划创建、Confirm、模型写入、保存或重启。无需用户再保存、重开、注册或重启；不重放原柱计划。下一步只凭新的可靠证据调查系统内部副作用，或继续独立离线开发。详细边界见[柱放置任务卡](structure-column-placement.md)。

## 2026-10-24 原生洞口最终回读的离线实现完成

用户批准最小补齐方案后，补齐已有三类 `create_opening` 的最终复核：绑定原生 Document、Opening ID 与独立原操作，整计划结束及原生事务提交后仍核对宿主、边界和竖井约束，检查均位于事务组可回滚窗口。创建阶段的重生成保留在事务内；提交后只读取。竖井偏移现在拒绝缺值、错误存储类型、非有限值及超出明确容差的值，未知不会当作零。最终 `openingCreationVerification` 进入既有回执容量预检，新指纹为 `opening-creation-readback`；副作用、精确切割、持久化、视觉和工程合规仍独立未验收。

CoreTests 320/320，定向 MCP 24/24，全量 MCP 982 通过、0 失败、1 跳过；Revit 2027.3 隔离编译 0 警告/0 错误，安装 CheckOnly 通过。构建为 `bin/Release/opening-readback-20261024T125425Z/`，MVID `c8716d1b-be79-4852-a0a4-a410f762b5b6`，DLL SHA-256 `f31f48876452fb573c7d171344ffa7162019660d34f5c4ce9d8ee59534193d72`，275 项代码/测试来源摘要和完整日志已归档。

新实现最高代码门槛为 compiled；`architecture.native-openings` 仍 blocked，未升级真实洞口验收。旧构建文件未覆盖，轴网55项、柱62项、四墙79项历史源摘要均未变；原归档审计仍分别0/0/11项，既有内部副作用结论不改写。本轮未注册新插件，未连接 Revit，未创建/确认模型计划，未写模型、保存或重启。全量测试中的生命周期行为仅使用隔离模拟夹具。

下一步在需要实机验收时再准备这份构建的具体注册申请；批准并人工重启后，先核验新 MVID 与完整当前只读范围，再选一个明确洞口宿主/几何做独立验收。当前无需用户重启。详细契约、实现边界及证据见[洞口说明](openings.md)。

## 2026-10-24 洞口构建注册材料已就绪，等待具体批准

为洞口回读构建准备了唯一申请 `b6acdf4237f148f484e893c721dc0f8b`，独立复核状态 `READY_FOR_SPECIFIC_CHAT_APPROVAL`，请求 SHA-256 `67BB10EC4AEA54CDD98270ABFF19F80EA9888345068B554D483AF093C86A9B8B`。275 项来源、7 份构建/测试日志和注册器隔离夹具 10/10 通过；拟议差异仅为当前用户 Revit 2027 清单的 Assembly 路径。真实清单和桥接/ACL、2025 清单、客户端配置保持，尚无本申请的提交 attempt/receipt/backup。

桥接 context 请求 ECONNREFUSED，正常权限确认 Revit 进程为0，故本次为明确的离线预检，没有伪造或复用当前 identity/revision/实机基线。当前磁盘测试副本摘要仍为 `d67efded2e99a9f32af5b3873872fbd1ab022e0dd6a8fde585b50b01d7ac02d1`，与最后保存证据一致；磁盘相等不能认证当前模型范围或隐藏副作用。未生成新的原生 run 或模型计划。

材料及保护范围复核已归档到构建目录 `registration-preparation-verification.json`，队列保留 blocked 和所有历史验收结论。本申请 Prepare=1、注册 Confirm=0，模型计划/Confirm、保存/启动/重启均0。下一步需对该具体摘要聊天批准后才能单次注册；注册完成后再请用户手动启动 Revit 并打开已保存副本，获取新会话只读基线。当前无需提前启动。注册批准边界来自 `v27/registration-switch.ps1:125–126`。

## 2026-10-24 洞口回读具体构建已获批并单次注册

用户明确批准具体请求 `67BB10EC4AEA54CDD98270ABFF19F80EA9888345068B554D483AF093C86A9B8B` 后，提交前全部摘要、275 项来源、保护范围及离线文件/进程状态复核通过。注册器只提交1次，原始回执 `REGISTERED_MANUAL_RESTART_PENDING`；安装清单摘要为 `FB1A089CB2B91E3C436D31329AF0B6A864E5A7670F99B3FD8B28E739652A7C74`，备份匹配原清单，真实差异仅Assembly字段。桥接/ACL、2025清单、客户端配置与已保存模型文件保持，批准/attempt/receipt/backup及核验报告已归档。

Revit 进程仍为0，新 MVID `c8716d1b-be79-4852-a0a4-a410f762b5b6` 尚未实载核验；任务继续 blocked，旧原生验收和内部副作用结论不变。下一步请用户手动启动 Revit 并打开同一已保存隔离副本，再只读核验新MVID/能力和完整当前范围；不沿用旧会话、不创建模型计划。本次注册Confirm=1，模型计划/Confirm、保存/启动/重启均0，不得重复该注册申请。

## 2026-10-24 洞口最终回读新构建实载与只读范围通过

用户手动启动并打开同一隔离副本后，新 run `d08cac8a-06a4-4355-a635-c36c259408e6` 核验 PID37216、MVID `c8716d1b-be79-4852-a0a4-a410f762b5b6` 及 `opening-creation-readback` 与批准构建一致，旧能力保留。当前 identity `1349f8b9c89324586508e7cf2091b820`、revision0、未修改；275 项代码/测试来源、已注册清单和 DLL 摘要保持。

31 类别、57 个 scope 的两轮原始读取通过：260 实例、29 类型、7 房间、4 观察元素及类别/视图范围与上次已保存重开快照一致。会话字段分别绑定各自原生文档，完整模型字段未删减；当前 context、视图/选择和文件在批次前后稳定。RVT 97,017,856 字节，SHA-256 `d67efded2e99a9f32af5b3873872fbd1ab022e0dd6a8fde585b50b01d7ac02d1`，匹配已保存文件。4 份标准阶段记录通过 schema，完整结果在新 run 和构建目录 `loaded-verification-20261024.json`。

队列新增有限的 readonly-accepted，整体仍 blocked：新洞口尚未创建，正向/最终事务回读/回滚/持久化/视觉未验收，上游系统内部副作用未解释。轴网55、柱62、四墙79项历史来源摘要与原审计0/0/11项保持。本轮无模型计划、Confirm、注册、模型写入、保存或启动/重启调用，无需再加载插件或重启。下一步先只读选择明确洞口宿主和完整XYZ，再另建单能力预览并取得具体批准；不重放任何旧计划。详见[洞口说明](openings.md)。

## 2026-10-24 只读宿主审查发现并修复直立墙枚举误判

本机Revit2027.3 SDK元数据确认 Vertical=1、SingleSlanted=0、Tapered=2；已有18面墙的原生横截面均为1。旧洞口校验硬编码0，会拒绝直立墙并可能放行单斜墙。已改为原生 `WallCrossSection.Vertical` 并拒绝未知/无值/非Integer参数，原有Basic/直线/水平约束保留；发现发生在创建洞口预览之前，无模型计划或写入。

新候选run `7c0a9929-68c3-499e-a82d-0aaf45d7422e` 复用同会话57项范围并补查6项：独立墙2296040公开字段不变、原生逻辑依赖仅自身，限定本机库存71项范围内邻近碰撞候选和未知均为0。候选为该墙 `(72000,60000,1000)` 至 `(73000,60000,2000)` mm 的1×1m矩形，容差1mm；不认证原生宿主包围盒、精确净距或切割影响。当前仍加载旧MVID8ffaa680…，同identity/revision0/未修改，磁盘摘要d67efded…保持。

CoreTests320/320，定向MCP25/25，全量MCP983通过、0失败、1跳过；Revit2027.3隔离编译0警告/0错误，安装CheckOnly通过。新构建 `bin/Release/opening-wall-host-fix-20261024T132922Z`，MVID `16e09876-8099-4ef2-a586-2141fd141784`，DLL摘要 `42b2a9ee9f857575aec749a0734599a8217d4afeb12b0578d82fea5485ca5e88`。275项来源和日志已归档，旧构建与历史验收未覆盖。

新注册申请 `d8b199550686502bea73db6a5a7020c2` 已准备并独立复核，摘要 `883881D74D89B3E7B0CC3FC7856523A02BDD10B68FCD3B4831DA1D6AD3EB312E`，仅拟议Assembly路径变化。真实清单、保护范围和模型均未变，准备1次、注册Confirm0次，无模型计划/Confirm、保存或重启。任务继续blocked，待对这份具体修复申请明确批准后单次注册、人工重载并核验新版本；当前无需提前重启，旧系统内部副作用阻塞不变。

## 2026-10-24 墙宿主枚举修复构建已单次注册，待人工重启

用户明确批准该修复构建后，具体请求、275项来源、DLL/MVID、日志、保护范围和当前原生会话/文件复核通过，注册Confirm仅1次。回执 `REGISTERED_MANUAL_RESTART_PENDING`，安装清单摘要 `9AB575F3A363E536C52094B84C31722D71DB54BB42917D1E1B5A43BEE0D7855A`，备份匹配原清单，差异仅Assembly；保护范围与模型字节保持。当前PID37216仍加载8ffaa680…旧DLL，同identity/revision0/未修改，修复MVID `16e09876-8099-4ef2-a586-2141fd141784` 待重启实载。

批准/attempt/receipt/backup和注册前后context证据已归档至修复构建目录 `registration-verification.json`。本次模型计划/Confirm、模型写入、保存和重启均0，任务保持blocked。下一步请用户手动重启并打开同一已保存隔离副本，随后只读核验修复模块及完整当前范围；无需再次保存，不重复注册，不创建洞口计划，全部历史副作用结论保留。

## 2026-10-24 墙洞口宿主枚举修复版实载核验通过

用户手动重启并打开副本后，新run `d1a6afdc-1078-4a49-a301-1ac32d183ea4` 核验PID30776、MVID `16e09876-8099-4ef2-a586-2141fd141784` 和原有能力集合均匹配已批准修复构建。当前identity `efda0f160cc699b9c34c607c103cdff2`、revision0、未修改；275项来源、已注册清单及DLL摘要保持。

原57项范围加两轮宿主依赖合并为59个scope，31类别、260实例、29类型、7房间和4观察元素两轮完整字段与保存快照一致。墙2296040仍为Vertical原生值1，依赖仅自身；原生Basic/包围盒准入尚未执行，不把模块加载当作洞口创建通过。RVT97,017,856字节，摘要 `d67efded2e99a9f32af5b3873872fbd1ab022e0dd6a8fde585b50b01d7ac02d1` 前后稳定，context/视图/选择保持。4份标准记录通过schema，原始结果及构建目录 `loaded-verification-20261024.json` 已归档。

任务继续blocked，限定readonly-accepted保留，实际洞口预览/正向/最终事务回读/回滚/持久化/视觉均待验收，旧系统内部副作用结论保持。轴网/柱/四墙历史来源与原审计0/0/11项未改写。本轮无模型计划、Confirm、注册、模型写入、保存或重启；无需再次重载插件。下一步基于新会话另建单洞口预览并取得具体planId批准，当前尚无该计划。

## 2026-10-24 单墙洞口预览通过，待具体计划聊天批准

新run `0f5c6053-e80e-42b7-a2ac-2d707e13948e` 在同修复MVID/会话/revision0/未修改及相同磁盘摘要下明确复用59项基线，另补7项只读范围，全部匹配。独立墙2296040依赖仅自身，限定邻近候选和未知均0。仅创建一次原生计划 `026763c081e5b2435b28cd1bc2f86764`：墙矩形洞口 `(72000,60000,1000)` 至 `(73000,60000,2000)` mm，宽高各1000mm，容差1mm。修复后原生Basic/直立/定位线和宿主范围预检通过，没有Opening或实际切割。

原生摘要 `62d1a7be2e7526c608ef414c096dc1f3521e2c252ed560310e6dd10dae437c15`，有效至上海时间2026-10-25 00:07:41，有1条宿主切割和影响范围提示。新基准PNG已查看，拟议洞口尚未渲染，视觉和工程/精确影响未认证。context和文件前后保持，原计划查询pending；标准阶段/审查schema通过，summary索引21项来源，原采集summary字节保留。

队列新增preview-accepted，整体blocked和旧内部副作用结论不变。本次plan.create=1、Confirm=0，模型写入/保存/重启均0。等待该具体planId聊天批准后再复核并持久化独占attempt，Confirm最多一次；当前不重复创建或执行，不自动保存。详细边界见[洞口说明](openings.md)。

## 2026-10-24 单墙洞口已单次提交并原生回读通过

用户批准具体计划026763c081e5b2435b28cd1bc2f86764后，原计划/摘要和当前范围复核通过，独占attempt持久化后Confirm恰为1，committed并新增Opening2296057、切割宿主2296040。原生矩形边界及提交后最终回读通过，宿主面积减少1m²、体积减少0.1m³，与100mm墙和1×1m洞口匹配。当前60个scope、261实例两轮结果中，原259个非宿主实例、29类型、7房间、4观察元素、原31类别和宿主其它完整字段保持；宿主依赖仅增加新Opening。

收据无附加新增或删除，另有系统86962/2289997内部修改。它们的事务前后公开字段一致，内部原因仍未解释，整体writeAccepted/allModelSideEffectsVerified为false、任务blocked。首次本地类别名只读查询失败后，依SDK映射改用OST_SWallRectOpening恢复，未重放模型或冒称回滚。

原生PNG及无缩放像素细部已查看，仅接受平面洞口边界标志可见性；正面/三维空洞外观、整图、精确切割和工程合规未认证。9份已有标准阶段schema通过，原预览summary保留。当前revision1、未保存，磁盘字节仍为d67efded…；保存/重开、失败回滚和完整归档审计待做。下一步由用户决定保留并手动保存后继续只读核验；不重复committed计划，不自动保存或重启。

## 2026-10-24 墙洞口保存结果与已观察的新进程持久化通过

用户确认手动保存后，实际已处于新Revit进程PID28128、identity `9231d82ed7a8d24a8376750a50eace29`、revision0、未修改，MVID仍为4345887a…。初次同会话断言在context处停止，随后按实际新会话继续，未重采已完成批次或重放计划。60项范围、261实例、29类型、7房间、4观察元素及洞口/宿主/依赖两轮完整字段与执行后匹配，洞口2296057身份及宿主14m²/1.4m³保持；原生PNG与执行后逐字节一致。

当前同路径文件97,030,144字节，SHA-256 `2ff97e280130575cd366fb0ec4ae990a864034417f7248dc1c8f62c73c2a419b`，读取前后稳定且与保存前不同。没有取得会话变化前的独立机器保存状态/文件摘要，不能声称精确匹配该未观察时点；用户仅确认保存，未补造人工关闭重开确认。单次新会话观察同时支持saved/reopen记录，有限声明范围persistence-accepted通过，exactSavedFileBytesVerified=false，缺口作为归档限制保留。

11份标准阶段schema通过，58项来源摘要索引，严格归档0项发现但保留preclose-save-snapshot-missing和archive-only限制；旧summary/visual字节及阶段含义保持。整体继续blocked：两项系统内部修改未解释，完整write acceptance为false，失败回滚/其它洞口种类/正面三维视觉未验收。本次无计划、Confirm、模型写入、保存或重启，累计Confirm=1。无需用户再保存、关闭重开、注册或重启；不重放原committed计划。详细边界见[洞口说明](openings.md)。

## 2026-10-24 楼板轮廓洞口进入待批准预览，既有依赖前值补齐

新run `3f369d09-21c5-487f-a280-f09f1b5f821f` 复用同MVID/PID/完整context/文件下的60项范围，另补7项只读范围。既有独立楼板2296043为4×4m、100mm厚、1F、非结构、零偏移，当前面积16m²/体积1.6m³。仅创建计划 `05fd87b04b325ee389ba5d1c2e8a9cd2`：中央X78500–79500/Y64500–65500/Z0mm的1×1m轮廓、vertical、容差1mm。原生平面顶面采样和轮廓预检通过，pending且payload不变；摘要 `27b3427b9c2f35aa4da082803208a845a529290fa4f38f32bfc2250d0a00a854`，上海时间2026-10-25 01:27:43到期，有1条宿主切割提示。

8项宿主依赖中新增读取了7个既有SketchPlane/Sketch/ModelLine的两轮完整公开快照，补齐执行前值；这是范围扩充，不是模型新增。现有平面和三维基准图已检查，拟议楼板孔洞尚未渲染。三维图顺带取得已保存墙孔洞的单视角可见性追加证据，写入新run单独followup，原墙run的58项来源和审计不变，旧缺口不改写。

最新summary索引27项来源，标准阶段与依赖/图像审查schema通过。队列补充各openingKind状态，墙限定持久化保留，当前楼板仅preview通过、shaft及其它宿主/方向场景未验收。文件仍为2ff97e28…、当前同identity/revision0/未修改，旧内部副作用阻塞保持。本轮新plan.create=1、Confirm=0，无模型写入/保存/重启；待具体楼板planId批准后再复核并独占单次提交，不重放墙计划。

## 2026-10-25 楼板洞口失败恢复归档，实际失配信息采集已补齐

原计划6c3d4b62…获批后仅Confirm一次，在创建后原生profile完整3D边段比对失败并回滚，回执causeDetails为空。独立63scope、268个既有实例（含7个原草图依赖）、29类型、7房间、4观察元素完整字段恢复为执行前；楼板16m²/1.6m³、原依赖和文件2ff97e28…保持，平面/三维PNG逐字节一致。当前同identity、revision1、未修改；旧计划failed，不重试，本次测试不需要额外保存/关闭重开。9份已有标准阶段、50项来源已按失败恢复档案归档，不冒充正向创建或专门故障哨兵验收。

本轮补了回滚前失败证据：冻结实际刚比较的端点、原输入和容差，辅助保留原生包围盒/草图平面坐标框；异常/预算明确记录，主体不受辅助失败影响。OpeningRules比较引擎摘要未变，仍比完整XYZ，不猜测投影或放宽1mm。原始高程/坐标基/形状差异尚不能证实，旧回执不补写实际坐标。

诊断构建 `bin/Release/opening-profile-diagnostics-20261024T175907Z` 已通过Core325、定向MCP28、全量MCP986通过/1跳过及Revit2027.3隔离编译/CheckOnly；MVID `dfcc6d30-e1f0-494b-aabf-46f7879a5205`，DLL摘要 `ec87363b93fa8a7bad6c611a3c6c4973fcea1d5a28cb33665920155aeb5816f5`，278项来源已归档。新构建未注册/实载，本轮无新模型计划/Confirm、保存或重启。后续需对诊断构建和新原生计划分别批准，旧failed计划不得重放；整体blocked及墙历史结论保持。

## 2026-10-25 楼板洞口诊断注册申请已准备，后续手动保存另记新观察

注册申请 `a37c56035be2ca9c95d7111e73952fa9` 已独立审核，SHA-256 `B4C7BBDD3658A67BD4DDEBA929AE1FDC8692C5CE260507CD3A5A67D1D5D33DE7`。278项来源、7份日志、DLL/MVID和原注册器fixture绑定保持；拟议清单只有Assembly路径变化，真实清单及保护范围未变，无attempt/receipt/backup。目标MVID7adc4a8e…，当前仍未注册，等待该具体申请聊天批准。失败计划6c3d4b62…不再使用，诊断补齐不代表原几何问题已修复。

Revit当前无进程。离线门禁发现后续磁盘变化，经两个SHA256实现和最新备份交叉确认：当前e76dcf03…、0012备份2ff97e28…匹配历史；日志记录上海时间00:58:46的QAT保存和随后退出。该保存晚于原恢复采集，历史档案保持，只读新申请明确没有当前identity/revision或原生验收。保存后的完整原生内容待用户加载新插件并打开文件后复核，不能把历史63scope恢复观察复用为当前基线。

本轮只新增注册材料/调查及更新队列和文档；申请Prepare=1，注册Confirm、模型计划/Confirm、自动保存和重启均0。整体及各场景状态未升级。下一步仅在该具体申请获批后单次注册，再人工启动/打开与完整只读核验；任何新的模型诊断需要另行具体planId批准。详情见构建目录registration-preparation-verification.json及[洞口说明](openings.md)。

## 2026-10-25 楼板洞口诊断构建已单次注册

用户明确批准原申请a4559013…（SHA256 B4C7BBDD…）后，注册前278项来源/7份日志、DLL/MVID、原清单、保护范围和当前离线文件e76dcf03…复核保持。注册器恰调用1次，原清单备份匹配9AB575F3…；新清单90207CF9…且差异仅Assembly，保护范围和模型文件未变。批准/attempt/receipt/backup及前后检查在诊断构建目录registration-verification.json归档，回执REGISTERED_MANUAL_RESTART_PENDING。

当前Revit进程为0，新MVID7adc4a8e…尚未实载。下一步由用户手动启动并打开同一隔离副本，只读核验新诊断能力及后续保存文件的完整原生范围。模型计划/Confirm、保存和启动/重启均0；不再注册已消费申请，不执行旧failed计划。此构建仅补失败诊断，原始几何问题及所有历史阻塞仍保留，验收状态未升级。

## 2026-10-25 楼板洞口诊断实载与后续保存文件声明范围通过

新run `685154e0-7997-4b9f-a385-e69de2946fcf` 确认诊断MVID7adc4a8e…在PID5740实际加载，能力集合、278项来源、7份日志、DLL和注册清单匹配。当前隔离副本identity5d0063b7…、revision0、未修改。重新采集63scope，两轮268既有实例、29类型、7房间、4观察元素及类别成员/视图/依赖/限量邻近/保存状态完整字段与历史一致；只有新会话绑定及历史归属明确调整，没有删去几何字段。

当前文件e76dcf03…与注册前后离线摘要一致，整批文件及context/模块稳定；历史2ff97e28…仍不同。本次只接受后续保存文件的声明公开范围匹配，不补造新楼板孔洞或保存重开/视觉证据。四份标准阶段与原始只读响应已归档，新构建loaded-verification-20261025.json指向该run。无注册、模型计划/Confirm、保存或启动/重启，原失败及墙档案保持。

加载及当前声明范围门槛已清除，整体仍blocked：旧失败没有实际轮廓坐标，几何根因和历史系统副作用尚未解决。下一步拟议新run的单楼板洞口诊断预览（宿主2296043，原1×1m/vertical/1mm输入）；当前尚未创建。正式执行须对新planId另行批准且最多一次Confirm，禁止重放旧failed计划，不自动保存/重启。

## 2026-10-25 新诊断楼板洞口预览通过，执行尚未批准

用户仅批准创建新预览后，新run `96812202-c32e-4501-abc7-9aa0286a8b6f` 在原诊断MVID/PID/完整会话和磁盘不变条件下明确复用63scope，并补7项当前检查；楼板及所有8项依赖、类型/标高、4观察元素及既有墙洞口等16个ID双轮完整字段匹配。仅创建计划 `fc27562b4d29ad74879c310127e04b05`：独立楼板2296043中央1×1m、XY78500–79500/64500–65500、Z0mm、vertical、1mm，宿主/顶面轮廓预检通过，有1条切割及依赖提示。

计划pending，摘要e859fd47f5e2db899f38f60c68d156234c1115e3f7900960d19d1d070f324389，有效至上海时间2026-10-25 05:22:46。新基准平面/3D PNG已查看，尚无拟议孔洞；8份标准记录及27项来源通过预览阶段审查，旧182项来源保持。当前同identity5d0063b7…/revision0/未修改，文件e76dcf03…不变；plan.create=1、Confirm和模型写入/保存/重启/注册均0。

本计划为失败几何取证而非已修复功能验收，原比较/容差不变，执行可能失败回滚；整体blocked和所有历史副作用结论保持。等待该具体planId聊天批准后才可持久化独占执行attempt并最多Confirm一次；未批准则保持预览，不复用旧failed计划或批准。

## 2026-10-25 单次诊断拿到实际高程差，修复设计待审核

计划3e96ed26…获批后Confirm恰为1，仍在after-creation边段比较处failed并回滚。新版真实causeDetails显示4条Line的XY与输入相差最多约7.28e-12mm，而Z全部为−100mm，输入Z0、宿主Z范围−100至0，Opening草图平面也为−100。离线直接调用已加载DLL比较器三次稳定重现；仅诊断副本消除统一Z差可通过。已证实本次拒绝来自不同原生表示平面的同平面比较，未更改生产规则或容差，也不把该观察推广为通用100mm平移。

独立64scope核验268既有实例/29类型/7房间/4观察元素等公开字段恢复，17个临时依赖ID均不存在；当前同identity、revision1、未修改，文件e76dcf03…及时间保持。3D PNG字节一致，平面有1292像素在阶梯方向注释附近不同，原因仍未知，完整视觉恢复和隐藏副作用保持不接受。10份标准记录及57项来源归档，旧182项来源保持；没有保存/重启/重复Confirm，不需要用户额外保存或重开。

已写出待审核设计docs/superpowers/specs/2026-10-25-opening-profile-host-surface-readback-design.md。推荐直接读宿主输入表面的真实切口内环，再按原完整XYZ和容差比较，同时保留原Opening底部轮廓；创建前绑定原表面及已有内环，防止把旧孔洞当新建。产品修复尚未实施或编译，需用户审核设计后再进入实施；后续新构建注册和新原生计划仍分别批准。目标和历史验收范围不变，任务继续blocked。

## 2026-10-25 宿主表面回读离线修复完成，具体注册待批准

用户批准设计后，已实现原生宿主输入表面/内环绑定、真实切口完整XYZ唯一匹配、既有孔洞/外环/未知或预算拒绝及三阶段回读；原Opening坐标独立保留，原比较器和1mm容差不变。Core341、定向MCP22、全量MCP989通过/1跳过，Revit2027.3隔离编译0警告/错误和CheckOnly通过。构建opening-host-surface-readback-20261024T200013Z，MVIDe1011050…，283项来源及8日志冻结；前诊断57项及旧182项来源保持。

当前Revit仍加载旧7adc4a8e…、同文档revision1/未修改、文件e76dcf03…稳定；64项源观察在同会话/文件下明确复用作注册前基线，新代码尚未实载或取得原生切口数据。历史客户端配置摘要变化已单独记录，脚本只保护当前值，不改配置；原清单及桥接/ACL/2025/其它客户端保持。

旧申请823f2aa1…因会话重开未复用；基于当前identity3ac55f2c…/PID27276/revision0重新准备申请778dd7f11eaccdf23388de98f0776d5e（SHA256 A19FEDE130B5074A9EA06846BEF80CC54288B1C711DEEF62EC0D7EDE92B81210），注册器已单次执行，清单差异仅Assembly、备份/receipt/attempt通过。当前MVID仍旧7adc4a8e…，新MVIDe1011050…待手动重启实载。设计实施阶段无模型计划/Confirm、保存或重启；下一步只需用户手动重启/打开后做只读核验，任务保持blocked。

## 2026-10-25 单楼板洞口限定持久化与3D视觉通过

run01a1723b-5159-786d-9dea-c9c12f602468的计划94a30c33…committed/Confirm=1，Opening2296081/楼板2296043的宿主输入面内环原生XYZ回读通过。用户保存并关闭重开后，新identity81566962…/revision0/未修改、MVIDe1011050…；67scope中主元素完整执行后快照和依赖一致，楼板15m²/1.5m³。17个新ID当前双轮稳定，16个新依赖无执行后完整快照，不扩大声明。

文件e653a1a5…/97,026,048字节稳定，3D PNG逐字节一致并已查看；平面远端楼梯注释2676像素不同，原因未知。关闭前独立保存快照未归档，广域比较的外部来源摘要原先漏绑；后者已事后补记可复现基线并保留原记录，均未补造历史证据。11阶段schema、120项来源摘要及归档审计0发现通过；系统86962/293247内部修改和整图视觉仍blocked，不提升整体write-accepted。

任务队列已补齐此前失败补丁遗漏的实载/写入/持久化状态，历史failed/committed计划和旧验收结论保留。当前无需再次保存/重开/注册；下一项优先只读审查显式两跑automaticBetweenRuns楼梯，承接旧stairs.csx缺口，不重做none-only或把模型夹具当工程标准。

## 2026-10-25 两跑自动平台楼梯进入待批准预览

新的楼梯前置run01a172b9…完成75项声明只读范围，楼梯相关42个元素/类型双轮一致。由原生完整参考2290014确认22踢面、两跑各11、250mm踏板/1200mm宽，实际第二跑底高约2000mm。类型624086及跑/平台类型624082/624083已读，既有none-only结果保留，不套用3000/280/10模拟几何。

预览run01a172d7-792a-71f3-9a81-be9e3787594a的计划62d688ec103c7468b7eaf007e058748a，仅新增一套候选楼梯并请求相邻两跑原生自动平台；参考XY平移至X60000/61500、Y1000–3550，底高0/2000、1F至2F约4m。预览前补齐全部200个既有楼梯逻辑依赖和219个既有元素/类型双轮前值，75项源观察明确复用。7标准记录/45项来源审查通过，原生pending、模型/文件保持、Confirm=0；上海时间2026-10-25 21:34:51到期。

当前只通过readonly/preview门槛，自动平台生成性、数量/轮廓/高程/连接均不因预览而接受；可能生成类型支撑/栏杆。执行须具体planId批准且最多一次Confirm；失败或提交后回读不确定先读原任务，不重试、不降级none、不自动保存或重启。现有洞口副作用和图像差异结论保持，本轮没有模型写入。

## 2026-10-25 两跑原生自动平台成功，停在手动保存

计划6b871059…获具体批准后恰好Confirm一次并committed/StairsEditScope；新楼梯2296092、跑2296093/2296097、平台2296101。主元素实际类型/标高/零偏移、22踢面/250mm踏板、每跑11/1200宽及路径/高程通过独立回读，实际平台1个、约2000mm，支撑9、栏杆2，楼梯原生警告为空。97个观察新增均在新楼梯逻辑依赖闭包，事件无既有修改或删除，完整219个既有前值及旧200依赖保持。

严格广域比较保留2295825/2295831共4个原生视口盒坐标尾差，最大7.1054e-14mm，未删除字段、归零或新增容差；原因/无害性未知。主楼梯成功与完整严格范围相等分开，writeAccepted、全模型副作用、完整连接/工程合规仍false。平面/3D已看见新两跑和平台，9阶段schema/167项来源按postwrite归档，模型revision3/未保存，磁盘e653a1a5…不变。

若保留成功试验，下一步由用户手动保存当前副本。保存后先把机器saved状态和磁盘摘要实际落盘并对照完整postwrite，再要求关闭重开；不自动保存/重启，不重复committed计划，也不重做旧none-only场景。

## 2026-10-25 楼梯已保存，关闭前机器证据完整归档

用户确认手动保存后，同identity0a29f9d8…/revision3/isModified=false，保存后91项完整范围与执行后逐字段一致。文件97,136,640字节、SHA256 245b267cdba4744136ba3e1e2a9a1c0280061ab630d2b58d0615ba5b77468f25，读取前后NTFS时间与摘要稳定；saved.json、saved-readonly.json及saved-file-before/after实际落盘，preCloseMachineSaveStateCaptured=true。旧严格视口盒坐标差异和完整连接/合规限制仍保留。原计划committed且累计Confirm=1，本阶段没有新的Confirm、保存或重启。下一步仅需用户手动关闭当前文档，再打开同一文件；不重启Revit、不再次保存、不重放楼梯计划。

## 2026-10-25 两跑自动平台楼梯重开持久化与单3D视觉通过

run cdc9fc95-1efd-412f-a2b3-906f2475f6f4 在用户手动关闭重开后，以新 identity 5dade536f06fbea4751da01882583362 / revision0 / isModified=false 完成91项只读范围：与实际已归档 saved-readonly.json 的保存前快照逐字段一致（仅显式换绑文档会话和清空新会话历史，旧三次事件仍保留）。新楼梯2296092及97个完整原生依赖双轮一致，实际1个平台2296101；主元素与依赖持久化接受。文件97,136,640字节、SHA256 245b267cdba4744136ba3e1e2a9a1c0280061ab630d2b58d0615ba5b77468f25、mtimeNs 1792930012560111500 与关闭前机器保存快照完全一致；本次确有 preclose 证据，没有套用旧楼板缺失保存快照的限制。

重开3D视图1847485 PNG与执行后逐字节/逐像素一致，已查看并接受单3D可见性；平面2295811有1451像素差异，边界[2809,620,3297,2537]，差异上下文显示楼梯“向上”文字及少量填充符号变化，原因未证实，整图视觉保持未接受。原4处既有原生视口盒坐标尾差、完整物理连接/支撑栏杆行为、隐藏副作用及工程合规仍保留 blocked，未扩大 write-accepted。

11份标准记录schema、390项来源摘要及离线归档审计0发现通过；原 readback.json、saved.json 和 rejected 的原 postwrite-readback.json 保持，旧 visual/summary 按阶段另存。任务队列增加限定 persistence-accepted / visual-accepted，整体仍blocked。累计Confirm=1，本阶段新Confirm/模型写入/保存/重启均0。该试验不需再次保存、关闭重开、注册或执行；后续先只读调查保留差异，再按既有队列推进其它覆盖。

## 2026-10-25 图框类型更换预览就绪

楼梯重开验收完成后，继续推进文档层 `documentation.titleblock-change`。当前会话 identity `5dade536f06fbea4751da01882583362`、revision=0、未修改，MVID `a5f06140-c95a-4705-a2f6-c81a34d64860`；基线 6 scope 通过，确认/写入/保存/重启均为 0。图框实例 `2296036`（THS-A1）位于图纸 `2296031`（AI-E102-REUSE），目标 `1018426`（A3）已激活，依赖和图纸图框成员完整。

单操作预览 `7598420d6314bf23905ebe5ffa0686e4` 已归档，摘要 `c979e8f0b9de5b4bd3d2ce49d55e29c3a694d874e0fc7b6704835954b62017d8`，有效至 UTC `2026-10-25T14:37:55.6168928Z`。预览明确披露 Revit `ChangeTypeId` 可能替代实例；执行后必须单独回读替代 ID、依赖、图纸成员、位置/旋转和 PNG。当前任务状态为 `preview-accepted`，下一步只需该具体 planId 的聊天批准；批准前不执行模型写入，也不保存或重启。

## 2026-10-26 图框预览会话恢复及真实版面风险

旧run aa295f1b-4b4b-4804-a264-b42b595ebebd / plan 7598420d6314bf23905ebe5ffa0686e4 的批准到达时，旧TTL已过且当前进程内计划不存在；本地无confirmation/attempt/execution，日志只找到旧Preview及随后PID22380启动。当前图框仍THS-A1，不据此反推历史从未执行；旧批准未用于新计划。前面连续错误参数/猜ID调用的失败保留为会话记录，停止这种尝试。

新run 7b699692-6654-4e20-a0fb-df760290a0db 在当前identity f491638f0b0d944e845ae5f6134ba77e/revision0/未修改、MVIDe1011050…，完成100个新只读scope；91个历史公开范围在显式更换会话字段后完整一致，图框/图纸/目标类型/既有放置/依赖/版面两轮一致，文件245b267c…/97,136,640字节及时间稳定。新预览 6b9ebd65430e7c0fc3a3c963001631b5 仅把2296036/图纸2296031的类型1018076换成已激活1018426 A3；摘要 bb8a4ae9ac5c83042970c455171a8f7fb1a55d4002cd0f190a6fa3478efc7b32，有效至上海时间 2026-10-26 03:17:30 +08:00。归档器一次误将result scope当request args导致只读复查停止，已按原计划恢复，只建了1个计划、Confirm=0；原错误文件保留。4标准阶段schema及146项来源摘要通过预览阶段审查，不调用未完成写入run的11阶段审计。

明确保留两个风险：表格2296037高约364.07mm，超过A3纸高297mm，且该计划不移动/缩放表格，因此不是版面修复；真正替代实例时原生回读对依赖自引用的存在性检查可能回滚，替代分支未接受。当前A1 PNG右上notes/legend仍重叠。需要新具体planId聊天批准才能写入；本阶段没有Confirm/保存/重启或注册，也无须用户重启。旧楼梯及其它验收结论保持。

## 2026-10-26 图框原位类型更换单次提交，PNG版面拒绝

run 7b699692-6654-4e20-a0fb-df760290a0db / plan 6b9ebd65430e7c0fc3a3c963001631b5 获具体聊天批准后Confirm恰为1，原生committed/1项。图框2296036保持原ID，1018076 THS-A1→1018426 THS-A3/A3，LocationPoint(0,0,0)、旋转0、依赖与图框成员不变，提交后documentationTitleBlockVerification单项通过；本次没有真正替代实例，不认证替代分支。revision0→1，原生事件仅修改图框2296036与图纸2296031，无新增、删除或截断。

100scope完整执行后回读全部捕获；623个唯一完整inspect对象中621项逐字段不变，仅图框与其图纸有变化。图纸宽高841×594→420×297、类型与图框bounds/outline等公开派生差异明确归档；原UID/编号/名称及其它参数不变。图框增加7项A3实例参数，与既有A3参考1042873相同；既有AL1表2296037、其视图2290440及位置/bounds保持。原始全部字段与差异均保留，未增容差或删几何。可解释公开字段不代表隐藏sheet状态或全模型净副作用已证实，整体writeAccepted仍false。

PNG已查看：AL1表位于左上，A3图框位于右下，两者明显分离，visualAccepted/wholeSheetLayoutAccepted=false。原生layout返回outOfSheet=[]，但其ViewSheet outline包络包含内容，不能证明表格在真实图框范围内；按图框边界独立比较和PNG均失败。未追加移动、缩放或修复计划。9阶段schema和297项来源摘要通过执行后阶段审查，保存/重开未运行，未调用11阶段完成审计。当前模型未保存、磁盘摘要仍245b267c…；若保留测试结果，下一步需用户手动保存后再只读核验。不重复该committed计划，不自动保存或重启。

## 2026-10-26 图框测试已手动保存，关闭前100项机器快照归档

用户回复“已手动保存，继续核验”后，run 7b699692-6654-4e20-a0fb-df760290a0db 同identity75a0e70a…/revision1/isModified=false，saved=true。完整100scope与执行后逐字段一致（仅保存状态从未保存改为已保存），文件97,136,640字节、SHA256 c99b0394902e540f45c5957cdb03be0cbc87b96bd6a6de953c8d1a1b18c47cb9、mtimeNs 1792949527402048900 读取前后稳定；saved.json、saved-readonly.json、saved-file-before/after实际落盘，preCloseMachineSaveStateCaptured=true。10阶段schema及414项来源摘要通过保存阶段审查；本阶段没有Confirm、模型写入、保存或重启调用。

下一步仅需用户手动关闭当前文件，再打开同一路径已保存隔离副本；无需再次保存或重启Revit。之后核验新会话持久化及PNG，不重放committed图框计划。AL1表在A3图框外的视觉拒绝、隐藏副作用未认证和真正替代分支未验收均保持；保存成功不提升这些状态。

## 2026-10-26 图框类型更换持久化归档完成，版面拒绝保持

run 7b699692-6654-4e20-a0fb-df760290a0db / plan 6b9ebd65430e7c0fc3a3c963001631b5 在用户手动关闭重开后，以新identity ffb7fdfea7cb58e8496ecd32a717986e/revision0/isModified=false完成100项只读scope、623个唯一完整inspect快照；与实际已归档saved-readonly.json逐字段一致，只有明确会话identity/revision及新会话空历史换绑，旧单次事务事件保留。图框2296036仍为1018426 A3，所属2296031及位置/旋转/依赖/既有表格均持久化。文件97,136,640字节、SHA256 c99b0394902e540f45c5957cdb03be0cbc87b96bd6a6de953c8d1a1b18c47cb9 和mtimeNs 1792949527402048900 与关闭前机器保存快照完全一致。

重开图纸PNG4096×2780与执行后逐字节及解码像素一致，已查看；AL1表仍在左上、A3框在右下，visualAccepted/wholeSheetLayoutAccepted=false。新增persistence-accepted仅覆盖声明公开范围，不认证隐藏副作用、全模型净差异或本次未触发的真正替代分支。11阶段schema、537项来源摘要及离线归档审计0发现通过，readback/saved/execution原阶段保持、旧visual/summary另存。累计Confirm=1，本阶段新的Confirm/模型写入/保存/重启均0。

此试验无需用户再次保存、重开、注册或重启，不重放committed计划。下一步先离线处理已发现的图框替代自引用依赖冲突，版面问题独立调查；不自动修复当前模型或缩小项目目标。

## 2026-10-26 图框替代自引用依赖修复设计待审核

最小设计已保存为 `docs/superpowers/specs/2026-10-26-titleblock-self-dependency-readback-design.md`，经源码与独立审查补齐三处检查统一、旧字段真实值及新增依赖保留证据：真正替代时，仅旧实例自身由独立的“必须消失”检查负责，所有真实从属仍须存在；原位/no-op 不放宽。实施范围限定代码、回归与版本化隔离编译，未修改插件代码、注册或模型。当前图框保存重开已完成，不需要重复人工操作；设计审核后再进入实施。

## 2026-10-26 图框自引用依赖修复离线完成，具体注册待批准

用户批准最小设计后，TitleBlockChangeReadbackRules统一读取必须保留的依赖，只在真正替代时豁免旧实例自身；原/结果身份与新实例存在仍独立拒绝，真实从属丢失保持失败。Service立即及提交前/后均消费该规则，每阶段重新读取；原始依赖列表保留，reviewedDependentsStillExist如实报告全部旧ID，新增dependencyPreservation单独披露required/exempt/missing/verified，不提升副作用、保存或视觉旗标。

新增13组纯规则回归，Core354/354通过；新增SDK/mock替代回执回归证明旧bool=false而新保留检查=true时完整原样传输、仅一次Confirm和同plan get。相关MCP51/51，全量MCP990通过/1跳过；版本化Revit2027.3隔离编译0警告/0错误、CheckOnly通过。DLL bin/Release/titleblock-self-dependency-20261025T175548Z/RevitAutoV27.dll，MVID 62920820-49bb-43e8-a562-07312ff4b187，SHA256 0a91a04a662da2c3f489b3a5549f7d36a6170ff67c1cce27c803e03bcaf901d7；289来源、7日志冻结，独立审查确认相对旧283来源仅Service/Rules/CoreTests/bridge测试4项改变。旧实载DLL及11阶段537项图框验收归档保持。

当前仍加载旧e1011050…/PID22380，同重开identity5b27f501…/revision0/未修改及c99b0394…保存文件。100scope新会话观察明确复用，另做2个新目标/依赖scope与上下文复核，未伪装成再次读取100项。只准备注册申请 53c7196e09ac81b1f1214844e23e70a3、SHA256 37324E1FDE244EA2C2FEF45D8A2AEC955642793321744ABE53A171C7771C2C62；尚未批准或注册，清单不变。下一步需具体申请聊天批准后单次切换，再请用户手动重启；此阶段注册/模型计划/Confirm/写入/保存/重启均0。真正替代原生分支仍未验收，A3/AL1版面仍拒绝；该离线修复没有修复当前模型版面。

## 2026-10-26 图框依赖修复具体构建已单次注册，待手动重启

用户批准精确申请53c7196e09ac81b1f1214844e23e70a3 / SHA256 37324E1FDE244EA2C2FEF45D8A2AEC955642793321744ABE53A171C7771C2C62 后，注册前发现人工Revit进程已换为PID42648、identityc100aea8…/revision0/未修改，但仍实载旧e1011050…，保存文件c99b0394…/大小/时间不变。另补100个新会话只读scope，与原保存重开范围严格一致；原申请及历史baseline字节保持不变。注册器无实时PID/identity硬绑定，纯清单DLL切换仍为同一已批准动作，不转移模型计划批准；该依据及补充证据已独立审查。

Invoke-SwitchRequest恰调用一次，回执REGISTERED_MANUAL_RESTART_PENDING。原清单备份、现清单仅Assembly切换、受保护bridge/config/ACL/2025清单、DLL SHA/MVID及原baseline保持通过。目标MVID 62920820-49bb-43e8-a562-07312ff4b187，当前进程仍旧e1011050…；本阶段模型计划/Confirm/写入/保存/重启为0，注册Confirm为1，原图框11阶段537项来源归档继续0发现。没有再次要求已完成的保存/重开。

下一步需用户手动重启Revit并打开同一已保存隔离副本，核验新构建实载和完整100scope；当前模型未修改，无需再次保存。新修复的真正替代原生分支仍未验收，当前A3/AL1版面视觉拒绝保持，不重放原图框计划。

## 2026-10-26 图框依赖修复加载核验完成

用户已手动重启。当前PID35768、MVID 62920820-49bb-43e8-a562-07312ff4b187，隔离副本identityprivate-document-identity/revision0/未修改。新加载核验run `31d7fe63-7c34-408d-a82f-661dc95078b4` 新读100个scope、623个完整快照，严格比较0差异，保存文件c99b0394…/大小/mtime保持；新PNG仍证实AL1表在A3图框外。独立审核289项来源/7日志/清单/DLL均一致。本轮仅只读与图片导出，未重复注册、模型计划、Confirm、写入、保存或重启。任务队列已解除本次“待重启/待打开”标记，仍保留整体blocked、视觉拒绝、真正替代原生分支及隐藏副作用未认证；已有保存/重开无需重做。

MCP的唯一跳过是旧生命周期模块的可选Windows OS辅助进程只读smoke：`local-test-copy-supervisor.test.mjs:194` 要求显式设置 `REVIT_LIFECYCLE_OS_SMOKE=1`，默认未启用。历史990通过/1跳过/0失败保持如实记录，不改成991通过；图框相关回归已通过，不因这项可选检查扩大到自动保存/重启开发。

## 2026-10-26 旧参数导入与导线成果归档，避免重复验收

离线审查 `acceptance/archive-reviews/20261026-parameter-import-and-wire/` 冻结14份历史原字节证据及索引。参数导入4a64fe…确已提交楼梯2295913注释并由用户手动保存；原生日志只冻结相关163–165行，事务报告13个修改项，缺完整原始阶段链/全部前值，不能凭目标1项推断完整副作用或关闭重开通过。

导线010b6e…已有一次成功提交、限定原生回读和手动保存当前会话复核；独立故意失败f2eff1…的117项电气快照与另一个查询内6项原生元素均由原始对象严格重算恢复一致（两组重叠4项，唯一元素合计119）。旧schema只有summary/parameters/connectors/electrical，不充当现代完整geometry/projection检查；成功事务69851/505261的前值、磁盘摘要、重开和PNG仍缺。旧预览记录缺afterSnapshot，仅保留context/counts可独立复算，不补造全范围证明。

队列补记上述已完成子范围，保留currentRunId=null及原acceptedStates，整体blocked，不重放旧Confirm/保存/回滚；reviewId只是历史审查标识，不是新原生run。14份原文件/冻结副本与全部审查摘要均已复核，来源矩阵原结论保持。

## 2026-10-26 图框包含诊断实现与机电只读基线推进

已按用户批准实现Node图框包含诊断，保留旧outOfSheet相对原生outline的语义，新增独立schema1/evaluated或unknown包含结果。真实AL1反例先红后绿，相关42项通过，全量MCP1006通过/1可选检查跳过/0失败；110项C#与既有构建一致，未重复编译/注册。只读run `3220ed2d-4134-427c-a555-1164d5fb9d2e` 的两张图纸原始bridge字段与新SDK派生结果全部严格一致，AL1正确报告left/top；模型文件c99与会话状态不变。A3视觉拒绝、替代原生分支和隐藏副作用仍未通过。

机电run `a37ebe44-b9a8-4728-a177-f8c686447d94` 的49项新范围、43完整快照、26连接器解析、两系统成员关系及10个局部单目标碰撞查询完成；经独立审查限定升级readonly-accepted，解除旧会话无法确认阻塞。11条警告、flow0、静压unsupported和clearance0局限保留，不升级水力、写入、持久化、视觉或全项目无碰撞结论。原本地验收脚本的错误摘要保留，由reviewed摘要和绑定源语义的sidecar补充，不重跑原生或篡改raw。

本轮当前入口仍是长驻旧Node代码，缺titleBlockContainment.schemaVersion1；新SDK验证不能替代用户当前连接加载证据。下一步需用户仅重新加载revit_custom MCP连接，再只读核验当前入口；无需重启Revit或保存。所需代码、回归、实机范围、队列和证据冻结已完成，模型写入/计划/Confirm/保存/重启/注册均0。

## 2026-10-26 当前MCP入口重新加载闭环完成

用户已重启客户端。当前连接直接调用两张图纸均返回包含诊断schema1，所有字段严格等于新SDK验收基线，AL1 left/top越框正确报告。原Revit进程/模块/identity/revision和未修改状态均保持，模型文件c99摘要/大小/mtime不变。原run追加当前入口4次工具观察及独立核验记录，旧pending记录不覆盖；Node源码、测试和原始证据摘要仍一致。

`documentation.sheet-layout-readonly` 已解除加载阻塞并恢复readonly-accepted，本次无需再由用户加载MCP、保存或重启。实际A3/AL1版面仍未修复，整图视觉、真正图框替代和隐藏副作用未认证保持，项目总目标及其它任务状态不变。后续从队列继续推进独立能力，不重复本次已闭环步骤。

## 2026-10-26 下一项：楼梯原生连接只读证据

从建筑验收缺口选取既有楼梯的梯段/平台关系，不重复创建或保存。当前MCP查到三个Stairs实例，前后identity8866/revision0/未修改稳定；通用inspect不返回StairsComponentConnection，创建回执也只含路径、标高、轮廓及成员，未能证明原生连接。

本机Revit2027.3 SDK直接提供StairsRun.GetConnections、StairsLanding.GetConnections及双端ElementId/ConnectionType，故无需靠几何贴近推测。新增任务architecture.stair-connections-readonly，书面设计选择独立有界只读查询；另比较了扩展通用inspect与几何推断两种路径。状态为设计待审核、未实现/编译/注册，调查原始记录与API证据另存preparations，不伪造实机连接已读或新run验收。

设计批准范围限定代码、测试和版本化隔离编译；具体构建注册仍另行批准，当前不要求加载MCP、保存或重启Revit。既有楼梯的视口尾差、PNG、支撑/栏杆、完整副作用和工程认证限制保持。

## 2026-10-26 楼梯原生连接查询离线完成，具体注册待批准

用户已批准只读连接设计并实施。新增独立 `revit_stairs_connections` / `revit.stairs.connections` 与 `native-stair-connections` 能力；严格单stairId/identity/revision，1000组件/4000连接/2MiB预算，UI线程冻结，原始重复和异常关系保留。已知空与unknown区分，互认要求两端各自枚举到相同ID/端点关系，不假定连接记录第一端总是当前组件；未知未来枚举不判成明确不一致。原楼梯创建/事务/生命周期代码未改。

CoreTests365通过；相关MCP42通过，全量MCP1015通过/1可选OS smoke跳过/0失败；最终Revit2027.3隔离编译0警告/0错误、CheckOnly通过。构建目录 `bin/Release/stair-native-connections-20261026T125434Z/`，MVID `b7b916fa-05da-4bf3-a8b9-0adf5cdcb1eb`、DLL SHA256 `334c810bd0047e524711e0a61fd58fd828cb624286cf4697e6473edaac49bf68`。302项来源与副本、8份日志冻结，并完成源码自审和请求摘要交叉校核；未冒称独立代理审查或真实连接验收。

恢复时桥接曾ECONNREFUSED且无Revit进程；用户手动启动后，当前PID30568/MVIDf89、identity763c4cab…/revision0/未修改。因磁盘文件摘要已由历史c99变为08855662，建立新会话100scope基线：623完整快照与旧公开范围一致，保留全部geometry/projection、不加容差；两个旧布局报告经明确的当前Node离线重派生后比较，不删除新字段掩盖schema差异。当前文件摘要/大小/mtime在读取期间稳定，外部历史文件变化原因仍未证明，不宣称整个二进制或隐藏状态相同。旧插件新功能拦截实测feature_not_loaded，未向旧模块发送新原生查询。

注册申请 `f72e9c12cbf67ca6b761c71cefb590b9` / SHA256 `E00F42DC15BA51B84E8652776DF2BF8E078FC0BEAD45BD868269DABEDDAECCC0` 已准备并复核：仅拟更换当前用户2027清单Assembly路径，现清单/受保护配置均未变，attempt/receipt/Confirm为0。准备记录的计数字段类型错误用追加review更正为302/8，不改原请求。需要用户对该具体申请批准后才单次注册，再请手动重启Revit及加载MCP。当前无需重复重启或保存。

新查询尚未实载/读取原生连接，nativeReadonlyAccepted=false；原楼梯副作用、视口尾差、PNG、支撑/栏杆及整体验收结论保持。代码/测试/编译不代替新版实机查询，未创建模型计划、写入、保存或自动重启。

## 2026-10-26 楼梯连接只读构建已单次注册，待手动加载

用户明确批准精确申请086af7c6…/E00F42DC…后，重新逐项复核302项来源与快照、8份日志、DLL SHA/MVID、请求、baseline和原attempt/receipt不存在。Invoke-SwitchRequest恰调用一次，回执REGISTERED_MANUAL_RESTART_PENDING；清单仅Assembly路径切到MVID6c6449ca，备份/清单回读及受保护配置通过，原申请和历史记录不改写。

注册后当前Revit仍为旧f89/PID30568，identity763c4cab/revision0/未修改；原生context/counts/活动视图/选择保持，模型08855662摘要/大小/mtime不变。本阶段注册Confirm=1，模型计划/Confirm/写入/保存/重启均0。新原生查询尚未加载验收，不提升楼梯连接、几何、栏杆/支撑或整体验收结论。

下一步需用户手动重启Revit、重载revit_custom MCP并打开同一保存隔离副本，无需再次保存。完成后只读核验新模块、当前新会话和原生连接；不重复注册、旧楼梯计划或已完成测试。

## 2026-10-26 楼梯原生连接实机只读验收通过，客户端新工具绑定待刷新

用户已手动重启，当前实载MVID6c6449ca/PID46340，隔离副本identityc6a16501/revision0/未修改。新只读run `fc301d40-4fb4-40d2-affd-d4080d1f63b3` 实际通过当前项目受控MCP服务的新SDK会话查询三个楼梯，未写模型。2296092两跑2296093/2296097与平台2296101原生互认，4条有向记录代表2对关系；2290014同样为2跑1平台；2295913无平台，两跑均明确known空连接，不被当作物理连通。

每份报告与直接原生bridge响应、重复读取严格一致，离线按端点ID/类型/数值独立复算互认通过。3类原生拒绝测试分别返回document_changed/document_revision_changed/stair_not_found。100项既有范围、623份完整快照与注册前公开数据无差异，保留geometry/projection、无新容差；RVT08855662摘要/大小/mtime和完整context保持。111次SDK工具调用、10次显式bridge逻辑调用；无计划/Confirm/写入/保存/重启/注册。

302来源、8日志和已注册DLL均再次核验一致；128项当前实机产物已索引。低效离线校核进程曾被终止，改为按顺序逐项核对请求参数和结果后成功复算，并用错误identity注入证明绑定检查会拒绝；没有重读Revit或改写原始观察。真实只读合同已加入acceptedStates，不将其倒推为旧楼梯事务/完整物理/支撑栏杆/隐藏副作用或工程认证通过。

当前聊天的工具绑定清单为39项，新SDK服务为40项，唯一缺少revit_stairs_connections。配置指向正确项目，无enabled/disabled工具白名单，未改配置或终止MCP/Revit。当前入口可发现性尚未通过，不能把新SDK验证冒充当前直接别名已加载。建议完全退出并重开Codex刷新本会话工具清单；Revit保持打开，无需再保存、重启或注册。此客户端问题不重新阻塞已通过的新DLL原生读取。


## 2026-10-27 Codex直接入口刷新完成与当前统计

楼梯原生连接只读任务的当前聊天入口已通过：40个revit_custom工具，直接查询2296092一次；当前identity f333e2d3…/revision0/未修改，4条原生连接记录与旧报告显式会话重绑定后严格一致，完整context前后一致。仅解除客户端入口blocker，队列currentState改为readonly-accepted；原始100scope/623快照、注册和保存等不重复。追加证据见acceptance/runs/fc301d40-4fb4-40d2-affd-d4080d1f63b3/client-entry-verification-20261027.json。

当前36个队列工作项按currentState统计：readonly-accepted 9、visual-accepted 2、compiled 5、core-tested 1、contract-ready 2、blocked 17。这是各项当前门槛，不是完整交付数量；部分readonly任务仍包含独立写入验收，两个visual项缺专属持久化归档，blocked项保留已通过子范围。自动保存/重启继续按用户决定停止，独立后台入口仍属第二阶段。

旧版来源矩阵52条仍保持既有独立结论：implemented-and-accepted 2、implemented-not-accepted 16、legacy-source-needs-redesign 33、intentionally-not-exposed 1，即49条尚未完成来源级迁移验收。52条中含21个查询参考、14个测试参考和1个原型，不能据此声称有49个全新功能待开发，也不能用2/52代表代码完成率。整体目标与两阶段顺序保持。

## 2026-10-28 图框族文字只读查询已编译，待具体注册批准

为继续调查AI-E035 Notes，新增families.text_notes工作流，沿用现有revit_workflow_run；只读取用户已打开的图框族，绑定identity/revision/精确族名及类别，返回限量正文、纸面尺寸、原生边界和类型默认字体。未知、已知空和截断分别保留，不自动打开、编辑、加载族或写模型。任务卡见family-text-readonly.md，当前仅compiled，尚无新查询实机验收；Notes来源和拥挤原因仍未知，原名称/标签已完成的保存重开不重复。

核心372、定向29、全量MCP1074通过/0失败/1项可选生命周期OS smoke跳过，Revit2027.3隔离编译0警告0错误及CheckOnly通过。候选bin/Release/family-text-20261028T141508Z冻结305项来源和5份日志，MVID 52b485d8-4e55-45ef-adc9-c6f26bd93fff；具体申请8e46d749219a027493d6658e2426d886已准备但未获准注册，注册Confirm=0。仅核验当前上下文和磁盘摘要，文件与上轮保存记录72a5dad6…相同；没有重做全范围验收、模型计划、写入、保存或重启。下一步先取得该具体申请批准，注册后才提示用户手动加载并打开经审阅族文档。

## 2026-10-28 图框族文字只读构建已获批单次注册

用户批准申请8e46d749219a027493d6658e2426d886（SHA256 BC53FBB10B12FC1204F5BCE72BB371AB9DD0387CD3A8FD9FB954EB6270D20141）后，只执行一次注册。回执REGISTERED_MANUAL_RESTART_PENDING；清单与拟定字节相同、原清单备份/305来源/5日志及受保护配置核验通过，当前模型文件摘要/大小/mtime不变。新MVID 52b485d8-4e55-45ef-adc9-c6f26bd93fff 尚未实载，当前仍为旧b7b916fa-05da-4bf3-a8b9-0adf5cdcb1eb，因此任务保持compiled、原生查询未验收。详见acceptance/preparations/family-text-20261028/registration-result.json；下一步用户手动重启并重载MCP后，在族编辑器打开经审阅THS-A1，只做新的只读查询；注册、模型计划、保存重开不重放。

## 2026-10-28 图框族查询实载后被范围保护拒绝，元数据补齐待注册

用户已重启并在族编辑器打开图框，实载d510168b/PID32812已核验。独立只读run01a182f5-5a82-7fb5-ba0f-57a49f557ca2记录THS-A1及实际标题THS-A1.rfa两次精确查询均被family_text_scope_mismatch拒绝；当前构建不提供实际OwnerFamily名称/类别，因此没有正文数据，Notes成功查询和整图修复仍未验收。完整族context前后相同（isModified=true在首次读取前已存在），RVT72a5dad6摘要/大小/mtime不变；只恢复最小化窗口做UI只读观察，没有模型写入、保存、族加载或文档开关。当前聊天Node仍旧，新SDK能发现工作流，两个门槛分别保留。

仅补齐族context的familyDocumentScope及拒绝细节；保持精确OwnerFamily名/类别/identity/revision，不用窗口标题代替原生族名。核心373、定向30、全量MCP1075通过/1可选OS smoke跳过，隔离编译及CheckOnly通过。候选MVID deb1d408-6719-428a-a1dc-59fb65cb7267；305来源只新增6份变化快照，其余复用已有冻结副本。申请c4839cb4b52b8598484630f62544ac7b已准备未注册，SHA256 07D8A5A0BA833DA34DFDF6C7A5CC9457E811A2066B085D7D821BC8829BC944B1，原d510申请不重放。当前任务blocked，等待这份诊断构建的独立注册批准；原图纸名称/标签保存重开不重复。

## 2026-10-28 实际族范围元数据构建已获批注册

用户批准申请c4839cb4b52b8598484630f62544ac7b（SHA256 07D8A5A0BA833DA34DFDF6C7A5CC9457E811A2066B085D7D821BC8829BC944B1）后已恰好注册一次；回执REGISTERED_MANUAL_RESTART_PENDING。实际清单与拟定字节相同，备份/305项来源及冻结副本/5份日志/受保护配置核验通过，项目磁盘不变=true、当前完整族context不变=true。新MVID deb1d408-6719-428a-a1dc-59fb65cb7267 待加载；当前仍实载52b485d8-4e55-45ef-adc9-c6f26bd93fff。任务保持blocked，原两次拒绝和实际族名未知不被升级为通过；未写模型、保存、载入族或自动重启。下一步手动加载后先读取实际scope，再使用新pin继续只读查询。证据见acceptance/preparations/family-text-scope-20261028/registration-result.json。

## 2026-10-28 开源参考首批落地与图框族空名根因

用户授权借鉴后，已独立实现runtime-diagnostics及更新health CLI：插件/MCP/文档/实际族范围分开诊断，expected/observed/nextAction明确，完整本地证据与默认摘要分离，SDK子进程显式透传桥接设置。11项测试通过；真实只读run 9ef4313c-f04d-4748-a736-54f79b76244b 准确报告已知空名契约缺口，完整47905字节与摘要2526字节，未声称token或原生性能提升。跨工具句柄/分页缓存及第三方Revit测试框架仍未实现，不改变既有模型写入与手动保存规则。

用户完全退出重开后，1fc8f276/PID22724实载；元数据run 9ac9cb62-c2ad-4a71-a701-60628c9407b2 证实OwnerFamily.Name=""、title=THS-A1.rfa、category=-2000280，identity02dbd27c/revision0/初始isModified=true保持，RVT72a5dad6摘要/大小/mtime不变。没有再发注定失败的正文请求。新增空名分支必须额外精确绑定文档标题、保持空名原值，并继续核对owner存在、category、identity/revision；新feature门控拒绝旧DLL派发。核心375、定向43、全量MCP1088通过/1可选OS smoke跳过；最终隔离编译0警告错误及CheckOnly通过。309来源、14份变化副本和5日志冻结，MVID 9cbadad3-0e66-4f33-a4cf-9f420fa75239。申请7cc651ad1acd4c02211a9d78ea013d55（SHA256 E3BA8D076B04C6786E440E9A5C74A0691BA2D7CD32FF77ECEB82924F580B7474）已准备未注册；正文未验收，原图纸名称/标签结果和旧失败证据保持。

## 2026-10-28 已知空族名修正已获批单次注册

用户批准申请7cc651ad1acd4c02211a9d78ea013d55（SHA256 E3BA8D076B04C6786E440E9A5C74A0691BA2D7CD32FF77ECEB82924F580B7474）后，已恰好注册一次，清单/备份/309来源及冻结副本/5日志/受保护配置核验通过。新MVID 9cbadad3-0e66-4f33-a4cf-9f420fa75239 待加载，当前实载deb1d408-6719-428a-a1dc-59fb65cb7267；项目磁盘不变=true、完整族context不变=true。正文查询仍未验收，metadata子范围及统一诊断首批结果保持；没有模型写入、保存、载入族或自动重启。下一步手动加载后仅使用新的精确空名/标题/session查询，不重复任何旧注册和模型动作。证据见acceptance/preparations/family-empty-owner-20261028/registration-result.json。

## 2026-10-28 图框族空名正文限定原生验收通过

用户重开后确认c9410ac8/PID39408实载，当前族identity9ef34fe0/revision0。新run f40b57ab-c902-437c-a6f1-5f19e019eefd经现有工作流的新SDK连接完成精确空名/THS-A1.rfa标题读取、限量1条及7类原生拒绝；110条中返回100条，正文无未知/截断，集合仍complete=false。100个get_BoundingBox(null)均未知，不把宽高当原生字形盒。正文候选1744762（默认Arial2.5mm），注释/Notes标题1744761/1744866（宋体5mm）已定位；原生2560×1808族PNG可见正文与下方图例标题重叠、Notes标题拥挤，Legend原生ID和字体替换原因未认证。

完整context及RVT72a5dad6摘要/大小/mtime在读取和PNG导出前后相同；初始isModified=true保持，无模型计划、Confirm、写入、保存、族载入或文档开关。当前聊天旧Node37404仍未刷新，新SDK通过不冒充当前入口通过；任务blocked但acceptedStates保留readonly-accepted。无需再注册或重启Revit；入口重连只做最小检查，剩余10条及视图包围盒并入后续相关DLL批次。原图纸名称/标签结果、旧拒绝证据和项目族关联/整图限制保持。

## 开发流程精简与首处明确源码移植

保留项目目标、状态名、精确写入批准和既有验收，重写日常执行段为按变更范围选择检查的表格：Node-only不触发DLL，候选批次冻结才做该批全量检查，字段级修改合批加载，未知按写入依赖处理。任务卡离线阶段改用契约/日志/构建引用，不再误填runId；阶段路径经summary引用，不逐项重复填写。没有新增流程执行器、独立任务或实机run。

实际移植bimwright/rvt-mcp的ToolArgumentGuard参数名归一化/提示与有界键名诊断，来源固定到commit4affa2aa/source blobf51da5dc，保留完整Apache2许可和改动说明。接入health CLI严格拒绝路径：提示唯一正确字段名，不自动纠正或忽略未知参数；不回显参数值，歧义无建议，截断明确。18项定向单元/CLI/SDK mock测试通过，未重跑全量、编译、注册或连接真实Revit；既有运行时只读范围保持，新增参数提示仅core-tested。

## 2026-10-29 项目只读诊断的原生pin修正

继续复用既有diagnostics.query入口及已移植的参数提示。补齐每次search/inspect的identity/revision，内层显式revision在外层省略时仍有效；沿现有握手强制readonly-query-pins能力，安全要求绕过可选缓存且不进入原生payload。完整文档元数据/修改/只读状态变化、异常或取消会停止后续读取，不重试；族文档早期拒绝，仍走独立族读取合同。组合查询的4次逻辑调用保持，没有新增工具入口。

最新诊断15项测试、共享桥接及相关72项回归通过（有重叠不相加），包含实际SDK到模拟桥接的成功、旧模块拒绝、文档切换与字段错拼。仅Node变更，无DLL编译、注册、模型计划、真实Revit读取/写入或新实机run。此新子范围保持core-tested，既有只读批次状态和runId保持；使用新代码时只需按需重连MCP。

## 2026-10-29 可选诊断摘要与内存句柄分页

选择性适配OakPlank ResultStore并保留MIT许可及不可变源blob，接入现有workflow入口：diagnostics.query默认full兼容，可选summary；diagnostics.result按受控section/offset/limit读取本次已捕获记录。快照绑定document全元数据/identity/revision与插件MVID/PID，最长5分钟单调有效期、不续期，16条/单条2MiB/总8MiB序列化预算，MCP摘要/页面封装预算256KiB。过期/驱逐/进程隔离/范围漂移拒绝，不自动再查询；分页保留原生hasMore，与缓存hasMore分开，不能补原生未返回数据或族缺失10条。

51项受影响单元和实际SDK到模拟桥接检查通过。100条模拟数据的实际MCP结果full41176字节/summary1320字节，翻页目标查询增加0；不声称真实Revit或token性能。保留assisted假设，超预算拒绝而非裁剪。原始数据在同一进程内保留，退出/重连后句柄不再可用；不是持久化验收证据。仅Node，无DLL、依赖、注册、模型动作或新增实机run；新子范围core-tested，旧已验收范围与runId保持。使用新服务代码时按需重连MCP。

## 2026-10-29 诊断结果分页限定实机验收通过

预检曾两次观察到活动族文档并在墙搜索前停止，未建立空run或要求保存/重启。用户操作后仍为族；新的可靠窗口观察定位到既有项目标签，仅切换到机电项目模板使用说明视图，保持族文档打开，不保存/载入。随后只读run 57b4f32d-9008-4233-a8c8-2edd5a74fc5d经新SDK和真实c9410ac8/PID42212完成18墙独立原生对照、一次SDK摘要与两页缓存严格比较；doc84d80e8a/revision0/未修改，全部捕获记录相等，源hasMore=false，完整context及RVT72a5dad6大小/mtime/SHA保持。无模型计划、写入、保存、文档开关或注册。

该摘要分页子范围升级readonly-accepted，限定本次墙记录/新SDK连接；当前聊天MCP目录仍无新工作流，不冒充入口已刷新。TTL/驱逐/切换故障不通过修改实机模型注入，保持离线覆盖；分页目标调用次数未独立实机计数，原生对照和SDK源查询各一次均如实记录。6个源hash事后采集、mtime早于run开始，原始源副本与响应均保留。后续配方已加入启动源hash及结束复核，1项包含source-snapshot目录的归档回归通过；不因该格式改进重跑已通过查询。

## 2026-10-29 房间标记显式引线修正已编译暂存

回到第一阶段业务检查，确认Room专用NewRoomTag分支已存在，实际缺口为未应用显式leader。补齐Node与Native严格布尔校验，RoomTag实际设置HasLeader；通用参数写入后立即回读，复用文档创建核验在事务提交前后、group仍可回滚时核对tagId/类别/ownerView/leader，并绑定原生Document。显式leader要求tag-leader-readback能力，旧模块在预览前拒绝；省略leader保持既有行为。目标关系/端点/几何、副作用、持久化和视觉不因此认证。

核心378、相关Node39通过，Revit2027.3隔离编译0警告0错误；候选bin/Release/tag-leader-candidate-20261028T200514Z（UTC）/MVID90b2f954。仅compiled暂存，未冻结完整候选或跑该批全量回归，未申请/执行注册、创建模型计划、写模型或保存/重启。原rooms只读状态及围护阻塞保持；下一相关Native批次合并加载，避免字段级注册循环。当前聊天目录仍未出现新workflow，记录状态后未再尝试该目标入口，不影响离线开发。


## 2026-10-30 入口恢复与图框文字候选

Codex重开后，当前聊天的单个tagtypeid无效请求返回Node键名建议且不回显参数值；插件099df33d/PID20568、完整上下文及RVT摘要/大小/mtime一致，没有成功计划或写入。原run01a18cba追加summary-current-chat-refreshed-20261030.json；只解除客户端入口阻塞，不重跑原生/新SDK矩阵，也不升级有效标记/尺寸创建与几何等门槛。

独立补齐图框族文字的可选受控分页与显式视图包围盒：401核心、88相关Node/SDK及2027.3隔离编译通过，0警告错误；候选 bin/Release/family-text-pages-20261030T123938Z / MVID 267db5db-dccd-4718-a6e3-9f057471a730。实际代码、契约和限制见docs/family-text-readonly.md，日志/来源摘要见staged-verification.json。未做发布冻结、注册或新分支实机验收；保留原100/110、未知模型框及项目关联限制，下一相关DLL批次合并加载，本轮不要求重启、切换族或保存。


## 2026-10-30 标记引线与族文字合批注册

既有房间标记新增独立的只读引线端点/折点观察，不改变头坐标或LocationPoint；无引线/直引线/读取失败分别保留，IndependentTag逐引用端点明确未实现。与此前文字分页及显式视图包围盒合批，复用既有inspect/workflow入口。最终Core409、相关SDK23、全量MCP1142通过/1可选跳过/0失败；2027.3隔离编译0警告错误、CheckOnly通过，冻结342来源/5日志，324份来源复用。

构建 bin/Release/annotation-evidence-batch-20261030T130414Z，MVID 1915c64d-c533-4a04-a1d3-5afc88db26c3，DLL SHA256 18c48f6a33cc50c764f6beac61b5ca531d809fc41d5fb81bac7500bb7a303f08。代理逐构建复核长期授权、源码/快照/日志、精确申请、DLL、原/新清单、备份和基线后，单次注册31e77275a77edfe364d412a4b80fa3c9；申请SHA256 8F28E77692F6209203D5590C68DD246DAC65BD28A02A0172E19296DE8473CBCC。回执agent-reviewed-standing-authorization、humanChatApproval=false，不冒充逐次人工批准。

当前实载仍为e6b5ebc3-761e-4845-a299-ce8bce92d285/PID20568，状态REGISTERED_MANUAL_RESTART_PENDING；队列两个新子范围保持compiled。基线仅含两枚既有标记和完整context，RVT摘要/大小/mtime不变，不宣称全模型验收。下一步一次手动重启Revit+MCP重载，在同一进程验收项目标记与族文字新分支；没有模型计划、Confirm、写入、保存或自动重启，也不重做2296196持久化。源码冻结首次因历史文档差异未列入白名单而停止，差异已逐项复核并保留初次快照；未触发测试/模型重放。


## 2026-10-30 合批新版实载及限定只读结果

用户加载后确认新MVID8f45ec0e/PID36160。项目run01a18d01-de3f-7609-8bd6-b1de54da75dc通过当前聊天读取2296196直引线端点(34000,3000,1199.9999999999998)mm、HasElbow=false；旧2295836为HasLeader=false，端点/折点明确不适用。两枚完整旧快照仅新增tagLeaderGeometry字段，头坐标等全部旧字段一致；新会话2aced463/revision0未修改，完整context和项目RVT摘要/大小/mtime保持。无折线RoomTag、IndependentTag端点、点在房间内或整体视觉验收推断。

随后通过Revit项目浏览器THS-A1的编辑族界面进入既有族，未保存或载入族。新SDK/原生run01a18d09-3f4f-76e7-8a1e-a5cb18e5be38以新族identity10427831/revision0、实际空OwnerFamily名和THS-A1.rfa标题绑定，读取100+10条、110个唯一严格递增ID；正文逐条完整，110个指定视图viewBounds已知，模型bounds仍全部未知。新family的isModified=true在任何查询前已存在且全程保持，baseline=unknown，不能计为保存文件/持久化基线。

完整文字现已定位图例1744965及/Legend1744966；与说明正文1744762存在原生变换盒正面积相交候选，详见notes-box-analysis.json，不认证实际字形碰撞或版面修复。

当前聊天family入口仍把afterNoteId识别为未知字段，新SDK则接受同一输入；当前workflow描述仍旧，后台有早于相关源码修改的MCP进程，但未声称确定哪个PID服务本聊天。两个功能的原生/新SDK结果与当前聊天刷新分开记录；只需完全退出重开Codex，保持Revit/图框族打开，回来只做1条maxNotes=1入口验证，不重复实机矩阵、注册、Revit重启或已保存标记写入。


## 2026-10-30 当前聊天分页入口刷新验收完成

用户重开Codex后，Revit仍实载8f45ec0e/PID36160，THS-A1.rfa仍为identity10427831/revision0/原有isModified=true。仅通过当前聊天发送1条maxNotes=1、afterNoteId=0、boundsViewId1744563的只读请求：返回首条1744755、remainingCount109及真实viewBounds，与已归档第一页的首条完整对象逐字段一致。前后完整context和项目RVT摘要/大小/mtime保持。

原族run追加current-chat-refreshed-20261030.json及summary-current-chat-accepted-20261030.json；旧pending记录保留作历史。pagesAndViewBounds子范围恢复readonly-accepted并清除重启/重载标志，族父任务仍因保存基线、共享影响及字体/视觉限制保持blocked。没有重跑100+10页、标记、测试矩阵、注册、模型计划、Confirm、保存或Revit重启；本项不再需要人工加载动作。


## 2026-10-30 尺寸创建回读离线补齐

既有create_dimension原先NewDimension后直接返回ID。本轮复用原事务组/DocumentationCreationReadbackService，补齐创建后、整计划提交前、事务提交后的原生Doc、ID/UniqueId、类型、owner view、可解析完整引用集合及支撑直线检查；后续操作改变尺寸结果则在组结束前失败回滚。预览和执行均重新解析引用，不猜几何或切换视图；原生重排允许且如实报告。输入上限128引用、每条4096字符，Node/native均拒绝越界；旧模块在尺寸预览派发前由新feature拦截。

inspect增加只读dimensionReadback，保留实际轴线/引用/可解析性；不认证数值/分段、输入线段范围、文字/见证线、持久化/视觉或隐藏副作用。族内尺寸创建未暴露，保持项目NewDimension范围。419核心、54相关Node/真实SDK mock检查、2027.3隔离编译通过，0警告/错误。SDK的Confirm仅调用隔离mock服务，真实模型计划/Confirm/写入/保存/重启/注册均0。

候选bin/Release/dimension-readback-20261030T145403Z，MVIDd78df8e4-e350-4d6b-90c6-48e6fb3d5fe0，来源/日志及限制见staged-verification.json。已compiled暂存，未做全量候选发布回归、CheckOnly、注册或新尺寸实机验收；与下一相关能力合批加载，当前不要求人工重启/重载。既有标记和110条族文字只读验收不重复。


## 2026-11-08 尺寸与轴网引用合批注册

接续上批尺寸最终回读，现有inspect补Grid原生Reference构造/序列化/解析/序列化的精确本地回转及独立模型直线端点；不手拼引用，不使用Grid.Curve.Reference，不认证指定视图可见或可标注。直线未知与引用读取分别保留。既有Dimension回读经一个独立只读源码审查，无可确认缺陷；链接引用初始化仍列为实机未知，未据此放行链接分支。

422核心、最终全量MCP1144通过/0失败/1既有可选跳过，2027.3编译0警告错误、CheckOnly通过。候选bin/Release/dimension-grid-batch-20261107T201943Z，MVIDc8001ce7-49df-4e32-9cf6-29e95ae3b92d，DLL SHA2563eef6fe9b3e0f5034fd701e87c0ec8fcaf3bbb54164aa5a310769b7072d0aa35；349来源/4份最终日志冻结，327份快照复用，较上次已实载构建22处预期来源改变。相关54项与全量重叠不累加；补模型线坐标后重新编译/全量检查，较早日志保留。

真实只读基线为当前同一路径未修改隔离副本identity79807107/revision0、PID22164、实载8f45ec0e，读取12轴网和5既有尺寸及类型/视图候选，完整context和保存文件b62d6ae8摘要/大小/mtime不变。首个基线脚本仅在路径分隔符规范化断言退出，修正两端规范化后读取成功，无模型动作重试。

依据长期授权，复核精确请求/DLL/来源/快照/日志/清单唯一Assembly差异/备份及保护设置，单次注册9923f5165c6eda201cccb427431c0a44，申请SHA256F0DF9317115A3F0AB9E32A9EA1B749DE7EC3A159D7A90C3F640896DDAEED43EB；回执agent-reviewed-standing-authorization、humanChatApproval=false。当前仍实载旧模块，REGISTERED_MANUAL_RESTART_PENDING；两个子范围保持compiled，不冒充实机验收。真实模型计划/Confirm/写入/保存/自动重启均0。下一步一次人工加载及MCP刷新，再核验新范围，不重做旧标记/族文字或旧注册。


## 2026-11-08 新版实载、轴网通过与LinearDimension修复注册

用户加载c8001ce7/PID26584后，新会话fca1a747/revision0/未修改，run01a1b7b9-2656-7c27-8c01-8e10d4f7c8ea经当前聊天一次读取12轴网+5尺寸；12轴网引用及直线均已知/回转一致，17完整旧快照字段只有新增诊断字段，无旧字段差异，完整context及RVTb62d6ae8摘要/大小/mtime保持。Grid子范围readonly-accepted。

5个尺寸实际className均为LinearDimension，旧三处Dimension精确假设造成invalid_dimension_readback，维持未通过，未创建模型计划。新真实类名回归先红、最小三处修复后423Core/相关51/全量MCP1144通过且0失败/1可选跳过；2027.3编译0警告错误/CheckOnly通过，349来源6份日志冻结、343快照复用。旧native失败和core-red.log保留。此前独立静态审查遗漏子类，后续结合实际回执/已装API元数据复核确认修复边界，未放宽其它维度类别或引用/轴线规则。

修复bin/Release/dimension-linear-class-fix-20261107T203742Z/MVIDf6cc9a92-434a-4ee8-ac60-a340c54046cd/SHA2563911619f5751770319c9662c08801cd0d2e04bdd289b10549e0206af251cf4f0按长期授权单次注册88b5099c76bc27b79402c06b2e6bce7e，申请SHA2561D7C004720FD8A841CFF10A2417D8668A6E35F9700FEB384FF483C04206935A5。清单/备份/保护设置/当前文档及保存文件核验通过，仍实载c8001ce7。状态FIX_REGISTERED_ONCE_MANUAL_REVIT_RESTART_PENDING；修复实机验收未完成。Node运行时代码未变，不要求MCP重载或Codex重开；用户只需重启Revit打开同一已保存副本，回来仅复查5个尺寸，不重跑已接受的Grid矩阵。真实模型计划/Confirm/写入/保存/自动重启均0。
