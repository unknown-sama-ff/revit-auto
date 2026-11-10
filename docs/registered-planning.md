> 发布副本说明：本机路径、模型名称及运行标识已匿名化。原始私有证据未随源码发布；历史验收不代表当前会话授权或完整业务认证。

# 普通工作流预览适配

## 2026-10-14 流程编排索引

预览适配现按统一生命周期执行：登记 → 契约 → 核心实现 → 模拟测试 → 隔离编译 → 只读实机基线 → 预览 → 确认 → 单次执行 → 原生回读 → 保存/重开 → 归档。预览本身只能推动 `preview-accepted`，不能替代写入、保存、重开或视觉门槛。确认必须绑定同一 `runId`、planId、document identity/revision、插件 MVID 和预览哈希；断线先查询原计划/attempt 状态。

当前顺序和 blocker 见 [capability-task-queue.json](capability-task-queue.json)。同一 MVID、Revit 会话和 document revision 的只读任务应合批；一次写入只覆盖一个明确能力。旧预览、旧 identity/revision 和过期 planId 不得重用。此索引只调整编排，不创建计划、不确认、不写入、不保存、不重启。

统一入口仍为 `revit_workflow_run`。本次适配复用现有操作生成器和原生事务引擎，不运行旧脚本，不新增 Revit 二次确认。

## 覆盖范围

`lighting.full`、`lighting.place`、`electrical.circuit`、`electrical.wire`、`electrical.sheet`、`architecture.build`、`architecture.rooms`、`architecture.openings`、`architecture.documentation`。

泵房、原生洞口、楼梯、族加载和导入保留各自专用适配器。普通适配器不会替换它们的专业检查。

`electrical.wire` 另复用导线领域模块，支持 `wireDeletions` 和 `switchControls`；在创建预览前分批检查已有导线/开关，并披露原值和删除依赖的不确定性。具体契约见 `electrical-wire.md`。

## 规划模式

- `explicit`：使用明确领域输入生成预览；保留普通工作流原有的默认模式。
- `ask`：返回范围、类型、标高、坐标、宿主和连接关系的澄清问题，不访问 Revit，不创建计划。
- `assisted`：必须列出非空 `assumptions`，返回 `candidateOnly: true`、假设和警告；候选仍需用户在聊天中审阅并确认。

助手在自然语言需求模糊时应主动选择 `ask`，不能用默认 `explicit` 代替需求澄清。

## 预览流程

1. 检查注册工作流、规划模式及领域输入。拒绝空范围、非列表字段、未知顶层字段、脚本/文件路径和 `input.operations`。
2. 调用已有操作生成器检查结构化操作及引用顺序。
3. 读取当前文档，校验身份和 revision，拒绝族文档、只读项目或未知 revision。
4. 原生 `plan.create` 总是携带刚读取的 revision，包含 revision 为 0 的情形。
5. 校验原生返回的 pending 状态、planId、identity 和 revision，并再次读取上下文。
6. 上下文、路径或保存状态变化时，尝试取消已知 planId 一次，返回原始失败原因；取消失败记录为 unknown，不宣称恢复模型。
7. 正常返回 `planCreated: true` 及预览。只有用户批准该具体计划后，助手才能调用 `plan.confirm` 一次。

顶层和 `input` 内的文档身份/revision 如果矛盾，立即拒绝；只提供嵌套 revision 时同样检查。原生创建失败或超时不自动重试、不自动创建替代计划。

## 兼容变化

普通工作流中的输入只能使用对应领域列表。例如 `architecture.build` 的 `walls`、`floors`、`doors` 和 `windows`。工作流内原始操作注入不再允许；独立 `revit.plan.create` 仍是结构化操作的预览工具。

普通适配器复用受控原生操作；建筑类型复制等新增分支需要对应原生能力已加载。类型/宿主/参数仍由当前模型查询和原生预览验证；功能矩阵不能仅凭预览通过升级为“已迁移并验收”。

## 验证

`mcp/tests/registered-planning.test.mjs` 覆盖九个工作流的预览和 ask 模式、候选假设、嵌套 revision、空范围、错误输入、文档切换、预览异常、取消失败和真实 stdio SDK 契约。测试中的原生主机是本机模拟桥接，不替代实机写入/回滚验收。

2026-10-09 验证：MCP 全量 468 项通过。实际 Revit 测试副本通过 MCP stdio 完成照明 `ask` 和建筑标高 `explicit` 预览，随后取消该预览并复查；文档身份、revision、路径、保存状态、元素数量、当前视图和选择集均不变。私有证据保存在 `runtime/registered-preview-evidence-*.json`，未提交模型写入。这是入口预览/取消验收，不是旧版全业务功能对等或实机写入/回滚验收。

