> 发布副本说明：本机路径、模型名称及运行标识已匿名化。原始私有证据未随源码发布；历史验收不代表当前会话授权或完整业务认证。

# 建筑主体回读与验收任务卡

最新状态（2026-10-24）：整体仍为 `blocked`，单墙、门、窗的已接受门槛保留，楼板系统元素修改因果未明。最新归档 run 为 `c38167b0-795c-40f7-a93a-3f331e5270c8`；单窗原始归档另有两处 identity 抄录错配及原始重开范围缺失限制，见文末追加审查。下方开篇的构建、identity 和单墙 run 属于最初登记时的历史状态，不可用作新计划的当前会话。

- taskId：`architecture.primary-elements`
- 来源：`architecture.csx`、`openings.csx` 的既有墙、楼板、宿主门窗范围；不包括裸洞口、房间和结构柱。
- 目标版本：Revit 2027.3；当前已加载构建为 `0.4.0+5b6011dadb1018e5214bc0730e4636ba96179b99`，包含 `architecture-primary-readback`。
- 依赖：`foundation.current-session-readonly-batch`、`foundation.active-family-catalog`。同会话只读基线已通过，插件 MVID `a47f13ad-fd6b-457a-a764-16bbf3d53d20`，文档 identity `99aa1b4ca8a9bebdf630d34f673515c8`、revision `0`、`isModified=false`。
- 当前 runId：`1fde38a1-ac13-4214-a5b9-9f4707603bab`。3/3 定向只读 scope 通过，确认 1F 标高 ID `311` / elevation `0 mm`、100 mm 墙类型 ID `763588`、既有墙 13 面。单墙预览 `463cb44f9cdc459ec8f9aa0d24bfad62` 经用户确认后仅执行一次；新增墙 ID `2296040`，原生回读、用户手动保存、关闭重开及现有 3D 视图 PNG 视觉核验均通过。当前为 `visual-accepted`，仅覆盖这次单墙操作；失败哨兵回滚、楼板/门/窗仍未验收。

## 2026-10-19 单墙原生写入与回读

- 当前状态：`write-accepted`（仅代表本次墙创建及原生回读，不代表墙/楼板/门窗整体范围完成）。Revit 2027.3 插件 MVID `a47f13ad-fd6b-457a-a764-16bbf3d53d20`，PID `45492`；测试副本 identity `99aa1b4ca8a9bebdf630d34f673515c8`。
- 单次执行计划 `463cb44f9cdc459ec8f9aa0d24bfad62`，回执为 `committed`，`confirmCallCount=1`、`automaticSave=false`。创建原生墙 ID `2296040`；主体验证回读确认 type `763588`、level `311`、height `3000 mm`、offset `0`、`flipped=false`、`structural=false`，位置线为 `(70000,60000,0)` 到 `(75000,60000,0) mm`，几何误差在规则容差内。
- `readback.json` 显示 `nativeReadbackVerified=true`。原生证据仍把 `sideEffectsVerified`、`persistenceVerified`、`visualVerified`、`engineeringComplianceVerified` 置为 false；本次只核对唯一新增墙，不能推断全类别均无副作用。
- 用户已手动保存同一测试副本。只读 `verification.saved` 核验确认 revision `1`、`isModified=false`、完整且未截断的 revision 0→1 变更历史；墙 `2296040` 的 `architecturePrimary.native` 与执行后快照完全一致。该项仅为当前会话保存状态核验，`persistenceVerified=false` 仍有效。
- 用户随后关闭并重开同一路径测试副本。重开会话 identity 更新为 `b811ce67462646d015583361ccbe58ab`、revision 重置为 `0`、`isModified=false`；加载插件 MVID 未变。墙 `2296040` 的 UniqueId 和完整原生 `architecturePrimary.native` 字段与执行回读一致；墙集合从 13 墙变为 14 墙，唯一新增为该墙、无旧墙缺失；当前跟踪的非墙类别计数均未变化。证据 `reopen.json` 标记 `persistenceVerified=true`、`visualVerified=false`。
- 当前任务状态推进至 `visual-accepted`（限这次单墙操作）。

