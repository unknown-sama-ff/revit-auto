> 发布副本说明：本机路径、模型名称及运行标识已匿名化。原始私有证据未随源码发布；历史验收不代表当前会话授权或完整业务认证。

# 房间正向验收的独立围护夹具

本卡承接 `architecture.rooms` 已通过的只读验收。既有围护中已经存在房间 `2295770`；不得在旧房间点位重复创建。先用独立 run 准备围护，再用另一个 run 只测一次 `create_room`。夹具不改变墙、门窗或楼板既有验收结论。

机器可读候选位于 `mcp/acceptance-recipes/architecture-room-enclosure.json`。它是离线方案，不是 Revit 预览，也没有当前 identity、revision、planId 或写入批准。

## 候选范围

- 隔离副本：`acceptance/models/floor-side-effect-isolated-20261020.rvt`。
- 既有墙类型候选 `763588`（100 mm），标高候选 `311`（项目高程 0 mm）；必须在当前副本重新读取。
- 四面墙中心线围成 X=42000–46000、Y=1000–5000 mm 的 4 m × 4 m 矩形；高 3000 mm、底偏移 0、非结构、`flip=false`。
- 后续房间候选点 `(44000,3000,0)` mm，名称“AI 房间创建正向验收”、编号 `AI-ROOM-POS-20261024`。房间操作不在夹具计划中，不附带标签或楼板。

选址参考 run `3653e000-ba9c-42c3-ab77-f088a5f20ebf` 的原始快照。该历史数据的候选附近未见已采集的位置样本，但部分元素没有位置摘要，且点/线采样不能代替包围盒、实体、链接模型或原生房间回路查询。因此“空闲”“无碰撞”均未验收，必须在 Revit 打开后重新核验，必要时另选位置。

## 执行编排

1. 手动打开隔离副本后，读取 context、操作指南和 safety。核对获批 MVID `ec3b91b2-a859-40dc-a66e-7e7b45685951` 及房间/墙回读能力；不重复注册已经加载通过的构建。
2. 为夹具新建 run，基于当前类别成员和类型生成只读 scopes，归档实际 MCP 契约及完整两轮原始结果。历史 45 scopes 是模板，243/26/7 是历史数量，不能当作当前数量或沿用旧 identity/revision。保留系统观察元素 `86962`、`293247`。
3. 复核新编号不存在、所有既有房间在候选外、附近建筑和机电范围及当前 PNG。发现已经存在的夹具墙、未知相交几何、未解释范围变化或文档已修改时停止，先查已有 run/plan，不补建或覆盖。
4. 仅对 4 个 `create_wall` 创建原生预览。归档 planId、有效期、当前 identity/revision、MVID 及原生警告；具体 planId 经聊天批准后，持久化独立 `wx` attempt 标记，再 Confirm 一次。断线先查询该计划状态。
5. 原生读取四墙的类型、标高、曲线、偏移、高度、翻转和结构标志；逐墙读取 `WALL_ATTR_ROOM_BOUNDING=1`。复核原生变更回执、全部既有范围以及 7 个或当前实际数量的房间集合和边界；未知附加修改不因“墙看起来正确”而放行。
6. 夹具通过后，为 `architecture.rooms` 新建独立 run 和当前基线，只提交一个 `create_room` 预览。Z 按 `NewRoom(Level, UV)` 取原生标高；仍须具体房间 planId 获批后单次 Confirm。
7. 房间原生读取名称、编号、标高、XYZ、正面积和完整 Finish 边界，检查所有副作用。失败回滚按独立测试执行，不和正向创建混在一起。
8. 用户手动保存；保存后归档完整只读范围，再由用户关闭重开同一副本，归档持久范围与 PNG。如夹具通过后继续同一会话进行房间验收，房间基线必须明确夹具尚未保存，最终保存/重开同时归档两个 run 的关系。

所有阶段使用现有统一证据结构：manifest、baseline、preview、confirmation、attempt、execution、readback、saved、reopen、visual、summary。夹具通过不能升级房间写入验收；正向创建不能替代失败回滚，采样边界不能认证任意曲线的精确拓扑。

## 2026-10-24 当前恢复状态

本轮 `revit_context_get` 返回 `ECONNREFUSED`，本机未检测到 Revit 进程。只完成离线方案、共享操作校验与历史证据核对；未建立新 run、未创建原生预览、未 Confirm、未写模型、未保存或重启。等待用户手动启动并打开隔离副本后再获取当前会话。

## 2026-10-24 手动打开后，四墙预览待批准

