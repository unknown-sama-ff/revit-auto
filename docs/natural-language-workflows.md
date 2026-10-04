# Natural-language modeling contract (v0.3.4)

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
