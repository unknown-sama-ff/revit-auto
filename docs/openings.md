> 发布副本说明：本机路径、模型名称及运行标识已匿名化。原始私有证据未随源码发布；历史验收不代表当前会话授权或完整业务认证。

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

## 2026-10-24 最终回读与竖井偏移校验补齐

用户批准[最小补齐方案](superpowers/specs/2026-10-24-opening-final-readback-design.md)后，沿用既有三类洞口和输入范围，没有增加建模操作。创建结果现在绑定原生 Document、Opening ID 及原操作独立副本；创建后即刻、整计划完成且事务提交前、事务提交后且事务组归并前分别核对。后续删除、换类、跨文档、宿主/边界或竖井约束漂移会进入现有整体回滚路径。创建阶段的重生成仍在事务内，提交后复核只读取，不在关闭的事务外调用 `Regenerate()`。

竖井偏移读取现在明确要求 Double、HasValue 和有限值；不可读或非有限值保留为未知，不认证为零。零偏移规则拒绝未知、NaN、Infinity、非法容差及超出明确容差的偏移。此前 `Math.Abs(NaN) > tolerance` 为 false 的路径已通过纯规则和原生接线守卫补齐；这是离线发现和修复，没有声称发生过真实 Revit 事故。

最终回执新增 `openingCreationVerification`，包含检查阶段、数量、逐项宿主/边界证据，并进入既有完整成功回执容量预检。新能力指纹为 `opening-creation-readback`；旧 `native-opening` 不证明这项最终复核已加载。副作用、保存、视觉、精确切割影响和工程合规仍为未验证，切割方向仍只证明传给原生 API，不把它包装成独立方向认证。

验证：CoreTests **320/320**，定向 MCP **24/24**，全量 MCP **982 通过、0 失败、1 跳过**；实际 Revit 2027.3 API 隔离编译 **0 警告、0 错误**，安装 `CheckOnly` 通过。新增守卫先在旧实现失败，原始失败与通过日志均保留；Core 新规则入口最初编译失败的记录不冒充原生运行失败。构建位于 `bin/Release/opening-readback-20261024T125425Z/`，MVID `c8716d1b-be79-4852-a0a4-a410f762b5b6`，DLL SHA-256 `f31f48876452fb573c7d171344ffa7162019660d34f5c4ce9d8ee59534193d72`。275 项代码/测试来源及日志摘要见该目录的 `build-verification.json`。

本轮只达到新实现的 `compiled` 门槛，没有注册/实载核验、原生洞口正向写入、失败回滚、持久化或 PNG 验收；任务仍为 `blocked`。旧构建文件和轴网/柱/四墙历史来源摘要未变，原归档问题和内部副作用结论保留。本轮 Revit 调用、模型计划、Confirm、模型写入、保存和重启均为 0。

下一步在需要实机验收时，先为这份具体构建准备注册申请，经批准后由用户手动重启并核验新 MVID 和当前完整只读范围，再选择单个明确洞口宿主及几何。当前无需用户重启；原已提交的楼板、柱、轴网等计划不得重放。

## 2026-10-24 具体注册申请已准备，尚未提交

申请 `b6acdf4237f148f484e893c721dc0f8b` 已通过独立内容复核，状态 `READY_FOR_SPECIFIC_CHAT_APPROVAL`，SHA-256 为 `67BB10EC4AEA54CDD98270ABFF19F80EA9888345068B554D483AF093C86A9B8B`。目标仍为上述具体 DLL/MVID；275 项来源、7 份原构建/测试日志摘要和注册器临时夹具 10/10 核验通过。

原生 context 请求返回 `ECONNREFUSED`，正常权限进程查询确认 Revit 进程为 0，因此没有建立或复用当前原生会话基线。离线预检明确 `nativeBaselineAvailable=false`、文档 identity/revision 为 null；磁盘测试副本仍为 97,017,856 字节，SHA-256 `d67efded2e99a9f32af5b3873872fbd1ab022e0dd6a8fde585b50b01d7ac02d1`，与最后已验收保存文件一致且本批次稳定。磁盘相等不代表当前模型回读或隐藏副作用通过，旧 identity/revision/planId 不用于新计划。

拟议差异仅为当前用户 Revit 2027 插件清单的 Assembly 路径，从已注册轴网构建切到洞口回读构建。实际清单 SHA-256 仍为 `B0CD455181DB43B2A8E338BB56FBCAC22BA0C59A0E5D56167D89BA3511F593B3`；桥接内容/ACL、2025 清单和客户端配置未变，没有本申请的 attempt、receipt 或清单备份。预检和拟用清单只写私有 runtime，准备调用恰为 1，注册 Confirm、模型计划/Confirm、保存和重启均为 0。

具体复核见构建目录的 `registration-preparation-verification.json`。`v27/registration-switch.ps1:125–126` 要求这份具体请求的明确聊天批准及独立审阅摘要；设计批准不替代注册批准。批准后先复核请求及保护范围仍有效，仅注册一次；当前 Revit 已退出，因此完成后由用户手动启动并打开同一已保存隔离副本，再以新会话核验 MVID/能力和完整声明范围。此时无需提前启动，也不自动启动、保存或重启。

## 2026-10-24 已批准具体构建单次注册，等待人工启动

用户明确回复“批准注册该具体构建”后，原申请摘要、DLL/MVID、275 项来源及原日志、进程状态、离线文件和保护范围复核通过。实际批准原文与来源写入私有证据，注册器只调用一次，回执为 `REGISTERED_MANUAL_RESTART_PENDING`。实际新清单 SHA-256 为 `FB1A089CB2B91E3C436D31329AF0B6A864E5A7670F99B3FD8B28E739652A7C74`，其备份与原清单摘要一致，复核差异只有 Assembly 路径。桥接内容/ACL、2025 清单、客户端配置及已保存 RVT 均未变。

回执、实际批准、单次 attempt 和备份均保留；构建目录的 `registration-verification.json` 汇总摘要与核验。原申请仍为已批准提交的同一份，不重新生成或重复 Confirm。注册 Confirm=1，模型计划/Confirm、模型写入、保存、启动和重启均为0。

注册完成时 Revit 进程仍为0，因此新 MVID `c8716d1b-be79-4852-a0a4-a410f762b5b6` 尚未实载核验，洞口任务保持 blocked，不升级原生验收。下一步由用户手动启动 Revit 并打开 `acceptance/models/floor-side-effect-isolated-20261020.rvt`；随后只读核验新 MVID、`opening-creation-readback` 和完整声明范围，不沿用旧 identity/revision，不创建模型计划或自动保存/重启。

