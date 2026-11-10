> 发布副本说明：本机路径、模型名称及运行标识已匿名化。原始私有证据未随源码发布；历史验收不代表当前会话授权或完整业务认证。

# 统一运行时只读诊断

沿用 `node mcp/health.mjs`，不新增MCP工具或DLL入口。`runtime-diagnostics.mjs`将插件、MCP服务、工作流、活动文档与实际族范围合成一个JSON摘要；错误含code/expected/observed/nextAction，保持严格参数拒绝，不自动重试、注册、保存或重启。核心诊断参考[开源对照](revit-mcp-open-source-review-2026-10-28.md)后独立实现；后续参数名提示为明确标注许可的选择性移植，未添加依赖。

示例：

```powershell
node mcp/health.mjs --expected-mvid deb1d408-6719-428a-a1dc-59fb65cb7267 --require-feature family-text-notes --require-workflow families.text_notes --evidence
```

`--expected-mvid`指定期望模块；`--require-feature`及`--require-workflow`可重复指定不同项；`--require-active-document`才把没有打开文档当作未满足要求。参数必须明确，无任意输出路径、脚本或模型动作。退出码0表示本次未发现指定诊断问题，1表示需要处理，2表示诊断入口失败。所有结果均为observationOnly，不授予模型写入或实机验收通过。

CLI建立新SDK进程，经initialize/listTools/workflow_list/context和原生指纹前后观测生成报告。只读取一次完整context，摘要不返回类型/元素目录；本轮没有减少原生context查询本身的数据量。REVIT_AI_CONFIG、TIMEOUT和只读指纹缓存设置显式透传给SDK子进程，防止直连指纹与SDK文档来自不同桥接配置。

`--evidence`把完整观测保存到本项目私有 `acceptance/diagnostics/runtime-<uuid>/observations.json`，返回绝对路径、SHA256及字节数。文件使用独占新建，不覆盖旧证据。health证据文件不充当结果句柄；项目诊断工作流的可选内存句柄见后节。

主要诊断：

| code | 含义 |
|---|---|
| PLUGIN_MODULE_MISMATCH | 实载MVID与期望不同，先核对监听进程和注册路径 |
| MCP_WORKFLOW_MISSING | 被观察的MCP连接未提供所需工作流，仅此问题不要求重启Revit |
| NATIVE_IDENTITY_CHANGED_OR_UNVERIFIED | 指纹前后变化或未复核，不能视为稳定目标 |
| FAMILY_SCOPE_UNAVAILABLE / INCOMPLETE | 原生族范围缺失或不完整，未知不能靠标题猜测 |
| FAMILY_QUERY_CONTRACT_UNSUPPORTED | 原生族名已知为空，但插件缺少精确标题绑定的空名分支 |
| OBSERVATION_FAILED | 某次只读请求失败，保留阶段和原始错误，不重试 |

默认observationScope为fresh-sdk-process，不能冒充当前聊天MCP已刷新。共享纯函数也能接收当前连接真实观察并注明current-connected-mcp；缺失所需入口时仍不认证该入口。MCP版本号可能不含源码指纹，工作流目录摘要也不能证明全部源码已加载。

11项定向测试覆盖无文档、实际族名与标题分离、已知空/未知、MVID和MCP缺项分别报错、配置透传、取消/失败不重试，以及实际SDK/CLI JSON输出。真实只读报告发现1fc8f276模块的已知空名契约缺口，未发送注定失败的TextNote请求；完整证据47905字节，摘要2526字节。这只是本次JSON输出大小，不是模型token或原生性能基准。

参数名提示已从rvt-mcp的ToolArgumentGuard选择性移植，来源/许可及修改见[THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md)。例如错误的 `--expected_mvid` 会返回 `invalid_diagnostic_arguments`，在 `details.invalid_arguments.unknown[].did_you_mean` 中给出 `--expected-mvid`。字段和值仍严格校验，不自动改名或忽略参数；诊断只包含有界键名、计数及截断标志，不回显代码值、位置参数值或错误UUID原值。归一化产生多个候选时不提示其中任意一个。

本次参数提示变更只涉及Node CLI错误路径，18项受影响测试通过（含CLI/SDK mock、拼写提示、歧义、缺值、截断、Unicode和不连接原生Revit）。原有11项测试及旧实机结果保留为历史观察；本次没有复跑全量回归、编译DLL或新建实机run。

## 项目诊断工作流的读取绑定

`diagnostics.query`现已把读前捕获的documentIdentity/expectedRevision传给每次原生search和inspect；请求input中提供的revision在外层未提供时仍有约束力。传输层利用已有握手检查`readonly-query-pins`，显式能力要求使用新鲜指纹而非可选缓存；该内部要求不混入原生请求字段，没有增加目标查询。组合search+inspect仍为4次工作流逻辑调用，单独查询3次，ask为0；这些数字不代表底层网络握手次数。

