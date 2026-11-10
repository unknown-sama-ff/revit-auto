> 发布副本说明：本机路径、模型名称及运行标识已匿名化。原始私有证据未随源码发布；历史验收不代表当前会话授权或完整业务认证。

# 电气图纸受控迁移

electrical.sheet 接受明确的创建输入，以及既有图纸和平面视图的限定属性变更。所有输入只生成预览；模型写入仍需审阅该具体计划并在聊天中确认。

sheetChanges 每行包含 sheetId，和至少一个 name 或 number。viewChanges 每行包含 viewId，和至少一个 name 或 scale；scale 为正整数。目标必须来自当前项目，同一目标不能重复出现，不能传入任意参数或原始操作。

例如 input 可使用：
{"sheetChanges":[{"sheetId":101,"number":"E101","name":"一层照明平面图"}],"viewChanges":[{"viewId":102,"name":"一层照明平面图 1比100","scale":100}]}

示例 ID 是合成值，不能用于实际模型。调用 revit_workflow_run 时 name 为 electrical.sheet，另提供当前只读查询取得的 documentIdentity、expectedRevision 和 planningMode。

预览前分批读取目标原生类别和参数，最多每批 100 个。图纸必须为 ViewSheet；视图必须为明确的非模板 ViewPlan。只允许 SHEET_NUMBER、SHEET_NAME、VIEW_NAME、VIEW_SCALE_PULLDOWN_METRIC。参数必须唯一、可写且有可靠值和存储类型；domainReview 披露 before、after、beforeHasValue 和 noOp。参数缺失、只读或不支持时停止，不采用空值默认。

改图纸编号或新建图纸时，分页读取现有图纸目录，核对目标当前编号与参数基线（仅既有图纸适用），并检查本次修改及新图纸编号冲突。创建行内部重号在任何原生读取前拒绝，共享操作校验也拒绝同一原始计划中的重复新图纸编号。仅新建图纸、名称修改＋新建、既有放置移动＋新建均经过同一目录冲突检查；未知、重复、取消或超过预算的目录停止预览，不自动临时编号，也不假设同一计划的其他改名会释放被占用编号。

仅创建的编号预检返回 `new-sheet-number-catalog-only` 范围、明确的 `newSheetNumbers` 和完整目录，`inspectedElementCount=0`、`nativeCreationAccepted=false`；不声称已检查图框类型或执行创建。图框兼容及真实创建仍由原生计划验证和后续具体验收承担，编号文本保持原值，不自动修剪空格、改大小写或重编号。

2026-10-28 补齐以上分支并通过106项相关回归及5项新增MCP专项（共111项），覆盖独立新建、批内重号、已有编号/第二页冲突、取消/截断、与名称或放置混合及目录读取后的会话变化。使用当前模型五张图纸的真实目录作只读重放，`AI-E035` 冲突和批内重复均被拒绝，空闲编号仅返回目录预检结果；证据见 `acceptance/diagnostics/sheet-creation-number-preflight-20261028.json`。本次没有创建真实计划或模型元素，不提高新建图纸、Notes排版或完整副作用验收结论。新增代码只在Node层，当前连接使用前需重载MCP，无需注册DLL或重启Revit。

现有创建输入继续支持 views、viewConfigurations、schedules、panelSchedules、sheets、viewports、tags、dimensions。配置行严格拒绝原生不会应用的 name/scale；改名称或比例应使用 viewChanges。所有操作仍经统一 validateOperations 和原生 plan.create。

metadata 检查后的上下文复核要求 identity、revision、路径和保存状态稳定。ask 不访问 Revit、不创建计划；assisted 必须披露非空假设并返回候选预览。

2026-10-28 单图纸名称 run `2db11d3e-6ec1-4786-a532-0ed1e19531c8` 已获具体聊天批准，计划 `7cb92d2dc84917f18f0fb408573eb3e4` 经独占 wx attempt 单次提交。图纸 AI-E035（2295739）的名称从“AI-V035 办公室1照明验收图”改为“AI-E035 办公室1照明验收图”，仅一项 `BIP:SHEET_NAME`；原生提交后元数据检查与独立回读通过，PNG中可见新名称。31项基线中23项完全不变，8项只有名称及图框/视口等派生标题文字变化；图纸编号、图框和视口几何、参考/目标视图设置保持不变。完整原始事件、32项执行后快照及差异均已归档。

该事务另报告内部元素 `23741` 修改，本run没有它的执行前快照；其内部用途、修改因果和全模型副作用仍未知，整体状态保持 blocked。图纸既有标签左/下越界继续保留，限定名称PNG通过不代表整图版面通过。当前 revision1、isModified=true，手动保存及关闭重开持久化待完成；不得重复原计划。旧照明视图配置与泵房裁剪的历史提交继续由独立归档复核，不作为此次元数据执行证据。

