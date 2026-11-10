> 发布副本说明：本机路径、模型名称及运行标识已匿名化。原始私有证据未随源码发布；历史验收不代表当前会话授权或完整业务认证。

# 图纸相对图框边界的只读包含诊断

日期：2026-10-26。状态：用户已批准设计，进入实施。
批准来源：`request_user_input_async call_f800a14280624071b29da3f5e565f7b9 item0`，用户回复“批准该只读诊断设计并实施”。
对应任务：`documentation.sheet-layout-readonly`、`documentation.whole-sheet-visual`。

## 问题与已取得的证据

原合同 `docs/drawing-architecture-parity.md` 规定图框边界用于越界检查。当前 `mcp/sheet-layout.mjs` 的 `diagnoseSheetLayout` 实际相对原生 `ViewSheet.Outline` 比较；该范围可以包含已越过图框的内容，因此 `outOfSheet=[]` 不能证明内容位于图框内。

真实来源为加载核验 `acceptance/load-checks/31d7fe63-7c34-408d-a82f-661dc95078b4/baseline.json` 的 `first-target-sheet-layout`，其完整MCP派生报告、保留的原生范围字段和PNG均已归档；该scope不是直接的原始bridge响应。唯一A3图框2296036的范围约X751.357–1171.357、Y43.273–340.273 mm；AL1表2296037范围约X398.5–703.3、Y203.933–568 mm。表相对图框左/上越界，但原生outline包络两者，现有输出为 `outOfSheet=[]`、`complete=true`。

离线调用真实 `diagnoseSheetLayout` 已稳定复现该漏报：断言AL1应出现在outOfSheet时失败。只在克隆载荷中把outline替换为同份原生图框BBox后，相同函数得到AL1的 `left/top` 越界；源载荷、模型及历史归档均未修改。真实PNG亦显示表在图框外。根因为比较边界选择，并非新旧session混入或单位换算失配。

## 方案比较与推荐

1. **推荐：新增明确的图框包含诊断。** 保留历史 `outOfSheet` 相对ViewSheet.Outline的语义，另以现有唯一图框的原生BBox计算 `titleBlockContainment`。无需改C#、编译DLL、注册或重启Revit；新旧结果来源清楚。
2. 直接将 `outOfSheet` 改为相对图框。改动较少，但静默改变已归档接口含义，空/多图框也会使原字段失去原生outline诊断能力。
3. 新增显式纸张原点、尺寸及可打印区查询。可支持更多排版判断，但当前没有足够原生合同，且超出本次已复现的边界漏报修复。

此次选择方案1。图框原生轴对齐BBox不是纸张可打印区、内部可用内容区或精确旋转轮廓，不为这些范围作认证。

## 输入、输出和边界

输入继续使用严格的 `documentIdentity`、`expectedRevision`、`sheetId`，不增加模型操作或计划。原生查询和前后文档检查保持。

保留原始 `outline`、所有图框/放置几何、`outOfSheet`、相交候选、现有 `unknownGeometry` 和 `complete`。新增 `outOfSheetBoundary: "native-view-sheet-outline"` 明示旧字段来源。现有complete仅表示既有几何读取和候选枚举的完整性，不能表示图框包含、整图视觉或合规通过。

新增派生对象 `titleBlockContainment`：

- `schemaVersion: 1`。
- `status: "evaluated" | "unknown"`。
- `boundarySource: "single-native-titleblock-bounding-box" | null`。
- `boundary: {titleBlockId, min:{xMm,yMm}, max:{xMm,yMm}} | null`，仅使用已验证原生数据。
- `outOfBounds: [{id, kind, sides}]`，只列已知范围的非图框放置对象；kind和左右上下顺序沿用现有诊断。
- `unknownGeometry: [{id, kind, error}]`，保留无法判断的非图框放置项。
- `complete: boolean`，仅唯一且非退化的已知图框BBox及所有被检查放置几何均已知时为true；有越界仍可完整，不能把complete当成无越界。
- `reason: null | "no-titleblock" | "multiple-titleblocks" | "titleblock-bounds-unknown" | "titleblock-bounds-degenerate"`。

只有恰好一个图框且其BBox已知、有限、两个方向均有正长度时，status为evaluated，boundary有效。零图框、多图框、未知或退化图框均status=unknown、boundarySource/boundary=null、complete=false；不得挑选第一个、把多个图框取并集或退回outline后称包含通过。未知边界时outOfBounds为空仅表示未计算，必须同时保留unknown状态/reason。

唯一边界可用而部分内容未知时，status=evaluated、complete=false；已知内容仍逐项报告，未知不当作框内。视口内容/标签、普通/配电盘表、TextNote/IndependentTag均参与。图框自身不与自身比较。边缘相切为包含，不新增浮点容差、不舍弃几何或投影字段。输出按id/kind稳定排序，不改变原始数组或对象。

保留所有只读与副作用旗标。该对象不新增 `visualAccepted`、`writeAccepted` 或 `allModelSideEffectsVerified=true`，不自动移动、缩放、换框或保存任何元素。

## 实施和验证范围

主要修改Node派生诊断 `mcp/sheet-layout.mjs`，及其直接的MCP描述/文档和测试；不改 `v27/SheetLayoutService.cs`、写入门禁、预览、Confirm或注册器。

先增加真实快照重放回归与最小合成回归，再实现。测试覆盖：outline包络图框和越界内容仍报告left/top；正常框内与相切；四方向；无/多图框；未知/退化图框；未知内容；视口内容和标签；普通表、配电盘表、两类注释；稳定排序和原始载荷不变；原有outOfSheet/相交输出保持；坏ID/宿主/非有限/重复数据仍拒绝；SDK实际工具结果含新对象且仅只读原生调用。

真实回归使用可纳入版本管理的 `mcp/tests/fixtures/` 最小夹具，附原baseline文件SHA-256、scope ID、scope序列化摘要及明确的提取/匿名化规则；保留真实边界数字，不将本地私有文件是否存在作为运行/skip条件。原完整私有证据仍保持字节不变，夹具只证明已捕获的诊断反例，不代表完整模型范围或隐藏副作用。

已有 `sheet-layout-acceptance.mjs` 保持全报告严格比较，不能剔除新增字段、geometry或projection来让旧报告通过。旧证据不重写；若新派生报告与旧schema不同，单独归档新Node版本及输入摘要，不将其称为原生模型变化。新实机检查仅查询当前图纸和前后context，复用本MVID当前完整只读基线并明确引用；不再次读取无关100scope，也不创建任何模型计划。

定向MCP回归与实际快照重放通过后运行适当的全量MCP回归，冻结来源和测试日志。C#未变，不重复隔离编译、注册或要求用户重启Revit。实际新派生结果/原生原始范围和PNG结论分别归档。

`revit-custom.mjs` 启动时静态导入Node模块；编辑文件不会更新已连接的长驻MCP进程。新SDK进程的只读实机证据与用户当前MCP入口加载状态分别记录。最终检查当前入口是否返回 `titleBlockContainment.schemaVersion=1`；若仍是旧结果，提示仅重新加载MCP连接，不要求重启Revit，不把新SDK验证当作所有客户端均已更新。

## 验收与后续

本次完成条件是只读诊断明确报告AL1相对唯一A3图框的left/top越界，并对不能确定边界的场景如实报告unknown。当前A3/AL1版面视觉仍为拒绝；真正图框替代分支、隐藏副作用、旧模型写入验收与持久化结论保持。修复诊断不修复模型版面。

用户审核此书面设计后再实施；本文件与离线调查不包含新模型计划或其批准。
