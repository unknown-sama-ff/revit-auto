> 发布副本说明：本机路径、模型名称及运行标识已匿名化。原始私有证据未随源码发布；历史验收不代表当前会话授权或完整业务认证。

# 图纸和建筑能力迁移补齐

## 只读图纸版面诊断（已注册并完成实机只读验收，整图视觉验收未完成）

新增 `revit_sheet_layout`，通过明确的 `documentIdentity`、`expectedRevision` 和 `sheetId` 读取一张图纸的原生范围、图框、视口内容/标签边界、普通明细表和配电盘表边界，以及图纸上的 `TextNote` 与 `IndependentTag` 注释边界。原生查询前后固定文档会话、revision、路径及保存/只读状态；未知边界保持 `unknown` 并令诊断 `complete=false`。MCP 仅将放置实例之间的正面积矩形相交报告为候选，边缘相切不算相交；标题栏边界只用于越界检查，不参与实例相交，以免整张图框与所有图纸内容形成伪候选。注释实例要求保留原生类别和明确 kind，不支持的类别、缺失集合或跨集合重复 ID 均失败关闭。

2026-10-26 补充：历史 `outOfSheet` 实际相对 `ViewSheet.Outline`，其范围可能包络越过图框的内容；新版本保留该字段并增加 `outOfSheetBoundary` 明示来源。独立 `titleBlockContainment` 才比较唯一、已知且非退化的原生图框BBox；无/多/未知图框返回unknown，不猜边界。该BBox不是纸张可打印区或内部可用内容区；旧complete或空数组不能证明整图通过。新实现、回归与当前入口加载状态见文末。

该诊断不写模型、不保存、不创建计划，不认定轴网/文字标签的边界，也不替代 PNG 导出和目视验收。它不判断图框内部的可用内容区，不会自动修复任何重叠。Revit 2027.3 API 隔离编译已完成（0 警告、0 错误）；CoreTests 258/258 和图纸版面定向 MCP 15/15 已通过。新版构建已注册并实载，MVID 为 `cffd0d77-6aac-49e4-a2e8-41260bb56e35`，`sheet-layout-diagnostics` 能力已加载。

2026-10-13：当前测试副本 `sample-lighting-model-验收-v031.rvt` 完成两张图纸的实机只读诊断。`AI-E102-REUSE`（sheetId `2296031`）与 `E101`（sheetId `1042869`）均在同一实载模块、revision=0、`isModified=false`、`isReadOnly=false` 下读取；完整 19 类别 ID 范围、文档状态、活动视图和选择集前后稳定。两张报告均 `complete=true`、unknown geometry 为 0、intersection candidates 为 0；`AI-E102-REUSE` 越界为 0，`E101` 越界为 1。证据为 `acceptance/sheet-layout-AI-E102-REUSE-20261013.json.verified.json` 和 `acceptance/sheet-layout-E101-20261013.json.verified.json`。本次没有 plan/confirm/save/lifecycle 调用，`wholeSheetLayoutAccepted=false` 继续保留。

2026-10-13：新增受控 `move_viewport_label` 操作，用于单独调整既有未旋转视口的 `Viewport.LabelOffset`，可选显式调整 `LabelLineLength`；不移动视口内容框，不修改图纸、视图比例、图框或模型元素。操作要求明确 viewport/sheet/view 三个原生 ID、有限毫米偏移、完整标签边界、未固定且可写文档，并在事务提交前与提交后核对偏移、引线长度、内容框、类型、旋转和图纸关系。Revit 2027.3 隔离编译 0 警告/0 错误，CoreTests 267/267，视口标签/图纸定向 MCP 100/100；新 DLL 尚未注册或实机加载，`E101` 的越界标签仍未修复，`wholeSheetLayoutAccepted=false` 保持。

2026-10-14：视口标签构建已实载并完成 E101 三次受控调整与保存后核验。最终保存状态 revision=3、`isModified=false`；viewport `2290439` 的 `LabelOffset=(20,-25,0) mm`、引线长度 `100 mm`、内容框中心/边界、类型、旋转和图纸关系保持正确。保存后 `revit_sheet_layout` 报告 `complete=true`、unknown=0、out-of-sheet=0、intersection candidates=0；E101 PNG 4096×2896 导出成功。证据仍只认证该视口标签和 E101 的受限范围；右侧 `AI-ARCH` 轴网文字侵入标题栏，`wholeSheetLayoutAccepted=false` 继续保留。

以下能力已接入新版受控接口，保留 Revit 2027.3/.NET 10、文档身份和 revision、预览、具体聊天确认、单事务及不自动保存的边界。2026-10-10 恢复版注册后实际加载结构柱、轴网、图框更换和批量导出四项能力，134 项完整原生范围及 29 项柱/轴网范围保存重开核验通过；随后两张图纸原生 PNG 导出受限场景通过。建筑类型复制构建也获准单次注册并实载。其后的具体柱类型复制测试已获用户批准且只 Confirm 一次，原生计划 committed；用户手动保存及关闭重开后，新类型尺寸、源/既有范围和已保存文件摘要的只读复查通过，新文档 identity、revision=0、isModified=false，`readScopePersistenceVerified=true`。额外新增原生 Element 分类仍 unresolved，`typeCopyExecutionAccepted=false`、`allModelSideEffectsVerified=false`、全局 `closeReopenPersistenceVerified=false`；实例放置、回滚、完整副作用及整图版面仍未验收，已读范围持久化通过不代表全部文件或模型安全。

`AI-E102-REUSE` 的 AL1 表格已经右移一次并保存，纸面 X=398.5、Y=568 mm；119 项电气快照保持一致。保存后重开核验已通过，禁止重复执行该移动或在当前位置再累加 30 mm。此受限范围证据不认证整张图纸质量或全部模型副作用。

