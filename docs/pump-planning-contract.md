> 发布副本说明：本机路径、模型名称及运行标识已匿名化。原始私有证据未随源码发布；历史验收不代表当前会话授权或完整业务认证。

# 泵房工作流规划与预览合同

适用统一入口 revit.workflow.run 的 pump_room.build、pump_room.route、pump_room.connect；逻辑 API 对应 MCP 工具 revit_workflow_run。本模块是工作流规划前置层，复用已有原生操作执行引擎，不执行任意脚本。

## 规划模式

- explicit：仅对明确输入生成计划。设备/类型、系统类型、标高、全 XYZ（毫米绝对 Z）、管径/风管尺寸、路线点或两侧接口、flowIntent、净距策略缺失时，返回 requiresClarification=true、missingInputs 和 questions，不创建计划。
- ask：即使请求里有参数，也只返回需要用户审阅的问题，不进行原生查询或计划创建。默认未声明规划模式时使用 ask。
- assisted：调用方明确允许候选，必须列出 assumptions。有效候选返回 candidateOnly=true、warnings、missingInputs、alternatives；alternatives 当前为空，表示没有额外替代路线求解器。假设不能填补未给出的 ID、管径、Z、连接器或净距数值。

明确或候选请求输入无效（例如非数字几何、非法 ID、重复端口或未知流向枚举）仍由原有操作校验拒绝；输入缺口与无效输入不是同一状态。

## 净距策略必须显式提供

clearanceCheck 支持两种模式：

1. skip：reason 非空。调用方明确表示此次不检查净距，原因保留在预览摘要和 warnings。插件不因为是测试副本就默认跳过。
2. screen_existing：显式 targetElementIds、clearanceMm，可选 excludeElementIds、candidateCategories、toleranceMm、maxCandidates。复用 revit.collision.check，只读筛查选定现有本机元素。报告必须与当前 identity/revision、目标、排除和毫米要求一致。碰撞、净距候选、unknown、truncated 或不完整报告将返回问题与完整原始证据，不创建计划，不自动忽略、改管道或选择另一条路线。

两者都返回 preflight.newGeometryVerified=false。screen_existing 没有对尚未创建的路线实体作碰撞计算，不检查链接模型，不计算水力或法规净距；不得把空碰撞数组称为新增路线通过工程验收。

## 最小候选示例（仅输入结构，不是工程设计）

ID 必须替换为当前模型查询/核对结果；这些值不可跨文档复用。下面示例选择明确不检查，实际应用也可以使用 screen_existing。

~~~json
{
  "name": "pump_room.route",
  "documentIdentity": "当前项目 identity",
  "expectedRevision": 0,
  "planningMode": "assisted",
  "assumptions": ["用户允许基于已核对的类型提出这个路线候选"],
  "input": {
    "routes": [{
      "id": "candidate-route",
      "pipeTypeId": 10,
      "systemTypeId": 20,
      "levelId": 30,
      "diameterMm": 80,
      "flowIntent": "supply",
      "points": [
        {"xMm": 0, "yMm": 0, "zMm": 1000},
        {"xMm": 1000, "yMm": 0, "zMm": 1000}
      ]
    }],
    "clearanceCheck": {"mode": "skip", "reason": "用户明确要求仅测试预览通信，不检验净距"}
  }
}
~~~

flowIntent=supply|return|neutral 只是审阅意图；它不设置原生连接器水力方向，也不以测试文件流向警告作为真实供回水关系。connect 两侧必须有已核对 ConnectorId 或唯一匹配的 criteria；新 pipe/duct 端点必须用条件解析，不能预测 ConnectorId。

本工作流不再接受 input.operations 通用操作列表。通用受控操作仍可通过 revit.plan.create 单独生成预览，不得伪装成已通过泵房专业前置核查。

## 返回和执行边界

通过输入与前置证据后只调用一次 plan.create。当前文档必须提供明确的 identity、revision、路径、修改状态及项目/只读标志；碰撞筛查后和返回预览前再核对同一状态。原生预览必须处于 pending，identity/revision、source、summary 和有序 operations 必须与实际请求一致，且采用聊天确认契约。检查通过才返回 requiresClarification=false、planCreated=true、questions=[] 和原生计划。

检查失败时只尝试取消此次返回的已知 pending 预览一次；保留原始错误及取消回执。取消失败、超时或返回状态不确定时如实标为 unknown，不代表模型恢复。原生创建超时且未返回 planId 时不猜测 ID、不重建；返回已提交计划时不自动取消或重试。用户核对准确预览后在聊天中确认才允许独立调用 plan.confirm；Revit 不弹第二次人工确认，不自动保存。

2026-10-28 上述预览状态保护完成 Node 实现及 43 项定向/SDK模拟测试，覆盖 build/route/connect、设备＋管段＋条件连接组合、筛查/预览后的会话与保存状态变化、操作替换、创建超时和取消不确定。组合建模、写入、完整副作用及新保护的真实 Revit 预览验收仍待完成。本次未创建真实模型计划；下次实机预览前需重新加载 revit_custom MCP，无需注册 DLL 或重启 Revit。

