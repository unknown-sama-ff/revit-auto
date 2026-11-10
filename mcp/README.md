# RevitAuto MCP v0.4.0

主使用说明见 `../README-2027.md`。v0.3.5 保留旧版 WorkPlaneBased 灯具的显式 legacyPoint 点位语义，并扩展房间照明场景的开关、回路、导线、图纸和明细表预览。

- revit-custom.mjs：MCP 官方 SDK stdio 服务，受控工具集合，无任意代码执行。
- bridge.mjs：localhost 认证、版本预检查、期限、取消和 UTF-8 分块响应。
- acceptance-run.mjs / acceptance-archive.mjs：`init <taskId>` 仅初始化 run；`audit <runId>` 仅离线检查已提交标准写入归档的 JSON、会话/计划/单次动作绑定、摘要及 PNG 文件头。发现不一致退出码为 1，不连接 Revit、不更改证据或验收状态；只读/未完成/失败回滚 run 不属于此检查配置。详见 `../docs/development-flow.md`。
- acceptance-evidence.mjs：标准写入阶段 JSON 的共享生产函数，也从 acceptance-run.mjs 导出。固定原生预览 payload 摘要、manifest/plan、confirmation/attempt、documentBefore、确认计数及 PNG bytes 字段；只生成数据，不读写文件、连接 Revit、授予批准、取得独占锁或升级验收。调用方仍先持久化 wx attempt 再按原协议单次提交；历史错误不自动修复。详见 `../docs/acceptance-evidence.md`。
- workflows.mjs：照明、建筑、泵房的确定性计划生成器。
- 房间创建回读：`create_room` 需要实际加载 `room-creation-readback`；预览披露原生 level/UV/Z 语义，执行与事务提交前后核对名称/编号、标高/XYZ、正面积和有界 Finish 边界采样证据，失败进入现有回滚路径。代码及隔离编译已验证，具体构建尚未注册/实机验收，见 `../docs/architecture-room-readback.md`。
- 标记引线修正：create_tag显式leader必须为布尔值，并实际加载tag-leader-readback后才派发预览。RoomTag应用该值，RoomTag/IndependentTag按标记/视图/引线在创建及事务提交前后回读；未提供leader保持既有行为。合批构建已注册/实载，显式引线设置仍未完成真实写入验收。
- 同批标记关联修正：所有create_tag预览需实载tag-target-readback；回读唯一原生本地目标、类型、视图和非孤立状态，并在通用参数写入后及提交前后复核。既有inspect提供tagCreation快照，暂不支持的标记明确返回supported=false。代码编译与实机/持久化/视觉验收分开记录，见docs/architecture-room-readback.md和队列。
- 既有RoomTag读取子范围已在run01a18617-e81e-726c-98c4-c8656aab9790通过；所查灯具/配电设备标签类别无样本，IndependentTag和新建标记/引线设置不因此通过。无需重复加载。
- 标记2296196的显式引线true及56项声明范围已保存/重开验证；后续tagPosition原生查询已明确区分TagHeadPosition、通用LocationPoint和HasLeader，并证实头坐标精确匹配原计划。字段未知不替换为坐标或false，远端PNG和端点限制保持。
- 2026-10-30直接TagHeadPosition已实机证明2296196的头坐标与原计划精确一致，只解除该证据疑点；端点及整图PNG未认证。后续标记/尺寸输入修复共用annotation-input-contracts能力：拒绝未知字段、无效可选类型ID及非数组/空白/重复尺寸引用，不静默忽略或自动更正。该新批次Node和DLL都变化，加载时须一次Revit重启＋MCP重载。
- mep-readonly.mjs：泵房审计、碰撞和净距筛查的统一只读工作流适配器；只返回证据，不创建计划。
- diagnostics-query.mjs：把旧版分散查询脚本统一为受控搜索和元素检查入口。每个原生search/inspect绑定本次identity/revision，并要求当前插件的readonly-query-pins能力；内外显式revision都生效，完整文档状态变化或取消立即丢弃结果。严格参数拒绝复用有界拼写提示，不纠正后执行。该Node修正已通过定向/SDK模拟测试，未冒充新增实机验收。
- diagnostic-results.mjs：`diagnostics.query`可选responseMode=summary保留有界只读快照，`diagnostics.result`在同一MCP进程中按页读取。句柄绑定文档状态/插件构建并过期拒绝，不重跑搜索，不补原查询未返回的数据；默认full输出保持，使用与限制见 `../docs/runtime-diagnostics.md`。
- family-text.mjs：现有 `revit_workflow_run` 的 `families.text_notes` 只读工作流，绑定已打开图框族的identity/revision、实际名称及可选精确标题；已知空名必须有标题并加载 `family-text-known-empty-owner`。原生限定100/110条、限量和7类拒绝已通过，当前聊天旧MCP入口待重连；不打开/加载/修改族，集合截断和未知包围盒仍如实保留，详见 `../docs/family-text-readonly.md`。
- document-version-diff.mjs：只读、完整且限量的 Revit 文档版本差异查询，必须绑定当前 document identity/revision 与显式基线 VersionGUID；不读取元素属性、不创建计划或保存。非工作共享模型不提供删除 ID；ID 差异不能证明属性变化因果。基础只读验收已通过，实测记录见 `../acceptance/runs/01a15996-ee18-7e44-8eb5-b784948d1731/`。
- element-dependencies.mjs：独立只读工具 `revit_element_dependencies`，读取有界原生逻辑依赖和 Family 类型成员，保持 inspect schema；严格请求并绑定 identity/revision，未知与已知空分开，每列表最多 4096 ID、请求总 16384 ID、完整响应 2 MiB，超限拒绝不截断。`bounded-element-dependencies` 已实际加载，保存范围及原生逻辑关系两轮核验通过；新类型与附加元素关联已证实，附加元素用途仍 unresolved，不能据此认证无害或完整副作用。
- stair-connections.mjs：新增只读工具 `revit_stairs_connections`，按当前identity/revision与单个stairId读取原生梯段/平台连接及端点类型。固定最多1000组件/4000连接记录/2MiB响应，未知与已知空分开，原始重复/域外/异常记录保留；互认要求两端独立枚举相同关系，不假设记录的存储方向。需要新版DLL能力 `native-stair-connections`，当前仅代码/测试/隔离编译完成，尚未注册加载或实机验收；不创建楼梯、计划、写入、保存或自动重启，不认证整楼梯物理或工程合规。
- element-storage-audit.mjs：独立只读工具 `revit_element_storage_schemas`，读取显式元素已附着的 Extensible Storage schema GUID、解析出的名称/vendor/application/access 与字段类型定义；不读取 Entity 值。绑定 document identity/revision，保留未加载、拒绝访问等未知状态，最多 20 个元素、128 个 schema、512 个字段和 2 MiB 响应；旧插件缺少 `element-storage-schema-audit` 时在原生调用前拒绝。Revit 2027.3 隔离编译、CheckOnly 与契约测试通过；批准构建已注册并实载（MVID `19f843ef-acb0-4fbf-b26d-9ab7ca8043a2`）。楼板 run 中两个 unresolved 系统元素的实载只读查询均完整返回零个附着 schema；这不能证明事务因果或副作用无害，证据见 `../acceptance/runs/01a153b3-fb18-70f1-bf75-bdad34622afe/storage-schema-audit.json`。
- registered-planning.mjs：照明、建筑和电气普通工作流共用的文档/revision 预检及预览复核。
- family-load.mjs：白名单族目录哈希及项目状态绑定，目录后/预览后复核路径和保存状态；异常仅取消已知计划一次并保留主错误，不加载或自动保存。
- electrical-wire.mjs：受控导线替换与开关控制编号；核对旧导线所属视图、开关原值并分批完整检查。详见 `../docs/electrical-wire.md`。
- electrical-circuit.mjs：受控回路成员、开关、配电箱、负荷名称和配电系统适配；分批核对原生范围与已有回路关系。详见 `../docs/electrical-circuit.md`。
- electrical-sheet.mjs：限定既有图纸编号/名称与平面视图名称/比例；drawing-placement.mjs 支持既有视口/表实例移动。AL1 已右移一次并保存于 X=398.5/Y=568 mm，119 项电气快照不变；原生回读、PNG 左侧签字栏重叠消除及保存后重开范围核验通过，禁止重复移动，整体出图验收仍未完成。详见 ../docs/electrical-sheet.md。
- titleblock-change.mjs：单操作图框类型更换，明确实例/图纸/已激活目标类型，披露原生替代实例和依赖；能力已实载，恢复保存范围读回核验通过，独立更换/回滚/保存验收待完成。
- architecture-rules.mjs：结构柱显式既有类型或匹配此前专用复制、底层/顶层/偏移和 XY；轴网显式名称及水平直线，原生几何读回；实机验收待完成。
- architecture-type-copy.mjs：建筑主体/门窗工作流的专用 duplicate_architecture_type，三类既有源、精确新名和两个原生参数 ID/名称/毫米值。源保护覆盖 numeric ID 和原生 family/type 别名；复制门窗核验有限三维位置及相对初始角度的规范化旋转差。建筑复制构建已获具体批准并单次注册实载；随后柱类型复制已获批准单次提交，无实例放置，手动保存及关闭重开的已读范围核验通过。额外元素仍 unresolved，`typeCopyExecutionAccepted=false`，完整副作用、放置及回滚验收待完成。
- view-export.mjs：只读批量高清 PNG，绑定 identity/revision，默认 4096 像素/300 DPI，读取实际文件尺寸；能力已实载，两张图纸的原生 PNG 导出受限场景已核验，版面仍待修复。以上输入和边界见 ../docs/drawing-architecture-parity.md。
- sheet-layout.mjs：只读图纸版面诊断，读取图框、视口内容/标签、普通/配电盘表，以及 TextNote 和 IndependentTag 注释边界；未知几何、集合缺失、跨集合重复 ID 或文档上下文漂移均失败关闭。标题栏只参与越界检查，正面积候选和 PNG 目视验收仍需独立判断。
- sheet-layout-acceptance.mjs：图纸诊断实机只读验收器，固定项目路径、插件 MVID、类别完整 ID 范围和 `diagnoseSheetLayout` 结果；允许重开后的 native identity 变化，禁止计划、确认、保存和生命周期调用。当前实机证据覆盖 `AI-E102-REUSE` 与 `E101`，并保留 `wholeSheetLayoutAccepted=false`。
- drawing-placement.mjs：既有图纸放置移动与单独 `move_viewport_label` 预检。标签操作只接受明确 viewport/sheet/view、未旋转视口、有限标签偏移和可选引线长度；需要 `viewport-label-offset` 能力，提交前后保持视口内容框和图纸关系不变。该能力已完成源码、隔离编译和契约测试，尚未注册或实机验收。
- parameter-import.mjs：表格导入的 explicit/ask/assisted 专用入口；ask 不读来源，候选披露假设，预览后复核 pending 计划及文档状态。
- imports.mjs：受限 CSV/TSV/XLSX/JSON 导入及图纸/图片候选适配器。
- autodesk-read-proxy.mjs：可选官方查询保护代理，默认不接通，需真实 Autodesk 配置。
- health.mjs / runtime-diagnostics.mjs：统一只读运行时诊断，分别报告插件/MCP/文档/族范围及期望与实际值；默认简短JSON，`--evidence`保存完整本地观测。新SDK观测不冒充当前聊天连接已刷新，不执行修复或模型动作，详见 `../docs/runtime-diagnostics.md`。acceptance.mjs保留既有预览/取消验收用途。
- readonly-batch.mjs：把同一插件 MVID、Revit PID、文档 identity/revision 下的显式只读 scope 合并为一个 baseline；每项能力保留独立结果，禁止 workflow/plan/commit/save/restart/lifecycle 写入入口，批次结束复核宿主和文档未漂移。
- tests：SDK、协议、导入与安全回归；不替代实机业务测试。

