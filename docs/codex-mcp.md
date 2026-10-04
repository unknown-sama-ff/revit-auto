# Codex 接入 `revit-custom`

本项目的 Codex 接入使用 Revit 2027 社区/自定义 MCP，不接入 Autodesk 官方 MCP。

## 当前入口

- MCP 服务：`D:\Desktop\revitt\revit-auto\mcp\revit-custom.mjs`
- Node：脚本会优先解析本机 Node 的绝对路径。
- Codex 配置：`%USERPROFILE%\.codex\config.toml`
- Claude 配置：`D:\Desktop\revitt\revit-auto\mcp\claude.mcp.json`

## 安装到 Codex

先确认 Revit 2027 已启动并加载新版插件，然后在 PowerShell 中运行：

```powershell
D:\Desktop\revitt\revit-auto\install-codex-revit-custom.ps1 -Mode CheckOnly
D:\Desktop\revitt\revit-auto\install-codex-revit-custom.ps1 -Mode Install
D:\Desktop\revitt\revit-auto\install-codex-revit-custom.ps1 -Mode CheckOnly
```

`Install` 会：

1. 检查项目 MCP 入口和 Node。
2. 检查 Codex 配置中没有官方 MCP、旧 WebSocket MCP 或任意代码执行入口。
3. 备份原始 `config.toml`。
4. 只增加 `[mcp_servers.revit-custom]`。
5. 已经正确配置时不重复写入。

脚本不会修改 Claude 配置、Revit 插件、RVT 文件或其他 Codex 设置。

## 只读烟测

重启 Codex CLI/IDE 以重新加载 MCP 配置，然后让 Codex 执行：

```text
读取当前 Revit 项目、当前楼层、当前视图和族类型，只查询，不修改模型。
```

随后核对：

- 工具来源是 `revit-custom`。
- 返回的项目 identity 和 revision 与 Revit/Claude Code 读取结果一致。
- 模型数量和 `isModified` 没有变化。
- 没有 Revit 二次确认弹窗。
- 不调用 `revit_plan_confirm`、`revit_import_commit` 或其他写入工具。

## 恢复

如果接入失败，使用安装脚本输出的备份路径恢复：

```powershell
D:\Desktop\revitt\revit-auto\install-codex-revit-custom.ps1 `
  -Mode Restore `
  -BackupPath 'C:\Users\unknown_sama\.codex\config.toml.bak-YYYYMMDD-HHMMSS'
```

恢复后重启 Codex。备份必须位于 Codex 配置目录内，脚本拒绝覆盖其他位置的文件。

## 写入边界

Codex 可以通过同一个 `revit-custom` 发现预览和确认工具，但模型写入仍然只经过：

```text
revit-custom → Revit 插件单队列 → TransactionGroup
```

必须先让助手读取当前上下文、生成预览，并在聊天中获得对同一 `planId` 的明确确认。Revit 不再弹第二次人工确认。当前阶段的 Codex 验收只允许只读查询，不执行写入。
