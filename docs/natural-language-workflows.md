# Natural-language modeling contract (v0.3.23)

Claude Code is the natural-language layer. The Revit bridge is deterministic and must not guess missing levels, family types, hosts, connectors, units, coordinates, or engineering requirements.

1. Call `revit_context_get` and inspect relevant elements/types.
2. Turn the request into `revit_workflow_run` or `revit_plan_create` preview.
3. Show the exact operations, affected elements, warnings, and missing inputs.
4. Ask once in chat for approval of that exact plan.
5. Call `revit_plan_confirm` exactly once with the same planId; Revit does not display a second confirmation dialog.
6. Read the receipt and inspect affected elements. On timeout call `revit_plan_get`; never recreate a write plan blindly.

Examples:
- “读取一层现有灯具、开关、配电箱、回路和导线，按当前族库提出办公室照明计划，先预览。”
- “在 1F_ARC(0.000) 用指定墙类型创建两段墙和封闭房间，缺少类型或点位时先列出缺口。”
- “读取泵房设备连接器和已有系统，只提出管道连接方案；多端口必须列 connectorId。”
- “读取 XLSX，按明确列映射生成参数导入预览；拒绝公式、缺列和未知类型。”

Write operations remain reviewable and transactional. DWG/image imports are candidate-only until reviewed. Engineering/code compliance is not inferred from a natural-language prompt.

## 测试夹具与产品开发边界

- 当前 acceptance RVT 是插件验收夹具，不是工程设计目标。夹具中的 CHWS/PA/SA 流向警告是已知测试环境事实，不阻塞灯具、建筑、泵房建模能力开发。
- `revit.flow.diagnose` 只读暴露系统成员和原生计算证据；若连接器 Direction=Bidirectional、Flow=0 或 GetFlow 报错，助手必须报告信息缺口，不能猜测 In/Out 或自动改系统。
- 泵房工作流必须先收集设备/族类型、systemTypeId、管径、标高、连接器、路线点位和用户流向意图；缺项生成缺口清单或候选预览，不从测试文件警告推断工程意图。
- 测试夹具的写入验收只证明事务、回滚、连接和查询契约，不把它当作规范、流向或维护净距标准。

## 泵房自然语言规划模式

- 用户明确提供设备、系统、管径、标高、接口、路线或流向约束时，Claude/Codex 调用 `revit_workflow_run` 时使用 `planningMode: "explicit"`，直接生成可审阅预览。
- 用户说明模糊、缺少关键约束或只说“帮我建泵房”时，使用 `planningMode: "ask"`。MCP 返回问题，不创建计划，不写模型。
- 用户明确允许助手根据当前模型提出候选时，使用 `planningMode: "assisted"`，同时列出假设。MCP 返回候选预览并标记 candidateOnly；候选仍必须聊天确认，不能从测试文件警告推断工程意图。
- A/B 两种模式最终都遵循：查询当前文档 → 预览 → 一次聊天确认 → 单事务执行 → 原生核验 → 用户手动保存。