配置模板是示例。安装脚本合并 Claude/Codex 原配置；桥接凭据留在私有 runtime/bridge.json 中。工具实际使用下划线名称，逻辑 API 内部仍保留点号名称。泵房只读能力可通过统一 `revit.workflow.run` 调用：`pump_room.audit`、`pump_room.collision`、`pump_room.clearance`。

修改前保留预览，由用户在聊天中批准；plan_confirm 和 import_commit 直接执行该计划，没有 Revit 二次确认或额外确认布尔值。后端无法读取聊天授权，须由可信助手/客户端核实。

2026-10-10：恢复版 DLL 已加载 `controlled-titleblock-change`、`controlled-structural-columns`、`explicit-grid-geometry` 和 `batch-view-image-export`；保存后重开核验通过，134 项完整原生范围和 29 项柱/轴网范围一致，私有证据见 `runtime/parity-postregistration-reopen-verified-1791626912602.json`。这些范围核验不代表四项分支已完成独立写入或导出验收。

2026-10-10：原生只读批量导出 `AI-E102-REUSE`（4096×2893）和 `E101`（4096×2896），请求 300 DPI；唯一 PNG 映射、完整解码和非空内容核验通过。导出前后 134 项完整范围、29 项柱/轴网范围、identity/revision/isModified 与 RVT 文件摘要一致，递归规范化只将 -0 转为 0，保留全部字段和顺序。AL1 已避开左侧签字栏，但右侧 notes/legend 仍重叠；E101 的 AI-ARCH 轴网名称侵入标题栏。`wholeSheetLayoutAccepted=false`，仅认证这两张 PNG 的受限导出场景，图框和整图布局尚未验收。私有证据为 `runtime/parity-batch-export-1791628307673.json` 和 `runtime/parity-batch-export-visual-1791628445571.json`。