## 2026-10-19 单墙视觉验收通过

- 当前 Revit PID `45492`、插件 MVID `a47f13ad-fd6b-457a-a764-16bbf3d53d20`；重开会话 identity `b811ce67462646d015583361ccbe58ab`、revision `0`、`isModified=false`。当前活动 DraftingView `机电项目模板使用说明`（ID `911279`）未被激活或修改。
- 以当前 identity/revision 只读导出既有 `AI-V040 建筑验收平面`（ID `2295811`）和 `1F_综合3D`（ID `770918`），均为 4096 px / 300 DPI。PNG 文件和放大图归档于 `acceptance/runs/1fde38a1-ac13-4214-a5b9-9f4707603bab/visual/`。
- 平面图只作位置上下文，不能单独辨认目标墙。3D 图及局部放大图显示与墙 `2296040` 的已回读位置和高度一致的独立墙体轮廓，因此接受该墙的视觉状态，不把整图或其他建筑构件列入本次验收。
- 导出后文档 identity/revision、保存状态、墙原生参数保持稳定，且元素选择集为空。未创建计划、确认、执行模型写入、保存或重启。图像哈希及范围记录于 `visual.json` 和 `summary.json`。
- 下一项为独立失败哨兵回滚验收；楼板、门、窗随后分别按单能力验收。整体建筑主体尚未完成。

## 2026-10-19 失败哨兵回滚验收通过

- 独立 run `9796b995-8de6-45ad-a261-b7a283c2dea3`，绑定 Revit 2027.3（27.3.0.28）、插件 MVID `a47f13ad-fd6b-457a-a764-16bbf3d53d20`、PID `45492`、文档 identity `b811ce67462646d015583361ccbe58ab`、revision `0`、`isModified=false`。
- 预览 `c2ea2f6df185f2e2daf08c8a7c09b67c` 只有 2 项：第 1 项 `create_wall`（类型 `763588`、标高 `311`、`(70000,62000,0)`→`(75000,62000,0) mm`、高 `3000 mm`、非结构）正常完成；第 2 项 `create_room` 位于 `(120000,90000) mm` 未封闭区域，执行期以 `The requested room is not enclosed.` 失败。
- 原生回执：`status=failed`、`code=execution_failed`、`rolledBack=true`、`completedOperationCount=1`、`failedOperationIndex=2`、`failedOperationType=create_room`、`causeCode=invalid_operation`；revision `0→1`、`isModified=false`。确认只调用一次，断线后通过 `revit.plan.get` 读取同一 planId，未重试或重建计划。
- 回读 35 项（14 墙 / 2 楼板 / 6 门 / 13 窗）与基线逐项一致；`verifyArchitecturePrimaryRollback` 返回 `rollbackVerified=true`、`capturedScopeVerified=true`。原生 `captureComplete=false`、`elementEvidenceComplete=false` 原样保留，未被视为安全证明。
- 同轮修复离线校验器的 BuiltInCategory 常量：`OST_Doors=-2000023`、`OST_Windows=-2000014`。原常量把门/窗写成 `-2000014`/`-2000012`，合成测试自洽但真实门窗快照必然被拒；修正后定向测试 22/22 通过，真实 35 项快照干跑通过。
- 本次只接受该失败哨兵场景的整体回滚；楼板、门、窗和全模型副作用仍未验收。
- 下一次 Codex 会话的接手说明见 [handoff-2026-10-19.md](handoff-2026-10-19.md)。

## 已实现的字段合同

`ArchitecturePrimaryReadbackService` 在执行器解析既有类型、精确名称、已有引用和标高后保存不可变期望。墙/楼板同时保留原始 `reviewedOperation` 与解析后的 `resolvedOperation`；不把原始 JSON 中的引用当成预测原生 ID。

