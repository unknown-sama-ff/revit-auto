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

通过输入与前置证据后只调用 plan.create；requiresClarification=false、planCreated=true、questions=[] 并返回原生计划。后台计划的 identity/revision 不匹配时取消该预览，不提交、不自动重试。用户核对准确预览后在聊天中确认才允许独立调用 plan.confirm；Revit 不弹第二次人工确认，不自动保存。

## 验收范围（2026-10-08）

真实 SDK/stdio 在当前测试副本确认三个 ask 入口正常，assisted 隔离候选生成两段管道操作后取消；前后 identity/revision、元素计数、视图、选择集和修改状态不变。证据只存本机被忽略的 acceptance/pump-planning-sdk-preview-20261008.json。

SDK 模拟宿主合同覆盖缺参询问、三模式可用、粗筛碰撞/候选/未知/截断阻断、原生错误不重试、范围和版本固定、过期预览取消及禁止脚本/通用操作注入。这些测试不等于原生管道创建、连接、管件、水力、计划路线避让或保存重开验收；完整泵房迁移仍未完成。
