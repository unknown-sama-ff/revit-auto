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

普通 TransactionGroup 和专用 StairsEditScope 的成功/失败回执均附 nativeChanges。失败后的观察可能含曾提交、后回滚的事件；失败回执仍不得凭事件集合重新提交计划。此前 rolledBack 字段由既有执行器决定，新证据本身不认定它已得到独立模型复查证实。

捕获器不会修改模型、创建额外事务、保存、删除警告、阻断人工操作或将未知元素作为默认安全类别。对象分类/参数/连接器副作用需要对当前元素作独立只读检查；删除对象只能保留历史ID，不保证可重新检查其内容。

## 自动化与发布边界（2026-10-08）

核心测试重放主要3元素而实际8新增/3修改、跨文档隔离、去重、删除/临时对象、容量截断、缺失事件/无效ID、不可变快照及序列化，另验证捕获不继承历史日志500元素上限。

MCP SDK模拟宿主验证 nativeChanges 完整透传、失败证据保留且不自动重试、plan.get 保留原回执、旧回执不虚构完整证据。源码契约验证捕获在有界日志之前、在 stale 检查之后、涵盖楼梯且按执行范围释放。

当前真实泵房测试的主要管道类型、DN80、系统分类和弯头双向连接已验证，用户手动保存后当前会话复查无待保存修改。但实际事务额外新增和既有内部元素修改仍有审阅缺口，不能把整个 pump_room.build 标为已迁移并验收。验收数据仅存本地忽略目录，不上传仓库。

新原生代码已编译在独立暂存目录，未切换安装清单或要求用户重启。发布前必须加载具有 native-change-receipts 能力的产物，再对经聊天批准的成功、失败/回滚、no-op 计划做实机验收，比较回执与原生历史/元素 readback；关闭重开、独立磁盘保存验证及干净安装也是单独门槛。