最新只读元素依赖查询构建已获本次具体批准并单次注册，用户手动重启后的实载、保存范围和原生关系读取核验通过，状态为 `ELEMENT_DEPENDENCIES_LOADED_SAVED_SCOPES_AND_NATIVE_RELATION_READS_VERIFIED`。实际模块指纹匹配获准构建，`bounded-element-dependencies` 已加载；源族包含源/新类型，新类型与额外元素的原生逻辑关联得到证实，`nativeRelationshipVerified=true`，但 `additionalElementPurposeVerified=false`，分类仍 unresolved。CoreTests 233/233、MCP 全量 714/714、实际 Revit 2027.3 API 隔离编译及 CheckOnly 的历史成绩保留，关系证据不升级全部模型验收。

## 批量高清 PNG

只读工具 `revit_view_export_images` 接受明确 `documentIdentity`、`expectedRevision` 和 1..20 个唯一 `viewIds`。`pixelSize` 为 600..8192 的整数，默认 4096；`resolutionDpi` 为 72/150/300/600，默认 300。每次使用新的受控本地导出目录，不接受任意文件路径。

导出前完整验证所有视图，之后逐图导出 PNG 并读取实际宽高、文件大小和视图/文件映射。身份、revision、路径及保存状态在全过程复核。部分失败保留已完成文件证据，不自动重试。`batch-view-image-export` 缺失时旧插件拒绝该请求。

2026-10-10 已通过当前实载插件只读批量导出 `AI-E102-REUSE` 和 `E101`，请求 4096 像素、300 DPI，实际 PNG 分别为 4096×2893 与 4096×2896。两张图纸各对应唯一 PNG，完整解码及非空内容检查通过。导出前后 134 项完整原生范围、29 项柱/轴网范围、文档 identity/revision/isModified 及 RVT 文件哈希不变。范围比较仅递归将负零 `-0` 规范化为 `0`，保留所有字段和列表顺序，不删除几何或投影证据。私有证据为 `runtime/parity-batch-export-1791628307673.json` 与 `runtime/parity-batch-export-visual-1791628445571.json`。

PNG 目视确认 AL1 已避开左侧签字栏，但 `AI-E102-REUSE` 右侧 notes/legend 文字仍有重叠；`E101` 的 AI-ARCH 轴网名称侵入标题栏。因此 `wholeSheetLayoutAccepted=false`，只认证这两张图纸的原生 PNG 导出受限场景，不认证图框更换、完整高清导出能力或整图版面。修正版面须另行生成明确预览并获得聊天确认。

## 图框更换

`electrical.sheet` 与 `architecture.documentation` 支持 `titleBlockChanges`，只允许一行 `{titleBlockInstanceId,sheetId,targetTypeId}`，并要求更换是计划唯一操作。目标为当前项目已激活的 ViewBased 图框 FamilySymbol；拒绝固定、只读、原生类型无效及依赖/位置/图纸归属证据不完整的实例。

预览披露旧/新类型、位置、旋转、完整有界依赖和图纸图框集合。Revit `ChangeTypeId` 可能替换实例，因此执行回执披露原/新 ID 和替代情况。执行后重新核验目标类型、归属、原位置/旋转及图纸图框集合；已有依赖被删除会使事务回滚。没有删除重建图纸或隐式激活类型。需 `controlled-titleblock-change` 能力。更换后图框字段、尺寸、版面与实机回滚/保存仍待验收。

## 结构柱和轴网

`architecture.build.columns` 每行明确既有或此前专用复制的 `symbolId`、既有 `baseLevelId`/`topLevelId`、`baseOffsetMm`、`topOffsetMm` 和 `{xMm,yMm}` 的 `point`，可选 `rotationDegrees`。只支持 OST_StructuralColumns 的 TwoLevelsBased 类型；顶层必须高于底层，偏移后净高度至少 1 mm。不猜类型或高度；尺寸复制使用下述独立操作。若放置类型未激活，原生预览披露激活，回执记录实际激活写入。类型、底/顶约束、偏移、位置与旋转回读不一致会回滚。需 `controlled-structural-columns` 能力。

轴网创建要求显式唯一名称、水平直线端点；拒绝未知字段、同计划重名、现有名称冲突和原生短曲线。执行后核对名称和端点。`revit.inspect` 的 `architecture` 字段读取原生直线或圆弧完整几何，未知曲线保持明确不可用。圆弧读回不代表圆弧创建已实现。轴网新门禁为 `explicit-grid-geometry`。柱/轴网原生写入、回滚及保存后验收仍待推进。

## 受控建筑类型复制

`architecture.build.typeCopies` 和 `architecture.openings.typeCopies` 使用专用 `duplicate_architecture_type`，需要已加载的 `architecture-type-copy` 能力。每行只有既有 `sourceTypeId`、精确新 `name`、类别以及恰好两个 `{parameterId,name,valueMm}` 尺寸，另可声明 `id`/`dependencies`。源 ID 为正安全整数；参数 ID 为非零有符号安全整数，允许真实负值内置 ID。尺寸值为有限正毫米值且不超过 100000000。参数 ID、原生名称均必须唯一；不得猜测 b/h、宽度、高度或沿用旧脚本固定尺寸。

支持类别为 `OST_StructuralColumns`、`OST_Doors`、`OST_Windows`。结构柱源必须为 TwoLevelsBased；门窗源必须为 OneLevelBasedHosted。`architecture.openings` 允许全部三个类别的复制，结构柱复制后放置使用 `architecture.build.columns`。原生参数 ID 和名称必须唯一指向同一可写、有值、无全局参数关联的 Double Length 参数；公式、未知值、不可读完整快照和已存在新名称会拒绝预览。控制字符和周围空白被拒绝；新类型名另拒绝 Revit 禁用字符。

