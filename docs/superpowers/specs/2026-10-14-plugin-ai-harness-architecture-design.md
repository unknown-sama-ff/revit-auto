# Revit AI 插件与多 Harness 产品架构设计

日期：2026-10-14
状态：已确认，进入计划分解

## 目标

最终产品以 Revit 内置插件为执行主体。插件负责读取当前文档、生成和校验计划、执行 Revit API 事务、保存并核验结果；AI 和 Agent 负责理解任务、组织步骤和提交结构化请求。

产品同时支持三类驱动方式：

1. 插件内置 AI：用户在插件中配置 AI 服务 URL、API Key、模型和协议。
2. 本机助手服务：插件调用本机服务，本机服务再连接 AI 服务，适合统一密钥、代理和本地模型。
3. 外部 Harness：Claude Code、Codex、DeepSeek Harness、Pi 以及后续兼容工具，通过 MCP、stdio、HTTP 或本机服务调用统一建模接口。

首版支持 OpenAI 兼容接口和自定义 JSON 接口。不同 AI 或 Harness 不复制 Revit 建模逻辑，所有请求进入同一条 `context -> plan -> confirm -> execute -> verify` 流程。

## 架构边界

### Revit 插件

- 提供 Revit API 的唯一模型写入入口。
- 管理文档 identity、revision、事务、回滚、保存和结果核验。
- 提供插件内配置页、连接状态、任务日志和最近任务记录。
- 暴露统一的结构化任务协议，不暴露任意 C#、任意脚本或任意 Revit API 调用。

### 领域核心

- 保存单位转换、标高/墙/楼板/柱/门窗等操作模型。
- 负责类型解析、几何校验、参数校验、计划摘要和结果规范化。
- 不依赖 MCP、Claude、Codex 或具体 AI 服务。
- 由插件内 AI、MCP 服务、本机助手和后台运行器共同复用。

### 驱动适配器

- `embedded-ai`：插件直连 OpenAI 兼容或自定义 JSON 服务。
- `local-assistant`：插件连接本机助手服务。
- `mcp`：供 Claude Code、Codex 和其他 MCP 客户端调用。
- `harness`：为 DeepSeek Harness、Pi 等外部编排器提供协议适配，不允许绕过插件的计划和执行边界。

## GitHub 开源与 Agent 自部署

项目公开发布到 GitHub，并设计为 Agent 可读取仓库后完成适配和安装。仓库必须包含：

- `AGENTS.md`：给 Agent 的项目结构、兼容版本、安装入口和安全边界说明。
- `README.md` 与 `docs/install.md`：给人和 Agent 的安装、配置、卸载和故障排查说明。
- `manifest.json`：Revit 版本、插件版本、目标框架、程序集、哈希和支持的配置协议。
- `scripts/preflight.ps1`：只读检查 Revit 版本、.NET、权限、目录和现有插件状态。
- `scripts/install.ps1`：安装匹配版本、写入用户级 Addins 清单、配置本机连接器并输出回滚路径。
- `scripts/verify-install.ps1`：检查插件实载、协议版本、MCP 工具发现和只读上下文查询。
- GitHub Release 资产：按 Revit 年份和版本提供固定哈希的程序集与安装包。

标准部署流程为：Agent 读取仓库和 `AGENTS.md`，识别本机 Revit 版本，选择匹配 Release，执行只读 preflight，展示安装计划，获得用户批准后安装，最后重启或提示用户重启并完成实载验证。Agent 不从聊天内容拼接任意安装命令，不把未验证的源码构建物当作生产程序集，也不把 API Key 写入 Git、日志或安装清单。

公共 GitHub 仓库默认只提供源码、文档、测试和版本化发布资产；密钥、用户配置、RVT 文件和本机验收证据留在本地。

## 数据流

1. 用户、插件内 AI 或外部 Harness 提交自然语言或结构化任务。
2. 驱动适配器转换为统一任务协议。
3. 插件读取当前文档上下文并绑定 identity/revision。
4. 领域核心生成候选计划并执行类型、单位、宿主和几何校验。
5. 插件返回预览；写入请求必须经过对应授权边界。
6. 插件在单一事务组中执行，返回主要结果、原生变更证据和未知边界。
7. 插件执行保存/重开核验或返回需要用户手动保存的状态。

## 失败与安全处理

- 不匹配的 Revit 版本、插件版本、文档 identity 或 revision 直接拒绝。
- AI 服务不可用时保留本地结构化任务和诊断信息，不自动重复写入。
- 外部 Harness 超时后查询原任务状态，不重新创建可能已经提交的计划。
- 安装前保留现有清单备份；安装失败可恢复原清单。
- 生产 Release 使用哈希校验；未签名或来源不明的程序集不能自动安装。
- 任务、API 配置和密钥分离保存；密钥使用系统凭据存储或本机加密配置。

## 分阶段交付

1. 插件内置 AI 配置页与 OpenAI 兼容/自定义 JSON 客户端。
2. 统一结构化任务协议和领域核心，接通现有 MCP、Claude Code、Codex。
3. 增加本机助手服务模式与任务日志。
4. 增加 DeepSeek Harness、Pi 等适配器。
5. 建立 GitHub Release、Agent 自部署文档、preflight/install/verify 脚本。
6. 完成多入口一致性、安装回滚、版本匹配、保存重开和真实 Revit 验收。

## 验收标准

- 同一份结构化任务从插件内 AI、MCP、Claude Code、Codex 和至少一个外部 Harness 进入后，计划和执行结果遵守同一安全边界。
- Agent 能仅依据公开 GitHub 仓库完成版本识别、只读 preflight、用户批准后的安装和实载验证。
- 安装错误不会覆盖原插件清单，卸载和回滚可验证。
- API Key 不出现在仓库、日志、任务回执或 GitHub Release。
- 至少一个建筑结构生成任务完成保存、关闭重开和元素统计核验。
