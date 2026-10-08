# 楼梯异常清理与取消：发布安全合同

## 缺陷

原楼梯执行路径吞掉 scope.Cancel() 的异常，并对任何失败硬编码 rolledBack=true。自动平台失败后一次样板 readback 验证过回滚，不代表所有失败路径都能据此声明恢复成功。Scope.Commit 已返回后发生 readback 异常也不能自动调用 Cancel 并认为模型未创建。

## 修复

取消信号传入 ExecuteStair；在编辑范围开始前、每段直跑前、每个自动平台前、普通子事务提交前、StairsEditScope 提交前检查。单个原生 API 调用内部不能由这些检查强制抢占。Scope.Commit 返回后不再因新到达取消信号主动抛取消异常；首先获取本次原生结果或返回 readback 不确定证据，防止已执行结果被误当成未执行。

失败回执不硬编码 rolledBack=true，增加 rollbackStatus、rollbackVerified=false、cleanupEvidence。原 BridgeException 的 causeCode、causeDetails 和事务警告保留；取消调用异常类型明确记录，而不覆盖原始建模失败。

rollbackStatus：

- not-started：记录到的范围开始尚未尝试；不执行额外取消动作，不宣称已回滚。
- cancel-returned-unverified：取消动作正常返回；没有独立模型恢复证据。
- cancel-failed：取消动作抛异常；记录 CancelErrorType，等待原生检查。
- scope-commit-returned-unverified：编辑范围提交调用曾返回，后来 readback 失败；可能存在已提交模型，不自动取消、不自动重建计划。
- unknown：诊断不可用或执行器之外异常；不填造清理状态。

cleanupEvidence 包含阶段、范围开始/提交返回状态、取消是否尝试和返回、异常类型及 requiresNativeInspection。未知布尔字段可能省略；省略不是 false 的工程结论。诊断对象只记录第一次取消结果，不以读取诊断为由重复取消。整个失败计划仍不可盲目重试。

## 与原生变更回执的关系

nativeChanges 保留期间发生的事件，包括曾提交又撤回的观察。无论是否完整，它都不自动证明最终净差异或回滚恢复。即使取消正常返回，客户端还需要通过原生元素、关键参数、连接器、依赖和模型状态核验；本修复不将未知设置为默认成功。

既有普通 TransactionGroup 路径的状态判定未在本次替换；本合同专门纠正 StairsEditScope 的清理误报。

## 验证与发布边界（2026-10-08）

纯核心测试模拟取消正常返回、取消失败、Start 抛错、尚未开始、Commit 返回后读回失败、重复诊断不重复取消、原因/警告保留和取消错误码；SDK/std​​io 模拟确认及 plan.get 验证不确定状态完整透传、没有虚构 rolledBack=true、不触发计划重建或保存。源码合同验证取消检查的集成位置与无吞异常模式。

代码编译在独立 release-safety 暂存目录，未部署，未执行新的样板写入。发布前仍须一次统一部署后在用户批准的测试计划中验证原生成功、错误、取消及回滚 readback，特别是清理失败/结果不确定时的诊断；自动平台几何、楼梯工程正确性和保存重开是另行验收事项。