生成器先复制后放置；`@type1` 或自定义 `@id` 只可用作此前同类别复制的放置 `symbolId`。新类型不能充当宿主、标高、视图或实例元素。计划禁止对复制源/新类型执行参数修改、删除或通用复制，禁止同计划族加载，以及放置源类型可能导致的激活写入。源保护覆盖 numeric `symbolId` 和原生解析后的 `family`/`type` 名称别名，且与放置操作在复制前后的顺序无关。通用灯具类型复制保持原行为。

执行前捕获所有源的完整参数和激活状态，之后只写新类型的两个尺寸。回执包含源前后快照、尺寸写入及原生回读；计划全部操作完成并 Regenerate 后核对所有源、所有新类型的类别/名称/身份/放置方式和尺寸，尺寸容差为 0.01 mm。复制门窗要求有限三维位置和原生旋转，位置与明示 XYZ 的三维距离不得超过 1 mm；`rotationDegrees` 表示相对创建后原生初始角度的增量，以规范化角差核对，容差为 1e-6 rad。未知或非有限证据拒绝认证；窗台参数造成明示位置偏移也会失败回滚。

常规事务在 `Commit` 前核验，并在 `Commit` 的原生重生成/失败处理完成后、事务组仍可回滚且尚未 `Assimilate` 时再核验一次。专用复制操作不请求激活；后续明确放置可以激活新类型并披露实际变化。源快照每类型最多 2048 参数，整体重复预览证据预算为 2 MB，超限拒绝而不截断。常规事务另预检完整成功执行回执和未来 `plan.get` 的 UTF-8 响应封装，包含事件证据预算与换行后必须适配 16 MiB 桥接上限；超限在事务组结束前拒绝并回滚，实际原生事件仍捕获到 `Assimilate` 完成后。此容量保护不覆盖 `StairsEditScope` 或失败回执，也不是所有响应均可交付的承诺。建筑复制构建阶段 CoreTests 222/222 通过；该构建已注册、实载及保存重开的已读范围核验通过，源码保护和只读范围核验不构成复制模型验收。该阶段复制/放置、强制失败回滚及人工保存复查尚待执行；之后的单次复制与保存核验见下述历史记录，最新测试与注册状态见本文件开头及文末。

## 最小注册切换

`v27/registration-switch.ps1 -Mode Prepare` 生成私有拟用清单和请求，仅替换 Assembly 字段的拟用值，绑定 DLL SHA-256/MVID、现行清单、保存后基线及受保护配置快照。请求 SHA-256 从 Prepare 摘要独立审阅；Confirm 必须携带该固定 `-ExpectedRequestSha256` 和具体部署的聊天批准，不能执行前现算摘要代替已审阅值。

Confirm 使用稳定请求 ID 的单次 attempt、原字节清单备份、排他写入及哈希/结构回读；仅更新当前用户 2027 注册。桥接凭据和 ACL、2025 清单及客户端配置保持一致，异常留下收据且不重试。注册成功本身只表示等待手动重启，不表示 DLL 已加载。2026-10-10 此次恢复版切换已在手动重开后核验匹配构建、四项能力及保存范围；后续建筑类型复制构建在此前测试时保持隔离、尚未注册。新查询增加图框字段的证据按 schema 单列核对，不能通过删除字段宣称整份快照相等。

此前建筑复制构建阶段 MCP 全量 694/694 通过，失败、跳过、取消均为 0；`tests/RegistrationSwitchTests.ps1` 的 10/10 组临时注册夹具通过。新建筑类型复制 DLL 的 CheckOnly 通过，随后用户具体批准注册并仅 Confirm 一次成功；当时注册回执为 `REGISTERED_MANUAL_RESTART_PENDING`。原清单备份、当前清单仅 Assembly 切换、桥接及 ACL、2025 清单、客户端配置和模型基线一致，注册回执的独立审查也全部通过。没有模型写入、自动保存或自动重启。模拟夹具、注册成功与源码测试不替代复制模型验收。

## 建筑类型复制加载与保存重开核验

用户手动重启并打开同一测试副本后，`mcp/verify-parity-reopen.mjs` 只读探针核验实际模块指纹与获准构建一致，`architecture-type-copy` 能力已加载；PID 和文档 identity 是新会话，revision=0、isModified=false。134 项完整原生范围、29 项柱/轴网范围、236 个实例和 24 个类型集合及完整 schema 的两轮读取核验全部通过，RVT、注册请求、基线、DLL 和注册清单摘要一致，AL1 保存位置不变。证据为私有 `runtime/parity-architecture-copy-reopen-1791635994866.json`，状态为 `ARCHITECTURE_COPY_LOADED_SAVED_REOPEN_READ_SCOPES_VERIFIED`。

探针不提交模型计划，不自动保存；此证据只认证新 DLL 实载和已读取范围的保存重开结果。`typeCopyExecutionAccepted=false`，复制/放置、强制失败回滚、图框更换等模型测试仍须各自生成有效预览并取得具体聊天批准；`wholeSheetLayoutAccepted=false` 和两张 PNG 的版面问题保持不变。

## 单操作柱类型复制测试预览（执行前历史记录）

`mcp/prepare-architecture-copy-test.mjs` 按旧 `architecture.csx` 已明确的 300×450→500×500 mm 测试意图，精确匹配既有 `混凝土-矩形-柱` 的 `300 x 450 mm` 类型，生成一个 `duplicate_architecture_type` 预览。新类型名为 `AI-PARITY-COLUMN-500x500-TEST`，原生 b=300/h=450 mm 复制后改为 b=h=500 mm。仅复制新类型，没有放置实例；该明确测试尺寸不作为其它模型的默认尺寸。

