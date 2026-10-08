# 原生事务变更回执：发布验收合同

## 缺陷和修复目标

执行器原有 createdElementIds / changedElementIds 只列出每项操作返回的主要对象。真实管道/弯头创建会伴随 Revit 系统、中心线和内部元素变化；这些不一定出现在主要对象回执中。因此不能把主要元素列表等同于完整模型变化，也不能据此宣称所有原有元素均未修改。

新回执保留这两个兼容字段，新增 nativeChanges；使用原有 DocumentChanged 订阅记录一次执行期间的原始 ID 数组，独立于有限容量的历史日志。在统一线程队列中，只捕获同一文档，从最后一次 identity/revision 检查之后开始，到执行返回时释放；既有提交计划再查询不会重新捕获或执行。

## 数据字段

- evidenceKind=document-changed-event-union：本次执行发生的事件 ID 集合，不是磁盘结果或最终净差异。
- observedAddedElementIds / observedModifiedElementIds / observedDeletedElementIds：该集合中的新增、修改、删除；不能省略后台系统变化。
- additionalAddedElementIds：原生新增集合减去操作返回的主要创建 ID。
- unreportedModifiedElementIds：原生修改集合减去主要创建/修改 ID；这些需要审阅，不能默认无害。
- observedThenDeletedElementIds：执行期既新增又删除的对象，可能来自临时过程或回滚，不代表最后仍然存在。
- events：有界 revision、operation、事务名和各类原始观察数量，用于核对执行范围。
- revisionCoverageComplete / elementEvidenceComplete / captureComplete：版本事件覆盖、元素覆盖、整体捕获完整性分别说明。
- elementIdsTruncated / eventMetadataTruncated：容量超过或元数据过长时明确披露。
- netModelDiffVerified=false / sideEffectsVerified=false：捕获证据从不自动变成模型净差异、工程副作用安全或回滚通过结论。

默认每类最多10000个去重ID、128项事件元数据；每事件最多3个事务名且每名500字符。元数据截断不掩盖独立的元素覆盖状态。无事件且没有主要创建/修改是合法 no-op；主要对象改变但未收到相应事件则不能判为完整。

## 普通与楼梯执行

普通 TransactionGroup 和专用 StairsEditScope 的成功/失败回执均附 nativeChanges。失败后的观察可能含曾提交、后回滚的事件；失败回执仍不得凭事件集合重新提交计划。普通执行器的 rolledBack 字段仍由既有原生事务状态判定。楼梯暂存版本已取消硬编码成功，返回 cleanupEvidence / rollbackStatus / rollbackVerified=false，详见 docs/stair-cleanup-evidence.md。新事件证据不将取消正常返回认定为已独立模型恢复。

捕获器不会修改模型、创建额外事务、保存、删除警告、阻断人工操作或将未知元素作为默认安全类别。对象分类/参数/连接器副作用需要对当前元素作独立只读检查；删除对象只能保留历史ID，不保证可重新检查其内容。

## 自动化与发布边界（2026-10-08）

核心测试重放主要3元素而实际8新增/3修改、跨文档隔离、去重、删除/临时对象、容量截断、缺失事件/无效ID、不可变快照及序列化，另验证捕获不继承历史日志500元素上限。

MCP SDK模拟宿主验证 nativeChanges 完整透传、失败证据保留且不自动重试、plan.get 保留原回执、旧回执不虚构完整证据。源码契约验证捕获在有界日志之前、在 stale 检查之后、涵盖楼梯且按执行范围释放。

当前真实泵房测试的主要管道类型、DN80、系统分类和弯头双向连接已验证，用户手动保存后当前会话复查无待保存修改。但实际事务额外新增和既有内部元素修改仍有审阅缺口，不能把整个 pump_room.build 标为已迁移并验收。验收数据仅存本地忽略目录，不上传仓库。

新原生代码已编译在独立暂存目录，未切换安装清单或要求用户重启。发布前必须加载具有 native-change-receipts 能力的产物，再对经聊天批准的成功、失败/回滚、no-op 计划做实机验收，比较回执与原生历史/元素 readback；关闭重开、独立磁盘保存验证及干净安装也是单独门槛。

## 2026-10-09：成功路径原生实测（限定范围）

已在实际加载 `0.4.0+ffa1d98…` 的 Revit 2027.3 测试副本上，按新预览及本次明确聊天批准执行一项注释修改，plan.confirm 仅发送一次。参数读回正确，目标类型/位置、连接器和电气关系、其他参数及模型分类统计在已读取范围内保持一致；没有新增/删除元素或自动保存。

主要回执只列目标灯具，原生 DocumentChanged 另记录系统浏览器与一个无法从公开字段识别工程角色的 Element 被修改。两者均已只读检查，但缺少执行前完整快照，**不能认定其内部变化无害**。独立 changes.get 事务历史与此次收据的新增/修改/删除集合一致，captureComplete=true、无截断；netModelDiffVerified/sideEffectsVerified 继续为 false。

这证明本次成功路径的事件捕获与历史对照，不证明全部模型净差异、其他专业无副作用、失败回滚/no-op、重复确认实测或磁盘保存/重开。待用户手动保存测试副本后复查；不自动还原注释、再执行该计划或沿用此批准创建回滚测试。具体元素和完整原生记录仅保存在本地忽略的 acceptance。

## 2026-10-09：手动保存后会话复查

用户报告手动保存后，仅查询同一测试副本、已提交计划和目标原生字段：isModified=false，原计划回执不变，已批准的注释和目标读回证据保持一致，分类统计未变化；没有第二次 plan.confirm、模型写入或自动保存。此证据证明当前会话无待保存修改，不证明关闭重开后的磁盘持久性，也没有消除两个额外内部元素变化的未知副作用。

下一失败/回滚测试使用新预览，先创建临时标高，再对该临时元素的已核实只读参数触发执行期错误。只生成预览，现有灯具/标高不修改；待单独聊天批准后才执行。预期回滚不是事实证据，必须核对失败阶段、回执/历史、临时元素消失和原模型基线；失败计划不可重试或自动清理。

## 2026-10-09：失败/回滚路径原生实测（限定基线）

新的临时标高两步预览按本次明确聊天批准提交一次：第一步完成创建，第二步因新元素只读参数校验失败；failedOperationIndex=2、completedOperationCount=1、原生状态 rolledBack=true。随后按临时元素名称和真实失败消息中的 ID 独立查询，元素均不存在；原标高集合、分类统计和事先记录的保护对象读回与基线一致。原计划状态为 failed，没有重复提交、额外清理或自动保存；当前 isModified=false，revision 仍因原生回滚事件递增。

DocumentChanged 与独立原生历史均记录一次 TransactionRolledBack，事件 ID 集合为空。临时元素在尚未提交事务中创建又被回滚，捕获器没有对应新增 ID 证据；revisionCoverageComplete=true，但 elementEvidenceComplete/captureComplete=false，未被改写为完整。声明基线恢复由独立名称/ID/集合/字段读回支持，不由空事件集合推断，netModelDiffVerified/sideEffectsVerified 仍为 false。此结果不是全模型恢复、楼梯/洞口回滚、其他业务写入或磁盘重开证明。

下一 no-op 测试只生成新的同值参数预览，等待新的聊天批准；不沿用回滚批准，也不把 failed 计划重新提交。实际 no-op 的事件、revision、主要 changed IDs 与数据不变状态必须独立读取，不能事先假定。
