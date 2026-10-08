# 当前项目通用审计工作流

统一入口：`revit.workflow.run`，`name: "audit"`。这是受控只读适配器，不执行旧 `.csx`，不创建或提交模型计划。

## 文档与版本保护

助手应先读 `revit.context.get`，把当前 `documentIdentity` 和 `expectedRevision` 传给工作流。查询前校验激活文档，查询后再次核对 identity、revision、路径和 `isModified`；任何变化都拒绝返回可用报告，不自动重试。revision 0 是有效版本，不会被当成缺失。

`input` 可为空，或只包含与顶层一致的 `documentIdentity` / `expectedRevision`。冲突、不支持的参数、脚本内容和文件路径均在原生调用前拒绝。未传 expectedRevision 时也会锁定本次首读 revision 并复查，但这不代表该 revision 经过了更早的人类审阅。

没有激活文档，或缺少可信 identity/revision 时停止。原生报告自身的 documentIdentity 必须与审阅项目一致；旧插件缺少原生审计能力时继续保留能力门禁。

## 返回与证据边界

- 保留原生 counts、warnings、未标记元素、重复标记和三态设备端口证据。
- 增加 `documentRevision`、`readOnly: true`、`planCreated: false` 和 `auditConsistency`。
- `auditConsistency.savedStateVerified` 仅表示查询前后的 `isModified` 均已知且一致，不是磁盘保存或重新打开 RVT 的验证。
- `warningsTruncated` 在 warningCount 和 warnings 都可读时披露警告截断；证据缺失时为 null，不冒充完整。
- 原生设备端口的 unknown / truncated 保留原样；未知属性不得当成未连接或零值。
- `engineeringComplianceVerified: false`：报告不替代工程规范、维护净距、水力设计或完整专业验收。

原始 `revit.audit.run` 保持已有无参数查询接口，不宣称支持传入 identity/revision；需要固定审阅上下文时使用统一工作流。通用报告尚未完整对等迁移旧版回路成员、专业参数或外部 RFA 文件审计，不因本轮安全校验而把整个功能矩阵标为已验收。

## 2026-10-08 实机只读证据

实际 SDK/stdio 查询已验证统一工作流返回当前文档 revision 1；前后 identity、revision、路径、isModified 与元素统计不变，没有创建计划、提交写入或自动保存。测试副本的 52 个原生设备端口均在当前报告范围内，未截断；11 条模型警告原样保留，不作为生产设计规则。

直接接口与工作流的端口集合内容一致，但原生 ConnectorSet 的返回顺序会变化。因此核验按实际元素/端口内容比较，而不是根据数组位置赋予连接器含义。此证据只验证当前报告范围和新适配器的只读契约，不证明完整工程模型无问题。完整记录保存在本地忽略的 `acceptance/model-audit-readonly-sdk-20261008.json`，不随仓库发布。

### 后续原生安全任务

原生 Audit 的警告、未标记元素和重复标记延迟枚举已在源码中改为 UI 线程物化，并以 NativeReadSnapshot 冻结独立 JSON；新增 documentRevision/snapshotPolicy 和 ui-thread-audit-snapshot 能力标记。暂存编译与核心生命周期测试通过，但当前运行 DLL 未部署该变更，原生加载后验收仍待完成。MCP 的 auditConsistency.uiThreadSnapshotVerified 仅在返回相应原生标记时为 true，旧 DLL 不冒充已核验。新电气回路审计的范围与未完成状态见 docs/electrical-audit.md；这些状态仍分别验收，不合并为“全部完成”。