源类型 27 项参数完整读取，134 项完整范围、29 项柱/轴网范围、236 个实例、24 个类型集合及源族完整 schema、已绑定摘要、文档状态和桥接指纹前后核验一致。证据为私有 `runtime/architecture-type-copy-preview-1791636415385.json`，状态为 `TYPE_COPY_PREVIEW_ONLY_COMPLETE_READ_SCOPES_VERIFIED`；plan.create=1、plan.confirm=0，预览返回 pending，没有模型写入或保存。具体聊天批准仍待用户，独立实际预览证据审查通过；有效期截至北京时间 2026-10-10 22:46:57。执行前须再次核对有效期、身份/revision 与原生基线。

`typeCopyExecutionAccepted=false`。预览、源参数可读和前后范围一致不能认证复制执行、源类型保护或回滚；这些仍须批准后单次提交并独立读取原生结果，人工保存后复查。注册授权不代替本次模型预览的批准，PNG 整图版面仍未验收。

## 已批准柱类型复制的单次提交与只读恢复（保存前历史记录）

用户明确批准“确认执行柱类型复制测试”后，原计划只 Confirm 一次，原生 committed、完成一项复制操作，没有实例放置。提交后的本地验收器误读 `architectureCopyVerification` 外层包装，在 `undefined !== 1` 处停止；另一次只读恢复误把最多 400 项的 context 类型样本当完整类型集合而停止。修正嵌套读取和样本边界后定向回归 6/6 通过，原执行证据保持原字节，不重新提交、不把验收器读取错误当原生回滚。完整只读恢复使用分页类型集合与新类型独立 inspect 验证。

新目标类型的族、名称、结构柱类别及 TwoLevelsBased 放置方式与预览一致，b/h 原生读回约 500.00000000000006 mm（0.01 mm 容差内）；源类型完整 27 项参数和激活状态不变。既有 134 项完整范围、29 项柱/轴网范围、236 个实例、24 个旧类型及源族完整 schema 一致，类型集合只增加目标类型至 25 项，AL1 保存位置不变。原生事件捕获记录目标类型和一项额外 Element 新增，无修改或删除；额外元素虽同名，但类别、有效 owner view、与复制类型的关联及用途均未获证实，保持 `unresolved`，不能把它猜作已知副作用。

原执行证据为私有 `runtime/architecture-type-copy-execution-10310f25cbc69db629bcb1db01c7e021.json`；完整恢复证据为 `runtime/architecture-type-copy-readback-1791638159095.json`，状态 `COPY_PRIMARY_AND_EXISTING_SCOPES_VERIFIED_ADDITIONAL_ELEMENT_UNRESOLVED_MANUAL_SAVE_PENDING`。后续只读续接证据 `runtime/architecture-type-copy-resume-1791638428447.json` 确认源/新/额外元素、原 committed 计划及磁盘摘要仍一致，状态 `COPY_RESUME_STATE_UNCHANGED_MANUAL_SAVE_PENDING`。原提交 confirmationCalls=1，恢复均 confirmationCalls=0、modelWritesRequested=false；原证据绑定摘要已离线复核。

当时 revision=1、isModified=true，RVT 磁盘摘要与提交前相同，尚未保存本次复制结果，等待用户手动保存并回复“柱类型复制已保存”；该历史阶段尚未收到回复或运行保存核验。`typeCopyExecutionAccepted=false`、`allModelSideEffectsVerified=false`，当时人工保存复查、额外元素归属和强制失败回滚均待核验；实例放置及其它模型测试须另行有效预览和具体批准。没有自动保存或重复 Confirm，`wholeSheetLayoutAccepted=false` 的 PNG 版面问题保持不变。

## 柱类型复制手动保存后的当前会话范围核验（关闭重开前历史记录）

用户明确确认本次柱类型复制已手动保存后，仅运行一次 `mcp/verify-architecture-copy-save.mjs` 只读保存探针，状态为 `SAVED_CURRENT_SESSION_COPY_SCOPES_VERIFIED_ADDITIONAL_ELEMENT_UNRESOLVED`。同一文档 identity、revision=1，isModified=false；`verification.saved` 返回 saved=true。原 committed 计划/收据及原执行证据绑定摘要未变，confirmationCalls=0、modelWritesRequested=false、automaticSave=false，没有新建计划、重复提交或自动保存。

完整 134 项范围、29 项柱/轴网范围、236 个实例、24 个旧类型、源族、新类型和额外元素的两轮原生读取均与提交后证据一致。分页集合仍仅增加目标类型至 25 项，源 27 项参数和新类型 b/h≈500 mm、AL1 保存位置保持一致。手动保存后的新 RVT 文件摘要与保存前不同，但在本次探针前后稳定；已离线复核固定证据绑定和当前文件摘要。私有证据为 `runtime/architecture-type-copy-manual-save-1791641393933.json`，manualSaveVerification=`current-session-verified`。

这仅认证当前会话无待保存修改、已读范围和本次已保存文件摘要稳定，不认证磁盘全部内容或关闭重开持久性。额外元素继续 `unresolved`，`typeCopyExecutionAccepted=false`、`allModelSideEffectsVerified=false`、`closeReopenPersistenceVerified=false`；强制失败回滚仍 pending。实例放置、额外元素关联核验和其它模型测试仍须有效预览及具体批准，`wholeSheetLayoutAccepted=false` 的 PNG 版面问题保持不变。

## 柱类型复制关闭重开后的已读范围持久化核验