## 验收范围（2026-10-08）

真实 SDK/stdio 在当前测试副本确认三个 ask 入口正常，assisted 隔离候选生成两段管道操作后取消；前后 identity/revision、元素计数、视图、选择集和修改状态不变。证据只存本机被忽略的 acceptance/pump-planning-sdk-preview-20261008.json。

SDK 模拟宿主合同覆盖缺参询问、三模式可用、粗筛碰撞/候选/未知/截断阻断、原生错误不重试、范围和版本固定、过期预览取消及禁止脚本/通用操作注入。这些测试不等于原生管道创建、连接、管件、水力、计划路线避让或保存重开验收；完整泵房迁移仍未完成。

## 2026-10-27 单管段候选与独立结果核验

当前已按assisted模式完成一个单管段候选的具体聊天批准和单次提交：沿用已核对的现有管型/系统，80mm管径、4000mm长度，完整绝对XYZ明确，flowIntent=neutral；未请求接口连接或管件。12项只读scope、62份原生快照及相邻既有管段的0mm实体相交初筛已归档。执行后独立核验器确认实际管段类型、系统分类、标高、直径、线端和两个物理端口正确，末端虽与旧开口重合，但两端仍未连接，未发生自动合并。针对实际新管段ID的实体相交筛查无已确认碰撞、未知或截断，仍不认证工程净距、链接模型或水力。62项已捕获既有快照不变，67项扩展范围归档；另生成中心线、独立管道系统和内部从属对象，成员及逻辑依赖已读。一个既有内部修改缺执行前快照、部分内部用途未明，整体验收保持blocked。限定新管段PNG可见性通过；用户人工保存并关闭重开已完成，新identity a3d538ae、revision0，67项声明范围全部存在，重开平面PNG限定可见性通过；独立回滚仍待完成。具体值、当前run/plan见任务队列和本机证据，不作为默认工程路线。

新增独立只读函数 [verifySinglePipeRouteCreation](../mcp/pipe-route-verification.mjs)，验证单个create_pipe的真实回执/会话、原生类型和系统分类、标高、直径、完整有向XYZ线端、两个实际物理端口及类别数量变化，不预测新ConnectorId。未知连接状态或不完整原生事件保留为未知/不完整，不认证流向、碰撞、容量或全部副作用。最终3项核验器单测与26项相关规划契约测试通过；包含对缺失ID误判的先失败后修复回归。该函数已使用本次真实管段回读通过验证；DLL和MCP工具入口未改动，无需注册或重载。新管段的回滚及全模型副作用仍不能由这些代码测试或限定几何/视觉结果代替。

## 2026-10-27 单端口连接验收

在新 run `0e99ef21-7948-4edd-aaaa-d44c8a54bca5` 中，使用当前文档 identity/revision 和完整 `DomainPiping`、圆形、绝对 XYZ、1 mm 条件解析，单次提交 `connect_elements` 计划 `49939bf1e5d9dc26ff994a9bd14aeb7e`。连接目标为新管段 `2296192:1` 与既有管段 `2296016:0`，两端均为80 mm、`SupplyHydronic`，原生回读确认双方 `connected=true` 且 peer 互指；系统 `2296018` 成员为 `2296016、2296019、2296022、2296192`。0 mm 碰撞筛查无碰撞、候选、未知或截断，限定平面 PNG 已导出。用户手动保存并关闭重开后，新会话中连接双方的 peer 仍互指，系统成员保持一致，重开平面 PNG 已归档；持久化范围验收通过。

连接事务没有新增元素，但原生事件删除旧独立系统 `2296194/2296195`，并修改中心线、系统及既有内部对象；这些副作用尚未完成因果验收，因此任务仍保持 `blocked`。连接持久化和限定视觉已接受，不重复连接计划。水力流量为0、静压计算不支持，不作工程合规结论。

2026-10-28 补齐独立核验入口 `verifySinglePipeConnection` 和 `verifyPipeConnectionPersistence`，位于 `mcp/pipe-connection-verification.mjs`。前者要求完整执行前管道快照及原生事务回执，拒绝类型/标高缺值、非有限坐标、端口未知或不唯一、非对称 peer，以及来自其它 identity/revision 的系统查询；系统成员清单还必须与同一次原生 `revit.flow.diagnose` 的完整成员记录一致。后者独立核验同路径保存文件的新会话中，已记录的端口关系是否保持，不以此声明完整范围快照持久化或隐藏副作用通过。

11 项核验器测试通过；当前 Revit 只读原始响应已捕获并由持久化入口核验通过，报告为当前 run 下的 `connection-reopen-verification-20261027T171609421Z.json`（文件名使用 UTC，上海日期为 2026-10-28），包含输入与核验代码 SHA-256。旧 run 的执行前/立即执行后证据是摘要，缺少原始完整快照，因此该历史提交未运行新的完整提交核验器；不从当前读数补造旧快照，也不重复执行计划。现有连接关系、保存重开及限定视觉结论保留，整体副作用阻塞保留。本次只改 Node 核验模块、测试和文档，无需 DLL 注册或 MCP 重载。
