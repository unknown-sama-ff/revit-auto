# 验收编排流程重构设计

## 目标

在不缩小 Revit 基础建模覆盖目标、不重做已完成能力、不修改模型的前提下，把开发、实机验收和归档整理成一条可追踪流程。旧版来源矩阵仍是业务覆盖清单；本设计只改变推进顺序、证据关联和恢复规则。

## 固定生命周期

所有能力统一经过：

`登记 → 契约 → 核心实现 → 模拟测试 → 隔离编译 → 只读实机基线 → 预览 → 确认 → 单次执行 → 原生回读 → 保存/重开 → 归档`

确认是独立闸门。它必须绑定当前 `runId`、预览哈希、planId、文档 identity/revision 和插件 MVID。保存和重开分别记录；重开后的原生 session identity 可以变化，但模型文件摘要和声明范围必须比较。

## 状态和证据

能力使用 `contract-ready`、`core-tested`、`compiled`、`readonly-accepted`、`preview-accepted`、`write-accepted`、`persistence-accepted`、`visual-accepted`、`blocked`。状态由证据门槛推动，旧矩阵的 `acceptanceStatus` 不被自动改写。

新运行使用 `acceptance/runs/<runId>/`，包括 manifest、baseline、preview、confirmation、execution、readback、saved、reopen、visual 和 summary。`mcp/run-evidence.schema.json` 固定字段，`mcp/acceptance-run.mjs` 只负责创建空的 run scaffold，不连接 Revit、不保存、不重启、不创建计划。

## 队列和批处理

`docs/capability-task-queue.json` 是当前任务排序和 blocker 的唯一机器可读来源，按基础数据、建筑主体、结构、机电/电气、文档、生命周期和发布排序。同一插件 MVID、Revit 会话和文档 revision 的只读检查合并到一次基线批次；每个能力保留独立子结果。写入验收一次只覆盖一个明确能力。

超时或断线先查询原 plan/attempt 状态。旧 identity、revision、过期 planId 和旧批准不可复用。许可证、插件加载、族/类型、宿主或保存重开阻塞必须记录解除条件。自动保存/重启按用户决定保持 blocked。

## 不在本设计内

本轮不新增建模能力，不调整 Revit 模型，不创建或确认模型写入计划，不自动保存或重启，不把旧 PNG、旧 runtime 证据或历史对话当作当前执行凭据。