- 墙：类型、底部标高、无连接顶部约束、高度、底偏移、结构标记及有向位置线。端点反向时同时核对 flip，防止墙内外侧被当成同一结果。几何与尺寸容差为 0.01 mm。
- 楼板：类型、所属标高、零高度偏移、非结构标记，以及属于该楼板的单闭环直线 Sketch。允许循环起点变化和整体反向，禁止任意排序、漏边或交叉拓扑。既有闭合重复点输入沿用 FloorLoop 处理。
- 门窗：根据解析后的原生类别覆盖既有类型及专用复制类型；检查类型、墙宿主、标高、完整 XYZ、创建后的初始原生旋转加显式相对角度。沿用已有 1 mm 点位和 1e-6 rad 角度容差。
- 墙、楼板使用 ProjectElevation 构造标高相关期望。墙为底标高加 offset；楼板按指定标高和零 offset 核验。输入曲线 Z 与实际投影的关系仍需独立实机检查，编译和模拟测试不证明这一 API 行为已通过验收。
- 实例通用参数仍由现有 setter 处理；创建时已声明的几何、类型、宿主和约束成为受保护字段，参数覆盖或同计划后续操作不得与其冲突。仅参数写入的独立操作入口不变。涉及几何覆盖的历史计划需要重新预览，不能重放。

## 执行与只读证据

单项 setter 完成后读取原生字段；全部操作完成后在 `Transaction.Commit()` 前后再次读取。提交后复核仍位于可回滚的 `TransactionGroup` 内。最终回执包含 `architecturePrimaryVerification`，并进入现有响应预算检查；不扩大提交后的重试权限。

`revit.inspect` 新增 `architecturePrimary` 快照，为后续独立只读、保存后和重开对照提供相同原生字段。曲线/草绘/宿主不受支持或 getter 失败时返回 `supported=false` 与诊断，不能以未知结果验收。该字段是新增 schema，旧基线不得通过删字段后冒充当前基线。

回执与快照不会证明全部副作用；`sideEffectsVerified`、`persistenceVerified`、`visualVerified` 和 `engineeringComplianceVerified` 保持 false。单项操作中的回读成功不能替代最终提交复核。

## 下一次实机运行的编排

1. 插件加载或 MVID 改变时，先提醒用户手动重启；随后只读查询当前 MVID、文档 identity/revision、文件路径和保存状态。当前会话的基础只读批次已接受。
2. 单墙历史 run `1fde38a1-ac13-4214-a5b9-9f4707603bab` 的 manifest/baseline/preview/confirmation/execution/readback/saved/reopen/visual 已归档。楼板当前 run 为 `a8218da0-d1c2-4877-acbf-141ce7891333`；楼板持久化/视觉证据继续追加到该 run，不重跑其基线。旧楼板 run `43a57c9c-b876-4d49-a572-668f7755a8be` 的 plan 已过期，禁止复用。
3. 每次只选择墙、楼板、门或窗中的一个明确能力。读取实际类型、标高、宿主、类别完整成员及相关原生元素范围；不要从历史 identity、revision 或 planId 重建。
4. 预览后取得对具体计划的确认；以独立 wx attempt marker 记录一次提交。断线先查询同一 planId，不重建或重试。本轮已按此规则执行一次；成功写入后核对 `architecturePrimaryVerification` 的阶段、元素数量和每项原生证据，再独立 inspect。
5. 失败回滚另用明确批准的主能力加失败哨兵场景，证明至少一个操作已执行、之后的操作失败。不得把预览拒绝当成执行回滚。`verifyArchitecturePrimaryRollback` 仅离线比较调用者提供的证据，不调用桥接、确认、保存或重启。
6. 每个 baseline/execution/readback artifact 绑定 `schemaVersion=1`、同一 runId/taskId/planId、`status=captured`、有效 UTC `capturedAtUtc`；时间按 baseline → execution → readback 排序。baseline/readback 记录完整 context 和 `snapshot={complete:true,truncated:false,categoryIds,items}`；execution 使用 `attemptId` 和嵌套 `receipt`，其中 receipt.planId 必须一致，receipt.status/code/进度/nativeChanges 必须为真实失败收据，不能用扁平字段替代。完整 scope 至少涵盖墙、楼板、门、窗及声明的依赖；所有已捕获字段参与比较，仅已知无序集合按既有策略规范化。revision 可以因回滚递增，不得回退或跨会话。
7. 离线回滚核验只证明捕获范围恢复，`allModelSideEffectsVerified=false`。独立快照必须完整且支持，修订覆盖和事件元数据不得截断。未提交创建不一定进入 DocumentChanged 的 ID 集合，因此原生 `captureComplete` / `elementEvidenceComplete` 可以为 false，必须原样保留；不能据此伪造事件 ID 完整或全部副作用通过，也不能把它等同于独立快照没有恢复。成功写入后由用户手动保存/重开，再读取同一文件和该能力相关范围，独立完成持久化与 PNG 视觉门槛。