用户随后已手动保存。保存后当前会话为 revision1、isModified=false，32份完整原生快照与执行后记录严格一致，磁盘文件 SHA-256 为 `d2b9c2c645ff4c6a4b25c63d627af972568115993398881c2496d6ec286f2c7d`，读取期间文件大小/时间稳定，详见本run的 `saved.json` 和 `saved-verification.json`。现在只待手动关闭并重开同一路径完成持久化核验，不再保存或执行名称计划；未解释副作用与整图视觉限制保留。

手动关闭重开核验已完成：新会话 `262018b2b0ca0dbb46d0c61c5eb37240`、revision0、isModified=false，32份完整原生快照与保存记录一致，磁盘SHA-256精确匹配，参考/目标视图设置及图纸布局数据保持一致（会话字段单独绑定）。重开PNG与已目视复核的执行后PNG字节相同，限定名称可见性通过；`reopen-verification.json` 保存可复现结果。标准归档校验0项问题，原始执行后回读和视觉记录另行保留，未通过该校验升级副作用或整图结论。本次run无需再保存、重开、注册或重复Confirm；`23741`及既有标签越界限制继续保留。

2026-10-28 针对 AI-E035 视口标签越界，另建 run `d49a24d6-bbad-4ffe-a96d-80a00370c09f`。计划 `64fa0228cd6b985e70dbf4b73bae97f6` 已获具体聊天批准，经独占 wx attempt 恰好提交一次；既有视口 `2295745` 的标签偏移从约 `(-238.2496,-250.9667)` mm 改为 `(+20,-25)` mm，引线从约 `587.7976` mm 缩短至 `100` mm。原生提交后检查、独立回读与PNG确认标签进入图框并与视图内容分开：标签 XY 边界为约 `(600.202,166.667)`–`(712.702,189.805)` mm。图框包含诊断的越界/未知及相交候选均为空；内容盒、图框、图纸名称、参考/目标视图设置保持不变。

32项执行后快照中，只有视口及所属图纸镜像标签字段发生预期变化，其余30项完全一致；原生事件也仅报告这两个对象修改，无新增、删除或其它ID。本run接受限定标签修复写入与可见性，完整模型净差异不作认证。当前 revision1、isModified=true，手动保存及关闭重开待完成，不重复Confirm。右侧Notes文字仍拥挤，整图视觉不通过；前一轮名称事务的 `23741` 历史缺口独立保留，不因本轮该对象未变就解除。

用户随后已手动保存标签结果。保存后 revision1、isModified=false，32份完整原生快照与标签执行后相同，标签偏移和100mm引线正确；磁盘SHA-256为 `72a5dad6b1a89abf39ecee5c230463a94c270970e6284b585fc9feea17575e6f`，读取期间文件大小/时间稳定，详见该标签run的 `saved.json` 和 `saved-verification.json`。现在只待手动关闭重开完成标签run的持久化，不再保存、注册或执行该计划；这与已完成的上一轮名称run分开记录。

标签run的手动关闭重开也已通过：新会话 `95a1902a24bf459e99812265b2119000`、revision0、isModified=false，32份完整原生快照与保存记录一致，RVT摘要精确匹配，图纸布局（会话字段独立绑定）及参考/目标视图设置不变。标签仍在图框内，重开PNG与已目视复核的执行后PNG字节相同；`reopen-verification.json` 和 `archive-audit.json` 记录限定持久化通过及0项归档问题。本run全部必要人工操作已完成，不再保存、重开、注册或Confirm；完整模型副作用、上一轮23741及右侧Notes等整图限制继续保留。

元数据与既有放置同时预检时，显式目标 ID 合并去重，每批最多 100 个元素，共享同一次调用内的原生快照；不开放跨调用缓存。放置单独输入保留原结果和错误码，图框/标签的独立操作限制不变。新增批次数和快照共享证据只说明只读编排，不提升实机验收状态。详见 [联合预检任务卡](sheet-inspection-preflight.md)。

placementMoves 可独立移动既有 Viewport、PanelScheduleSheetInstance 或 ScheduleSheetInstance；每行明确 placementId、sheetId、viewId、xMm、yMm，zMm 可省略或只能为 0。全部 ID 必须为既有元素；禁止重复移动、任意参数、隐式新建引用及同一计划 configure_view 的重复重定位。electrical.sheet 与 architecture.documentation 均可使用。预检分批读取原生归属、源视图和旧纸点，原生预览再次检查类别、固定状态和修订表限制，并披露旧/新位置。执行后检查归属和位置；单项操作不自动修改比例或视图设置。旧运行插件缺少 drawing-placement-move 时会在 plan.create 转发前拒绝。该源码能力尚无原生移动/回滚/保存验收；受控更换图框和完整旧版批量高分辨率导出仍缺失。配电盘表实例必须独立 inspect 为 PanelScheduleSheetInstance；图纸 drawing.viewports 只列普通 Viewport。原生放置锚点不能证明整表在纸内，必须查看 PNG。源码/模拟契约测试不能替代实机写入、回滚、手动保存及保存后复查。

