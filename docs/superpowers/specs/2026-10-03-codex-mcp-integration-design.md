# Codex MCP 接入设计

- 日期：2026-10-03
- 状态：已获用户批准，等待书面规格审阅
- 范围：将 Codex CLI/IDE 接入现有 `revit-custom` 本机 MCP
- 不在范围：Autodesk 官方 MCP、旧版 WebSocket 包、Revit 写入引擎重构

## 1. 背景

当前 Revit 2027.3 插件和 `revit-custom` v0.3.9 已完成 Claude Code 的自然语言查询、预览、聊天确认、单事务写入和回滚验收。Claude 使用项目内的专用配置，Codex 的本机配置尚未显式注册 `revit-custom`。

本阶段只补齐 Codex 客户端入口，不改变已经通过验收的 Revit 插件、MCP 工具契约、事务逻辑、模型数据或 Claude 配置。

## 2. 目标

1. Codex 能通过本机 stdio 发现并启动 `revit-custom`。
2. Codex 能调用只读工具读取当前 Revit 项目上下文和族类型。
3. Codex 与 Claude Code 使用同一个本机 MCP 服务和同一个 Revit 插件状态。
4. Codex 的接入不注册官方 MCP，不注册旧社区 WebSocket 服务，不暴露任意 C# 执行。
5. 配置修改可审计、可重复执行、可恢复，不覆盖现有 Codex 设置。
6. 只读烟测不改变模型、revision、保存状态或当前 Revit 视图。

## 3. 非目标

- 本阶段不接入 Autodesk 官方 MCP。
- 不启用任何官方 Write/Experimental 工具。
- 不把 `mcp-server-for-revit-1.0.0.tgz` 重新安装为当前服务。
- 不修改 `revit-custom.mjs` 的工具语义。
- 不修改 Revit 2027 插件 DLL。
- 不自动保存 RVT。
- 不在 Codex 配置中写入模型服务密钥或新的远程地址。

## 4. 方案比较

### 方案 A：合并当前 Codex 全局配置（采用）

在现有 `C:\Users\unknown_sama\.codex\config.toml` 中增加一个明确的 `[mcp_servers.revit-custom]` 节点：

```toml
[mcp_servers.revit-custom]
command = "node"
args = ["D:\\Desktop\\revitt\\revit-auto\\mcp\\revit-custom.mjs"]
startup_timeout_sec = 120
```

修改前生成带时间戳的备份；如果节点已经存在且内容一致，则不重复写入。该方式同时适合 Codex CLI 和使用同一配置层的 Codex IDE。

优点：入口稳定、配置位置明确、无需额外启动器、容易验证和恢复。

风险：修改用户级配置；必须精确保留其他 TOML 内容，不能粗暴重写整个配置文件。

### 方案 B：单独设置临时 `CODEX_HOME`

为 Revit 项目建立独立 Codex 配置目录，并通过启动脚本传递该目录。

优点：不触碰现有全局设置。

缺点：容易只对某个 CLI 会话生效，Codex IDE 不一定使用同一个环境；日常操作复杂，不采用。

### 方案 C：只提供手工配置片段

只写入示例文件，由用户手动复制到 Codex 配置。

优点：不产生外部配置修改。

缺点：容易重复注册、路径错误或破坏 TOML；不能完成实际接入验收，不采用。

## 5. 配置写入规则

配置脚本应满足：

- 使用项目内绝对路径指向 `mcp/revit-custom.mjs`。
- 优先解析可执行的 Node 路径；不得依赖不可预测的临时 Node 环境。
- 写入前检查目标配置存在且可读取。
- 写入前保存原始内容到同目录备份文件。
- 只增加或修正 `mcp_servers.revit-custom` 节点。
- 不删除或改写其他 MCP、模型、代理、权限、插件和环境设置。
- 不写入官方 MCP 可执行文件路径。
- 不写入 `send_code_to_revit` 或任意代码执行工具。
- 重复运行必须幂等。
- 如果配置格式、目标节点或路径不符合预期，应停止并报告，不自动重写整个文件。

## 6. 验证流程

### 配置静态验证

- 确认 Codex 配置包含唯一的 `revit-custom` 节点。
- 确认 command/args 指向项目内 `revit-custom.mjs`。
- 确认项目入口文件和 Node 运行时存在。
- 确认配置中没有新增官方 MCP、旧 WebSocket MCP 或任意 C# 执行入口。
- 确认原配置备份存在且内容可恢复。

### Codex MCP 烟测

在 Revit 2027.3 已运行且插件已加载的前提下：

1. 启动 Codex MCP 会话。
2. 发现 `revit-custom` 工具。
3. 调用 `revit_context_get`。
4. 调用一次只读族类型解析或模型查询。
5. 比较 Codex 返回的文档 identity、revision、项目路径和基础计数与现有客户端读取结果。
6. 检查 Revit 没有二次确认弹窗。
7. 检查模型计数、revision、`isModified` 和保存时间不变。
8. 不调用 `revit_plan_confirm`，不产生模型写入。

### 失败条件

以下任一情况均判定为失败并停止后续操作：

- MCP 服务器无法启动。
- 工具发现为空或工具集合不是 `revit-custom`。
- 当前文档 identity 与 Revit 返回不一致。
- 只读查询导致 revision、计数或模型保存状态变化。
- 发现 `send_code_to_revit` 或其他未受限任意代码执行入口。
- 需要 Revit 二次确认才能完成只读烟测。
- 原 Codex 配置无法恢复。

## 7. 回滚

如果静态验证或烟测失败：

1. 停止当前 Codex MCP 会话。
2. 保留失败日志和配置差异。
3. 用本次备份恢复 `config.toml`。
4. 再次确认 Claude Code 配置和 Revit 插件未被修改。
5. 不删除项目内 `revit-custom` 文件，不回退 Revit 2027 插件。

## 8. 验收标准

本阶段完成必须同时满足：

- Codex 能发现并调用 `revit-custom`。
- 至少完成一次当前项目上下文读取和一次族类型只读查询。
- 两次查询均不修改模型。
- 返回的 identity/revision 与 Revit 当前会话一致。
- Claude Code 原有配置继续只注册 `revit-custom`。
- Codex 配置没有官方 MCP、旧 WebSocket MCP 或任意 C# 工具。
- 配置脚本可重复执行且不会产生重复节点。
- 失败时可由备份恢复。

## 9. 后续实现顺序

1. 编写配置检查和幂等安装脚本。
2. 编写 Codex 配置示例和恢复说明。
3. 对本机 Codex 配置执行备份和最小合并。
4. 运行静态验证。
5. 运行 Codex 只读烟测。
6. 保存验收证据到 `acceptance/codex-mcp-*.json`。
7. 仅在烟测通过后，向用户报告 Codex 已实际接通。

## 10. 决策

本阶段采用方案 A。`revit-custom` 仍是唯一模型写入入口；Codex 只是新增的客户端入口，不获得独立写入权限。