## 状态

代码与隔离编译结果不替代 Revit 实机验收。能力当前状态以 `docs/capability-task-queue.json` 和对应 run 证据为准；旧来源矩阵结论及完整基础建模目标保持不变。

2026-10-19 写入前只读基线（历史阶段快照，已由后续 run 推进）：Revit PID `45492`、MVID `a47f13ad-fd6b-457a-a764-16bbf3d53d20`、文档 identity `99aa1b4ca8a9bebdf630d34f673515c8`、revision `0`。定向 run 的 3 个 scope 验证了 1F 标高、100 mm 基本墙类型及 13 面既有墙；空间范围检查显示机电管线最大约 X=62,000 mm、Y=52,000 mm。随后创建单墙预览并完成单项写入。

2026-10-15 验证结果：CoreTests 280/280；完整 MCP 套件 909 项，其中 908 通过、0 失败、1 跳过；新增离线验收及比较回归 29/29。Revit 2027.3 隔离编译 0 警告、0 错误，未注册。输出为 `bin/Release/architecture-primary-readback-20261015T152625Z/RevitAutoV27.dll`，SHA-256 `5C1A2E120D0AE9F506031CE168C5D245C848596B355EC92DD64BEE09D96A9B20`；构建与最终 MCP 输出 `mcp-tests-verified.log` 存于同一隔离目录。

2026-10-19 单墙验收结果：run `1fde38a1-ac13-4214-a5b9-9f4707603bab` 的墙 `2296040` 已完成 `visual-accepted`。执行、原生回读、手动保存及关闭重开记录均绑定同一 run 和 plan `463cb44f9cdc459ec8f9aa0d24bfad62`；重开后新文档 identity 为 `b811ce67462646d015583361ccbe58ab`、revision `0`、`isModified=false`，墙几何及类型仍与执行回读一致。现有 3D 视图 PNG 清楚显示目标墙，四张图像的归档哈希和尺寸已复核。该结果只接受这一面墙；失败哨兵回滚、楼板、门、窗及整体建筑主体仍待单独验收。

2026-10-19 楼板单项执行结果：run `a8218da0-d1c2-4877-acbf-141ce7891333`、plan `a3503d588dfe278a0e9d2f3d9eae6e6b` 在新会话 identity `ecd87ddcb273adfd2e3595d868eef060`、revision `0` 下只确认一次并提交。新楼板 ID `2296043` 的类型 `763936`、标高 `311`、offset `0`、非结构属性与批准操作一致；边界循环起点偏移 3 条后完全匹配 4 m × 4 m 输入。原有 35 个墙/楼板/门/窗快照不变，楼板类别计数 2→3。

- Revit 同一事务另报新增 ID `2296041`、`2296042`、`2296044..2296048`；依赖查询显示它们属于该 Floor/Sketch/SketchPlane 依赖集合，含四条轮廓线和一条跨方向边缘线。原生 `captureComplete=true`、`elementEvidenceComplete=true`，没有截断。
- 同一事务修改系统元素 `86962`（系统数据）和 `293247`（自动连接跟踪器图元）。两者无类别/位置、参数快照未显示可解释的值变化，且依赖结果没有证明它们与新楼板关联；这些副作用保持 unresolved，`allModelSideEffectsVerified=false`，任务当前 `blocked`，整体 `writeAccepted=false`。
- 执行后文档为 revision `1`、`isModified=true`；用户随后手动保存，详见下节。未自动保存、关闭或重启。

