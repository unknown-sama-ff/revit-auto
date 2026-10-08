# 楼梯显式类型、梯段与平台（源码/暂存版）

统一入口：`revit.workflow.run`，`name: "architecture.stairs"`。仍使用单操作 `StairsEditScope` 路径，不能混合其他建模操作、自动保存或执行旧 `stairs.csx`。

## 为什么本轮需要更新

旧脚本和前一版 `create_stair` 没有明确楼梯类型或踢面/踏面设置。`StairsEditScope.Start` 原生过程会先建立默认类型的空楼梯，而直跑 API 又会按踏面深度取整生成踢面数。新版不能把这些原生默认结果当作用户明确的设计意图。

本轮把输入升级为显式契约；旧格式不能继续写入。缺字段先澄清，重新展示预览后才可在聊天批准，不能继承旧计划批准或把旧 `landingMode=none` 夹具验收升级成新契约验收。

## 必需输入

- 当前 `documentIdentity` 必填；强烈建议同时传入首读 `expectedRevision`（版本 0 有效）。未提供 revision 时仅使用创建预览当时的版本，不能冒充早前已审阅版本；
- 现有 `stairTypeId`、`baseLevelId`、`topLevelId`，不预测 ID、不采用默认类型；
- `desiredRisersNumber`：总踢面数；每跑 `risersNumber` 的总和必须一致；
- `treadDepthMm`：明确踏面深度；`geometryToleranceMm`：明确核验容差；
- 每跑完整绝对项目 `start/end` XYZ、`widthMm` 与 `risersNumber`。路径是处于明确底高的水平直线，不是倾斜线；第二跑不能继续默认为第一跑底高；
- 明确 `landingMode`：`none`、`automaticBetweenRuns`、`sketched`。

`none` 仅创建明确梯段，不承诺连接成完整可通行楼梯。自动模式明确请求相邻跑的原生平台，不能失败后静默改为无平台。`sketched` 必须提供每个平台的完整 `boundary` 与绝对 `elevationMm`；轮廓必须闭合、水平、不自交，标高需与总高/踢面数形成的已批准踢面网格一致。

用户模糊输入或缺字段使用 ask，只返回缺口；明确提供关键约束使用 explicit；只有用户明确允许候选推断且列出假设时使用 assisted，返回 candidateOnly。结构、消防、踏步合规和净距标准不由插件自行补值。

## 原生执行与核验

1. 读取真实 StairsType 与其 RunType/LandingType，披露继承的类型关系和可能生成的支撑/栏杆；不修改类型定义。
2. 原生范围建立空楼梯后，在生成任何梯段前把实例绑定到已审阅的 stairTypeId；不能保留默认类型。
3. 设置明确的总踢面数与踏面深度；创建直跑/自动或草绘平台。
4. 内部事务提交前核验类型、宽度、踢面数、路径 XY、绝对底高/顶高和实际梯段/平台集合；草绘平台核验其轮廓与标高。
5. 范围提交后再次读回；若原生取整、提交处理或类型继承改变了已批准结果，返回明确失败/不确定证据，不冒充恢复成功、不重试。

原生 GetStairsPath/GetFootprintBoundary 是投影读取；结果只返回其 XY，真实梯段和平台标高单独报告，不填一个假的 Z=0 作为模型高度。回执包括关联支撑和栏杆，但还需审阅 nativeChanges 才能判断其他原生副作用；`completeStairConnectionsVerified=false`、`engineeringComplianceVerified=false` 不变。

原有清理证据继续有效：取消成功返回不等于模型恢复验证，提交返回后的读回失败可能已经提交。不要自动重新创建或把失败计划盲目重试。

## 2026-10-08 状态

新 `explicit-stair-geometry` 能力已实现并独立编译；核心与 SDK/stdio 模拟契约覆盖缺字段、原生类型门禁、候选假设、坐标/平台输入和清理边界。**暂存 DLL 未部署，类型切换、实际踢面/梯段/平台几何、范围提交与原生副作用仍未验收**。不把测试绿灯称为完整楼梯对等迁移完成。

一次工作流只允许一套楼梯，不接收多楼梯批量范围；缺少每跑 XYZ/踢面数会返回具体字段问题而不调用原生。内部试图生成默认平台或忽略输入均被拒绝。