用户打开同一隔离副本后，已核对新 identity `22d226cc445142c9b0dbb578d5d2f566`、revision `0`、未修改，实际 PID `29876`，获批 MVID `ec3b91b2-a859-40dc-a66e-7e7b45685951` 已加载。新 run `b836c349-e3c4-46fd-acf9-d3d5532f0db8` 保留实际 MCP 指南、契约和原始范围。

本轮扩展到 254 个实例、29 个类型、7 个房间及 2 个系统观察元素；原有 243 个实例、26 个类型、类别成员和已捕获字段均严格相同，两轮快照和完整 context 一致。多出的 11 个实例/3 个类型来自新增管件、风管管件查询范围，并非模型新增。屋顶、天花、Revit 链接、房间分隔线等新增查询为空。

原始 `baseline.json` 有 56 个成功 scope，另两个视图设置查询误用了三维视图 ID，返回 `invalid_view_configuration`，因此原文件的 `status=unknown` 保留。没有重建 run；`view-addendum.json` 使用已核实的 FloorPlan `2295811` 和三维视图 inspect 补充 3 个成功 scope。`preflight.json` 显式记录恢复过程和组合核验结论，不能把原基线错误改成成功。

已归档并目视检查建筑平面及三维 PNG，候选区域未见既有几何；当前点、曲线端点范围、楼板轮廓、房间 Finish 边界范围均在复核区外。此证据只用于夹具选址，不认证精确实体净距、隐藏几何或空闲原生房间回路。

单次生成四墙预览 `ef4eec57aa32d8a4f1ee164fde3929ec`，原生操作与配方完全一致、无警告、状态 `pending`；到期上海时间 **2026-10-24 07:16:49**。预览 SHA-256 `43bd99fc059f1d5c3e56dd49f4f1f688bf986c39dbd9a67458916db3131c2999`。生成后 context 完全相同；Confirm=0，模型写入/保存/重启均为 0。夹具推进到 `preview-accepted`，等待该具体 planId 的聊天批准；房间能力保持 `readonly-accepted`。

## 2026-10-24 获批单次提交，主结果与限定视觉通过，整体副作用仍待解释

用户明确批准上述四墙计划后，执行前再次逐项比较原计划、有效期、当前 identity/revision、实际 MVID/PID 及原先完整已读范围；原文批准、预览摘要和独立 `wx` attempt 持久化后，Confirm 只调用一次。原生状态 `committed`，新增墙 `2296051`、`2296052`、`2296053`、`2296054`，revision 从 0 变为 1，文件 `isModified=true`，没有保存。

四墙类型、标高、XYZ 中心线、高度、偏移、翻转和结构标志均通过原生回读，全部 `WALL_ATTR_ROOM_BOUNDING=1`。执行后两轮完整原始快照保存在 `postwrite-snapshots.json`：原有 254 个实例、29 个类型和 7 个房间的全部已捕获字段相同，类别集合只多出四面墙，系统观察元素 `86962`、`293247` 的可见快照字段相同。执行后平面/三维 PNG 显示独立四墙围合；`visual.json` 只接受这四墙的可见几何，不代表房间、持久化或整体模型视觉验收。

原生变更完整记录新增 4、修改 2、删除 0；额外修改为 `86962`（系统数据）和 `2289997`（无名称/类别的原生 `Element`）。依赖查询显示前者的 `GetDependentElements(null)` 包含两者，但不能说明内部内容变化。历史单墙 run `1fde38a1-ac13-4214-a5b9-9f4707603bab` 也记录同两个修改 ID，复现只作为线索；本 run 没有 `2289997` 的事务前快照，不能声称其全部字段前后相同或无害。

夹具整体状态为 `blocked`：主写入结果和限定视觉通过，`writeAccepted=false`、`allModelSideEffectsVerified=false`，保存/重开未执行。预览阶段 summary 已保留为 `preview-stage-summary.json`，最新 summary 明确记录当前状态。等待用户决定是否手动保存继续只读持久化核验；在系统副作用解释之前，不生成或执行新房间计划，也不重放已 committed 的四墙计划。

## 2026-10-24 用户手动保存后，完整只读范围核验通过

用户回复“已手动保存”后，当前同路径、同 identity、revision `1`，`isModified=false`。`saved-readonly-batch.json` 保存真实 MCP 契约及两轮完整原始回读，258 个实例（含四墙）、29 个类型、7 个房间和 3 个系统观察元素与执行后原始范围一致；context 仅保存标志改变。`saved.json` 记录人工保存确认、只读保存状态/变更历史及稳定磁盘文件：97,009,664 字节，SHA-256 `16112056fc6c340abae48eb2fd190b2c8611900eaa1ad10efeb8c2adc1c203d0`。