## 2026-10-19 楼板手动保存与当前会话核验

- 用户手动保存后，在同一 Revit 进程、插件 MVID `a47f13ad-fd6b-457a-a764-16bbf3d53d20` 和文档 identity `ecd87ddcb273adfd2e3595d868eef060` 下执行只读 `verification.saved`。revision 保持 `1`，`isModified=false`、`saved=true`，revision 0→1 变更历史完整且未截断；原 plan `a3503d588dfe278a0e9d2f3d9eae6e6b` 仍为 committed，没有再次确认或创建计划。
- 保存后再次读取 run 中全部 45 个原生元素，与提交后回读逐字段一致，包括楼板 `2296043`、7 个 Sketch 依赖和两个被修改系统元素。保存证据为 `acceptance/runs/a8218da0-d1c2-4877-acbf-141ce7891333/saved.json`。
- 用户随后手动关闭并重开同一路径文件。新 identity 为 `6998d61394e161463d79ba8bade402e8`、revision `0`、`isModified=false`；楼板 `2296043` 的 UniqueId、类型 `763936`、标高 `311`、4 条边界和完整 45 项原生范围与提交及保存后证据一致。最终持久化证据为 `reopen.json`（独立恢复记录为 `reopen-recovery.json`）；首次归档尝试的参数错误原样保留在 `reopen-attempt-error.json`，恢复核验没有重放模型写入或保存。
- 导出平面 `2295811`、`1F_综合3D` `770918` 及两个既有通用 3D 视图 `1054338`、`1847485`。平面裁剪范围不含楼板位置；两个通用 3D PNG 均显示远离建筑主体的独立 4 m × 4 m 水平板件，并可与相邻独立测试墙区分。完整图和局部审查裁图归档在同一 run 的 `visual/`，视觉记录为 `visual.json`，楼板视觉门槛通过。
- 楼板单项的保存、持久化及视觉门槛已接受，但系统元素 `86962`、`293247` 仍未分类，`allModelSideEffectsVerified=false`；因此整体写入仍不得标记 `write-accepted`，`architecture.primary-elements` 继续 `blocked`。没有自动保存、重启、计划创建或额外模型写入。
- 下一步先调查两个系统元素在事务中的修改来源和影响，证据不足时保持阻塞；解决后再分别验收门与窗。无需重启 Revit；不得重用旧 identity、revision 或 plan 创建新写入。

## 系统元素只读取证能力已编译

- 为识别事务记录中的 `86962` 和 `293247`，新增 `revit.element.storage_schemas`：只接受 1..20 个显式 element ID 及必需的 document identity/revision；读取元素已附着的 Extensible Storage schema GUID、可解析时的 schema 名称/vendor/application/access 和字段定义，不读取 Entity 值，不创建计划、写入模型或保存。schema 未加载、读取拒绝、元素缺失分别保留为未知状态；结果超过 GUID/字段/响应预算即拒绝，不截断。
- Revit API service、MCP schema/adaptor、旧插件 capability gate 和 CoreTests 已实现。MCP 定向 5/5、桥接门禁 33/33、CoreTests 299/299、完整 MCP 928 通过/0 失败/1 跳过；Revit `27.3.0.28` 隔离编译 0 警告/0 错误，`install-v27.ps1 -CheckOnly` 通过。
- 确切构建为 `v27/bin/Release/element-storage-schema-audit-20261019T/RevitAutoV27.dll`，MVID `93750ffe-f3da-4469-a7bf-8cf0f24de70e`，SHA-256 `643286C06FB6E55130FF299BE3AE09D8DDCF893644521007A3EF51CA1386D2F9`。此构建尚未注册或加载；当前 Revit PID `18024` 仍运行旧 MVID `a47f13ad-fd6b-457a-a764-16bbf3d53d20`，所以不能运行新工具。
- 下一步需先批准注册上述 SHA-256 对应的具体 DLL；注册后请用户手动重启 Revit，随后以新的 context identity/revision 只读查询 `86962`、`293247`。即使取得 schema 定义，也不等同于事件修改的前值或因果证明；`allModelSideEffectsVerified=false` 继续有效，整体任务保持 `blocked`。没有注册插件、重启 Revit 或触发任何模型计划。

