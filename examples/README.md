# 示例使用

lighting.template.json 仅说明工作流字段。所有 null 的族、宿主、视图和标高 id 都需要从当前模型查询；已知项仍需确认坐标和配电制式。该模板不能直接执行。

审查后另存 lighting.reviewed.json，使用 acceptance.mjs 先预览。正式写入前在聊天中确认审核后的计划即可；Revit 不再二次弹窗。

lights.csv 和 csv-import.template.json 展示显式列映射；不会选择默认族、默认楼层或猜测尺寸。
