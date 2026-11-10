# 只读验收合批

`mcp/readonly-batch.mjs` 把同一 Revit 进程、插件 MVID、文档 identity 和 revision 下的只读检查合并为一次基线运行。

批次输入是显式 scope 数组，每项包含 `id`、MCP `tool`、可选 `args` 和关联的 `taskIds`。编排器只接受 MCP 契约声明为 `readOnlyHint=true` 且 `destructiveHint=false` 的工具，并拒绝 workflow、plan、commit、save、restart 和 lifecycle 写入入口。

运行前先验证全部 scope 的 MCP 工具存在、声明 `readOnlyHint=true`/`destructiveHint=false`，且 schema 同时支持 `documentIdentity` 和 `expectedRevision`；加载的插件还必须报告 `readonly-query-pins`。有冲突的 scope pin 会在执行第一个查询前统一拒绝。运行顺序固定为：读取 `bridge.info` 和 `context.get`，给全部 scope 注入 identity/revision，逐项执行一次，最后再次读取 context 和 bridge.info。CLI 必须同时指定 informational version 和获批程序集的 MVID。子进程只对明确列出的只读原生方法启用最长两分钟的 bridge 信息缓存；写入入口始终新鲜检查，批次结束仍由父进程重新核验 MVID/PID/版本。任一 scope 失败会保留独立错误并继续其它只读 scope；scope 根结果若声明 `readOnly=false`，或任意深度出现写入、保存、重启或自动重试标记，整项会被拒绝。Revit 参数对象上的嵌套 `readOnly` 表示该参数是否可编辑，不代表查询修改了模型。文档 counts、identity/revision、插件 MVID 或 Revit PID 漂移时，整批证据为无效。

baseline 同时保存本次实际参与校验的 MCP 工具描述（`revit_context_get` 以及每个 scope 工具）和其规范化 JSON 的 SHA-256。归档器会重新计算哈希，并确认每个 scope 都存在于该快照、仍声明只读且支持两个文档 pin；篡改工具名、注解、schema 或哈希会拒绝归档。快照用于证据完整性和复核，不能替代 MCP 客户端在调用前执行的契约检查。

只有 `isModified=false` 的文档才能得到 `status=accepted`；读取稳定但仍有未保存修改时，结果为 `unknown`，不得用作保存文件的基线。

## 使用

先为任务创建空 run：

```powershell
node mcp/acceptance-run.mjs init foundation.current-session-readonly-batch
```

准备一个 scope JSON，例如：

```json
[
  {
    "id": "levels",
    "tool": "revit_search",
    "args": { "category": "OST_Levels" },
    "taskIds": ["foundation.current-session-readonly-batch"]
  },
  {
    "id": "electrical-audit",
    "tool": "revit_electrical_audit",
    "args": { "maxCircuits": 10 },
    "taskIds": ["mep.electrical-circuit-existing-members"]
  }
]
```

再使用当前已加载程序集的 informational version 和已批准 MVID 执行：

```powershell
node mcp/readonly-batch.mjs `
  --run-dir acceptance/runs/<runId> `
  --project D:\path\to\TEST_COPY.rvt `
  --build 0.4.0+build `
  --mvid APPROVED_MODULE_VERSION_ID `
  --scopes scopes.json
```

成功后只会新增 `baseline.json` 并原子替换 `manifest.json`。写入器要求 run 是仓库 `acceptance/runs/` 下的直接真实目录，manifest 必须是合法 UUIDv7/taskId 且仍处于 `initialized`；拒绝符号链接、非普通文件、已有 baseline 和覆盖。baseline 先以独占方式创建，再原子替换 manifest；普通写入失败会清理本轮 baseline。若进程在两份文件提交之间被强制终止，先检查原 run 下的 baseline 与 manifest，不要重跑批次或覆盖证据。该工具没有重试逻辑；超时或断线必须查询原任务状态，不能重建批次或重新执行写入。

视觉 PNG 导出、预览、确认、模型写入、保存和重开不属于只读基线，分别在后续阶段记录。
