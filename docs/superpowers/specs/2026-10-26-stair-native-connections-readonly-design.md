# 楼梯梯段与平台的原生连接只读查询

日期：2026-10-26。状态：用户已批准并实施，原生实机验收待新版加载。
批准来源：`request_user_input_async call_93d3349d600140e0aee9ae57d70aabdc item0`，用户回复“批准该只读连接设计并实施”。提交审核时的冻结版本保存在 `acceptance/preparations/stair-connections-20261026/design-submitted.md`。
任务：`architecture.stair-connections-readonly`，服务于既有 `architecture.stairs-explicit` 验收缺口。

## 已确认的问题与依据

楼梯2296092的创建、原生两跑/单平台回读及限定保存重开已经完成，不能重放原计划62d688ec103c7468b7eaf007e058748a。现有 `StairGeometryService.Snapshot` 记录梯段路径、标高、平台轮廓、支撑/栏杆ID，`ModelExecutor` 如实保留 `completeStairConnectionsVerified=false`，没有记录梯段和平台之间的原生连接。

本轮当前MCP只读搜索发现同一保存隔离副本的三个Stairs实例2290014、2295913、2296092，通用inspect只有summary/parameters/connectors/piping/drawing，没有展开的楼梯连接。前后文档identity8866…、revision0、未修改保持，原始观察归档于 `acceptance/preparations/stair-connections-20261026/current-stair-scope.json`。这些ID只作为本次调查，未来实机必须重新绑定当时会话。

本机Revit2027.3 SDK的 `RevitAPI.xml` 直接确认：`StairsRun.GetConnections()` 返回该梯段参与的连接，最多上下端两个；`StairsLanding.GetConnections()` 返回平台连接；`StairsComponentConnection` 表示run-to-landing连接，公开ElementId、PeerElementId、ConnectionType、PeerConnectionType。应使用这些原生关系，不能从XY投影或BBox贴近推出已连接。

## 方案与选择

1. **推荐：独立、有界、绑定文档的只读查询。** 新增 `revit_stairs_connections` / `revit.stairs.connections`，一次只查明确的一套楼梯及其原生梯段、平台。复用现有只读查询、UI线程冻结和预算模式，不改写入逻辑。
2. 扩展通用inspect。少一个入口，但会改变所有历史完整快照的字段并在一般inspect时隐式展开大量从属，不利于精确范围与旧证据比较。
3. 用几何/逻辑依赖推断连接。无需读取新关系，但现有投影和逻辑dependents不能证明原生run-to-landing连接，不能补齐本缺口。

本次采用方案1；没有新的模型写入、楼梯重建、几何调整或类型修改。

## 请求与只读边界

严格请求仅有 `documentIdentity`、`expectedRevision`、`stairId`。identity非空，revision为非负安全整数，stairId为正安全整数，未知字段拒绝。不接受路径、代码、动作、任意查询表达式或保存/重启选项。

原生要求活动项目、当前身份/revision一致、目标确为Stairs。查询前后核对同一文档及identity/revision、路径、修改和只读状态，遵循现有read pin约定；文档变化则拒绝整份报告。查询在ExternalEvent/UI线程内完成并冻结普通JSON数据，返回时不保留活的Revit对象。取消必须传播，不把取消当成unknown或完整成功。

固定预算为一套楼梯、最多1000个梯段/平台、合计4000条有向原生连接记录、2MiB响应；取消/十秒查询时间预算按现有有界查询方式检查。超限返回明确limit错误，不静默截断为完整报告，也不递归扩大到其它楼梯或模型类别。

## 原生证据与输出

响应包括文档身份/revision、楼梯summary、完整runIds/landingIds及components。每个component包含自身ID、kind（run/landing）、原生所属楼梯ID、读取状态和原生connection记录：ElementId、PeerElementId、ConnectionType及PeerConnectionType的名称和原始枚举数值。支撑/栏杆不是本次连接节点。

成员ID必须唯一且安全，组件GetStairs必须指向请求楼梯。保留每条连接记录，不去重、不捏造反向边、不把错误改为空集合。原生连接对象失效或getter异常时，该组件为unknown并保留已读部分及具体错误；known且完整的空集合才表示该组件确无原生连接。预算、取消和文档变化错误不吞入组件unknown。

另提供纯规则派生 `graph`：

- `enumerationComplete`：全部节点和原生记录均完整已读。
- `reciprocityStatus`：`verified`、`inconsistent`或`unknown`。只在完整已知图上检查双向同一ID对及互换的端点类型；读取不完整即unknown。
- `issues`：保留重复记录、自连接、域外peer、端点类别不符和缺少反向记录等具体证据；不删除原记录来让检查通过。
- `isolatedComponentIds`：只依据known完整空连接节点报告；未知组件不计作孤立。

合法但不互认的原生结果仍完整返回并标记inconsistent，不通过自动修复或推测将其改为verified。返回数组在副本上稳定排序，原始字段均保留，不使用几何比较容差。端点枚举未知值保留原值并报告不能认证的issue。

实施澄清：SDK说明连接的两端ID，但未承诺第一端总是当前GetConnections的查询对象。派生互认按端点ID配对，接受两端分别枚举时相同或相反的存储方向，仍必须在两个组件各自的原生集合中独立找到相同关系及对应端点类型/数值；不改写或补造任何原生行。完整枚举若含未来未知端点类型，enumerationComplete仍可true，但reciprocityStatus为unknown，并明确保留endpoint_type_unknown。

共同旗标固定 `readOnly=true`、`modelWritesRequested=false`、`automaticSave=false`、`planCreated=false`、`allModelSideEffectsVerified=false`、`completeStairConnectionsVerified=false`、`engineeringComplianceVerified=false`。原生run-to-landing互认不自动认证支撑、栏杆、实体接触、几何正确或工程规范，也不解除旧楼梯副作用/PNG阻塞。

## 接入与验证

使用独立feature `native-stair-connections`。桥接先检查实际加载能力；旧插件不具备此查询时在发送新原生请求之前拒绝，不能因旧 `explicit-stair-geometry` 已存在就当新版加载。MCP工具声明只读、非破坏性，所有输入和结果做严格校验。注册为readonly-batch可用scope时补完整pin契约与只读允许表；新查询不得进入普通计划操作列表。

纯核心测试先覆盖请求拒绝、预算/取消、完整互认、已知空连接、部分读取、重复/域外/self/端点错误、未知枚举及原始数据不变。SDK/mock测试覆盖旧feature拒绝、正确透传、上下文漂移与错误不重试，证明无plan/Confirm/save/restart。源契约和Revit2027.3隔离编译验证真实GetConnections调用及UI线程快照接入。保持旧核心/MCP回归。

编译输出使用新的版本化目录，冻结DLL SHA/MVID与来源/日志；此设计批准仅涵盖代码、测试和隔离编译。具体构建注册继续单独审核批准，之后才请用户手动重启Revit。新版本加载后，在当前保存副本对已有楼梯做只读验收，不新建楼梯、不重复旧计划、不要求再次保存/关闭重开来证明只读查询。

## 完成判据与明确不变项

本切片完成是：查询能如实返回既有梯段/平台的原生连接及互认状态，并有真实Revit只读证据。新数据出现前不预写当前2296092必有多少条连接或必为verified。

当前楼梯已有的创建/保存/重开结论保留；四处视口盒尾差、1451像素平面差异、支撑/栏杆和隐藏副作用仍按原队列记录。自动保存/重启方向不恢复，第一阶段覆盖目标不缩小。