## 2026-10-24 人工启动后，新构建实载与完整只读范围通过

用户回复“已启动并打开隔离副本”后，新 run `d08cac8a-06a4-4355-a635-c36c259408e6` 核验实际 PID `37216`、MVID `c8716d1b-be79-4852-a0a4-a410f762b5b6` 和 `opening-creation-readback` 均匹配已批准构建，原有能力集合保留。安装清单及 DLL 摘要仍匹配注册回执，275 项代码/测试来源摘要复核通过；原始注册证据不改写、不重复提交。

当前文档 identity `1349f8b9c89324586508e7cf2091b820`、revision `0`、`isModified=false`，同一路径隔离副本。当前契约快照和 31 类别、57 个 scope 的两轮原始结果已归档：260 实例、29 类型、7 房间和 4 个观察元素的全部已捕获字段与上次柱关闭重开快照一致，类别成员及视图设置保持。房间/视图的 identity/revision 按各自会话单独核验，已知会话字段显式映射，其它模型字段未删减；只规范化既有明确无序集合。完整当前 context 在批次前后不变，界面视图与选择也与历史一致。

磁盘文件为 97,017,856 字节，SHA-256 `d67efded2e99a9f32af5b3873872fbd1ab022e0dd6a8fde585b50b01d7ac02d1`，读取前后稳定并匹配上次已保存文件。manifest、baseline、model-comparison、summary 共 4 份标准记录通过 schema，完整结果和摘要见上述 run 及构建目录 `loaded-verification-20261024.json`。

新增 `readonly-accepted` 仅接受这份 DLL 的实际加载和声明读取范围，不表示执行过新洞口或验收了提交后回读、回滚、持久化、视觉与切割影响。任务整体继续 blocked：上游未知系统内部副作用及洞口宿主/几何、单能力写入验收缺口保持。轴网55项、柱62项、四墙79项历史来源摘要未变，原归档审计仍分别为0/0/11项。

本轮模型计划创建、Confirm、注册 Confirm、模型写入、保存、启动和重启调用均为0。无需用户再次注册、启动或重启。下一步先只读选择一个明确既有宿主，审查完整 XYZ、依赖和范围，再另建单能力 run/预览并取得具体 planId 聊天批准；不使用旧会话绑定或重放已提交计划。

## 2026-10-24 墙宿主枚举误判已修复，具体修复构建待注册

宿主审查发现 `OpeningService.Validate` 把 `WALL_CROSS_SECTION` 的0当作直立墙。直接读取本机 Revit 2027.3 API 元数据证实 `WallCrossSection.Vertical=1`、`SingleSlanted=0`、`Tapered=2`；最近完整快照的18面墙也均为值1、格式化文本“垂直”。旧条件会误拒绝合法直立墙，并可能误放行水平定位线的单斜墙。此问题在发出洞口预览前发现，没有通过修改墙或发送失败写入来绕过。SDK、旧源码和模型快照摘要证据见 `acceptance/preparations/opening-wall-host-enum-20261024.json`。

修复改用 `(int)WallCrossSection.Vertical`，同时明确要求参数存在、Integer、HasValue；Basic、直线、水平定位线等既有约束保留，支持范围未扩大。新增原生宿主接线回归先在旧实现失败，修复后通过。CoreTests 320/320、定向 MCP 25/25、全量 MCP 983通过/0失败/1跳过，实际 Revit 2027.3 隔离编译0警告/0错误，安装CheckOnly通过。新构建为 `bin/Release/opening-wall-host-fix-20261024T132922Z`，MVID `16e09876-8099-4ef2-a586-2141fd141784`，DLL SHA-256 `42b2a9ee9f857575aec749a0734599a8217d4afeb12b0578d82fea5485ca5e88`；275项来源及日志摘要已归档。

新只读候选 run `7c0a9929-68c3-499e-a82d-0aaf45d7422e` 在同一已保存会话复用57项完整基线，并新采6项宿主/类型/标高/观察元素、依赖和局部碰撞范围。独立测试墙 `2296040` 为100 mm非结构墙，1F、高3000 mm，定位线 `(70000,60000,0)` 至 `(75000,60000,0)` mm；公开字段与原快照一致。两轮原生依赖仅返回自身，完整且未截断；限定类别71项本机库存范围中邻近候选为0、未知为0。该结果不认证链接模型、精确净距、拟议切割影响或工程合规。

候选洞口为 `(72000,60000,1000)` 至 `(73000,60000,2000)` mm，宽高各1000 mm、宿主容差1 mm。尚未创建原生预览，也未完成修复 DLL 下的 Basic/包围盒准入；候选几何不是执行批准。读取及注册材料准备前后，实际仍加载旧MVID `c8716d1b-be79-4852-a0a4-a410f762b5b6`，identity `1349f8b9c89324586508e7cf2091b820`、revision0、未修改，RVT摘要仍为 `d67efded2e99a9f32af5b3873872fbd1ab022e0dd6a8fde585b50b01d7ac02d1`。

修复构建的唯一注册申请 `d8b199550686502bea73db6a5a7020c2` 已独立复核，状态 `READY_FOR_SPECIFIC_CHAT_APPROVAL`，请求 SHA-256 `883881D74D89B3E7B0CC3FC7856523A02BDD10B68FCD3B4831DA1D6AD3EB312E`。原生基线采用同会话明确来源复用，当前 context、模块、PID、revision、磁盘文件前后匹配；没有把旧57项读取重标为本轮新采集。拟用差异仅为当前用户2027清单的Assembly路径，真实清单仍为 `FB1A089CB2B91E3C436D31329AF0B6A864E5A7670F99B3FD8B28E739652A7C74`，桥接/ACL、2025清单及客户端配置未变，尚无本申请的attempt/receipt/backup。

旧构建文件和全部历史验收来源未覆盖；原系统内部副作用与归档问题保持。当前没有模型计划、模型Confirm、保存或重启。具体复核见新构建目录 `registration-preparation-verification.json`；需按注册器125–126行对这份独立申请明确批准后才能单次切换，再由用户手动重载并核验新MVID。前一份洞口构建注册批准不代替本次具体修复申请批准，当前无需提前重启。

## 2026-10-24 枚举修复构建已批准并单次注册，等待人工重启