2026-10-13：图纸诊断新版构建已实载并完成两张图纸的只读验收。`AI-E102-REUSE`（2296031）与 `E101`（1042869）均为 complete=true、unknown geometry=0、intersection candidates=0；E102 越界=0，E101 越界=1。revision=0、isModified=false、isReadOnly=false，类别范围和完整 context 前后稳定；本次没有计划、确认、保存或生命周期调用。证据为 `acceptance/sheet-layout-AI-E102-REUSE-20261013.json.verified.json` 和 `acceptance/sheet-layout-E101-20261013.json.verified.json`。整图 PNG 视觉状态仍 `wholeSheetLayoutAccepted=false`。

后续建筑类型复制构建在常规事务 `Commit` 前和 `Commit` 后、事务组仍可回滚且尚未 `Assimilate` 时核验建筑复制/放置结果。完整成功执行回执及未来 `plan.get` 的 UTF-8 响应含事件预算和换行须适配 16 MiB 桥接上限，超限在事务组结束前拒绝并回滚；实际原生事件保留到 `Assimilate` 后捕获。该容量保护不覆盖 `StairsEditScope` 或失败回执。CoreTests 222/222 通过；此构建已注册并实载，保存重开的已读范围核验通过，未完成复制模型实机验收。

此前建筑复制构建阶段 MCP 全量 694/694 通过，失败、跳过、取消均为 0；`tests/RegistrationSwitchTests.ps1` 的 10/10 组临时注册夹具通过。建筑类型复制 DLL 的 CheckOnly 通过，测试时尚未注册；随后用户具体批准，单次 Confirm 成功，当时注册回执为 `REGISTERED_MANUAL_RESTART_PENDING`。仅切换当前用户 2027 清单 Assembly，备份、桥接及 ACL、2025/客户端配置和模型基线核验一致，注册回执的独立审查全部通过；没有模型写入、自动保存或自动重启。

