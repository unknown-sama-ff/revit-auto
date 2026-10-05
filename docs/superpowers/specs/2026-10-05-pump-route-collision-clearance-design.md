# v0.3.22 泵房路线碰撞与维护净距只读核查设计

- 日期：2026-10-05
- 状态：待用户审阅
- 范围：当前泵房路线周边，不扫描整个项目
- 目标：只读识别三维实体碰撞和可疑维护净距候选，不自动移动、删除或重建模型

## 背景

v0.3.20 已完成水泵至既有管道的真实连接验收，v0.3.21 已完成设备连接器三态审计实机验收。当前平面导出图显示路线与水泵图形存在投影重叠，但二维投影不足以证明三维碰撞；Revit 仍有流向/流量计算警告。因此下一步先实现只读几何证据，不把“连接成功”或“图像显示”当作碰撞、维护净距或水力合规证明。

## 目标与非目标

### 目标

1. 对指定泵房路线及其两端设备读取当前 Revit 原生三维几何。
2. 在明确的附近类别范围内查找实体碰撞候选，并明确目标/排除元素过滤规则。
3. 用布尔实体相交确认可确认的三维实体碰撞，并保留无法确认的未知项。
4. 在用户提供 `clearanceMm` 后，输出保守的包围盒净距候选；明确区分候选与精确净距证明。
5. 返回当前 document identity、revision、范围、证据级别和截断信息。
6. 查询全过程不启动事务、不创建临时元素、不修改视图、不保存 RVT。

### 非目标

- 不自动移动水泵、管道、管件或其他障碍物。
- 不自动重建路线、不改变标高、不改变系统或连接关系。
- 不声明满足任何国家、行业或项目规范。
- 不推断水力流向、流量、压降、维护标准或消防/机电净距标准。
- 不将包围盒相交直接标记为实体碰撞。
- 不将没有几何证据的对象标记为无碰撞。
- 不扫描当前项目全部构件；全项目扫描是后续独立范围。

## 用户范围

首期固定为当前泵房路线周边，目标元素由当前文档实时查询得到，不硬编码跨项目使用的 ElementId。当前验收副本中的目标元素包括：水泵、既有管道、4 段新增管道、3 个弯头和 1 个变径，但接口输入必须允许助手传入当前文档中重新核验的目标 ID。

候选类别默认包括：

- `OST_MechanicalEquipment`
- `OST_PipeCurves`
- `OST_PipeFitting`
- `OST_DuctCurves`
- `OST_DuctFitting`
- 墙、楼板和结构构件等建筑/结构障碍物

目标元素自身、明确列入排除列表的元素以及路线内部正常连接的目标对不作为外部碰撞障碍物重复返回。

## 接口

新增逻辑 API：

```text
revit.collision.check
```

MCP 工具名：

```text
revit_collision_check
```

请求字段：

```json
{
  "documentIdentity": "当前会话 identity",
  "expectedRevision": 1,
  "targetElementIds": [2295837, 2295855],
  "candidateCategories": ["OST_MechanicalEquipment", "OST_PipeCurves"],
  "excludeElementIds": [],
  "clearanceMm": 0,
  "toleranceMm": 0.1,
  "maxCandidates": 500
}
```

约束：

- `documentIdentity` 必填，并且必须匹配当前文档。
- `expectedRevision` 提供时必须匹配当前 revision。
- `targetElementIds` 必须是当前文档中真实存在的正整数，不能使用预测 ID。
- `candidateCategories` 只接受已支持的类别；空值使用安全默认类别集。
- `excludeElementIds` 可选，必须是当前文档中的真实元素 ID；目标元素和排除元素不会进入外部障碍物报告。
- `clearanceMm` 可选，必须是有限的非负毫米数；默认 `0`，只做实体碰撞。
- `toleranceMm` 必须是有限正数，用于几何体积阈值和包围盒扩展，不作为规范净距。
- `maxCandidates` 有上限，超过时返回 `truncated=true`，不能宣称完整扫描；`candidateCount` 表示截断前发现的候选数量，`scannedCandidateCount` 表示实际读取的数量。

## 结果模型

```json
{
  "documentIdentity": "...",
  "documentRevision": 1,
  "scope": {
    "targetElementIds": [],
    "candidateCategories": [],
    "clearanceMm": 0,
    "toleranceMm": 0.1,
    "truncated": false
  },
  "collisions": [
    {
      "targetElementId": 1,
      "candidateElementId": 2,
      "evidence": "exact-solid-intersection",
      "intersectionVolumeMm3": 123.4,
      "targetGeometryStatus": "complete",
      "candidateGeometryStatus": "complete"
    }
  ],
  "clearanceCandidates": [
    {
      "targetElementId": 1,
      "candidateElementId": 2,
      "evidence": "expanded-bounding-box-candidate",
      "clearanceMm": 300,
      "note": "候选筛选，不是精确净距证明。"
    }
  ],
  "unknown": [
    {
      "targetElementId": 1,
      "candidateElementId": 3,
      "role": "candidate",
      "reason": "geometry-unavailable"
    }
  ],
  "diagnostics": {
    "candidateCount": 0,
    "scannedCandidateCount": 0,
    "geometryReadCount": 0,
    "exactIntersectionCount": 0,
    "clearanceCandidateCount": 0,
    "unknownCount": 0,
    "truncated": false
  }
}
```