用户明确回复“批准注册该修复构建”后，原请求 `883881D74D89B3E7B0CC3FC7856523A02BDD10B68FCD3B4831DA1D6AD3EB312E`、修复DLL/MVID、275项来源、原始日志、保护范围及当前原生上下文/文件复核通过。实际批准原文与来源已记录，注册器只调用一次，回执为 `REGISTERED_MANUAL_RESTART_PENDING`。安装清单SHA-256现为 `9AB575F3A363E536C52094B84C31722D71DB54BB42917D1E1B5A43BEE0D7855A`；备份匹配原FB1A089C…清单，复核差异只有Assembly路径。桥接/ACL、2025清单和客户端配置保持。

注册前后完整原生context、旧模块MVID/PID与RVT字节一致：当前仍为PID37216、MVID `c8716d1b-be79-4852-a0a4-a410f762b5b6`，同identity/revision0/未修改。修复MVID `16e09876-8099-4ef2-a586-2141fd141784` 尚未实载核验；仅注册不升级洞口或宿主准入验收。原批准、独占attempt、原生回执和清单备份保留，汇总见修复构建目录 `registration-verification.json`。

本次注册Confirm=1，模型计划、模型Confirm、模型写入、保存和重启均为0。下一步由用户手动重启Revit并打开同一已保存隔离副本，随后只读核验新修复MVID和完整声明范围；不重放该注册申请、不沿用旧会话、不自动保存或创建洞口计划。当前测试副本无需再次保存。

## 2026-10-24 枚举修复版重启实载与完整只读核验通过

用户回复“修复插件已重启并打开隔离副本”后，新 run `d1a6afdc-1078-4a49-a301-1ac32d183ea4` 核验实际PID `30776`、MVID `16e09876-8099-4ef2-a586-2141fd141784` 与已批准修复构建一致，`opening-creation-readback` 及旧能力集合保留。安装清单、修复DLL摘要及275项代码/测试来源保持，原注册回执不改写、不重复提交。

新文档 identity `efda0f160cc699b9c34c607c103cdff2`、revision0、`isModified=false`。同一新模块批次完整读取原57项范围，并合并两轮候选墙依赖，共59个scope：31类别、260实例、29类型、7房间和4观察元素的全部已捕获字段与已保存快照一致；类别成员、视图设置、当前context、视图与选择保持。房间/视图及宿主依赖的会话字段分别验证各自真实文档后显式映射，其余字段未剔除，仅规范化已知无序集合。

墙 `2296040` 当前横截面原生值为1（Vertical），两轮完整逻辑依赖仍仅自身，与旧宿主只读结果一致。这里只接受修复DLL实载和声明只读范围，未调用洞口预览准入；墙Basic类型、原生包围盒准入及实际切割仍须之后的新预览/执行验证。

RVT仍为97,017,856字节，SHA-256 `d67efded2e99a9f32af5b3873872fbd1ab022e0dd6a8fde585b50b01d7ac02d1`，读取前后稳定并匹配已保存文件。manifest、baseline、model-comparison、summary四份标准记录通过schema；完整原始结果及构建目录 `loaded-verification-20261024.json` 已归档。轴网55项、柱62项、四墙79项历史来源摘要及原审计0/0/11项保持。

任务仍为blocked，保留已有readonly-accepted；新洞口预览/写入、最终事务回读、失败回滚、持久化、视觉和旧系统内部副作用均未因此升级。本轮模型计划、Confirm、注册Confirm、模型写入、保存和重启调用均0，无需用户再次注册或重启。下一步另建单墙洞口预览run并通过原生宿主准入，具体planId获聊天批准后才可单次执行；当前没有该计划，不沿用旧会话绑定。

## 2026-10-24 单墙洞口原生预览通过，等待具体批准

新 run `0f5c6053-e80e-42b7-a2ac-2d707e13948e` 复用同MVID/PID、完整context、identity/revision及文件摘要保持的59项基线，另新采7项宿主/类型/标高/观察元素、两轮依赖、限定碰撞、保存状态和候选视图。所有已捕获字段匹配；原59项读取明确标记来源，没有重标为本轮新采。墙 `2296040` 的依赖完整且仅自身，限定碰撞候选与未知均为0，当前文档仍为 `efda0f160cc699b9c34c607c103cdff2`、revision0、未修改。

仅创建一次计划 `026763c081e5b2435b28cd1bc2f86764`，原生返回pending：一个 `wall_rectangle`，宿主墙 `2296040`，下角 `(72000,60000,1000)` 至对角 `(73000,60000,2000)` mm，宽高各1000 mm，宿主容差1 mm。修复后的原生 Basic/直立/定位线与宿主范围预检已通过，说明原先枚举误判不再阻断该合法宿主；还没有原生Opening或实际切割。

原生预览摘要为 `62d1a7be2e7526c608ef414c096dc1f3521e2c252ed560310e6dd10dae437c15`，范围 `native-preview-pretty-json-v1`；有效至上海时间 **2026-10-25 00:07:41**。有1条原生宿主切割及影响范围提示，依赖未截断，结构设计和精确切割影响仍未认证。原生预览payload、实际工具响应、清单绑定及单次preview-create attempt均已归档；原计划查询仍pending，无confirmation或执行attempt。

新导出的当前平面基准PNG已目视查看，远端独立测试墙线可见；拟议洞口尚未渲染，不据此接受切割、净距、视觉或整图版面。当前context及RVT字节在导出/预览前后不变，摘要仍为 `d67efded2e99a9f32af5b3873872fbd1ab022e0dd6a8fde585b50b01d7ac02d1`。标准阶段和追加审查记录通过schema，原始预览采集summary字节保留为 `summary-preview-capture-stage.json`，最新summary索引21项来源。

队列新增仅限该计划的preview-accepted，整体blocked及历史副作用结论保持。模型计划创建=1、Confirm=0、模型写入/保存/重启=0。下一步需该planId聊天批准后，复核有效期、原pending状态、摘要及当前范围，先持久化独占执行attempt，再Confirm一次；不自动保存，不将批准扩展至其它洞口或后续回滚场景。

## 2026-10-24 单墙洞口已批准并单次提交，主结果通过

用户回复“批准执行该墙洞口计划”后，原pending计划、预览摘要、当前会话、文件及7项补充范围复核一致。实际批准与来源写入confirmation，独占wx attempt落盘并fsync后只Confirm一次；原计划结果committed，新增原生Opening `2296057`，宿主 `2296040`。后续仅查询同一计划，未重复执行。初次创建、事务提交前及提交后最终回读均通过；独立inspect与最终 `openingCreationVerification` 的宿主及两角点一致，原生类别为 `OST_SWallRectOpening`（-2000997）。