用户手动重启后，`mcp/verify-parity-reopen.mjs` 只读探针已验证新模块与 architecture-type-copy 能力实载、新会话 identity/revision=0/isModified=false，134 项完整范围、29 项柱/轴网范围、236 个实例与 24 个类型集合及完整 schema 两轮核验通过；RVT、请求、基线、DLL 和清单摘要一致，AL1 位置不变。该阶段核验状态为 `ARCHITECTURE_COPY_LOADED_SAVED_REOPEN_READ_SCOPES_VERIFIED`，私有证据为 `runtime/parity-architecture-copy-reopen-1791635994866.json`。`typeCopyExecutionAccepted=false`；当时复制、放置、回滚等模型测试尚待各自有效预览及具体聊天批准，PNG 版面未验收；其后单次复制与保存核验及最新构建状态见下文。

2026-10-10 后续柱类型复制已经单次提交，用户手动保存及关闭重开后的完整已读范围两轮核验通过，`readScopePersistenceVerified=true`；该结论仅限已读取范围。源 27 项参数、134 项完整范围、29 项柱/轴网、236 个实例和 24 个旧类型不变，类型分页仅增加一个目标新类型。原生事件的附加元素仍 unresolved，全局 `closeReopenPersistenceVerified=false`、`typeCopyExecutionAccepted=false`、`allModelSideEffectsVerified=false`，rollbackVerification 仍 pending；不重复 Confirm 或移动 AL1。