文档路径、标题、saved/read-only状态与种类必须已知且前后保持；原生会话/版本拒绝、读取异常或取消后不再发后续查询。该入口查项目元素，族文档在目标读取前拒绝，族正文继续使用独立的families.text_notes。未知参数先用已移植的键名提示返回invalid_diagnostics_input；建议只作提示，不改名、不记录参数值。

此修正的最后15项诊断单元/SDK模拟检查通过，共享桥接及相关72项回归记录亦保留（两者有重叠，不相加）。覆盖每次原生请求pin、旧模块拦截、缓存能力失效、文档中途切换、元数据漂移、取消与拒绝。没有新增实机run或真实Revit查询；新分支为core-tested，旧限定原生证据保持。使用新Node服务代码时按需重连MCP，无需DLL注册或Revit重启。

## 可选摘要与结果分页

使用原有 `revit_workflow_run`，查询输入增加 `responseMode:"summary"`。省略时保持原完整输出；模式本身不能代替明确的查询条件。

```json
{"name":"diagnostics.query","documentIdentity":"<当前项目identity>","expectedRevision":3,"input":{"category":"OST_Walls","limit":100,"responseMode":"summary"}}
```

摘要返回resultHandle、快照SHA256、捕获数、源分页完整性及有效期，保持assisted假设和候选标志。再在**同一MCP进程**调用：

```json
{"name":"diagnostics.result","documentIdentity":"<同一项目identity>","expectedRevision":3,"input":{"resultHandle":"res_<查询返回的32位标识>","section":"search","offset":0,"limit":25}}
```

section只能是search或inspected；offset/limit作用于已捕获记录，单页最多100条。分页hasMore只指缓存内尚有记录，sourceSearchHasMore保留原生后续匹配标志；即使缓存翻完，原查询也可能没有读全。原查询没请求的section、错scope、超期、被驱逐或另一进程的句柄均拒绝，不自动重跑查询。它不能补齐族读取未返回的10条，也不读取其它工具或任意文件。

句柄绑定identity/revision、完整document元数据及插件MVID/PID；查询和分页前后都检查状态，漂移/取消不发布结果。有效期使用单调时钟，最长5分钟、读取不续期；过期数据惰性回收，MCP进程重启后全部失效。最多16条、单条序列化快照2MiB、合计8MiB；这是序列化负载预算，不是进程堆内存限额。摘要/页按实际MCP文本封装及转义预算256KiB，超限拒绝，不静默删除字段。完整捕获JSON在进程内保留，返回数据都是副本；不作为持久化验收证据或写入授权。正式验收/归档继续使用full或专用证据输出，不能以摘要替代完整原始记录。

摘要组合查询为6次工作流逻辑调用（增加前后插件指纹），分页4次元数据读取、不调用search/inspect；它减少重复目标查询和默认输出，不减少现有context本身的数据量。没有新增工具入口、DLL或依赖。首次使用新代码按需重连MCP即可，不重启Revit。

适配来源是OakPlank ResultStore，许可/版本/改动见THIRD_PARTY_NOTICES。51项定向单元及真实SDK到模拟桥接检查通过；覆盖不可变副本、失配/过期/驱逐、预算、原生截断标志、插件漂移和进程隔离。100条模拟记录的实际MCP结果为full41176字节/summary1320字节，翻页增加目标查询0次；不据此宣称真实Revit或token性能。尚无新分支实机验收，状态core-tested。

限定实机配方：`node mcp/diagnostic-results-acceptance.mjs`。只接受已打开、未修改的既定隔离项目；族文档/其它路径/未知会话在目标读取前拒绝，不新建实机run、不要求保存。预检通过才创建只读run，做一次固定墙搜索原生对照、一次SDK摘要查询及最多两页缓存比较，保存完整响应，复核context和磁盘摘要。独立原生对照是验收比较，不宣称全流程只有一次搜索；分页不重查由源码/SDK模拟轨迹证明，实机未独立计数。无任意查询输入或模型动作，失败不重试；需要用户先切回已打开的项目标签。

## 限定实机验收已通过

run `57b4f32d-9008-4233-a8c8-2edd5a74fc5d` 经新SDK连接和真实c9410ac8插件完成：固定隔离项目、identity84d80e8a…/revision0/未修改，18面墙分两页返回，与一次独立原生搜索的全部捕获记录严格相等，源hasMore=false，快照摘要前后一致。完整context和RVT72a5dad6…大小/mtime/SHA256保持。无模型计划、写入、保存、族载入、文档开关或插件注册。

该子范围为readonly-accepted；仅证明本次18面墙的SDK/原生摘要分页成功。当前聊天MCP入口未验证；TTL/驱逐/切换拒绝等仍引用离线测试，不为实机故障注入修改模型。该run的源hash为事后采集，6个源文件mtime均早于run开始，原文副本保存在source-snapshot；后续配方已增加启动时源hash和结束复核，无须为这项证据格式改善重跑已通过的墙查询。
