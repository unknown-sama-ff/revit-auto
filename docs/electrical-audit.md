# 电气回路只读审计：受控迁移

本轮实现旧 `audit-final.csx` 的核心读取意图：项目类别统计与警告、原生电气回路号、负载名、配电箱、回路终端成员及其标记，以及回路参数的原生值/显示值/只读属性。普通助手不能运行原脚本、传入 `.csx` 路径或执行任意 C#。

## 接口

统一入口：`revit.workflow.run`，`name: "electrical.audit"`；`audit.electrical` 是同一读取适配器的兼容名称，结果中的规范 workflowId 是 `electrical.audit`。

直接 MCP：`revit.electrical.audit`，实际工具名 `revit_electrical_audit`。工具标记为 read-only、不破坏模型、不创建计划。

助手从当前 `revit.context.get` 读取 documentIdentity/revision。允许字段：

- `documentIdentity`：直接接口必填；统一工作流顶层必填。
- `expectedRevision`：可选；0 是有效版本。未提供时固定本次首读版本，不冒充先前已审阅的版本。
- `circuitIds`：可选、1–200 个唯一原生电气回路 ID；提供时只审这些回路，任何不存在或非回路 ID 都拒绝，不默默跳过。省略时查询当前激活文档的回路。
- `maxCircuits`：1–200，默认 100。显式所选回路必须全部位于该预算内；全项目查询超预算则明确返回 scope.truncated。
- `maxMembersPerCircuit`：1–500，默认 100；整个报告的终端成员预算为 5000。
- `maxParametersPerCircuit`：1–128，默认 64；整个报告的参数预算为 2000。

统一工作流 `input` 只能包含上述字段；嵌套 identity/revision 不能与顶层冲突。需求缺少电气容量标准时此读取接口不自行创造规则，而是返回证据供用户/助手审阅。

## 原生证据

Revit 的回路 `Elements` 是终端成员，**不含配电箱**；配电箱由 `BaseEquipment` 单独读取。成员按实际 ID 排序，不把数组索引当作端口或元素 ID。

每个字段用 `state/supported/value/errorType/error/truncated` 区分：

- `known`：已读到原生值，包括真实的 0、false、原生无效 ID 值；不把这些改成默认值。
- `known-null`：已知原生缺值/未分配；JSON 可省略 value，但 state 明确保留。
- `unknown`：getter 不可用、枚举异常或非有限数；不会当成未分配、零容量或正常连接。

参数包括原生 ID、名称、StorageType、readOnly、hasValue、dataTypeId、raw value 和 formattedValue。数字 raw value 使用 Revit 原生内部约定，不能直接当作毫米/伏特/瓦输入值；显示字符串仅是读取证据。每个字符串最多 2048 字符，超出显式 truncated；诊断最多 400 字符。参数未赋值时 raw value 为已知缺值，不用 `AsDouble` 的默认 0 冒充赋值。

scope、memberAudit、parameterAudit 均披露总数、已返回数量与截断/读取异常。`complete` 只表示本次声明范围与读取预算内的证据覆盖；scope=explicit-circuit-ids 时不是完整项目审计。模型警告最多 200 条，counts 是当前文档类别统计，不局限于所选回路。工程规范、容量、保护配合、真实水力/电气设计与磁盘保存都没有被插件认证：`engineeringComplianceVerified=false`。

## 执行安全

- NativeReadSnapshot 在 Revit ExternalEvent/UI API 上下文内把结果冻结成 JSON 数据；桥线程只序列化数据，不继续枚举 Revit wrappers。
- 原生端和 MCP 端都检查 identity/revision；MCP 前后另核对路径和 isModified。变化、来源错误或缺少可信快照标记时丢弃报告，不重试。
- 单次原生读取时间预算 20 秒；取消在回路、成员、参数循环中检查。超预算、读取响应超 8 MiB 时明确报错并建议缩小范围，不创建/重试写入。
- 无事务、创建、删除、修复、自动保存、外部文件打开或权限绕过。
- 旧运行插件缺少 `electrical-circuit-audit` 时桥会在发送审计方法前拒绝；源码可发现工具不等于旧 DLL 已拥有该能力。

## 2026-10-08 验证状态

已完成源码、核心测试、公共 MCP SDK/stdio 模拟测试和 Revit 2027.3 API 独立暂存编译。新增原生快照与电气回路审计 **尚未安装到当前运行 Revit，也未完成原生实机验收**。迁移矩阵 `audit-final.csx` 为“已迁移但未验收”，不能升级为已验收。

实机验收需要在批次安装后的运行插件上核验能力、读取基线、对比真实 circuit.Elements/BaseEquipment/参数、检查 unknown/truncated、查询前后 identity/revision/保存状态不变。不需要为只读审计制造写入计划或人为修改样板；不要求保存不存在的模型变更。

## 2026-10-09：已加载的原生只读验收

候选程序集 `0.4.0+ffa1d98f18983579c828cc36d7c17c9355fc0eca` 已通过实际 bridge.info 编译指纹和模块标识核对，新增原生能力已加载。固定测试副本、文档身份/版本、UI 审计快照和直接/统一电气查询契约均通过；查询前后模型状态及元素统计不变，没有计划提交、保存或应用操作。

默认 `maxParametersPerCircuit=64` 会在每回路原生参数数量超过预算时如实标记 `complete=false`。本次发现的不完整来自该预算截断；明确提高到 128 后，声明范围没有截断或未知字段，并与独立 `revit.inspect` 的原生回路成员、配电箱、标记/类型及参数元数据/值逐项对照通过。未赋值参数保持 known-null，不用原生 getter 的默认 0 冒充值。现有模型警告原样保留，不清理、不转换为工程规则。

`audit-final.csx` 对应来源现标为“已迁移并验收”，**仅限当前文档的有界只读审计范围**。这不表示照明/电气建模写入、回滚、容量/规范、独立磁盘重开、真实 Claude/Codex UI 联调或其他矩阵项已验收。完整实机证据仅保存本地 acceptance，不上传模型/原始检查结果。