## 2026-10-20 注册后实载核验

批准构建已注册并在 Revit 2027.3 PID `29888` 实载（MVID `93750ffe-f3da-4469-a7bf-8cf0f24de70e`）。在当前验收文件新 identity `a8e6f2e7a0c155cf879df01173dd4cd0`、revision `0` 下，`86962` 与 `293247` 的 schema 查询均完整返回零个附着 schema；记录见 `acceptance/runs/a8218da0-d1c2-4877-acbf-141ce7891333/storage-schema-audit.json`。该结果不恢复事务前状态。原事件只有事务名称和修改 ID，无写入前快照；副作用因果仍未证明，`allModelSideEffectsVerified=false`、整体 `writeAccepted=false`，任务保持 `blocked`。若无新的独立只读证据，不重复查询或重放写入。

## 2026-10-20 文档版本差异只读核验

- 新插件 MVID `51ec430d-e749-4205-ac99-d4217aead546` 已实载。当前文件 identity `6a31e4b3b31b93ca54eca8916b0d91bc`、revision `0`、`isModified=false`。
- 以 `.0024.rvt` 的 `BasicFileInfo.GetDocumentVersion()` 作为来源明确的版本基线：GUID `8b2c9938-1fa0-41d2-a8ff-423898411749`、保存次数 `51`、文件 SHA-256 `0F5180F55F02AA5EDEAF09ECB3720A9BF2F909AAEAD1B79ECEEC60F000B838CE`。当前版本 GUID 为 `756d4e46-dcc0-45cc-ac42-93a1e92971cc`、保存次数 `52`。
- `Document.GetChangedElements` 完整返回新增 `[2296041,2296042,2296043,2296044,2296045,2296046,2296047,2296048]`，修改 `[86962,293247]`，非工作共享文档删除历史不可用。结果归档于 `acceptance/runs/cb2e5c1f-8255-41a9-a8ab-76002a264a01/`。
- 该结果确认两个系统元素处于楼板事务之后的版本差异范围，但 API 只返回元素 ID，不返回事务前后属性或因果关系；`architecture.primary-elements` 仍保持 `blocked`，不重复创建楼板。

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

## 2026-10-22 单窗独立预览

- run `c38167b0-795c-40f7-a93a-3f331e5270c8` 在当前 Revit 会话获取接受的只读基线，MVID `51ec430d-e749-4205-ac99-d4217aead546`、identity `af6c5cd5caf6a4eceb0ba193e0dec5cb`、revision `0`、未修改。声明范围包含 37 个建筑实例、7 个相关类型和 2 个系统观察元素；现有门放置结果包含在基线中。
- 唯一候选为窗类型 `2285519`（C-3，1200×1800 mm）放置在既有测试墙 `2295754`，标高 `311`，位置 `(32000,3000,1200) mm`，唯一标记 `AI-ARCH-WINDOW-TEST-20261022`。宿主当前无窗。计划 `b00457dd56d457b91954c61ad934e5cb` 仅包含一个 `create_family_instance`，affected category 为 `OST_Windows`，无警告；预览摘要 SHA-256 `da07723ae32c7a4ea162f3d97b97b01f5dacefbc17480788beddd39483fbdf86`，2026-10-22 02:23:59.977（上海时间）到期。
- 以上记录为当时尚未确认的预览阶段；之后该计划已获批并只确认一次，详见下方“单窗执行与原生回读”及持久化/视觉归档。楼板系统元素修改因果仍未解决，整体建筑主体状态保持 `blocked`。


## 2026-10-22 单窗执行与原生回读