只读编排器首次把白名单 `revit_saved_verify` 名称中的 `save` 误判为写动作，失败发生在 scope 校验，没有模型写入或保存动作。已将禁止项改为动作 token 匹配，同时保留精确工具白名单和 MCP 只读/文档 pin 检查；补充保存状态可读及伪装为只读的保存/生命周期动作仍被拒绝的测试。三个相关套件 37/37 通过。沙箱硬链接限制曾拦截两个既有文件写入测试，同一套件在正常本地权限下通过；真实保存后只读核验随后通过。该改动只涉及本地编排，不改 DLL，无需重新注册或重启，证据见 `orchestration-fix-verification.json`。

当前 `manualSaveVerified=true`，关闭重开尚未完成，`persistenceAccepted=false`；`86962/2289997` 内部变化因果仍未解决，整体仍 `blocked`、`allModelSideEffectsVerified=false`。下一步请用户手动关闭并重开同一已保存隔离副本，无需重启 Revit，再对照本次完整保存后原始范围做只读持久化核验。保存前阶段 summary 保留为 `pre-save-stage-summary.json`，不重放四墙、不创建房间计划。

## 2026-10-24 重开后的限定持久化与视觉通过

用户回复“已关闭重开”后，当前同路径 identity `bb1489862de8cc7120fe0dff233ee14f`、revision `0`、`isModified=false`。实际 PID 从 `29876` 变为 `15556`，在新 Revit 进程中读取，获批 MVID 仍一致；本阶段没有发出重启或打开指令。跨会话活动视图从说明视图切换为电气平面，完整界面前后值单列记录，其余 context 字段严格相同。

`reopen-readonly-batch.json` 保留真实契约及 56 scopes 的完整两轮结果：258 个实例、29 个类型、7 个既有房间、3 个系统观察元素的全部已捕获字段与保存时一致，类别成员不变；四墙 ID、原生几何和房间边界开关保留。只显式映射文档 identity/revision 两项会话字段，没有剔除几何或未知字段。`reopen.json` 接受限定四墙及完整保存范围的持久化；重开后的平面/三维 PNG 与执行后图像逐字节相同，限定视觉也通过。`persistenceAccepted=true` 不升级整体写入或系统副作用结论。

严格原文件哈希相等检查未通过：当前文件为 `652d45ad3c1b37f0751c61559b073ce9a9f4684d6e19cee649e0fe86aa12122a`，修改时间 UTC `2026-10-23T21:35:50`；原保存快照 `16112056fc6c340abae48eb2fd190b2c8611900eaa1ad10efeb8c2adc1c203d0` 精确匹配现存 `.0007.rvt` 备份。二者都是 97,009,664 字节。`reopen-file-lineage.json` 保留实际完整哈希/时间；不推断中间磁盘写入的原因或执行者，不声称当前文件与原保存字节相同。最初的严格哈希检查及界面状态预检中断也保留说明，没有重跑模型动作。

标准离线 `audit` 仍报告 11 项字段/格式不匹配：本次脚本使用整份 preview 文件摘要、`plan`/`document`/`confirmCalls` 等字段位置，严格 profile 期望另一套字段及原生预览 payload 摘要；另有初始 manifest 的 planId、attempt 类型与 PNG 字节数记录缺项。原生预览、执行回执、完整快照和 PNG 实际摘要均保留，但不能称标准归档一致。报告与逐项事实见 `archive-audit-20261024.json`、`archive-review-20261024.json`；追加审查不让原始 audit 自动通过，原文件不为凑格式而改写。

夹具整体继续 `blocked`，`86962/2289997` 因果未明、标准归档 profile 尚待离线对齐。四墙主结果、限定持久化/视觉结论如实保留。当前无需再保存、关闭重开或注册；下一步先离线修编排字段和调查系统证据，不重放已提交四墙，不创建/执行房间计划。

## 2026-10-24 后续记录生产方已离线对齐，历史证据保持

新增 `mcp/acceptance-evidence.mjs` 统一未来记录的原生预览 payload 摘要、manifest/plan 绑定、明确 attempt 类型、执行前文档、确认计数和 PNG 实际 bytes；schema 与归档器要求已对齐，说明见 `docs/acceptance-evidence.md`。真实 run 初始化与共享函数的模拟端到端记录通过 Schema 2020-12 和严格归档检查，相关31项回归通过，最终 MCP 全量975通过、0失败、1跳过。

本 run 的79项索引源摘要逐项复核未变，严格 audit 仍精确报告原11项，`currentState=blocked`、`allModelSideEffectsVerified=false` 保持。新生产方防止未来重复出现格式错位，不补造当时缺失的字段、不替换整份预览文件的历史批准摘要。限定原生/持久化/视觉结果不变；系统项仍须凭新证据调查，无需用户重新保存/重开或注册，不创建房间计划。
