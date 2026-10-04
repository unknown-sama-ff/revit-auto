# RevitAuto MCP v0.3.6

主使用说明见 `../README-2027.md`。v0.3.5 保留旧版 WorkPlaneBased 灯具的显式 legacyPoint 点位语义，并扩展房间照明场景的开关、回路、导线、图纸和明细表预览。

- revit-custom.mjs：MCP 官方 SDK stdio 服务，17 个工具，无任意代码执行。
- bridge.mjs：localhost 认证、版本预检查、期限、取消和 UTF-8 分块响应。
- workflows.mjs：照明、建筑、泵房的确定性计划生成器。
- imports.mjs：受限 CSV/TSV/XLSX/JSON 导入及图纸/图片候选适配器。
- autodesk-read-proxy.mjs：可选官方查询保护代理，默认不接通，需真实 Autodesk 配置。
- health.mjs / acceptance.mjs：真实 Revit 只读检查及预览/取消验收。
- tests：SDK、协议、导入与安全回归；不替代实机业务测试。

配置模板是示例。安装脚本合并 Claude/Codex 原配置；桥接凭据留在私有 runtime/bridge.json 中。工具实际使用下划线名称，逻辑 API 内部仍保留点号名称。

修改前保留预览，由用户在聊天中批准；plan_confirm 和 import_commit 直接执行该计划，没有 Revit 二次确认或额外确认布尔值。后端无法读取聊天授权，须由可信助手/客户端核实。

identity-acceptance.mjs / acceptance-helpers.mjs：五次稳定 identity 检查、严格项目副本校验、写入／回滚预览和精确电气快照核验。不自动提交计划。当前 v0.3.5 的新增灯具兼容路径仍须在重启后的 Revit 实例中实机验收。

连接器的 connected 属性可能不可查询；connectionStatusSupported=false 时状态为未知，不是 false/未连接。参数、端口坐标和电气系统关系仍返回。


预览的有效期以原生expiresAtUtc为准。v0.3.6默认给聊天确认120分钟，可在私有bridge配置中将planLifetimeMinutes设为15..480整数分钟。更长等待不会放宽文档/修订号校验，也不会自动确认或复活过期计划；旧DLL尚未重启时仍保留原有15分钟行为。