用户手动关闭并重新打开同一测试副本后，仅运行一次只读 `mcp/verify-architecture-copy-reopen.mjs`，状态为 `SAVED_REOPEN_COPY_READ_SCOPES_VERIFIED_ADDITIONAL_ELEMENT_UNRESOLVED`。新的文档 identity、revision=0/isModified=false 符合重开会话；RVT 文件摘要与已核验的手动保存文件相同，在本次读回前后稳定。原会话 committed 计划只从不可变证据离线核对，没有读取、重建或提交旧会话计划；confirmationCalls=0、planCreationCalls=0、modelWritesRequested=false、automaticSave=false。

134 项完整范围、29 项柱/轴网范围、236 个实例、24 个旧类型、源族、新类型及额外元素均与手动保存证据一致，完整 schema 和分页集合两轮核验通过，类型集合仍仅新增目标类型至 25 项。源类型仍为 300×450 mm，目标新类型为 500×500 mm，AL1 保存位置不变。固定保存证据绑定、完整已读范围、原计划归档及当前 RVT 摘要已离线复核；私有证据为 `runtime/architecture-type-copy-saved-reopen-1791641871255.json`。

`readScopePersistenceVerified=true` 仅认证这些已读取范围的保存重开持久化。额外元素仍 `unresolved`，全局 `closeReopenPersistenceVerified=false`、`typeCopyExecutionAccepted=false`、`allModelSideEffectsVerified=false`，rollbackVerification 仍 pending；不宣称全部文件内容、全模型副作用或额外元素用途已安全。其它模型测试及写入继续需要新的有效预览和具体批准，PNG 整图版面仍 `wholeSheetLayoutAccepted=false`。

## 受控只读元素依赖查询与本次注册状态

独立 MCP 工具 `revit_element_dependencies` 对应逻辑 API `revit.element.dependencies`，使用 `bounded-element-dependencies` 能力门禁，保留既有 inspect 快照 schema。严格请求只包含 `documentIdentity`、`expectedRevision` 和 `elementIds`：identity 非空且最多 200 字符，revision 为显式非负安全整数，元素为 1..20 个唯一正安全整数。MCP 和原生拒绝未知字段及非法值，原生另拒绝重复 JSON 字段；不把字符串 ID 转为数值。未实载该能力的旧插件在查询发送前拒绝。设计详见 [受控只读元素依赖证据](superpowers/specs/2026-10-10-element-dependencies-design.md)。

`dependencies` 只读取原生 `GetDependentElements(null)`；`familySymbols` 仅对 Family 读取 `GetFamilySymbolIds()`。每集返回 supported、complete、ids、count、truncated=false 和必要的 reason，族成员另返回 applicable。已知空集合是 supported=true、complete=true、count=0；缺失、不支持或非 Family 的成员查询保留 supported=false、complete=false、ids=[]、count=null 和明确原因。缺失元素 summary=null，未知类别保持未知，原生 typeId/ownerViewId/levelId 的真实负值不改为默认值。列表排序且唯一，保留 API 自引用；只有明确 NotSupportedException 降级，未知异常与取消传播。

每列表最多 4096 ID、一个请求的全部 dependencies 和 familySymbols 返回列表长度合计最多 16384，跨列表重复仍计数，查询不递归扩展依赖图。完整原生成功响应封装含 CRLF 不超过 2 MiB；超限拒绝而不截断，原生另有 20 秒协作读取预算检查，不承诺硬中断每个 API 调用。原生在 UI 线程冻结 JSON，并前后核对文档 identity/revision/path/isModified/isReadOnly/IsModifiable；MCP 再核对前后 context 和严格响应结构、数量、顺序、完整性及固定声明。工具声明 readOnlyHint=true、destructiveHint=false，没有事务、删除探测、类型激活、计划创建/确认、保存或打开文档路径。响应固定 `relationshipScope=native-logical-dependents-and-family-symbol-membership`、`modelWritesRequested=false`、`automaticSave=false`、`allModelSideEffectsVerified=false`。

2026-10-10 源码双审通过，CoreTests 233/233、MCP 全量 714/714 通过。首次编译因默认 API 路径不存在失败；改用本机实际 Revit 2027.3 API 后隔离编译 0 警告、0 错误，CheckOnly 通过，两份日志均保留。新保存模型 fresh baseline 和拟用清单的只读独立审查通过；该阶段注册申请为 PREPARED，未改变运行 DLL 或注册。

随后用户明确批准本次具体注册申请，父代理仅 Confirm 一次成功，当时回执为 `REGISTERED_MANUAL_RESTART_PENDING`。当前用户 2027 清单只切换 Assembly，原字节备份和受保护配置、保存基线核验一致；没有模型写入、自动保存、自动关闭或重启。该历史阶段等待用户手动重启并打开同一已保存测试副本后核验实际模块、能力和完整已读范围，当时运行中仍是先前建筑复制构建；本次实载结果见下文。

注册完成时本接口尚无真实原生关系证据。关系读取不能证明附加元素无害、完整依赖图、净模型差异或回滚，也不能补出复制前的附加元素基线；下述已完成实载核验仍保留这些边界。

## 只读依赖查询实载、已保存范围与原生关系核验

2026-10-10 用户手动重启后，只读核验实际模块指纹与本次获准 DLL 一致、`bounded-element-dependencies` 已加载。新会话 revision=0、isModified=false，前后文档状态及 RVT 文件摘要稳定；完整 134 项范围、29 项柱/轴网、236 个实例、24 个旧类型、源族、新类型和额外元素两轮读取与已保存基线一致。源 27 项参数和 AL1 绝对位置 X≈398.5/Y≈568 mm 不变。私有证据为 `runtime/element-dependencies-loaded-1791644043265.json`，状态 `ELEMENT_DEPENDENCIES_LOADED_SAVED_SCOPES_AND_NATIVE_RELATION_READS_VERIFIED`，`loadedModuleVerified=true`、`savedReadScopesVerified=true`、`readScopePersistenceVerified=true`。

