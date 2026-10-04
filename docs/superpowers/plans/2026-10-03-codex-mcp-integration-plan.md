# Codex MCP 接入实施计划

设计依据：`D:\Desktop\revitt\revit-auto\docs\superpowers\specs\2026-10-03-codex-mcp-integration-design.md`

## Slice 1：配置工具

- 新增 `install-codex-revit-custom.ps1`。
- 默认只读检查，不修改文件。
- `-Mode Install` 只向用户级 Codex `config.toml` 添加 `[mcp_servers.revit-custom]`。
- 使用已解析的绝对 Node 路径和项目内绝对 MCP 入口。
- 写入前生成备份；重复执行幂等；遇到冲突停止。
- `-Mode Restore` 只接受明确指定的备份路径。

## Slice 2：配置模板和文档

- 新增 `mcp/codex.revit-custom.toml.example`。
- 新增 `docs/codex-mcp.md`，说明安装、检查、恢复和安全边界。
- 明确官方 MCP、旧 WebSocket 包和任意代码执行均不注册。

## Slice 3：静态验证

- 用临时配置 fixture 验证新增、重复执行、冲突拒绝和恢复逻辑。
- 校验 Claude 配置仍只包含 `revit-custom`。
- 运行现有 118 项 Node/MCP 测试，确保 MCP 服务行为没有变化。

## Slice 4：本机配置和 Codex 烟测

- 读取当前用户 Codex 配置并保存备份。
- 最小合并 `revit-custom` 节点。
- 运行脚本的只读检查。
- 使用 Codex CLI 的 MCP 管理/发现能力确认服务器和工具可见。
- 在已运行 Revit 测试副本中完成上下文和族类型只读查询。
- 对比 identity/revision/模型计数，禁止提交计划。

## Slice 5：证据与回滚

- 将配置、工具发现和只读查询结果写入 `acceptance/codex-mcp-*.json`。
- 若烟测失败，停止 Codex 会话并使用备份恢复。
- 仅在所有验收条件通过后报告完成。

## 风险控制

- 不写入 Revit 模型。
- 不调用 `revit_plan_confirm`、`revit_import_commit` 或其他写入工具。
- 不修改 Revit DLL。
- 不改变 Claude 的严格 MCP 配置。
- 不把 Codex 的连接状态误报为 Revit 模型写入成功。
