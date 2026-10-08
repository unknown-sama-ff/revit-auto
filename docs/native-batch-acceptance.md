# 集中原生候选版验收

本阶段不继续将源码测试累计数当作原生功能已完成，而是集中加载已编译能力：原生变更收据、楼梯清理证据、UI 线程审计快照、电气回路审计、洞口和严格楼梯几何。

## 加载判据

`revit.bridge.info` 返回程序集实际 `informationalVersion`（含源码 revision）、`moduleVersionId` 和进程 ID。附加模块中的 **Revit AI → AI 连接状态** 显示同一编译版本。

插件启动不增加自动弹窗；没有加载提示窗口并不能证明没加载。以连接状态与真实 MCP 返回的编译指纹/能力为准，不凭 DLL 存在、清单已更新或相同的 `0.4.0` 数字宣布新版已运行。

## 重启后的第一批只读检查

在用户手动保存、重启并打开已指定的测试副本后执行：

```powershell
$repo = 'C:\src\revit-auto'
$build = '从候选版编译记录取得的完整 informationalVersion'
$project = 'C:\test-models\TEST_COPY.rvt'
$record = "$repo\acceptance\new-native-read-check.json"
node "$repo\mcp\native-readonly-acceptance.mjs" $build $project $record
```

检查要求：

- 必须与指定编译版本、当前测试项目和本次宿主进程匹配；
- 必须有 build-fingerprint、native-change-receipts、stair-cleanup-evidence、ui-thread-audit-snapshot、electrical-circuit-audit、native-opening、explicit-stair-geometry；
- 通用审计必须是已固定 identity/revision 的 UI 快照；
- 电气直接工具与统一工作流必须返回等价的原生读取证据；
- 查询前后已知的文档 identity、revision、路径、isModified、元素统计必须一致；
- 没有模型计划创建、确认、保存或自动应用重启。

新记录必须位于当前包的 acceptance 目录且不能覆盖已有记录。证据仅保存在本机，不随源仓库发布。

## 不证明的内容

`PASS_NATIVE_READ_ONLY_CONTRACT` 只证明本次 loaded-build/查询契约；不证明完整电气功能矩阵、字段工程正确性、模型写入/回滚、楼梯与洞口实际几何、磁盘重开或真实 Claude/Codex UI 会话验收。unknown/truncated 结果保持原样，不当作完整审计。

后续写入验收必须逐项新预览、聊天确认、单次提交、原生读回、副作用核对。楼梯和洞口不能复用历史计划的确认。新 DLL 安装后由用户手动重启；等待期间停止提示/轮询，不为“加载新版”擅自关闭或保存应用。

## 2026-10-09：本次加载与只读检查

已在重启后的实际 Revit 2027.3 中核对 `0.4.0+ffa1d98…` 和新模块身份，第一批工具契约通过。默认预算截断被如实披露；随后使用明确的 128 参数预算完成独立原生电气字段对照。只读状态/元素统计保持一致，没有模型写入、保存或 plan.confirm。新版变更收据、楼梯/洞口几何及回滚仍需单独新预览与用户聊天批准后验证，不能凭 loaded features 推断已通过。

## 2026-10-09：首项经批准写入测试

单项注释计划已按该计划的明确聊天批准提交一次，参数与保护字段读回核验通过；原生收据完整披露目标及额外两个对象修改，并与独立事务历史一致。新增/删除均为空，不自动保存。额外内部对象变化的无害性仍未知，完整副作用认证、失败回滚、no-op 和保存后持久性尚未完成。当前等待用户手动保存，再做同一计划/文档的只读复查；不再次调用 plan.confirm。