- 用户批准的单窗计划 b00457dd56d457b91954c61ad934e5cb 仅 Confirm 一次；回执 committed，创建窗 2296050。类型 2285519（C-3 / 1200×1800 mm）、宿主测试墙 2295754、1F 标高 311、位置 (32000,3000,1200) mm、mark AI-ARCH-WINDOW-TEST-20261022 均通过原生回读。窗类别由13增至14，其他已检查主元素类别及实例未变化。
- DocumentChanged 记录新增窗 2296050 和修改宿主墙 2295754。宿主几何保持一致，面积减少 2.160 m²、体积减少 0.216 m³，匹配 1.2m×1.8m 窗洞通过 100mm 墙；限定范围内无其它元素变化。全模型副作用仍未证明。
- 用户随后手动保存并关闭重开同一隔离副本。重开 identity `008cf16ba56beba595523718468fdf73`、revision `0`、`isModified=false`；`saved.json` 与 `reopen.json` 记录的 47 项声明范围及窗/宿主墙/类型快照与执行回读一致。关闭前没有独立机器快照证明 `isModified=false`，该限制原样保留。
- 重开后导出 `{3D}` 与 `{三维}` PNG，并在局部图中确认窗位于宿主墙开口内；视觉证据为 `visual.json` 与 run `visual/` 下的重开图和局部图。单窗状态达到 `write-accepted`、`persistence-accepted`、`visual-accepted`，未自动保存、自动重启或重复确认。
- 楼板系统元素 `86962`、`293247` 的修改原因及隐藏影响仍未解决，`allModelSideEffectsVerified=false`，故整体 `architecture.primary-elements` 继续 `blocked`；后续应只读调查该副作用，不重放已完成的楼板、门或窗写入。

## 2026-10-22 楼板副作用当前会话只读跟进

- 在当前重开会话以 identity `fc24a531d7ed8a7ca356c9f22b0c6f8f`、revision `0`、`isModified=false` 重新查询系统元素 `86962`、`293247` 的 schema 与逻辑依赖；查询过程中路径、identity、revision、保存状态保持不变，未创建计划、确认、写入或保存。
- 两元素仍为无类别/无类型的原生 `Element`，均没有附着 Extensible Storage schema。`86962` 的依赖集合为 `[86962, 2289997]`；依赖根 `2289997` 仍只有 5 个通用参数且没有 schema；`293247` 的依赖集合仅为自身 `[293247]`。该结果没有提供事务前后内部状态，也不能证明楼板事务的修改因果或无害。
- 证据归档于 `acceptance/runs/c38167b0-795c-40f7-a93a-3f331e5270c8/floor-side-effect-readonly-followup.json`。调查结论不改变 `allModelSideEffectsVerified=false`，整体 `architecture.primary-elements` 继续 `blocked`；不得重放已完成楼板、门或窗写入。

## 2026-10-24 单窗归档交叉审查与追加更正

- 新增离线 `audit <runId>` 后，原始 11 份阶段 JSON 及 5 张 PNG 的摘要保持匹配，但不能据此声明证据链一致。两处抄录错误被交叉校验检出：`reopen.json.previousSession.documentIdentity` 原值为 `e72c20cde63140f449ac35d6d733eda5a`；`visual.json.comparison.sourceBeforeDocumentIdentity` 原值为 `4441a0bb55ce60c332ac9ce5377383ce`。根据执行回读、基线及单门源 run `f526ac0b-f23d-4928-acb6-5a9161248695/reopen.json`，正确值均为 `af6c5cd5caf6a4eceb0ba193e0dec5cb`。
- `archive-review-20261024.json` 追加记录原值、更正值、权威来源字段和 SHA-256。原始文件、原摘要及既有受限验收结论保留；`audit` 对原始文件仍返回两个 finding 和退出码 1，不通过修改历史字节消除问题，也不触发保存、重开或新写入。
- 保存前没有独立机器状态快照，完整 47 项新会话原始回读对象也未归档，故无法单凭当前归档重跑完整持久化比较。两项限制已进入离线报告；既有报告的限定范围持久化和视觉结论保留，不能扩大成全模型等价。未来应保存完整原始对象并由同一比较器离线重算。
- 楼板系统元素调查已有的参数、schema、依赖查询没有新的因果线索；继续保持整体 `blocked`。仅在获得新的事务前证据或可靠 API 语义来源时再调查，不重复同一只读查询，不重放楼板、门、窗。