离线复核确认依赖响应、33 项关系范围以及柱/轴网、类型、族、新类型和额外元素两轮原始结构一致。134 项完整范围与236项实例范围存在原生无序集合的读取顺序差异，按既有完整比较规则排序参数、连接器/peers、电气 systemIds/memberIds 并规范化 -0 后一致；保留所有字段、重复项、未知状态、有序几何与其它数组，不把原始 JSON 字节一致作为本次结论。

四个显式查询根的两轮依赖响应一致，各根的 dependencies 列表 supported=true、complete=true、truncated=false，源族的 Family 类型成员列表也完整未截断；原生关系范围为逻辑 dependents 及 Family 类型成员，并保留自引用：

| 查询根 | 原生逻辑 dependents | Family 类型成员 |
| --- | --- | --- |
| 源柱类型 | 2 项，包含自身及一个既有元素 | 不适用，reason=not_family、count=null |
| 源族 | 33 项，包含自身、源类型、新类型及额外元素 | 6 个 FamilySymbol，包含源类型与新类型 |
| 新复制柱类型 | 2 项，包含自身及额外元素 | 不适用，reason=not_family、count=null |
| 额外 Element | 2 项，包含自身及新复制柱类型 | 不适用，reason=not_family、count=null |

返回的 33 项关系范围另作两轮完整 inspect，前后一致。`dependencyEvidenceComplete=true`、`nativeRelationshipVerified=true` 只认证此次明确原生关系列表；额外元素仍为无类别的 Element，typeId/ownerViewId/levelId 为原生 -1，不能据此确定用途。`additionalElementPurposeVerified=false`、`baselineAvailable=false`、classification=unresolved，源类型既有关系中也存在同名元素的事实不构成无害性证明。探针 confirmationCalls=0、planCreationCalls=0、modelWritesRequested=false、automaticSave=false、automaticRetry=false，没有计划创建、重复提交或自动保存。

`typeCopyExecutionAccepted=false`、`allModelSideEffectsVerified=false`、全局 `closeReopenPersistenceVerified=false`，rollbackVerification 仍 pending；已读范围持久化通过不认证全模型副作用。PNG 整图版面仍 `wholeSheetLayoutAccepted=false`，AL1 禁止重复移动。用户随后选择允许仅当前本地测试副本的自动保存/重启流程；该受限流程尚未实现或执行，此次实载仍来自手动重启，不改变本依赖查询的只读契约或默认不自动保存边界。

## 2026-10-25 图框类型更换进入待批准预览

`documentation.titleblock-change` 已在当前 Revit 2027.3 会话完成新 run `aa295f1b-4b4b-4804-a264-b42b595ebebd` 的只读基线：MVID `a5f06140-c95a-4705-a2f6-c81a34d64860`、文档 identity `5dade536f06fbea4751da01882583362`、revision=0、`isModified=false`；6 个 scope 覆盖图框实例/图纸/类型、图纸目录、图框类型目录、目标图纸版面和保存状态，plan/Confirm/模型写入/保存/重启均为 0。目标图框 `1018426 A3` 已激活，既有实例 `2296036 THS-A1` 属于图纸 `2296031 AI-E102-REUSE`，原生位置/旋转为 (0,0,0)/0，依赖和图纸图框成员均完整。

已创建并归档单图框预览 `7598420d6314bf23905ebe5ffa0686e4`，预览摘要 `c979e8f0b9de5b4bd3d2ce49d55e29c3a694d874e0fc7b6704835954b62017d8`，有效至 UTC `2026-10-25T14:37:55.6168928Z`（上海时间 `2026-10-25 22:37:55`）。操作只把 `2296036` 从类型 `1018076` 切换到已激活 `1018426`；Revit `ChangeTypeId` 可能替代原实例，因此执行后必须核对替代 ID、依赖、图纸成员、位置/旋转及 PNG。当前状态为 `preview-accepted`，下一步需要对该具体 planId 的聊天批准；批准前不会提交、保存或重启。

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

## 2026-10-26 图框依赖修复实载与完整只读范围通过

用户回复“已重启”后，新进程 PID35768 实载 MVID 62920820-49bb-43e8-a562-07312ff4b187；同一隔离副本 identityprivate-document-identity、revision0、未修改。独立审计重新核对289项来源、7份日志、DLL实际PE MVID/SHA及清单目标，全部一致，未重复注册。

独立加载核验 run `31d7fe63-7c34-408d-a82f-661dc95078b4` 归档于 `acceptance/load-checks/`：本轮新读100个scope、623个完整元素快照，与注册前同一保存文件的公开范围严格相同，差异为0。仅明确重绑定新会话身份，活动视图/选择另列UI状态；未删除geometry/projection字段，未加容差。文件c99b0394…/97136640字节/mtime均保持。新PNG人工查看仍为AL1表在A3图框外，视觉不通过；原生真正替代分支与隐藏副作用仍未验收，既有原位更换的保存/重开结论不变。模型计划、Confirm、写入、保存、重启、注册均0；不再要求人工重复上述步骤。

历史MCP全量结果仍是990通过/1跳过/0失败。唯一跳过位于 `mcp/tests/local-test-copy-supervisor.test.mjs:194`，为读取辅助进程自身SID/session及端口的Windows OS smoke，要求Windows且显式启用 `REVIT_LIFECYCLE_OS_SMOKE=1`；默认全量未启用此项。不是图框回归失败，也不将该跳过项记为通过。本轮不恢复自动保存/重启开发。

上述注册阶段提出的人工重启已在后续加载核验完成，不再是当前待办。新修复的真正替代原生分支仍未验收，当前A3/AL1版面视觉拒绝保持，不重放原图框计划。

## 2026-10-26 图框包含只读诊断已实现，当前MCP连接待重新加载