普通入口的规划模式和上下文保护修改只影响 MCP 层，重新连接 MCP 服务后生效。新增原生操作仍需加载对应 DLL；桥接能力门槛在旧主机上阻止创建这些计划。

## 图纸与表格导入补齐

2026-10-13：`revit_sheet_layout` 已完成实机只读验收。当前实载构建 MVID 为 `cffd0d77-6aac-49e4-a2e8-41260bb56e35`，`sheet-layout-diagnostics` 已加载；测试副本 revision=0、未修改、可写。`AI-E102-REUSE`（2296031）和 `E101`（1042869）各自读取图框、视口、普通/配电盘表、TextNote 与 IndependentTag 的原生范围，并通过 MCP 派生 unknown/out-of-sheet/intersection 诊断；两张报告 complete=true、unknown=0、intersection=0，E102 out-of-sheet=0，E101 out-of-sheet=1。验收脚本只允许 bridge.info/context.get/search/sheet.layout，未调用 plan/confirm/save/lifecycle；同会话复核通过，关闭重开后的 identity 变化兼容逻辑已由定向测试覆盖。`wholeSheetLayoutAccepted=false`，PNG 中 notes/legend 与轴网标签问题仍需独立版面修复和视觉验收。

2026-10-13：新增受控 `move_viewport_label` 单操作，要求明确 viewport/sheet/view 原生 ID、未旋转且未固定视口、完整标签几何与可写文档；可设置有限 XY 标签偏移并可选指定引线长度，执行前后核验视口内容框及归属不变。Revit 2027.3 隔离编译、CoreTests 267/267、MCP 定向测试 100/100 已通过；该具体新 DLL 尚未注册或实机加载，当前 E101 越界标签没有因此修复，模型写入和 PNG 视觉验收均未完成，`wholeSheetLayoutAccepted=false`。

2026-10-14：`move_viewport_label` 已完成实机链路。新版 MVID `d13a629d-f305-4474-adb0-7ff58f53aef1` 实载；E101 viewport `2290439` 最终保存后的 offset 为 `(20,-25,0) mm`、引线长度 `100 mm`。保存后文档 revision=3、`isModified=false`；图纸诊断 complete=true、unknown=0、out-of-sheet=0、intersection=0；E101 PNG 4096×2896 导出通过。此结果不认证右侧 `AI-ARCH` 轴网标签视觉问题，`wholeSheetLayoutAccepted=false` 保持。

electrical.sheet 新增 sheetChanges 和 viewChanges，限定修改当前既有图纸名称/编号及非模板平面视图名称/比例。预览前读取准确参数基线，并检查图纸编号目录和冲突。详情见 electrical-sheet.md；移动、更换图框及批量高清导出已接入受控代码，独立原生验收范围见 drawing-architecture-parity.md。

imports.parameter_table 与 revit_parameter_import_preview 现在使用相同的 explicit/ask/assisted 语义。ask 可以没有来源，只返回字段映射、文件/工作表和模型约束问题，不读文件、不访问 Revit；assisted 必须提供非空 assumptions，只处理明确表格数据，返回 candidateOnly、warnings、missingInputs、alternatives，仍需具体聊天确认。

表格映射/校验错误只返回问题，不创建计划。正常预览要求原生返回 pending、非空 planId 和准确 identity/revision，随后复核上下文、路径和保存状态；失败时只尝试取消已知预览一次，保留原始错误与清理未知状态。创建超时不自动重试。所有模式均不提交或保存模型。

2026-10-10：结构柱、具名轴网与图框类型更换已补齐受控源码入口。architecture.build 接受严格 columns；electrical.sheet 和 architecture.documentation 均接受单操作 titleBlockChanges，并执行同一原生范围预读。批量高清 PNG 是独立只读工具，不产生模型计划。这四项原生能力已完成一次注册切换并实载，保存后重开核验通过：134 项完整原生范围、29 项柱/轴网范围一致，证据为 `runtime/parity-postregistration-reopen-verified-1791626912602.json`。AL1 表格已经保存于 X=398.5/Y=568 mm，119 项电气快照不变，禁止重复移动；该受限保存/重开结果不能代替四项新增分支的独立写入、回滚或导出验收。详见 [图纸和建筑能力迁移补齐](drawing-architecture-parity.md)。

