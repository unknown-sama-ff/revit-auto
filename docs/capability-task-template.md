# 能力任务卡模板

复制本模板，为每个建筑、结构、机电、电气或图纸能力建立一张任务卡。任务卡是开发入口，完整原始证据放在 `acceptance/`。

日常推进仅更新发生变化的字段，并遵循 [默认精简执行](development-flow.md#默认精简执行2026-10-27)。已有契约、测试和实机结论通过引用复用；不因换会话重填任务卡或重新走全部阶段。简单修复不额外生成设计/计划文档；仅在引入新输入、改变执行边界或存在实质方案选择时补充必要设计。

新能力或实质契约变化才使用完整模板；普通修复直接更新原任务。每轮只写交付目标、实际改动、复用的证据和按流程表选择的检查。上游引用/移植复用THIRD_PARTY_NOTICES中的版本、许可和改动记录，不另写重复清单。

## 基本信息

- taskId：
- 能力名称：
- 专业层：基础数据 / 建筑 / 结构 / 机电 / 电气 / 文档 / 生命周期
- 来源矩阵条目：
- 负责人或当前会话：
- 依赖能力及本步骤所需子范围/门槛：
- 目标 Revit 版本：
- 当前状态：contract-ready / core-tested / compiled / readonly-accepted / preview-accepted / write-accepted / persistence-accepted / visual-accepted / blocked
- 状态更新时间：
- 当前阻塞（如有）：

## 契约

- 输入字段：
- 单位和坐标约定：
- 必须读取的上下文：
- 明确拒绝条件：
- 生成的结构化操作：
- 主要结果字段：
- 允许的假设：

## 验收阶段

只核验适用阶段。契约、测试和编译引用对应文档/日志/构建标识即可；真实 Revit 阶段填写 runId。不适用项注明原因，不勾选为已通过；只读任务不建立模型 plan 或要求保存重开。

- [ ] contract-ready（契约/变更点引用：）
- [ ] core-tested（测试范围与日志引用：）
- [ ] compiled（构建目录/标识及日志；Node-only写不适用：）
- [ ] readonly-accepted（证据 runId：）
- [ ] preview-accepted（证据 runId：）
- [ ] write-accepted（证据 runId：）
- [ ] persistence-accepted（证据 runId：）
- [ ] visual-accepted（证据 runId：；不适用时写明原因）
- [ ] blocked（blocker、复现证据、解除条件：）

## 运行记录

- 当前 runId：
- summary：
- 本轮变化阶段及其证据引用（其余通过summary查，不逐项复制路径）：
- 复用的历史结论及其适用范围（不得复用旧会话pin或动作批准）：
- 待合批的DLL修改、是否确需当前加载及原因（Node-only写不适用）：

## 限制和阻塞

- 已知未知值或未覆盖副作用：
- 失败复现：
- 解除阻塞所需条件：
- 下一步：
