# 受控洞口工作流（源码/暂存版）

`architecture.openings` 继续表示旧 `openings.csx` 的门窗宿主能力；它不代表 Revit Opening API。本轮新增独立 `openings.create`，用于明确的墙面矩形洞口、楼板/屋面/天花板轮廓洞口和跨标高竖井洞口。

## 输入边界

每个 `create_opening` 必须提供：

- `openingKind`：`wall_rectangle`、`floor_profile` 或 `shaft`；
- 墙/楼板类洞口使用当前项目中已存在的正整数 `hostElementId`；竖井使用已存在的 `baseLevelId` / `topLevelId`；不接受预测 ID、`@` 新元素引用或自动选宿主；
- 所有点都必须完整包含 `xMm/yMm/zMm`，并提供显式 `hostToleranceMm`；
- 墙洞口使用下角和对角点；楼板/竖井使用 3–128 个不重复闭合轮廓顶点（不重复首点）；楼板还必须明确 `cutDirection: vertical|perpendicular`。

校验拒绝零面积、非平面、重复/共线、短边、自交/接触轮廓；竖井轮廓必须处于明确的底标高平面。墙洞口首期只接受直立、直线、Basic wall，拒绝曲线、倾斜、叠层和幕墙宿主，不自动投影或移动坐标。

## 规划与执行

- `ask`：缺少洞口种类、宿主/标高、坐标、轮廓、切割方式或容差时只返回问题，不读取原生计划、不修改模型；
- `explicit`：用户完整提供约束后生成当前文档 identity/revision 绑定的预览；
- `assisted`：只有用户明确允许候选推断并列出假设时才生成 candidate-only 预览，仍需聊天确认。

原生预览会披露宿主依赖元素；竖井只提供包围盒范围内可能受影响的楼板/屋面/天花候选，不把候选称为精确切割影响。计划确认后由现有单事务/回滚引擎调用 Revit `Document.NewOpening`，创建后检查宿主、墙矩形边界或轮廓边段。原生预览明确 `structuralDesignVerified=false`、`exactCutImpactVerified=false`；操作回执保持 `sideEffectsVerified=false`、`engineeringComplianceVerified=false`，切割方向仅确认已传给原生 API，不冒充独立几何认证；结构设计、机电净距、防火封堵和加固由工程人员审查。

没有第二个 Revit 弹窗确认，不自动保存，不运行旧脚本，不允许任意 C# 或文件路径。

## 2026-10-08 状态

已完成 JS/C# 规则、统一工作流、能力门禁、原生宿主/几何校验与独立暂存编译。自动化测试和暂存编译通过；新版 DLL 尚未部署到运行中的 Revit，墙/楼板/竖井洞口尚未完成真实项目原生验收。功能状态保持“已实现但未验收”，不能把门窗旧版验收替代为洞口验收。