宿主面积15→14m²，减少约1.000000000000001m²；体积1.50→1.40m³，减少约0.100000000000003m³，与原生厚度100mm和1×1m边界一致。仅允许这两个已验证Double派生参数的数值及格式变化，其它宿主参数/几何/关系字段逐一保留并比较。完整执行后60个scope的两轮读取通过：当前261个已捕获实例中，259个既有非宿主实例不变，29类型、7房间、4观察元素及原31类别成员保持。宿主逻辑依赖精确增加新Opening至 `[2296040,2296057]`。

完整事务回执只新增2296057，无附加新增或删除；修改宿主以及系统 `86962/2289997`。两项系统已有事务前后完整公开字段快照且一致，但内部变化仍未解释。`primaryWriteVerified=true`、`capturedExistingScopeVerified=true`，`writeAccepted=false`、`allModelSideEffectsVerified=false`，任务整体继续blocked。新洞口类别是在执行后首次枚举，当前仅含2296057，不把它冒称为事务前已有直接空集快照。

首次只读类别发现因本地名称“矩形直墙洞口”不在搜索器类别列表而停止；SDK元数据确认其准确内置名 `OST_SWallRectOpening`，改用该标识后当前类别查询及后续批次通过。该失败发生在完整postwrite采集前；原生执行已committed，恢复没有重放Confirm、重采完整旧批次或把查询失败当成原生回滚。类别发现记录保留原名称错误及SDK映射。

执行后原生PNG4096×3562、76,344字节，摘要 `13e982e693bf6709360cab3684df1f5330ee547c2cece90b552ccf5b3728d6c1`，已检查原图及无缩放像素细部裁片。该墙跨度中新增一对洞口边界/侧边标志；平面中的下部墙体投影/窗台线仍连续，因此仅接受当前平面边界标志可见性，**不认证正面或三维空洞外观**，也不升级整图版面、精确实体切割或工程合规。原生导出图未修改，细部来源和像素矩形记录在 `wall-detail-derivation.json`。

9份已有标准阶段记录通过schema，原预览summary字节保留；手动保存、关闭重开及失败回滚尚未发生，不运行完整归档审计。文档同identity、revision1、isModified=true，磁盘RVT仍为提交前d67efded…摘要。累计Confirm=1；本次只读核验没有计划创建/Confirm/模型写入/保存/重启。下一步由用户决定是否保留并手动保存同一路径，随后只读核验保存状态并人工关闭重开；不重放此计划，不继续其它模型写入。

## 2026-10-24 保存确认后观测到新进程，声明范围持久化归档通过

用户回复“已手动保存，继续核验”后，初次同会话保存检查发现文档已变为新的identity和revision0，在首个context断言处停止，没有采集完整saved批次，也没有重放计划。改按实际新会话核验：PID已从30776变为 **28128**，identity为 `9231d82ed7a8d24a8376750a50eace29`，revision0、isModified=false，修复MVID仍为 `16e09876-8099-4ef2-a586-2141fd141784`。这是机器观察到的新进程/干净文档会话；用户明确确认的是保存，未另行回复关闭重开，因此不补造人工关闭重开确认或关闭前机器快照，也不请用户重复操作。

同run `0f5c6053-e80e-42b7-a2ac-2d707e13948e` 的60项范围两轮原始读取与执行后快照一致：261实例、29类型、7房间、4观察元素及原类别/视图/依赖范围保持。洞口 `2296057` 的唯一ID、宿主、矩形两角点和偏移保持，宿主面积约14m²、体积约1.4m³，完整其它字段与预期依赖 `[2296040,2296057]` 一致。仅显式映射各自会话identity/revision、保存标志和新会话空历史，其它模型字段未删减。完整原始数据保存为 `reopen-readonly.json`，同一次观察明确同时支持当前保存状态与新会话重载记录，没有伪造两次独立采集。

当前已保存文件为97,030,144字节，SHA-256 `2ff97e280130575cd366fb0ec4ae990a864034417f7248dc1c8f62c73c2a419b`，读取和图像导出前后稳定，且与保存前d67efded…不同。**未取得保存后、会话变化前的独立文件摘要，无法证明当前文件与该未观察时点的字节完全相等**；`exactSavedFileBytesVerified=false`，归档保留 `preclose-save-snapshot-missing` 限制。当前新进程中的已保存状态、同路径文件、洞口身份及声明范围支持有限的persistence-accepted，不认证整模型隐藏状态。

新会话原生PNG已目视查看，与执行后PNG逐字节一致（SHA-256 `13e982e693bf6709360cab3684df1f5330ee547c2cece90b552ccf5b3728d6c1`）；仅保留当前平面洞口边界标志的有限视觉结论，正面/三维空洞外观、整图、精确切割和工程合规仍未认证。旧细部裁片保持原阶段语义，以原生父图字节相等解释像素证据复用，不修改原生图或重标历史元数据。

11份标准阶段记录通过schema，最新summary索引58项来源；严格离线绑定/字节审计 `archive-audit-20261024.json` 为0项发现，同时明确列出关闭前保存快照缺失及archive-only限制。原执行后summary、visual准确字节保留为 `summary-postwrite-stage.json`、`visual-postwrite-stage.json`，阶段来源关系已记录，没有伪造关闭前saved阶段summary。

任务只对本次wall_rectangle的声明范围新增persistence-accepted，整体仍blocked：系统86962/2289997内部修改未解释，writeAccepted/allModelSideEffectsVerified=false；失败回滚、其它洞口种类及正面/三维视觉仍未验收。本次计划创建/Confirm/模型写入/保存/重启均0，累计Confirm=1。无需再保存、关闭重开、注册或重启；不重放原committed计划，不补造历史证据。

## 2026-10-24 独立楼板轮廓洞口预览通过，等待具体批准

新run `3f369d09-21c5-487f-a280-f09f1b5f821f` 在同一已保存新会话复用60项原始范围，另补7项当前宿主/类型/标高/观察元素、两轮依赖、限定碰撞、保存状态和候选视图。MVID仍为4345887a…、PID28128、identity `9231d82ed7a8d24a8376750a50eace29`、revision0、未修改，文件摘要仍为 `2ff97e280130575cd366fb0ec4ae990a864034417f7248dc1c8f62c73c2a419b`。公开字段与原快照一致，当前保存文件和context前后保持；原60项明确记录为同会话来源复用，不重标为本轮新采。

