# Revit MCP 开源参考与本项目取舍

调研日期：2026-10-28。通过 GitHub 连接实查下列仓库的 README、许可证和选定源码；没有安装、执行第三方代码、连接第三方 Revit 桥接或修改当前模型。本记录是源码对照，不是这些项目的实机认证。项目继续按“旧版功能对等 → 完整 Revit 自动化助手”推进，既有验收状态不变。

## 是否继续自研

通用 MCP 桥接、ExternalEvent 调度、墙/门/楼板等基础 API 调用已有多个可用参考，从零重复实现这些部分的差异价值有限。自研的合理投入是把已有建筑、电气、泵房和图纸能力连成可完成实际任务的产品：输入可确定、错误可定位、写入可控、结果可原生核验，同时让用户减少手动往返。

本项目已有严格参数、identity/revision、计划批准、单次执行和原生回读，但仍有许多实机及副作用限制，不能宣称比开源项目更成熟，也不能把测试数量当成产品优势。最近族查询的范围拒绝未暴露真实OwnerFamily信息，导致额外构建和手动加载，说明通用诊断仍需补强。继续保留现有成果、选择性复用参考，比推倒重做或继续全部独立实现更合理。

## 已查看的参考

| 仓库 | 实查内容及值得借鉴之处 | 接入边界 |
|---|---|---|
| [mcp-servers-for-revit/mcp-servers-for-revit](https://github.com/mcp-servers-for-revit/mcp-servers-for-revit) | MIT。server / plugin / commandset 分层；命令清单与版本配置；Nice3point.TUnit.Revit集成测试。真实源码中房间测试创建独立文档、围合与房间，再检查原生面积。 | README声明Revit2020–2026，不当作本项目2027.3可直接运行的证明。测试代码会新建/关闭文档并提交事务，需要专用测试环境和明确授权；没有在本轮运行。 |
| [bimwright/rvt-mcp](https://github.com/bimwright/rvt-mcp) | Apache-2.0。结构化参数错误、独立health、插件/网关身份、请求状态、工具分组、响应字节预算与本地溢出文件。README声明2022–2027；架构文件区分2027插件.NET10与独立.NET8网关。 | README明确族编辑器创作暂不在范围；保留自己的协议与批准边界。其公开原生验证记录仅覆盖特定2026开发程序集，不能等同所有工具/版本认证。 |
| [oakplank/RevitMCP](https://github.com/oakplank/RevitMCP) | MIT。pyRevit + Python；ResultStore提供查询句柄、摘要和按文档指纹缓存schema；有参数解析、关系查询、明细表与多步骤工作流入口。 | 具体ResultStore记录本身未含本项目要求的identity/revision，借鉴时必须增加会话绑定与过期拒绝；不推断整个仓库不存在其它校验。其schema采样最多400元素，采样名称不能当完整目录。 |
| [mcp-servers-for-revit/mcp-server-for-revit-python](https://github.com/mcp-servers-for-revit/mcp-server-for-revit-python) | GitHub元数据标记MIT；本轮主要查看README。模块化Routes、显式配对/撤销与操作审阅适合参考原型开发和权限体验。 | README同时列出implemented/pending，且说明Marketplace候选尚未认证；执行Python、启动/保存/关闭等入口不引入本项目。没有本轮2027.3兼容或实机验收证据。 |

原有 `mcp-servers-for-revit/revit-mcp`、`revit-mcp-plugin`、`revit-mcp-commandset` 在本次搜索中标记为archived；合并仓库README说明自身沿用这些项目。它们属于同一来源链，不能按多个独立成熟实现重复计数。这些社区仓库不因名称而视为Autodesk官方产品。

## 下一步借鉴顺序

1. **完整诊断与可恢复错误。** 参考HealthTools与ToolArgumentGuard，把已有bridge指纹、MCP服务身份、活动文档种类、实际族范围、所需/已加载能力和期望/实际值组织成一个明确结果。优先扩展现有诊断入口，不为一个字段不断增加工具和单独加载批次。错误必须区分可重新读取、需要用户操作、结果不明需查询原任务；不把失败提示变成自动重试授权。当前health.mjs仍会读取完整context，新工作应评估轻量元数据查询而非重复搬运类型目录。
2. **完整证据留本地，聊天按需展开。** 参考ResultStore和RuntimeToolFilter，以数量、差异、未知项、证据路径/摘要和结果句柄作为默认返回；需要时分页取细节。句柄绑定原生会话、revision和插件版本，过期拒绝。原始证据与完整性状态继续保留；输出压缩不能偷偷丢字段或把采样说成全量。先用实际响应字节/调用次数测改进，再测模型token，不能承诺固定节约比例。
3. **复用真实Revit测试夹具。** 参考CreateRoomTests的独立夹具和RevitThreadExecutor做小范围技术评估，保留本项目模拟测试与真实结果验收的区别。评估是否能让同一Revit会话批量执行独立用例、减少人工搭夹具。框架能在Revit里执行测试不等于DLL可安全热卸载，也不代替最终版本的具体计划批准、保存/重开和PNG验收。本轮不安装测试插件、不改变当前手动保存/重启规则。
4. **逐项复用建模方法。** 后续未完成能力先定位公开实现与API约束，再决定是引用库、移植小段算法、参考测试，还是自行实现。优先补旧版对等缺口；复用后仍走本项目结构化操作、事务与原生回读，不直接接入另一个模型写入通道。已完成能力不为改成别人的架构而重写。

## 源码级注意事项

- [ToolArgumentGuard.cs](https://github.com/bimwright/rvt-mcp/blob/master/src/server/Mcp/ToolArgumentGuard.cs)提供missing/unknown/received/expected及did_you_mean，适合参考错误格式；它在无缺失必填项时可能继续执行并仅报告忽略的未知字段。本项目继续严格拒绝未知字段，尤其是写入请求。
- [RuntimeToolFilter.cs](https://github.com/bimwright/rvt-mcp/blob/master/src/server/Mcp/RuntimeToolFilter.cs)按实际MCP封装测字节、保留目标/变更元数据并处理本地溢出结果；可参考避免“执行成功但回执过大，从而误重试”的路径。不能只按正文字符数估算传输上限。
- [HealthTools.cs](https://github.com/bimwright/rvt-mcp/blob/master/src/server/Tools/HealthTools.cs)默认不联网检查更新；旧模块未知状态与真正连接失败分开，health不执行安装或模型动作。文档状态可能是带时间的先前观察，写入前仍需新pin。
- [ResultStore](https://github.com/oakplank/RevitMCP/blob/main/lib/RevitMCP_ExternalServer/core/result_store.py)的UUID句柄与明确truncated/total字段有参考价值；需要本项目额外的身份与失效保护。[schema_routes.py](https://github.com/oakplank/RevitMCP/blob/main/lib/routes/schema_routes.py)保留了采样上限，不能直接把其schema结果用于“目录完整”断言。
- [CreateRoomTests.cs](https://github.com/mcp-servers-for-revit/mcp-servers-for-revit/blob/main/tests/commandset/Architecture/CreateRoomTests.cs)说明真实API夹具的结构；已查看部分主要直接调用Revit API，不据此认定完整MCP→命令→结果链路通过。
- [CommandManager.cs](https://github.com/mcp-servers-for-revit/mcp-servers-for-revit/blob/main/plugin/Core/CommandManager.cs)可参考命令配置/版本检查；使用Assembly.LoadFrom本身不证明能卸载或覆盖已加载DLL。[ExternalEventManager.cs](https://github.com/mcp-servers-for-revit/mcp-servers-for-revit/blob/main/plugin/Core/ExternalEventManager.cs)中的ExecuteCommand扩展方法只是直接调用delegate，不能仅凭“UI线程”注释就替代本项目已有的队列和ExternalEvent边界。

## 采用方式与证据范围

初次调研没有引入源码或依赖；后续实际移植见文末记录及THIRD_PARTY_NOTICES。移植须记录上游文件及版本，保留MIT/Apache许可与相应声明，并审查具体文件和依赖；不以仓库根许可证代替依赖许可核对。优先采用小范围可测试的方法和错误/输出设计，避免把另一套任意C#/Python执行、自动保存/关闭或写入协议整包接进来。

已核对文件的Git blob标识（不是提交SHA）：

- rvt-mcp ToolArgumentGuard：`f51da5dc58b2fc340242004274ae2d54796137b6`。
- rvt-mcp RuntimeToolFilter：`702869883a923d11323ad00b24c6cb4a1793b075`。
- rvt-mcp HealthTools：`d7bfebe8045161da158a78ef0fa7b15b69ec184a`。
- oakplank ResultStore：`29276a4a0f4492fdbaf68765b7c6801ab494ad67`；schema_routes：`4e41873570abab46266e901689d791d2f7d195c0`。
- CreateRoomTests：`e5ec93356f3f7a2ca55c2deb03aef348146917fc`。

本轮源码和README检查不保证这些仓库在本机可直接构建、在Revit2027.3运行或达到本项目全部验收要求。后续选择性移植时再做对应范围验证；无需为调研本身重跑本项目测试。

## 首批借鉴已实施

用户授权继续借鉴后，已独立实现 `mcp/runtime-diagnostics.mjs` 并更新既有health CLI：结构化期望/实际/恢复动作、完整证据本地留存、摘要默认输出、明确新SDK与当前聊天入口边界。11项测试含真实SDK/CLI及桥接配置透传；实机诊断准确识别“族名已知空而原生查询契约不支持”，没有反复提交失败查询。本次完整观测47905字节、摘要2526字节，不换算为token节约比例。使用说明见[runtime-diagnostics.md](runtime-diagnostics.md)。

这是统一诊断与摘要输出的第一批落地；跨工具结果句柄、缓存失效/分页及第三方Revit测试框架尚未接入。继续保留现有模型写入/保存边界，不为借鉴而重写已验收能力。

后续已实际移植ToolArgumentGuard的参数名归一化/提示与有界键名输出，接入现有health CLI拒绝路径；固定上游commit/blob，保留完整Apache-2.0许可，详见[THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md)。只给唯一候选建议，保持严格拒绝且不记录参数值；上游的“未知参数只警告并继续”没有移植。18项受影响测试通过；这次按精简流程仅验证Node变更，不注册插件或重启Revit。

后续又选择性适配ResultStore的句柄/保留记录/摘要模式，仅接入diagnostics.query及diagnostics.result。额外补入不可变JSON、完整文档与插件pin、单调时钟有效期和容量/MCP字节预算；默认full兼容，缓存分页不重查目标，不把原生截断说成完整。MIT许可与源blob已登记；51项定向/SDK模拟检查通过，真实Revit新分支未验收。通用跨工具缓存、原生查询分页及Revit测试框架仍不在此实现内。

2026-10-29 业务代码借鉴：对照合并仓库 `TagWallsEventHandler.cs`（commit `86cf7057785f2423fc0d0892c9a5d9c93deb1aa3`、blob `ed1e1019bf7d28fd93cd3dad94f93580041f33fd`）确认本项目已有的 IndependentTag.Create/Reference 调用方式，无需重写。实际选择性适配 rvt-mcp `FindUntaggedElementsHandler.cs`（commit `4affa2aaae3f6e7b798d1067ce7e324ad92f0f91`、blob `48b13f993fe9bc66b8565e39c984b56b967465bc`）的 HostElementId/Room 关联提取；改为2027强类型API和严格失败处理，补齐本项目创建标记的目标/类型/视图及事务前后核验。没有移入批量自动标记、反射回退或吞异常逻辑，未运行上游。与既有引线修正合批，来源许可、局部测试和未完成的原生验收分别记录。
