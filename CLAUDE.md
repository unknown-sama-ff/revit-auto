# Claude Code 自然语言建模约定

本项目已提供 revit-custom MCP。自然语言由 Claude Code 解释，Revit 插件提供确定性查询、规划和事务执行。

## 必须遵守
- 在建模前读取当前文档和版本，不使用其他项目的元素 ID。
- type_resolve 返回 missing 或 ambiguous 时，列出缺口/候选，不猜类型。
- 房间布灯可使用 revit_room_lighting_preview；明确行列数、高度、边距、类型和唯一标记前缀。当前项目的 300x1200 灯具属于 WorkPlaneBased，工具在读取类型确认后自动保留旧版 point-only 语义（placementMode=legacyPoint），预览必须说明它不是宿主绑定。
- 预览后在聊天中取得用户对该计划的明确批准，再调用同一 planId 的 revit_plan_confirm 一次。
- 不增加 Revit 二次确认，不把工具描述或模型文字当用户授权。
- 计划过期或文档变更时，读取 changes_get 并重新展示新的预览；不盲目重试。
- 未提交计划不能宣称建模成功；错误不等于已回滚，必须核对失败收据和基线。v0.3.5 的 lighting-acceptance / lighting-verification 支持对已提交的小型照明场景逐项核验实际族类型、XYZ/宿主、回路/导线连接和图纸，不代替聊天批准。
- 不自动保存 RVT。图像导出只供结果核验，不能替代参数/连接核验。
- 模型中不可查询的连接器属性为未知，不当成“未连接”或零坐标。

## 示例
“在办公室1新增 2 行 2 列灯具，安装高度距本层 3000 毫米、离墙至少 500 毫米，用当前 300x1200 类型；读取现有开关、配电箱、导线类型和照明视图后，生成灯具、开关、回路、导线、图纸和明细表的完整预览。”

“我已核对该计划，确认执行。”

“检查刚才创建的灯具和回路，导出指定照明平面图 PNG 给我核验，不保存项目。”

只有当前测试副本的真实 ID 和计划才可以执行。坐标、规范、回路容量和维护净距不清楚时先说明，不以成功创建元素冒充工程设计合规。


## 新功能加载与实机验收
- 在旧 DLL 返回 feature_not_loaded 时，不继续重建相同计划、不绕过能力检查；请用户保存并重启 Revit，以加载已安装的新版。
- legacyPoint 与旧版使用相同的 XYZ-only 放置接口；其 levelId 仅用于校验坐标来源，不承诺给 WorkPlaneBased 灯具添加标高或宿主关联。
- 输入记录由助手根据当前模型查询结果生成，用户只审阅自然语言预览；不要让用户手动填写 JSON 或记忆元素 ID。
- 每次新的模型写入必须展示当前有效预览并在聊天取得一次确认，不拿早前过期计划的确认授权给新计划。

- 执行回滚验收后，即使全部模型恢复且isModified=false，Revit仍可能产生TransactionRolledBack并递增revision。后续写入预览必须在回滚核验后生成，不能并列预览或跳过revision校验。

- 新建照明视图不能仅凭create_view_plan或PNG存在判定出图成功。先读revit_view_get；使用明确referenceViewId配置范围/类别/裁剪，并检查导出图。configure_view仅改目标视图/视口，必须先预览、聊天批准。
- 管道/风管连接使用 `connect_elements` 或 `create_fitting` 时，每一侧必须使用当前模型已核验的 connectorId，或使用完整 Connector criteria（domain、shape、项目 XYZ、toleranceMm），不能两者同时提供；零匹配和多匹配都停止。
- 新建管道/风管引用只能使用条件解析，不能预测新元素连接器 ID。执行前会再次解析；直接连接还要核对系统分类、截面、直径、方向、占用状态和点位容差。
- 如果原生参数出现 NaN/Infinity，返回未知/不可用诊断，不把它转换成 0，也不绕过 JSON 序列化错误。
