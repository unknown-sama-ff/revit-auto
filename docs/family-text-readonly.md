> 发布副本说明：本机路径、模型名称及运行标识已匿名化。原始私有证据未随源码发布；历史验收不代表当前会话授权或完整业务认证。

# 图框族文字只读查询

任务 `documentation.family-text-readonly` 的限定原生只读验收已通过，接受门槛加入 `readonly-accepted`；2026-10-30 当前聊天已发现工作流，完整文字和项目关联等限制仍保留，队列整体保持 `blocked`。用于定位 AI-E035 的 Notes 正文、纸面尺寸和默认字体；不修改共享 THS-A1 族。既有图纸名称和视口标签的保存重开验收保持，无需重复。

通过现有 `revit_workflow_run` 使用 `name=families.text_notes`、`planningMode=explicit`，提供当前族文档的 `documentIdentity`、`expectedRevision` 和从原生scope取得的精确名称。当前已知空名实例使用 `input: {familyName: "", familyDocumentTitle: "THS-A1.rfa", maxNotes: 100}`。原生方法 `revit.family.text_notes` 需要实际加载 `family-text-notes`，空名分支另需 `family-text-known-empty-owner`。没有新增 MCP 工具入口。

查询只允许已经由用户打开的图框族文档，精确核对名称及类别 -2000280；项目文档、过期会话和 revision 不符均拒绝。不会打开/关闭文档、调用 EditFamily、加载族、创建计划、写模型或保存。读前/读后检查当前文档、路径、修改状态、只读状态和事务状态；取消、异常或20秒超时不重试。

每条返回 TextNote 纯文本、族坐标 mm、纸面宽高 mm、包含变换的原生边界，以及 TextNoteType 默认字体、字号 mm 和宽度因子。未知字段保留 supported=false/value=null，不填默认值。collection complete 仅表示 TextNote 数量完整；每条 text.complete/text.truncated 单独表明正文完整性。默认50条、最大100条，每条最多2048个 UTF-16 单元、总16384单元，不截断代理对，完整原生响应上限512 KiB。

不认证富文本覆盖、字体替换、族标签、嵌套注释、实际字形边界或与项目中共享族的关联；不能仅凭同名就将族编辑器数据归属于项目实例。Notes确切来源、拥挤原因和整图视觉验收仍未知。

实现与验证：`v27/FamilyTextRules.cs`、`v27/FamilyTextService.cs`、`mcp/family-text.mjs`、`mcp/tests/family-text.test.mjs`。核心372项、定向29项（含实际SDK initialize/list/call的成功、无效输入和旧插件拒绝）、Revit2027.3隔离编译及CheckOnly通过。最终构建和全量回归以 `bin/Release/family-text-20261028T141508Z/build-verification.json` 为准；这是离线证据，不是实机只读验收。

2026-10-28 实载记录：申请 `8e46d749219a027493d6658e2426d886` 已获批准并注册一次，用户重启后已核对 MVID `52b485d8-4e55-45ef-adc9-c6f26bd93fff`。只读 run `6a624f00-71e3-4a18-aeef-fe998051916b` 的当前族文档标题为 `THS-A1.rfa`，identity `9e9ceed2…`、revision0；首次读取前 `isModified=true`，前后完整上下文保持。THS-A1及实测标题这两个精确名称均被原生 `family_text_scope_mismatch` 拒绝，没有正文返回，成功路径未验收。UI可见图框族，API枚举图框类别为-2000280；实际OwnerFamily名称和原生类别未被旧响应暴露，不能据此确定哪项谓词失配。RVT文件摘要/大小/mtime未变，无模型写入或保存。当前聊天仍连接旧Node代码，新SDK已发现工作流；两个状态分别记录。

最小补齐：仅为族文档的context增加 `familyDocumentScope`（ownerFamilyAvailable、documentTitle、familyName、categoryId），拒绝回执同时保留请求名和实际范围；项目文档不新增该字段。DocumentTitle不代替OwnerFamily.Name，原精确名称、类别、identity/revision约束不放宽。核心373项、定向30项、Revit2027.3隔离编译0警告/错误及CheckOnly通过。新候选路径 `bin/Release/family-text-scope-20261028T144640Z/`；尚未批准注册，不覆盖实载DLL或旧证据。

2026-10-28 元数据实载已通过：申请 `c4839cb4b52b8598484630f62544ac7b` 已获批注册一次，用户完全退出后重开，实载MVID `deb1d408-6719-428a-a1dc-59fb65cb7267`、PID22724。新run `9ac9cb62-c2ad-4a71-a701-60628c9407b2` 原生scope为ownerFamilyAvailable=true、familyName=""、documentTitle="THS-A1.rfa"、categoryId=-2000280；identity02dbd27c…/revision0，初始isModified=true且前后相同，项目RVT摘要/大小/mtime不变。根因是旧请求要求非空原生族名，无法表达真实的已知空值；没有再次发送注定失败的正文查询。元数据只读子范围通过，正文仍未验收。

修正契约允许 `familyName:""`，但此时必须额外提供精确 `familyDocumentTitle`；原生继续验证OwnerFamily实际值（空值不替换）、owner存在、图框类别、identity/revision，并在整个读取过程中保持标题/路径/修改状态不变。Node同时核对context原生scope及返回标题；空名分支必须实际加载 `family-text-known-empty-owner`，旧模块在新方法分支派发前拒绝。缺值null、空白、错误标题或类别仍被拒绝。非空名既有调用保持兼容，提供额外标题时同样严格绑定。