2026-10-10：只读原生批量导出已核验两张图纸：`AI-E102-REUSE` 为 4096×2893、`E101` 为 4096×2896，请求 300 DPI，PNG 唯一映射、完整解码及非空内容通过。134 项完整范围、29 项柱/轴网范围、identity/revision/isModified 和 RVT 文件摘要保持一致；快照仅递归规范化 -0→0，保留所有字段及顺序。AL1 左侧签字栏已避开，但右侧 notes/legend 重叠，E101 的 AI-ARCH 轴网名称侵入标题栏；`wholeSheetLayoutAccepted=false`，只认证两张 PNG 的受限导出场景，图框/整图布局待修复与验收。私有证据为 `runtime/parity-batch-export-1791628307673.json`、`runtime/parity-batch-export-visual-1791628445571.json`。MCP 最终全量 694/694 通过，失败、跳过、取消均为 0；此前全量 692/692 和新增两项后的定向 27/27 也通过。`tests/RegistrationSwitchTests.ps1` 的 10/10 组临时注册夹具通过，不代表真实部署；导出与测试时建筑类型复制的新 DLL 尚未注册，CheckOnly 通过不代表已加载。

2026-10-12：新增只读 `revit_sheet_layout` 已接入图纸版面诊断，按 `ElementOwnerViewFilter` 读取图纸所属 `TextNote` 与 `IndependentTag` 边界，并将未知边界保留为 `unknown`、令 `complete=false`；图框仅参与越界检查，正面积相交仍需独立目视判断。Revit 2027.3 API 隔离编译 0 警告/0 错误，CoreTests 258/258、图纸版面定向 MCP 15/15；完整 MCP 回归在重定向本地 .NET 用户目录后 812 项（811 通过、1 跳过、0 失败）。该能力尚未注册或进行 Revit 实机只读验收，`wholeSheetLayoutAccepted=false` 继续保持。

2026-10-10：families.load 的目录读取后、计划创建后均复核 identity/revision/path/isModified 和可写项目标记。原生预览必须具有非空 planId、pending 状态及一致身份/revision；已知计划只取消一次，取消失败保留主错误并披露 unknown。族加载单元与真实 stdio 模拟契约覆盖目录中途路径变更、保存状态变化和取消失败。此修复只涉及 MCP 层，不加载 RFA、不提交计划、不保存，也不改变新 RFA/replace/回滚尚未原生验收的状态。

## 建筑类型复制

`architecture.build` 和 `architecture.openings` 接受严格 `typeCopies`。每行明确当前项目的 `sourceTypeId`、精确新 `name`、`category` 和两个 `{parameterId,name,valueMm}` 尺寸；类别只允许 `OST_StructuralColumns`、`OST_Doors`、`OST_Windows`。`architecture.openings` 有意允许这三个类别，包括仅复制结构柱类型的计划。不能输入任意参数、路径或推测的宽高字段；名称不自动修剪，类型名拒绝 Revit 禁用字符和控制字符。

生成器在放置操作之前生成 `duplicate_architecture_type`，默认引用为 `@type1`、`@type2`；可使用明确且唯一的 `id` 和只指向此前操作的 `dependencies`。结构柱的 `symbolId` 引用必须对应此前结构柱专用复制；门窗引用必须对应显式匹配类别的专用复制。复制类型不能作为宿主、标高、视图或实例元素引用，同一计划不能修改/删除/通用复制源或新类型、加载族或放置源类型。源保护同时覆盖 numeric `symbolId` 和原生解析后的 `family`/`type` 名称别名，不因操作顺序改变。照明的通用 `typeCopies` 保留原 `duplicate_type` 契约。

桥接要求精确 `architecture-type-copy` 能力。原生预览核对 FamilySymbol、类别/放置方式、名称冲突、两个参数的精确 ID/名称、可写 Double Length 类型及完整源快照。执行只更改新类型；源的身份、激活状态和全部参数以及新类型尺寸在常规事务 `Commit` 前核验，并在 `Commit` 后、事务组仍可回滚且尚未 `Assimilate` 时再次核验。复制门窗的有限 XYZ 以三维距离 1 mm 核对；相对原生创建初始角度的 `rotationDegrees` 增量以规范化角差 1e-6 rad 核对。窗台参数使位置偏离明示 XYZ、未知值或非有限原生证据均失败回滚。