宿主为既有独立楼板 `2296043`，类型763936、1F标高311、非结构、零偏移、厚100mm；外轮廓X77000–81000/Y63000–67000/Z0mm，面积16m²、体积1.6m³。候选为其中央1×1m矩形，按顺序四点 `(78500,64500,0)`、`(79500,64500,0)`、`(79500,65500,0)`、`(78500,65500,0)` mm，`cutDirection=vertical`、宿主容差1mm。修复版原生planar-top-face顶面顶点/中点采样与闭合直边轮廓预检通过；不据此认证精确切割影响或独立实际切割方向。

仅创建一次原生计划 `05fd87b04b325ee389ba5d1c2e8a9cd2`，当前pending，操作仅一个floor_profile。预览摘要 `27b3427b9c2f35aa4da082803208a845a529290fa4f38f32bfc2250d0a00a854`，摘要范围native-preview-pretty-json-v1；有效至上海时间 **2026-10-25 01:27:43**。有1条宿主切割及影响范围提示，原生依赖8项完整未截断。计划生成后再次查询仍pending且payload不变，没有confirmation或执行attempt。

为避免缺少后续副作用前值，补齐原8项依赖中此前未完整inspect的7个既有元素：SketchPlane2296041、Sketch2296042、ModelLine2296044–2296048。两轮参数/身份等公开快照一致，无额外引用类型需要扩充；它们是既有依赖的读取范围扩展，不是新建模型元素。完整数据在 `dependency-baseline-readonly.json`，审查在 `dependency-baseline-review.json`；其后计划、context和文件保持。

使用现有平面2295811及现有原生三维视图1847485（`{三维}`）取得基准图，没有新建或修改视图。三维导出在同一轮只读审查中先取得，后按相同会话/文件和源摘要明确复用；当前远端楼板仍为完整面，尚未出现拟议楼板洞口。新增三维图也清楚显示已保存墙洞口2296057的孔洞，作为独立后续观察记入 `wall-opening-3d-followup.json`，只接受该单视角可见性。旧墙run的原平面visual、summary、58项来源和审计未改写，旧关闭前快照缺口及内部副作用限制保留。

最新summary索引27项来源，标准阶段与追加依赖/图像审查记录通过schema，原预览采集summary字节保留。队列按wall_rectangle、floor_profile、shaft分别登记当前结论：墙的有限持久化保留；本楼板场景仅readonly/preview通过、尚无实例或实际切割；竖井尚未原生验收，天花/屋顶/perpendicular场景不包含在本楼板候选内。

本轮floor_profile plan.create=1、Confirm=0、模型写入/保存/重启=0。整体blocked和旧系统副作用结论保持。下一步需该具体planId聊天批准，再复核原pending状态、摘要、当前范围和全部已捕获依赖，持久化独占attempt后仅Confirm一次；保存和重开仍由用户手动完成。此前墙洞口的Confirm不得重放。

## 2026-10-25 归档楼板洞口失败与独立恢复核验

用户批准计划 `05fd87b04b325ee389ba5d1c2e8a9cd2` 后，原pending/payload摘要、7项主体范围及两轮7个既有依赖快照复核一致，确认与独占attempt持久化后仅Confirm一次。原生创建后的profile完整XYZ边段不匹配，回执failed、causeCode=invalid_opening、rolledBack=true、completedOperationCount=0；原始回执没有实际失配轮廓的causeDetails。原计划已经结束，不重复Confirm，也不以同名/新坐标自动重建来绕过。

独立63项范围两轮读取确认已捕获状态恢复：原261实例加7个既有依赖共268个实例、29类型、7房间、4观察元素及类别/视图/依赖字段全部与执行前一致。楼板2296043仍为16m²/1.6m³、依赖仍为原8项，原墙孔洞2296057保持。保存状态干净，只有一条零增删改ID的TransactionRolledBack历史事件，文件仍为原97,030,144字节及2ff97e28…摘要，平面/三维原生PNG均与执行前逐字节一致并已查看。

这里只认证声明公开范围及图像恢复，不把空事件ID集合当作全模型净差异证明，也不将本次意外正向失败冒充专门故障哨兵回滚验收。9份已有标准阶段通过schema，50项来源摘要归档；readback是原rollback-readback的明确字节别名，visual仅认证恢复画面，未认证正向楼板孔洞。失败档案采用 `failed-scope-archive-audit-20261025.json` 的阶段/字节盘点，不套用要求committed的完整保存重开审计，不补造saved/reopen文件。模型仍同identity、revision1、未修改；本次失败测试无需额外保存或关闭重开。

## 2026-10-25 补齐未来profile失配的回滚前诊断，原始根因仍待取证

按现有失败路径，新增 `opening-profile-failure-evidence`：把刚刚参与失败比较的实际完整XYZ端点、原操作、阶段和原始容差原样冻结到BridgeException.Details，经已有causeDetails回执返回。辅助上下文保留宿主/Opening原生包围盒及Transform、宿主草图平面和Opening依赖中的草图平面，均不应用坐标变换。主体几何与补充数据独立采集，后者失败不能抹掉前者；采集异常/非有限序列化失败/超字节预算明确记录，不替换原invalid_opening或让比较成功。每段JSON数据预算256KiB，依赖最多读取256项、草图平面最多4项。

`OpeningRules`比较引擎文件摘要与已注册构建完全一致，完整3D匹配和原1mm输入不变，没有改为只比XY或猜测消除Z。当前未证实的可能性是高程表示、局部坐标基或边段形状差异；旧Opening已回滚且未采集实际数据，因此这些不是已证实根因。本轮修复的是失败证据缺口，不声称原始楼板轮廓问题已解决，也不改写旧空causeDetails。

新诊断回归先在旧代码失败；CoreTests325项、定向MCP28项、全量MCP986通过/0失败/1跳过，Revit2027.3隔离编译0警告/0错误、安装CheckOnly通过。构建 `bin/Release/opening-profile-diagnostics-20261024T175907Z`，MVID `dfcc6d30-e1f0-494b-aabf-46f7879a5205`，DLL摘要 `ec87363b93fa8a7bad6c611a3c6c4973fcea1d5a28cb33665920155aeb5816f5`，278项来源及日志摘要已归档。序列化测试使用明确的合成数据，不冒充已取得的Revit实际失配数据。