用户批准 `2026-10-26-sheet-titleblock-containment-design.md` 后，只修改Node派生诊断和工具说明，新增独立 `titleBlockContainment`；保留所有原始几何、旧outOfSheet/相交/完整性语义。真实反例便携夹具和未知/多框/退化/相切/四侧/所有放置类别/SDK只读路径的回归先红后绿：新测试16项，相关42/42，全量MCP1006通过/1可选OS smoke跳过/0失败。110项C#来源与既有f89构建冻结摘要一致，不编译、不注册、不重启Revit。

新SDK实机只读run `3220ed2d-4134-427c-a555-1164d5fb9d2e` 对AI-E102-REUSE与E101各读取一次派生诊断，并分别保存原始bridge响应；所有原生字段严格相等。AL1表2296037现在明确报告相对图框的left/top越界，而历史outOfSheet仍为空；E101本次BBox包含检查没有越界，不等于其轴网文字/PNG视觉通过。固定PID35768/MVIDf89/identity8866/revision0，模型c99摘要/大小/mtime不变，未重复100scope或任何模型计划。

`acceptance/preparations/sheet-titleblock-containment-node-verification-20261026.json` 固定来源、测试日志和实机证据摘要；新run另有29项证据索引及离线审核。当前会话已有MCP连接的直接调用仍无schema1，已独立冻结为旧入口证据；新SDK通过不冒充当前连接已加载。下一步只需用户重新加载revit_custom MCP连接，再核验schema1；无需重启Revit、注册DLL或保存。A3/AL1视觉拒绝、真正图框替代分支及隐藏副作用未认证保持。

## 2026-10-26 当前MCP连接重新加载核验通过

用户回复“已经重启”后，直接通过当前已连接MCP工具读取两张图纸和前后context，不依赖新SDK进程替代当前入口。两张报告均含 `titleBlockContainment.schemaVersion=1`，所有报告字段与先前新SDK基线严格相等；AL1仍正确报告left/top，E101本次BBox无越界。Revit仍为PID35768/MVIDf89、原identity8866/revision0/未修改，RVT文件c99摘要/大小/mtime保持。

在原run `3220ed2d-4134-427c-a555-1164d5fb9d2e` 追加 `current-entry-reload-observations-20261026.json` 和 `current-entry-reload-verification-20261026.json`，旧pending-reload记录保持原样作为历史阶段。队列已解除本次MCP加载阻塞，恢复readonly-accepted；无需再次加载、保存、注册或重启。未创建模型计划或执行写入，未重新运行已通过测试或100scope。此次仅认证诊断及当前入口，实际模型版面视觉拒绝、替代原生分支和隐藏副作用结论不变。
## 标记与尺寸输入契约修复（2026-10-30）

复用现有create_tag/create_dimension，不增加模型操作。两者拒绝未知顶层字段，保留共同的id/dependencies/parameters/mark。create_tag保留elementId/viewId/tagTypeId/xMm/yMm/zMm/leader；create_dimension保留viewId/dimensionTypeId/start/end/references。可选类型ID显式出现时不得为null或其它会被忽略的类型。

尺寸references必须是至少两项非空、精确不重复的原生稳定引用字符串数组，不做大小写、空白或引用内容修正。此校验不证明字符串可解析、几何可标注或原生NewDimension会成功，原生预检仍负责解析。Node参数名提示复用已移植的describeArgumentKeys，仅输出有界键名。

新feature为annotation-input-contracts；新Node在派发任一标记/尺寸预览前要求该原生能力。Node实现与DLL均变化，因此这一批加载后需要重启Revit并重载MCP，工具名/schema不变，不需要重启Codex。候选与验证日志以任务队列documentation.sheet-metadata-and-placement.developmentSlices.annotationInputs为准；没有为本次离线阶段创建空实机run。

本批Core398、相关Node56、全量MCP1136通过/1可选跳过，另有独立SDK检查1通过（全量启动枚举后新增，合计1137项不重复通过）；Revit2027.3编译0警告/错误和CheckOnly通过。候选`bin/Release/annotation-contracts-20261030T111428Z`冻结338项来源/7份日志，MVID`e6b5ebc3-761e-4845-a299-ce8bce92d285`。初次核心测试对既有ID校验的错误层级预期不正确，修正测试后通过，初次失败日志保留；未弱化全局ID校验。

依据长期用户授权，已代理逐构建复核并单次注册请求`dff8abaaecf0fcdbfc634ca554b65883`，SHA-256 `7B2A7CA957B612FB920B3C454E5F94B439308297C0EC4A6F424107FEEC4337BD`。回执标记agent-reviewed-standing-authorization、humanChatApproval=false，清单/备份/保护设置核验通过。当前仅compiled并注册，Node及原生拒绝路径的本次实机验收尚未进行；等待一次Revit重启＋MCP重载，不重复注册或原标记计划。

### 新版原生与新SDK拒绝路径通过，当前聊天连接仍待刷新

run `7cb4809a-db9f-4630-a70d-5470037b5518` 核验099df33d/PID20568实载，在干净会话44a03bb6…/revision0上批量检查10类标记/尺寸错误。新SDK Node均返回invalid_annotation_input并保留有界键名/错拼提示，直接原生预览校验也全部返回预期拒绝。原先对null可选类型ID的错误码假设已按全局ID规则允许null、随后注释规则拒绝的实际顺序更正，仅调整验收预期，不改变原生保护。30次逻辑预览入口调用（当前聊天10、新SDK10、显式原生10），没有成功plan、Confirm或模型写入；不声称测量了各入口背后的传输调用次数。