常规事务的完整成功执行回执与未来 `plan.get` 响应在事务组结束前做 UTF-8 封装容量预检，含原生事件预算和换行必须适配 16 MiB 桥接上限；超限拒绝并回滚，不截断业务证据。实际事件捕获保留到 `Assimilate` 后。此保护不覆盖 `StairsEditScope` 和失败回执容量。入口仍只创建一次 pending 计划；聊天确认、执行回执、回滚、人工保存与保存后复查是独立步骤。当前源码已实现，CoreTests 222/222 通过；该新构建已注册并实载。首个柱类型复制测试获准后只提交一次，原生 committed；用户手动保存及关闭重开后已读范围持久化核验通过，新 identity/revision=0、isModified=false，同已核验文件摘要，源 300×450/new 500×500 mm 和 AL1 稳定，`readScopePersistenceVerified=true`。额外原生元素仍未分类，全局 `closeReopenPersistenceVerified=false`、`typeCopyExecutionAccepted=false`、`allModelSideEffectsVerified=false`；完整副作用、异常回滚及全模型安全尚未认证，执行与恢复范围见 `drawing-architecture-parity.md`。

2026-10-10 注册时记录：用户针对建筑类型复制构建具体批准后，单次 Confirm 成功，当时回执为 `REGISTERED_MANUAL_RESTART_PENDING`。当前用户 2027 清单仅切换 Assembly；原字节备份、桥接内容及 ACL、2025 清单、客户端配置和模型基线核验一致，注册回执的独立审查全部通过。没有模型写入、自动保存或自动重启。该注册授权不代替复制/放置等模型计划的独立预览和具体聊天确认。

用户随后手动重启并打开同一测试副本，`mcp/verify-parity-reopen.mjs` 只读探针核验实际模块与 architecture-type-copy 能力已加载，新 PID/identity、revision=0/isModified=false 与重开会话相符。134 项完整范围、29 项柱/轴网范围、236 个实例及 24 个类型集合和完整 schema 两轮读取核验通过，RVT/请求/基线/DLL/清单摘要一致，AL1 位置不变。该加载阶段状态为 `ARCHITECTURE_COPY_LOADED_SAVED_REOPEN_READ_SCOPES_VERIFIED`，私有证据为 `runtime/parity-architecture-copy-reopen-1791635994866.json`。这只认证实载与复制执行前已读范围的保存重开结果；当时 `typeCopyExecutionAccepted=false`，所有模型测试/回滚均待有效预览与具体批准，`wholeSheetLayoutAccepted=false` 的 PNG 版面问题仍待修复。

2026-10-10 手动保存时核验记录（关闭重开前）：用户明确本次柱类型复制已手动保存后，一次运行只读 `mcp/verify-architecture-copy-save.mjs`，状态为 `SAVED_CURRENT_SESSION_COPY_SCOPES_VERIFIED_ADDITIONAL_ELEMENT_UNRESOLVED`。同 identity、revision=1/isModified=false、saved=true，134/29/236/24 既有范围、源族、新类型与额外元素两轮读取一致，类型集合仅新增目标至 25 项；原 committed 收据、源 27 项参数、新类型 b/h≈500 mm 及 AL1 位置不变，新 RVT 摘要前后稳定。私有证据为 `runtime/architecture-type-copy-manual-save-1791641393933.json`；confirmationCalls=0、modelWritesRequested=false、automaticSave=false。

manualSaveVerification=`current-session-verified` 仅认证当前会话保存状态及已读范围，额外元素继续 unresolved；`typeCopyExecutionAccepted=false`、`allModelSideEffectsVerified=false`、`closeReopenPersistenceVerified=false`，回滚仍 pending。其它模型测试与写入须新的有效预览和具体批准，不由保存回复授权；PNG 整图版面仍未验收。

2026-10-10 最新保存重开核验：用户手动关闭并重开后，只运行一次只读 `mcp/verify-architecture-copy-reopen.mjs`，状态 `SAVED_REOPEN_COPY_READ_SCOPES_VERIFIED_ADDITIONAL_ELEMENT_UNRESOLVED`。新文档 identity/revision=0、isModified=false、同已核验文件摘要；134/29/236/24 既有范围、源族、新类型和额外元素的完整 schema 与分页集合两轮一致，源 300×450/new 500×500 mm、源 27 项参数和 AL1 位置不变，类型集合仅增目标至 25 项。私有证据为 `runtime/architecture-type-copy-saved-reopen-1791641871255.json`；旧 committed 计划只从不可变归档离线核对，confirmationCalls=0、planCreationCalls=0、modelWritesRequested=false、automaticSave=false。

`readScopePersistenceVerified=true` 只认证已读取范围的持久化，额外元素仍 unresolved，全局 `closeReopenPersistenceVerified=false`、`typeCopyExecutionAccepted=false`、`allModelSideEffectsVerified=false`，回滚仍 pending；不认证全部文件内容或模型安全，不扩大后续模型写入授权。PNG 整图版面仍 `wholeSheetLayoutAccepted=false`。