2026-10-10 图纸复用测试获明确聊天批准后，原计划只提交一次，原生收据 committed，两项操作完成，revision 从 6 到 7。新图纸与既有配电盘表实例的关系、图框类型及请求纸点一致；119 项电气范围和原有四张图纸读取一致。PNG 显示表格左侧与图框签字栏相交，版面验收失败，不自动移动或重提计划。

事务附带的内部未上图纸 Viewport 触发原检查器 GetBoxOutline 等 API 异常，不代表新图纸或表实例创建失败。源码已对 SheetId 无效及无投影变换的情况返回明确不可用状态，隔离编译通过；活动 DLL 尚未替换。其他内部修改元素缺少写入前基线，不能认证全部副作用。

用户手动保存后，只读复查通过：revision=7、isModified=false，verification.saved 返回 saved=true；原计划仍 committed，收据与提交时一致，新图纸/表实例、源范围、119 项电气快照及四张原图纸均与提交后结果一致。只认证当前会话无待保存变化及已读范围，不认证关闭重开持久性。当前证据为已提交、保存后范围核验通过、版面失败；总体状态仍 implemented-not-accepted。后续移动须先获准加载具备 drawing-placement-move 的插件，再生成并审阅新的具体预览。

获准注册并由用户手动重启后，已核验加载模块指纹与注册 DLL 相符，drawing-placement-move 能力存在。重新打开同一测试副本，identity 为新会话身份、revision=0、isModified=false；旧 plan 返回 plan_not_found 属于会话记录不可用，不能重建原创建计划。已保存的新图纸/表实例、源范围、119 项电气元素及四张原图纸的已读字段通过重开复查。新查询仅为原有普通视口增加 geometrySupported=true、projectionSupported=true；逐项验证旧几何/投影数据完整且全部原字段不变，保留原始证据。此前报错的内部 Viewport 已返回 viewport_not_on_sheet 的明确不可用状态。

另行生成了仅包含一次 move_drawing_placement 的新预览：将复用表实例向右移动 30 mm，Y/Z 保持不变，目标是避开 PNG 所见签字栏相交。原生预览披露旧/新纸点，前后上下文和已读范围不变；尚未确认或写入。坐标预览不认证版面，执行后仍须独立 PNG、手动保存及后续重开验证。

2026-10-10 中断恢复后，旧预览已过期且旧文档会话计划不可用；旧执行器在身份预检退出，没有提交记录。恢复先严格比较原 119 项电气快照、已有图纸、四项源范围（包含图框 FamilySymbol）、新图纸/表实例和九项既有原生范围，所有字段保持不变，不删去 geometry/projection 或新增支持状态。再捕获当前 schema 下合并后的 134 项完整原生范围。新预览保留原绝对目标 X=398.5 mm、Y=568 mm，从旧 X=368.5 mm 移动；若已在目标或位置发生其他变化则拒绝恢复，不对当前位置再加 30 mm。

用户既有具体聊天批准和本次继续恢复指令仅用于这个已证明等价的移动。当前有效预览的操作、警告、原点及绝对目标均与旧预览一致，一次性 attempt 记录以 wx 落盘后仅确认一次。原生收据 committed，完成一项操作；原生变更事件只报告该配电盘表实例修改，无新增、删除或其他修改。移动后的 134 项完整读取与预期只差实例 drawing.position，119 项电气集合和快照保持不变。PNG 独立目视确认签字栏重叠消除，表格完整位于图框内；图框右侧原有注释文字仍拥挤，所以整张图纸质量不宣称通过。

收到用户“已保存”后一次只读核验通过：revision=1、isModified=false、verification.saved=true，原计划和收据一致，119 项电气与 134 项完整范围和移动后证据相同。此次移动的当前会话保存核验通过，移动回滚、移动后关闭重开持久性和整个模型副作用未验收；历史图纸创建的重开证据不能替代移动后的重开。私有完整记录与 PNG 仍保留在 Git 忽略目录。本项受限移动测试通过，不将整体 electrical.sheet 标为已迁移并验收。

受控单图框类型更换和只读批量高清 PNG 的源码迁移现已补齐，输入、门禁、回读与未验收边界见 [图纸和建筑能力迁移补齐](drawing-architecture-parity.md)。它们尚未部署到当前运行插件；历史段落的“缺失”描述为当时状态，不能挪用本次移动证据证明新能力实机通过。
