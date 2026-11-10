> 发布副本说明：本机路径、模型名称及运行标识已匿名化。原始私有证据未随源码发布；历史验收不代表当前会话授权或完整业务认证。

# 图纸元数据与放置联合预检

- taskId：`documentation.sheet-metadata-and-placement`
- 本批范围：优化现有 Node MCP 只读预检；不新增模型操作或扩大工作流输入。
- 代码门槛：本批为 `core-tested`；所属任务保留既有 `compiled`，不提升原生只读、写入、保存重开或视觉门槛。
- 当前 Revit runId：无。本批只有模拟回归，不创建或确认真实模型计划。

## 调用流程

`electrical.sheet` 同时包含 `sheetChanges` / `viewChanges` 和 `placementMoves` 时，先将显式元数据、放置实例、所属图纸及源视图 ID 合并去重，再按每批最多 100 个元素调用 `revit.inspect`。元数据与放置复核消费本次调用内的同一份 Map；图纸编号冲突目录仍按原有独立分页流程读取。

`reviewDrawingPlacementScope(input, nativeItems)` 只复核关系和几何，不认证会话新鲜度。它验证请求的每个元素仍存在、summary.id 与 Map 键一致、类别/归属/源视图以及位置证据满足原合同。它不访问桥接、不修改输入、不创建计划。缺项、null、数组或不一致元素均返回受控错误。

`inspectDrawingPlacementScope(input, call, signal)` 每次自行读取原生数据，不接收可复用的外部缓存。Map 不跨调用、会话或 revision 保存。独立放置预检保留原 scope、安全标记和 `drawing_placement_scope_unknown` 错误码。

统一规划器在读取前后继续核对 identity、revision、文件路径和保存状态；变化时在创建预览前停止，不重读或自动重试。每个原生批次返回后再次检查取消状态，已取消调用不能返回通过结果。

## 证据字段

- `inspectedElementIds` / `inspectedElementCount`：本次唯一请求范围。
- `inspectionBatches`：本次实际原生 inspect 批次数，不包含编号目录查询或上下文读取。
- `inspectionDeduplicated`：输入范围存在重复 ID 并已去重；这是调用计数信息，不代表实机耗时基准或原生验收通过。
- `inspectionSnapshotShared`：元数据和放置复核是否共享本次读取结果；独立放置检查为 false。

模拟回归中的共享图纸/视图场景由两次 inspect、共 5 个请求 ID，减少为一次、3 个唯一 ID；101 个放置实例共享图纸与视图时为 103 个唯一 ID，分成 100＋3 两批。

## 保留的边界

图框更换仍为独立单操作。视口标签的独立操作限制不变；本批没有给 `architecture.documentation` 增加元数据输入。AL1 和 E101 既有写入结果不重放、不重新移动。

共享只读检查不合并写入验收；后续仍按元数据、放置、图框和标签分别创建新的单能力 runId。当前的 `nativeMovementAccepted`、`allModelSideEffectsVerified` 或 `fullLegacyParityVerified` 不因去重而提升。

## 后续任务

当前源码已完成 CoreTests 和版本化隔离编译，具体 DLL 已于 2026-10-16 获用户批准并单次注册，回执为 `REGISTERED_MANUAL_RESTART_PENDING`。下一步由用户手动重启 Revit 并打开同一已保存测试副本；先只读核验实际 MVID、文档身份/修订与范围，再在同一插件会话合并只读基线。metadata、placement、titleblock、创建图纸/放置和标签仍分别使用新的单能力 runId；不把本批模拟预检或旧 AL1/E101 证据当作写入闭环。

当前切片已补齐 `move_drawing_placement` 的 C# 回读门禁：执行后、事务提交前和提交后都复核 placement 类别、sheet/view 归属及纸面 XY；原生 Z 只作为证据保留。回执新增 `documentationVerification`，但 `sideEffectsVerified`、`persistenceVerified`、`visualVerified` 继续为 false。新建图纸与放置创建也已接入独立的 `DocumentationCreationReadbackService`，最新源码已编译，实载和实机验收仍待完成。

四项既有文档元数据参数现已进入同一回读门禁：`BIP:SHEET_NUMBER`、`BIP:SHEET_NAME`、`BIP:VIEW_NAME`、`BIP:VIEW_SCALE_PULLDOWN_METRIC`。setter 返回后、事务提交前和提交后均按目标元素类别、参数名和值复核；回执新增 `documentationMetadataVerification`，未知存储类型或实际值不一致会回滚。该门禁不覆盖保存重开；新建图纸/放置与图框更换已有独立原生回读服务，仍需分别实机验收。

图框类型更换也已加入同一回读闭环：记录更换后的实例，提交前和提交后复核 ViewBased 图框类别、所属图纸、目标 FamilySymbol、完整图框成员、位置/旋转和依赖存在性；回执新增 `documentationTitleBlockVerification`，不提升副作用、持久化或视觉状态。

新建图纸与放置现按源视图类型绑定原生类别：`ViewSchedule` → `ScheduleSheetInstance`，`PanelScheduleView` → `PanelScheduleSheetInstance`，其他视图 → `Viewport`。图纸回读同时区分图框实例 ID、图框类型 ID 和请求的目标类型；`ChangeTypeId` 替换图框后使用原生返回的新实例 ID继续绑定回读，避免将 FamilySymbol 类型 ID 当成图框实例 ID。上述规则只认证当前事务内的原生字段，不提升副作用、保存持久化或视觉状态。

## 验证记录

本轮 CoreTests 为 292/292；图纸 placement、创建回读、图框及规划定向回归为 38/38。Revit 2027.3 隔离构建 0 警告、0 错误，最新 DLL 为 `v27/bin/Release/documentation-creation-readback-20261016T-final/RevitAutoV27.dll`，SHA-256 为 `E9475D51AC979DEEDA5066F8909D700A3C11032BEDBC5A096C32255672D517EB`。没有调用真实 Revit 桥接、创建模型计划、写模型、保存或重启；实机只读基线仍待加载该具体构建后的手动重启。

2026-10-16 用户批准该构建注册后，具体请求 `ff8b9d2a513b5503e0a935b05415b547` 经独立复核，只 Confirm 一次。安装清单回读、原清单备份和受保护配置核验通过；已注册 MVID 为 `a47f13ad-fd6b-457a-a764-16bbf3d53d20`。回执位于私有 `runtime/registration-switch-receipt-ff8b9d2a513b5503e0a935b05415b547.json`，状态 `REGISTERED_MANUAL_RESTART_PENDING`。本步骤未连接 Revit、未创建模型计划、未修改模型、未保存或重启；任务门槛保持 `compiled`。
