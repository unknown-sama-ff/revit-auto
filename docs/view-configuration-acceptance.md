# 照明视图显示与图纸裁剪修复（v0.3.7）

## 范围
仅修改明确指定的新照明视图及它的视口；不创建、删除或移动灯具/开关/配电箱/回路/导线，不修改参考视图，不自动保存RVT。

## 已观察到的事实
- 现有视图770796能显示灯具，新视图2295719不能正确显示，但模型参数与电气关联核验通过。
- 当前普通参数查询显示：参考视图规程为Plumbing、裁剪开启；新视图为Coordination、裁剪关闭。真正的PlanViewRange和图形类别规则此前未公开，不能只据这些参数断言根因。

## 新能力
- revit_view_get：读取原生范围平面/偏移、裁剪框及坐标轴、规程、详图级别、显示样式、零件显示、照明类别隐藏/图形覆盖及视图范围内候选元素。
- configure_view：通过已批准计划复制明确选择的设置。参考/目标必须同视图类型和标高，目标不能受模板控制。非矩形/拆分裁剪和不同裁剪坐标框架明确拒绝，不能猜转换。
- 可显式将规程改为Electrical，并在裁剪后按已审核纸面XY重设视口中心。
- 新建照明场景可传newView.referenceViewId与discipline；没有参考时保留默认行为但返回图形显示风险警告，不声称可出图。

## 当前实例待验收步骤
加载v0.3.7后先分别读参考770796与目标2295719，再准备一份仅配置视图的预览。建议复制viewRange/crop/lightingCategories/displayStyle/detailLevel/partsVisibility，目标规程明确Electrical，视口2295745保持纸面(420,280)。

使用D:\Desktop\revitt\revit-auto\mcp\view-acceptance.mjs prepare --project TEST_COPY.rvt --target 2295719 --reference 770796 --viewport 2295745 --state NEW_RECORD.json只生成预览。获得聊天批准后通过正常MCP确认该同一计划，再运行verify。

验收器检查参考设置不变、只有目标视图/视口修改、完整电气基线不变，并导出新视图/图纸。原生设置PASS不是视觉PASS；仍必须检查灯具符号和图纸排版的真实PNG。

## 自动验证边界
编译0警告0错误；51项核心测试、115项Node/SDK测试通过。它们证明数据规则和接口路径，不替代新DLL加载后的真实视图修正与图片验收。
