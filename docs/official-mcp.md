# 官方 MCP 并行接入（只读）

本项目不会假装 Autodesk Public MCP 已安装。当前机器存在 Autodesk Assistant，但这不等同于 Public MCP 独立服务器已配置成功。本机 Revit.exe 实测版本为 27.3.0.28；计划最初写的是 2027.2，安装官方组件前必须按 Autodesk 的说明核对其支持版本。

官方说明入口：
- https://help.autodesk.com/view/ADSKMCP/ENU/?guid=ADSKMCP_RevitMcp_revit_mcp_server_html

## 配置方式
1. 按 Autodesk 官方安装程序安装 Public MCP，并选 **Read** 配置。不要选 Write 或 Experimental。
2. 从官方程序复制真实的可执行文件路径、参数和查询工具名称。不要从这里的示例猜测官方程序名称。
3. 将 `mcp/autodesk-read.config.json.example` 复制到 `runtime/autodesk-read.json`，填入真实配置，并把已核对的查询工具名称加入 `allowedReadTools`。
4. 该文件的目录已由安装脚本限制为当前用户可读。必须同时满足白名单和上游 `readOnlyHint=true`；否则本项目的保护代理不会暴露该工具。若 Autodesk 版本没有提供该元数据，代理会拒绝，需用官方 Read 配置本身，并人工核实权限。
5. 在 Claude/Codex 中新增 **独立** MCP `revit-autodesk-read`，命令为本地 Node，参数为本项目 `mcp/autodesk-read-proxy.mjs` 的绝对路径。不要替换 `revit-custom`。

## 权限边界
官方查询工具和自定义专业工具通过两个 MCP 通道并行提供。所有创建、修改、删除必须交给 `revit-custom`；它具有真正的 Revit 主线程单队列、计划和聊天确认执行流程（无 Revit 二次确认弹窗）。不要同时注册旧社区 MCP 的写工具、`send_code_to_revit` 或未受限的官方写入配置，否则“统一写入”保障不成立。

保护代理是已测试的连接代码，但 **尚未与 Autodesk Public MCP 实际联调**。安装、支持版本、账户资格和工具名单由官方组件决定，本项目不替代这些要求。


## 已核实的官方获取入口（2026-10-03）
Autodesk于2026-09-07发布的下载说明：https://www.autodesk.com/support/technical/article/caas/sfdcarticles/sfdcarticles/How-to-download-the-Revit-MCP-server.html

在Autodesk Account中进入Products and Services → Revit → View Details → Extensions，下载Revit 2027 MCP Server Read-Tools Technical Preview。不是Autodesk App Store上的第三方MCP插件。安装器可能自动加入Claude/Cursor的JSON配置，安装前须备份并审查客户端设置；不让它覆盖自定义通道或加入Write/Experimental工具。

当前设置文档 https://help.autodesk.com/view/ADSKMCP/ENU/?guid=ADSKMCP_RevitMcp_setting_up_revit_mcp_server_html 仍明确限定2027.2。获取安装包后先检查来源、签名、支持版本，再决定联调；本机2027.3的兼容性未证明，不擅自回退Revit。下载入口的核实不等于安装或联调通过。