`collisions`、`clearanceCandidates` 和 `unknown` 三组结果必须互不混淆。布尔运算异常、没有有效实体、非有限边界或几何读取不完整时进入 `unknown`，不能进入“无碰撞”结论。

## 几何算法

### 1. 文档与范围验证

- 读取当前 document identity/revision。
- 校验目标元素和类别。
- 记录检查前的 document state；查询期间再次读取 identity/revision，若发生变化则返回文档变化错误。

### 2. 几何读取

- 使用 Revit 原生 `Options` 读取 Fine 级别几何。
- 递归处理 `GeometryInstance` 的实例变换。
- 只收集有效、非空、有限边界的 `Solid`。
- 目标或候选几何完全不可用时记录 `unknown`。
- 不创建临时 Revit 元素，不改变活动视图。

### 3. 候选筛选

- 先用当前元素的 `BoundingBoxXYZ` 和 `BoundingBoxIntersectsFilter` 做候选缩小。
- `clearanceMm=0` 时，包围盒只用于筛选，不直接产生碰撞结论。
- `clearanceMm>0` 时，使用扩大后的包围盒生成保守净距候选。
- 目标元素之间、显式排除元素之间以及目标元素与排除元素之间不作为外部障碍物重复报告；路线内部目标对是否连接不改变结果，只影响是否作为外部候选输出。

### 4. 精确实体相交

- 对有效实体对执行 `BooleanOperationsUtils.ExecuteBooleanOperation` 的 intersection。
- 只有交集实体有效且体积严格大于 `max(1 mm³, toleranceMm³)` 时，才加入 `exact-solid-intersection`；低于该阈值的数值噪声不作为碰撞。
- 布尔失败或结果无法判定时进入 `unknown`，不降级成无碰撞。
- 多 Solid 元素按元素对合并证据，避免同一元素对产生无意义重复结果。

### 5. 净距候选

首期不实现精确实体距离算法。`clearanceMm>0` 只输出扩大包围盒相交候选，标签固定为 `expanded-bounding-box-candidate`。助手必须在自然语言中说明：这是保守候选，需人工或后续精确算法确认，不能直接判定净距合格/不合格。

## MCP 与安全

- 工具标记为只读：`readOnlyHint=true`、`destructiveHint=false`、`idempotentHint=true`。
- bridge 在发送请求前检查 `collision-check` 能力；旧 DLL 返回 `feature_not_loaded`，不发送检查请求。
- 任何 identity/revision 不匹配都停止检查，不绕过文档保护。
- 结果超出大小或候选数上限时明确返回截断，不使用部分结果宣称通过。
- 官方 Autodesk MCP 继续保持 Read-only；自定义 MCP 仍是唯一写入通道，但本工具本身不写入。

## 测试与验收

### 单元/契约测试

- 非法/负数/NaN/Infinity 的 `clearanceMm` 和 `toleranceMm` 被拒绝。
- 目标 ID、候选类别和 `maxCandidates` 校验严格。
- 只读注解和 MCP schema 正确。
- 旧 DLL 缺少 `collision-check` 时不转发请求。
- exact collision、clearance candidate、unknown 三类结果不会混淆。
- 几何失败不会产生“无碰撞通过”。

### 实机只读验收

1. 用户保存当前副本并重启到 v0.3.22。
2. 重新读取 document identity/revision 和泵房路线真实元素 ID。
3. 使用 `clearanceMm=0` 检查当前路线周边。
4. 核对水泵与路线的精确碰撞结果，不能使用二维 PNG 代替。
5. 用户指定维护净距后，再运行 `clearanceMm>0`，检查保守候选。
6. 对比调用前后 identity、revision、模型数量、保存状态、活动视图和选择集。
7. 任何避让修改另行生成预览，聊天确认后才执行。

## 版本与交付

- 版本从 v0.3.21 升至 v0.3.22。
- 新增 Revit API 查询服务、MCP bridge 能力门控、MCP 工具、核心/Node 契约测试和本地安装输出。
- Revit 2025 旧版不受影响。
- 不提交 `.rvt`、runtime token、acceptance 本地证据或导出图片。
- 先完成设计文档审阅，再实现代码；实现后必须重新编译、跑完整测试、安装并实机验收。

## 设计决策

- 选择“精确实体相交 + 包围盒净距候选”，而不是只用包围盒，也不创建临时分析几何。
- 不默认任何工程规范净距，避免把地区/项目标准猜测写入工具。
- 先做当前泵房路线周边，避免全项目扫描带来的性能和结果解释问题。
- 不自动修复碰撞，保证查询与写入严格分离。