2026-10-10 独立只读依赖查询源码双审、CoreTests 233/233、MCP 全量 714/714 通过。首次隔离编译因默认 API 路径不存在失败；纠正为本机实际 Revit 2027.3 API 后为 0 警告、0 错误，CheckOnly 通过，两份日志保留。新保存模型 fresh baseline 和拟用清单只读独立审查通过，当时注册申请为 PREPARED；随后本次具体申请已获用户明确批准，仅 Confirm 一次成功，当时为 `REGISTERED_MANUAL_RESTART_PENDING`。当前用户 2027 清单只切换 Assembly，原字节备份、受保护配置和模型保存基线核验一致；没有模型写入或自动保存/重启。用户随后手动重启，当前模块与获准构建匹配，能力及已保存范围读取通过，状态 `ELEMENT_DEPENDENCIES_LOADED_SAVED_SCOPES_AND_NATIVE_RELATION_READS_VERIFIED`。

`revit_element_dependencies` 只接受 `documentIdentity`、显式 `expectedRevision` 和 1..20 个唯一正安全整数 `elementIds`，MCP/原生均拒绝未知字段及非法值，原生另拒绝重复 JSON 字段。原生 UI 线程冻结结果并前后检查文档状态，MCP 严格复核响应及前后 context；没有事务、删除探测、激活、计划创建/确认、保存或文档打开路径。响应固定 `relationshipScope=native-logical-dependents-and-family-symbol-membership`、`modelWritesRequested=false`、`automaticSave=false`、`allModelSideEffectsVerified=false`。四根关系响应和33项关系范围两轮核验一致，源族成员包含源/新类型，新类型与附加元素相互列入原生依赖；`nativeRelationshipVerified=true`，`additionalElementPurposeVerified=false`、baselineAvailable=false、classification=unresolved。关系证据不能认证额外元素无害、全部依赖图、净模型差异或回滚，不能补出复制前基线。详见 `../docs/drawing-architecture-parity.md`。

用户已批准仅当前本地测试副本的自动保存/重启设计。`document-lifecycle.mjs` 提供固定预览、状态、索引范围核验和单次保存/退出/打开；`local-test-copy-supervisor.mjs` 与 `tools/test-copy-restart.ps1` 负责备份、原进程自然退出、新进程握手和跨进程许可。实现、最终隔离验证及具体构建独立复核已完成；最终具体申请已获批准并单次注册，回执为 REGISTERED_MANUAL_RESTART_PENDING，等待首次人工重启后的实载核验。尚未执行生命周期动作。使用说明与限制见 `../docs/local-test-copy-lifecycle.md`；既有模型计划和只读依赖接口不附带自动保存。

照明、建筑主体/房间/门窗/图纸、电气回路/导线/图纸工作流均支持 `explicit`、`ask` 和 `assisted`。`ask` 只返回问题；`assisted` 必须列出非空假设，结果为候选预览。空范围、未知顶层字段和工作流中的 `input.operations` 会被拒绝。需要直接提交结构化操作时，使用独立的 `revit.plan.create` 预览入口，仍需聊天确认才能执行。详见 `../docs/registered-planning.md`。

identity-acceptance.mjs / acceptance-helpers.mjs：五次稳定 identity 检查、严格项目副本校验、写入／回滚预览和精确电气快照核验。不自动提交计划。lighting.full 已有一个明确点位灯具接入既有配电箱的新回路创建及保存后受限验收证据；完整旧版照明场景和全部兼容路径仍须逐项验收，见 `../docs/goal-progress.md`。

连接器的 connected 属性可能不可查询；connectionStatusSupported=false 时状态为未知，不是 false/未连接。参数、端口坐标和电气系统关系仍返回。


预览的有效期以原生expiresAtUtc为准。v0.3.6默认给聊天确认120分钟，可在私有bridge配置中将planLifetimeMinutes设为15..480整数分钟。更长等待不会放宽文档/修订号校验，也不会自动确认或复活过期计划；旧DLL尚未重启时仍保留原有15分钟行为。

## 源码许可

当前新增原创部分适用 [RevitAuto 非商业源码许可协议 1.0](LICENSE)，商业用途须事先书面授权；历史 Apache 与第三方权利保留。详见 [许可边界](../LICENSING.md)。