完整context、RVT摘要/大小/mtime及相关可执行源码在前后保持。当前聊天10次调用返回原生文案且无新Node键名诊断，与同源新SDK结果不同，不能把新连接通过当作当前入口已刷新。两个模块保留原生/新SDK的readonly-accepted子范围，当前state=blocked仅指客户端绑定；建议完全退出重开Codex刷新本会话，Revit/模型保持打开，不重复加载DLL、注册或20项矩阵。回来仅查一次错拼字段入口。


### 2026-10-30 当前聊天入口已刷新

用户重开Codex后，仅发送1个tagtypeid错拼拒绝请求，当前入口返回Node提示tagTypeId且valuesIncluded=false；没有成功计划或写入，完整context和RVT摘要/大小/mtime保持。原run追加summary-current-chat-refreshed-20261030.json，客户端阻塞已解除，不重复原生/新SDK矩阵、注册或重启。上文待刷新结论属于历史阶段；有效标记/尺寸创建、几何及既有副作用/视觉限制没有升级。


## 2026-10-30 尺寸标注最终回读契约

仅在项目文档创建线性尺寸，族内尺寸创建暂未暴露。复用create_dimension/NewDimension、既有计划事务组和DocumentationCreationReadbackService，补齐创建后、整计划提交前和事务提交后的原生复核；事务组结束前失败仍可回滚。不增加模型操作或工具。预览及执行均重新解析原生稳定引用，捕获请求线轴与已解析引用；省略类型时锁定原生实际默认类型，再执行通用参数写入。绑定原生Document，按ID/UniqueId、类型、owner view、当前可解析引用集合及支撑直线检查，防止后续操作改变结果。

引用输入为2..128个不同非空稳定字符串，每条最多4096个UTF-16单元；不清理字符串，原生解析/回转后重复也拒绝。引用集合必须完全匹配，包括元素、链接目标与引用类型；允许原生重排并如实记录顺序是否相同。直线允许原点沿轴平移或方向反转，垂直偏移容差0.01mm、归一化方向叉积容差1e-8；不把原生可能无界的尺寸线强行当作输入线段端点。

创建检查要求原生AreReferencesAvailable=true；视图相关引用不可解析或读取失败时拒绝，不自动激活视图或猜引用。只读inspect新增dimensionReadback，保留原生可解析性、线轴、有界状态和完整引用；其它尺寸类别、缺曲线或超过证据边界明确unsupported。新feature为dimension-creation-readback，Node在旧模块上拒绝尺寸预览。

支撑直线和引用关联检查不认证尺寸数值、分段/文字覆盖、见证线、标签布局、全模型副作用或持久化/视觉。相关规则/SDK检查与2027.3隔离编译完成后暂存，最终状态以队列该子范围为准；新功能实机验收需要后续合批加载及具体新计划批准。没有为离线实现创建空Revit run，也不重做既有标记/族文字验收。

已对照此前查看的rvt-mcp CreateDimensionsHandler（commit4affa2aaae3f6e7b798d1067ce7e324ad92f0f91）；本项目原有显式NewDimension重载继续复用。未移入其活动视图/线坐标推断或跳过失败引用逻辑，本次没有新增第三方代码移植。


## 2026-11-08 尺寸与轴网引用合批

沿用此前d78df8e4尺寸最终回读，补existing inspect的gridDimensionReference只读快照。只针对现存本地Grid构造Reference(grid)，读取原生稳定字符串/元素/链接/引用类型，再ParseFromStableRepresentation并重新序列化，要求原生回转全部字段相同且目标仍为同一个本地轴网。不会使用Grid.Curve.Reference或手工拼接字符串；输出包含当前documentIdentity/revision、Grid ID/UniqueId及roundTripVerified。其它元素不增加该快照，读取失败返回unsupported并保留错误种类，不伪装为空成功。

快照明确dimensionSuitabilityVerified=false和viewVisibilityVerified=false，原生可序列化不等于该视图可标注。尺寸执行仍重新解析引用、检查类型/视图/完整集合与支撑直线。墙面、链接模型或其它稳定引用的获取不因此认证；原输入路径保持。解析器的链接元数据初始化仍需实机分支证明，不将本地轴网结果外推到链接引用。

独立源码复核覆盖上批Dimension规则、服务、ModelExecutor和事务前后调用，无可确认缺陷；源码复核不代替实机验收。两项合批后再做完整候选回归/2027.3编译/CheckOnly和精确注册复核；每项结果按自己的真实证据记录。


## 2026-11-08 LinearDimension实机兼容缺陷与修复

合批c8001ce7加载后，run01a1b7b9-2656-7c27-8c01-8e10d4f7c8ea的12根Grid原生引用回转及模型线观察全部通过，17项旧快照字段全部不变；5个既有尺寸的summary.className实际均为LinearDimension，而新快照误要求精确Dimension，返回invalid_dimension_readback。没有创建尺寸计划或写模型；原始失败回执保留，不将5个拒绝当通过。

最小修复同时调整原生读取精确类型白名单、纯规则类名白名单和ModelExecutor期望类名捕获三处：仅允许精确Dimension或LinearDimension，仍要求Curve为Line，禁止Angular/Radial/Spot等类别，期望/实际类名继续精确一致、不规范化为基类。已先运行来自真实native类名的回归测试，旧规则在RequireStructure处确定失败，随后修复后423Core/51相关SDK通过及2027.3编译0警告错误、CheckOnly通过。

独立复核结合实载记录和已安装API元数据确认LinearDimension继承Dimension并使用相同读取属性；先前静态审查未发现这一运行时子类问题。修复不放宽引用集合、Doc、ID/UniqueId、类型、视图、轴线、数值/视觉或事务边界；未来子类仍不自动接受。最终回归/具体构建状态以队列和构建目录为准，修复在重新加载前不算实机通过。此修复只改变C#与测试，Node运行时代码未变，无需因此重载MCP或重开Codex。