本轮未注册新诊断构建，未新建或确认任何模型计划、未保存或重启；旧加载构建文件、原失败档案和墙持久化档案保持。下一次原生取证先对新构建单独注册/人工加载核验，再通过新run、具体新planId和新聊天批准执行；旧failed计划不可重放。floor_profile正向、专门回滚、持久化和视觉仍未验收，历史系统内部副作用阻塞不变。

## 2026-10-25 诊断构建注册材料已复核，等待具体批准

已准备唯一注册申请 `a37c56035be2ca9c95d7111e73952fa9`，SHA-256 `B4C7BBDD3658A67BD4DDEBA929AE1FDC8692C5CE260507CD3A5A67D1D5D33DE7`，目标MVID仍为 `dfcc6d30-e1f0-494b-aabf-46f7879a5205`。独立复查278项来源、7份日志、DLL/MVID及未变的注册器/部署器来源和10项fixture证据；拟议清单仅Assembly路径不同。当前真实清单仍为9AB575F3…，桥接内容/ACL、runtime ACL、2025清单和客户端配置保持；没有本申请的attempt、receipt或backup。完整材料在构建目录 `registration-preparation-verification.json`，尚未注册。

当前原生连接ECONNREFUSED，常规权限下进程查询确认Revit为0。离线预检首次在文件摘要门禁停止、没有创建申请：磁盘文件现为97,030,144字节、SHA-256 `e76dcf031316a117995d081436905705f4684ed9a18cee661e20a531360a03b9`，不同于历史恢复2ff97e28…。PowerShell及Node原始字节计算一致；最新 `.0012.rvt` 备份恰匹配历史2ff97e28…及旧mtime。journal.0123第4555/4558/4684行记录上海时间00:58:46的QAT `ID_REVIT_FILE_SAVE`，第4619行时间与当前文件00:58:47一致，随后为 `ID_APP_EXIT` 及正常结束记录。该后续保存发生在原15:57UTC恢复采集之后，不改写历史恢复或墙持久化证据。

新的离线材料只绑定后续保存文件的稳定摘要，明确 `nativeBaselineAvailable=false`，identity/revision为null，`historicalRestorationFileMatchesCurrent=false`；不认证保存后的模型内容。调查独立保存在 `registration-model-drift-review-20261025.json`。临时预检中另一次JSON日期自动解析导致字符串比较停止，已按UTC刻度修正；该次也在reservation/申请创建前停止。最终New-SwitchRequest恰为1，注册Confirm、模型计划/Confirm、自动保存和重启均0。

注册器 `v27/registration-switch.ps1:125–126` 要求该具体申请的明确聊天批准及独立审核摘要。批准仅覆盖切换插件清单；随后用户手动启动并打开原路径副本，再核验新MVID、能力及完整原生范围，不能沿用旧会话作为当前基线。新模型试验不在本申请批准范围内，仍需新run、新planId及单独批准；此构建仅补诊断，原始几何失配未解决。历史系统副作用和其它洞口场景继续blocked。

## 2026-10-25 诊断构建已获批并单次注册，待手动加载

用户通过聊天明确批准“批准注册该诊断构建”后，对原申请 `a37c56035be2ca9c95d7111e73952fa9` 及审核摘要B4C7BBDD…重新核验：278项来源、7份日志、DLL/MVID、原清单/保护范围、离线模型e76dcf03…及后续保存调查保持，Revit进程为0。approval与preconfirm检查落盘后仅调用一次注册器，回执 `REGISTERED_MANUAL_RESTART_PENDING`，注册Confirm=1。

安装清单新SHA-256 `90207CF9D31E74DC3A8DD3FD848B3914F936024795E32E7AE5CB7BF1DF10A331`，原清单备份摘要仍为9AB575F3…，XML差异仅Assembly；桥接/ACL、2025清单和客户端配置保持，模型文件字节未变。批准、独占attempt、receipt、backup及前后文件检查均由构建目录 `registration-verification.json` 绑定归档，原准备报告按历史阶段保留。模型计划/Confirm、保存及启动/重启均0；不得重放本次已消费注册申请。

当前Revit仍未启动，目标MVID `dfcc6d30-e1f0-494b-aabf-46f7879a5205` 尚未实载。下一步请用户手动启动Revit，打开同一路径隔离副本，再只读核验诊断能力和完整原生范围；不要求额外保存。原始轮廓失配未修复，floor_profile正向创建、持久化/视觉及旧系统副作用阻塞保持。注册批准不包含新的模型取证计划。

## 2026-10-25 诊断构建实载及新会话63项只读范围通过

用户确认手动启动并打开隔离副本后，新run `685154e0-7997-4b9f-a385-e69de2946fcf` 核验PID5740、MVID `dfcc6d30-e1f0-494b-aabf-46f7879a5205`、新增 `opening-profile-failure-evidence` 及全部既有能力。278项来源、7份构建日志、DLL及已注册清单摘要匹配。当前identity `0c6cb5ac38b80df2a24ec06ef688eb33`、revision0、未修改；原生会话已变，不复用旧文档身份或失效计划。

以旧rollback-scopes为查询配方，重新原生采集63个scope，而非复用旧结果：32项类别/成员范围、268个既有实例（含7个楼板草图依赖）、29类型、7房间、4观察元素、既有视图、墙及楼板依赖、限量邻近候选和保存状态全部完整字段匹配。实例/类型与房间/依赖等双轮均一致；没有剔除geometry/projection或放宽数值/几何容差。新旧identity/revision绑定、重启后的空历史单独明确处理，旧回滚事件仍只属于历史证据。当前视图911279及空选择也与旧快照一致。

磁盘文件仍为97,030,144字节、e76dcf03…，与注册时离线观察一致，整个批次摘要、NTFS时间、context及模块保持。历史磁盘2ff97e28…不与当前字节相等；现在仅认证后续保存文件的声明公开范围与历史一致，不认证全模型隐藏状态或历史内部副作用无害。临时采集首次在创建run前因Node毫秒显示与.NET亚毫秒精度表示停止，未创建reservation或执行scope；随后改用NTFS精确纳秒比较，不放宽文件时间检查。成功批次各只读响应逐份落盘，可按原run恢复，不盲目重采。