核心375项、定向43项（含统一诊断）、全量MCP1088通过/1可选OS检查跳过、最终隔离编译和CheckOnly通过。最终空名构建位于 `bin/Release/family-empty-owner-final-20261028T153019Z/`，具体冻结/申请以该目录build-verification和preparations为准；尚未注册，正文成功路径不能升级为通过。

下一步：冻结并审查该具体空名构建申请，获批后只注册一次，合并一次手动加载。随后以新scope/title/identity/revision做正文只读验收，保留旧失败证据；不重做旧图纸写入、保存重开或此前注册。当前无需再次重启或保存族。

## 2026-10-28 当前限定原生只读结果

申请 `7cc651ad1acd4c02211a9d78ea013d55` 已获批并注册一次，用户重开后确认实载MVID `9cbadad3-0e66-4f33-a4cf-9f420fa75239`、PID39408，空名能力实际可用。新run `f40b57ab-c902-437c-a6f1-5f19e019eefd` 通过新SDK initialize/listTools、注册工作流与精确空名/标题读取；新identity `040da07701e2986ee252370dbe440673`、revision0。实际类型参数、坐标与文字都返回；原生限量1条读取和7类拒绝（错identity、revision、族名、标题、缺标题、超上限、未知字段）通过。

族内总数110条，按契约上限返回100条，collection complete=false；已返回的100条正文均完整且非未知，不能写成“110条全量验收”。这100条的get_BoundingBox(null)均返回未知，coord/纸面宽高/类型默认字体可用，未知包围盒不能从宽高补造。

定位到正文1744762（类型1744961），正文以“图中所有尺寸均以标注为准”开头，类型默认Arial、2.5mm；“注释”1744761与“/Notes”1744866共用类型1744957，默认宋体、5mm。原生族视图PNG2560×1808已独立查看，说明正文与下方“图例/Legend”标题发生可见重叠，注释/Notes标题拥挤。当前返回集合没有识别出Legend的TextNote ID，不能据截图给它猜ID或修改参数；字体替换、富文本和真实字形框仍未认证。

本轮全部读取及一次PNG导出前后完整context保持，isModified=true是首次读取前已有状态；已保存项目RVT72a5dad6…摘要/大小/mtime保持。无模型计划、Confirm、写入、保存、载入族或文档开关；不要求再次保存或重启。原始summary保持，PNG与分析是同run的followup-summary/notes-analysis追加证据。

当前聊天的workflow_list仍没有families.text_notes；配置确实指向本项目，后台Node37404仍是旧进程。新SDK成功不冒充当前聊天入口刷新成功。重连MCP后只需一次入口及目标查询检查，无需重复DLL注册、整套只读验收或重启Revit。剩余10条、视图相关原生包围盒可在下一次相关DLL批次补受控分页/显式视图读取，不为单个缺口立即再走一轮注册。

下一步模型修复仍需明确族与项目关联、受影响的共享实例及精确改动范围，再接入受控族编辑契约；本次只证明当前族内存在排版问题，未修改族，也不把诊断计为整图视觉通过。

## 2026-10-30 分页与显式视图包围盒候选

在现有工作流增加两个可选字段，不增加工具或模型写入通道。`afterNoteId:0` 请求第一页：先按全部 TextNote 的原生 ID 排序，再取最多 `maxNotes` 条；后续使用原响应 `page.nextAfterNoteId`，保持同一 identity/revision、族名和标题。非零游标必须仍是该文档的 TextNote，否则拒绝。`page` 返回跳过数、剩余数和已知空的结束游标；每页仍受原字符和字节预算约束，调用不会自动翻页或重试。`complete/truncated` 继续描述这一响应是否含全部 TextNote，末页不自动成为全量结果；正文完整性仍逐条判断。不带游标的旧查询保留原选择语义。

`boundsViewId` 必须是当前族内真实的非模板视图。原 `bounds` 仍读取 `get_BoundingBox(null)`，新增 `viewBounds` 独立读取指定视图；不以视图框覆盖未知模型框，也不从宽高猜框。文字不属于该视图时返回明确未知，原生返回空时继续未知。响应绑定该视图的 ID/UniqueId/名称/类型。无此字段的旧响应形状不变。两项新字段均要求插件特征 `family-text-pagination-view-bounds`，旧 DLL 在目标查询派发前拒绝。

401 项核心、88 项相关 Node/SDK 检查及 Revit 2027.3 隔离编译通过，0 警告/错误。日志与源码摘要见 `bin/Release/family-text-pages-20261030T123938Z/staged-verification.json`。这是待合批候选，未做全量发布回归、未注册、未实载，110 条真实文字跨页及视图原生包围盒尚待验收；历史100/110结果和未知包围盒未被升级。首次编译只因默认安装路径不存在退出，保留失败日志；指定现运行 Revit 的实际安装目录后编译通过。

当前项目保持打开，不为候选单独要求重启、切换族或保存；与下一相关 DLL 批次一起加载。当前聊天已发现既有工作流，本轮没有重做正文查询，当前入口的族目标读取仍待合适的族会话核验。