本run只有四份标准阶段manifest/baseline/readback/summary，无preview、Confirm、执行、saved/reopen或新PNG；不冒充楼板洞口正向验收或新的保存重开验收。`readonly-archive-audit-20261025.json` 独立复核4份标准记录schema、74项来源摘要及旧楼板50/墙58项来源字节，归档一致；不套用要求committed的写入归档profile。构建目录 `loaded-verification-20261025.json` 绑定该观察。全程注册、模型计划/Confirm、保存及启动/重启均0，旧楼板及墙档案不改写。整体任务继续blocked，诊断实载和声明范围readonly-accepted通过，原始失配仍未知。

下一项仅拟议创建新诊断预览：仍使用独立楼板2296043，四点 `(78500,64500,0)`、`(79500,64500,0)`、`(79500,65500,0)`、`(78500,65500,0)` mm，vertical、1mm宿主容差；目的是在未来获批的单次原生尝试中捕获实际失败端点。当前没有新planId。后续须另建新run、检查当前会话并创建新预览；执行再对具体新planId单独批准，最多Confirm一次，不沿用旧计划或旧批准，不自动保存/重启。

## 2026-10-25 新楼板洞口诊断预览已生成，等待具体执行批准

用户批准“仅创建新诊断预览”后，新run `96812202-c32e-4501-abc7-9aa0286a8b6f` 在同MVID/PID、完整context、identity5d0063b7…、revision0/未修改及磁盘e76dcf03…下明确复用上一个run的63项观察，另采7项当前范围。两轮完整读取楼板及8项既有依赖、类型/标高、4观察元素和既有墙/墙洞口共16个ID；全部字段与来源匹配，依赖8项且无截断，邻近候选/未知均0。源63scope没有冒充本轮重新采集，8项依赖已有前值不再遗漏。

只创建一次新计划 `fc27562b4d29ad74879c310127e04b05`：楼板2296043中央1×1m、四点为 `(78500,64500,0)`、`(79500,64500,0)`、`(79500,65500,0)`、`(78500,65500,0)` mm，vertical、宿主容差1mm。原生顶面/轮廓预检通过，pending，只有1条宿主切割及依赖影响提示；预览不是精确切割/合规认证。原生预览摘要 `e859fd47f5e2db899f38f60c68d156234c1115e3f7900960d19d1d070f324389`，有效至上海时间 **2026-10-25 05:22:46**（原生UTC到期字段保留，不改写时区）。

新平面/三维PNG已导出并查看：三维中独立楼板仍为完整面，既有墙孔洞可见；远端楼板在平面图接近画幅边界，不认证其整板平面细部。拟议楼板孔洞尚未渲染。PNG只作当前执行前基准，不提高positive visual状态。后续只读复核确认新计划pending/摘要/输入未变、context/文件保持，Confirm=0，没有Opening或原生失配端点数据。

8份标准记录schema及27项来源摘要通过预览阶段审查，旧失败50项、墙58项和实载只读74项来源保持；记录见 `preview-archive-audit-20261025.json`。审查曾把零Confirm计数放入schema只允许1的根字段，已将计数移到sideEffectCounters并保存两个未通过schema的原始捕获别名；它们仅是原始格式历史，不作标准记录通过证据。修正期间没有重采或重建预览。原预览采集summary也保留，未补造confirmation/execution/saved/reopen。

本轮plan.create=1、Confirm=0，模型写入/保存/重启/注册均0。新试验仅为取证，原完整XYZ比较和1mm容差保持，实际执行仍可能再次失败回滚；不能称为原几何问题已修复。整体及系统副作用阻塞保持。执行须对本具体planId单独聊天批准，获批后复核当前状态并独占单次Confirm；旧failed计划6c3d4b62…绝不重放，超时先查原计划，不盲目重建。

## 2026-10-25 新诊断单次执行失败回滚，已取得真实平面差异

用户批准具体计划fc27562b4d29ad74879c310127e04b05后，原pending/预览摘要、7项当前范围、完整8项依赖前值、会话/文件保持，confirmation与独占attempt落盘后恰好Confirm一次。原生仍在after-creation的完整XYZ边段比较处failed/invalid_opening并回滚，完成操作0，无保留的新建ID。新版causeDetails成功冻结了临时Opening2296081的4条真实Line及原操作/包围盒/草图平面；它和其依赖已随回滚不存在，不能拿这些ID继续执行。

输入端点全部Z0，实际端点全部Z−100mm，XY最大差约7.275957614183426×10⁻¹²mm。宿主包围盒Z−100至0、单位Transform，Opening草图平面原点Z−100、法向−Z；宿主草图平面仍Z0。离线诊断程序直接反射调用相同已加载DLL的OpeningRules.EdgesMatch，连续3次false；只在诊断数据副本上消除统一Z差后为true。本次拒绝由输入表面与原生轮廓不同高程表示的同平面比较造成，现有距离算法本身没有算错；没有放宽容差、投影生产几何或改写旧回执。此结论仅覆盖本次真实楼板/vertical观察，不能推广为所有宿主均须平移100mm。

独立恢复核验重新采集原63scope，加读17个实际临时依赖ID的存在性，共64scope。268个既有实例、29类型、7房间、4观察元素及其它声明字段与执行前一致，17个临时ID均不存在。保存状态干净，revision0→1且仅一条回滚历史事件；文件e76dcf03…、字节数及NTFS时间不变。后处理曾误把缺失元素summary应为null写成undefined检查，修正后在同context/模块下继续使用已完成的64项采集，没有重采或重放Confirm。

三维PNG与执行前字节一致；平面PNG实际有1292个像素改变，bbox(2809,620)–(2915,673)，位于阶梯方向注释附近，具体渲染/内部原因未证实。原始PNG已查看，像素证据在rollback-pixel-analysis.json；不把声明公开字段恢复当作整图像素恢复，也不把该差异解释为无害。整体视觉恢复、全模型隐藏副作用和正向楼板孔洞均不接受。

10份标准阶段/分析记录及57项来源通过失败诊断归档，原失败50项、墙58项和诊断实载74项来源保持。见本run的failed-diagnostic-archive-audit-20261025.json、diagnostic-analysis.json及analysis/replay-red.log。readback/visual是明确的恢复观察字节别名，原预览summary保留，没有虚构saved/reopen。累计该计划Confirm=1，未保存、重启或重新注册；不再执行此failed计划，本次也无需额外保存或关闭重开。

下一步推荐从宿主输入表面的真实切口内环回读，继续用原完整XYZ/1mm比较，原Opening底部高程轮廓单独保留。该语义修复尚未实施，实际宿主切口内环也尚未被本次诊断构建捕获；需要先审核[具体设计](superpowers/specs/2026-10-25-opening-profile-host-surface-readback-design.md)，随后才实施、测试、隔离编译和各自批准的新构建/计划。两份failed计划、旧内部副作用及本次平面注释差异均保持原结论。

## 2026-10-25 宿主表面回读修复已实现并隔离编译，待具体注册

用户已批准推荐设计并实施。新增OpeningHostSurfaceRules和OpeningHostSurfaceReadbackService，在创建前冻结原Document、原操作、宿主输入表面及已有内环；floor_profile随后直接读取宿主输入表面的实际切口内环，以原EdgeMatch完整XYZ及原容差唯一匹配。原Opening底部高程轮廓仍原样单独保留，不平移Z、不只比XY、不把既有孔洞或外轮廓冒充新建。原Document/宿主/操作绑定传入创建后、提交前、提交后三个既有回读阶段，提交后没有新增Regenerate或事务。墙和竖井路径保持，raw profile仍须为有界、有限的直线边段。

纯规则覆盖原输入/表面绑定、已有孔洞、外环、多重匹配、错高度/宿主、非有限/截断/预算、后续破坏、倾斜perpendicular输入和快照不可变；合成宿主内环样本明确标识，没有冒充本次已取得的真实native切口。CoreTests341通过，定向MCP22通过，全量MCP989通过/0失败/1跳过；Revit2027.3隔离编译0警告/0错误、CheckOnly通过。先前受限环境中的既有生命周期临时文件移动测试失败单独保存，正常权限完整341通过，不涉及真实Revit生命周期。

构建目录 `bin/Release/opening-host-surface-readback-20261024T200013Z`，MVID `a5f06140-c95a-4705-a2f6-c81a34d64860`，DLL SHA-256 `aeb73e058ca6f828fff1d6c03bfc78ac84244c0ee55299517eda4ae3cb00e20b`。283项来源和8份日志已冻结；来源盘点额外纳入未修改、旧盘点遗漏的official-fixture.mjs。原EdgeMatch源码摘要仍与旧构建一致，诊断57项及旧182项来源保持。新代码仅提升代码门槛，原native失败回执、平面1292像素差异、完整副作用/持久化/视觉结论不变。

当前实际仍加载7adc4a8e…/PID5740，原文档identity5d0063b7…、revision1、未修改，文件e76dcf03…不变。注册基线在完整当前会话/模块/文件保持条件下明确复用64项恢复观察，不冒充新采集或新代码原生验收。一次预检发现客户端config.toml摘要较旧注册变化，mtime早于本次构建，原因/操作者未推断；桥接/ACL、2025清单和其它客户端保持。差异单独记录，只绑定当前配置摘要，不写入或恢复配置。另一次Get-FileHash因Revit持有写句柄停止，确认没有Prepare痕迹后改为FileAccess.Read并允许既有共享句柄，Node交叉摘要和NTFS时间保持，没有解锁/关闭模型。

原申请823f2aa1…因Revit会话重开而过期，未重试。针对新会话identity3ac55f2c…/PID27276/revision0重新准备申请 `778dd7f11eaccdf23388de98f0776d5e`，SHA-256 `A19FEDE130B5074A9EA06846BEF80CC54288B1C711DEEF62EC0D7EDE92B81210`；当前清单90207CF9…未变，拟议清单仅Assembly，注册Confirm恰为1，备份/receipt/attempt已归档。当前新MVID尚未实载。

下一步需要用户手动重启Revit并打开同一隔离副本，再只读核验新MVID/宿主表面回读能力和完整范围；不需再次注册或保存。模型试验仍需新run、新planId及单独批准。新宿主切口内环、原生方向分类和正向结果尚未实机验收，不能称为楼板洞口已验收或已完全修复。

## 2026-10-25 单楼板洞口原生结果与保存重开核验已归档

修复构建e1011050…已实际加载。计划f3d42ef6e65682f6b8f80a2c9b63ac0b在run01a1723b-5159-786d-9dea-c9c12f602468获具体批准后恰好Confirm一次并committed，创建Opening2296081、切割楼板2296043。原事务中宿主输入表面真实内环位于Z0，按原完整XYZ/1mm匹配；原Opening自身Z−100边段仍原样保留。该单楼板/vertical场景已取得正向原生证据，不外推至其它宿主或方向。

用户手动保存并关闭重开后，新identity815669625bea451399088621c65796f2、revision0、未修改，MVIDe1011050…/PID27244保持。67项只读scope完成：268既有实例、29类型、7房间、4观察元素，以及17个新增原生ID。洞口及宿主完整公开快照、原生边段和依赖对照执行后快照一致，楼板15m²/1.5m³；其它267旧实例对照写入前基线一致。连接器/peers按身份排序比较，未声称原始JSON字节相等。16个新依赖没有执行后完整快照，仅接受当前双轮和关系。重开后没有重新调用内部宿主顶面切口核验，其顶面证据仍来自原事务回执。

文件97,026,048字节，SHA256 e653a1a54c129ba3d2587709f5cb5858fd8f2442ccd82adb14eb95e51e4152ef，本批次前后摘要及NTFS时间稳定，匹配此前工具输出中的保存摘要。此前关闭前的机器保存状态/摘要没有落盘为run文件，saved记录明确使用当前重开观察，保留preclose-save-snapshot-missing限制，不补造历史快照，也无需用户再保存/重开补证。

三维view1847485的PNG与执行后字节、像素完全相同，方形洞口可见，限定单视图visual-accepted通过。平面PNG有2676像素变化，bbox(2809,496)至(2972,673)，位于远端楼梯注释附近；原因未知，整张平面图视觉仍不接受。系统86962/293247内部修改未解释，整体writeAccepted和全模型副作用验收保持false，任务继续blocked。

11份标准阶段记录schema通过，来源摘要索引现为120项，归档审计0项发现。并行独立复核确认了主元素/依赖及像素比较；另发现原广域比较漏绑前一个63scope基线的来源摘要。现补记该外部基线及其原来源索引，保留原117项summary和audit，不回填当时已记录摘要的假象；该补记只加强当前可复现性，原始来源链缺口仍明确保留。见reopen-comparison-source-provenance.json及reopen-archive-audit.json。

本次洞口的保存/关闭重开已完成，不再要求用户保存、重开、重启或执行此committed计划；旧两份failed计划也不重放。接下来按第一阶段对等队列审查显式两跑自动平台楼梯，不重做已有none-only场景。历史系统副作用及平面注释差异继续保留。
