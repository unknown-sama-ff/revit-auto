> 发布副本说明：本机路径、模型名称及运行标识已匿名化。原始私有证据未随源码发布；历史验收不代表当前会话授权或完整业务认证。

# 房间创建原生回读任务卡

- taskId：`architecture.rooms`
- 当前能力门槛：`readonly-accepted`，代码隔离编译通过；实机 run `3653e000-ba9c-42c3-ab77-f088a5f20ebf` 仅覆盖既有范围只读查询和新模块实载，尚未测试新建房间。
- 来源：`rooms.csx`、既有 `create_room`、2026-10-15 房间名称/编号合同。
- 既有建筑主体、门窗和楼板验收结论不变；楼板系统元素因果阻塞继续独立保留。

## 实现范围

沿用现有 `create_room` 的明确名称、编号、标高与 XY 点位。原生 `NewRoom(Level, UV)` 使用标高决定 Z；预览明确返回该策略。标高已存在时披露解析后的原生 ID 和项目高程；引用此前创建的标高时明确标记尚待执行期解析，不预测原生 ID。

创建后以及事务提交前、提交后且事务组仍可回滚时，核对：

- 名称从原生 `ROOM_NAME` 字符串参数读取，编号按原始字符串精确比较，不用组合显示名称替代。
- 解析后的原生标高 ID 及完整 XYZ，三维距离容差 1 mm；保留原始操作和解析后的操作。
- 原生面积有限且大于零，房间已定位并封闭。
- Finish 边界完整返回，保留所有环和曲线类型；逐段归档起点、中点、终点和原生长度，检查有限值及环的衔接，最多 1,000 段，超限拒绝而不截断。

上述边界证据是分段采样与长度，不能唯一重建任意样条，不能认证精确边界拓扑、工程规范、全模型副作用或无碰撞。正面积来自 Revit，不以采样点自行推导面积。`sideEffectsVerified`、`persistenceVerified`、`visualVerified`、`engineeringComplianceVerified` 保持 `false`；房间标签属于后续独立能力，不因房间创建回读而自动通过。

`revit.inspect` 的 `architecturePrimary` 对可读取房间补充同样的原生快照；未封闭、缺少名称/位置或边界不可读的既有房间保留 `supported=false`。新增插件能力 `room-creation-readback`；MCP 在房间预览转发前核对该能力，旧插件未加载时不转发计划。

## 验证与具体构建

2026-10-24 验证记录：

- CoreTests：310/310，通过名称/编号、标高、三维点位、未知/非有限值、缺失边界、曲线与多环、预算拒绝等规则测试。
- MCP 全量：960 通过、0 失败、1 跳过；最终补齐预览说明后的相关回归 70/70。
- Revit 2027.3 / .NET 10 隔离编译：0 警告、0 错误；安装 `CheckOnly` 通过。
- 最终 DLL：`bin/Release/room-readback-20261023T181039Z/RevitAutoV27.dll`（目录标识采用 UTC，验证记录日期采用上海时间）。
- MVID：`ec3b91b2-a859-40dc-a66e-7e7b45685951`。
- SHA-256：`31F384D9BDD2934E416FA255C01FCAC3C86D826334D7A11FDA241FE95FB21963`。
- 构建证据：同一目录下 `build-verification.json`。
- 首次常规构建因沙箱无法读取用户 NuGet.Config 停止；使用已有依赖缓存和 `--no-restore`，经项目内相同 API 版本门禁后完成隔离编译。首次及最终日志分别保留在 `.tmp/room-readback-build-20261024.log`、`.tmp/room-readback-build-final-20261024.log`。

## 实机验收顺序

1. 具体构建获准注册后，由用户手动重启 Revit 并打开已保存测试副本；先核对实际 MVID 和能力，不沿用历史会话。
2. 新 run 只读基线：明确已有围护、标高、唯一房间名称/编号和点位；读取房间及必要宿主/周边范围。
3. 单个 `create_room` 预览，披露 level/UV/Z 语义；具体 planId 获聊天批准后，只确认一次。
4. 保存完整原生回执与原始回读对象；检查未知副作用，并做单独的失败回滚验收。
5. 用户手动保存、关闭重开；归档完整范围供离线复算，再完成 PNG 视觉核验。房间标签单独排队。

上述代码构建阶段未注册、未连接 Revit、未创建模型计划、未写模型，未保存或重启。`readonly-accepted`、`preview-accepted`、`write-accepted`、持久化和视觉门槛仍未取得。

## 2026-10-29 房间标记引线参数修正，暂存待合批

既有create_tag已经通过NewRoomTag处理Room，并非缺少房间专用分支；本轮确认的问题是该分支未应用显式leader，而IndependentTag分支已将其传给原生创建。修正只在leader实际出现时要求严格布尔值并设置RoomTag.HasLeader；缺省保留既有行为。RoomTagType在本机2027.3 API元数据中继承FamilySymbol，既有类型检查无需重写。

显式leader的RoomTag/IndependentTag在通用parameters应用后立即回读，并复用文档创建回读服务，在整计划结束的事务提交前/提交后、group仍可回滚时复核tagId/class/viewId/HasLeader。绑定原生Document；元素消失、换视图/类或引线失配会失败，孤立/受限标记设置由原生异常拒绝，不转成默认false。回执仍不认证目标关联/引线端点形状、几何、全副作用、保存或视觉。

NativePlanRules与Node低层操作校验同时拒绝null/字符串/数字leader；新Node在派发任何显式leader的create_tag预览前要求tag-leader-readback能力，未传leader的既有请求兼容。该能力尚未在当前加载模块提供，不能将候选代码当作实载修复。

378项核心、39项相关Node检查通过；Revit2027.3隔离编译0警告0错误，候选目录为bin/Release/tag-leader-candidate-20261028T200514Z（UTC目录名）。本次仅暂存compiled子范围，不冻结发布包、不注册、不要求重启、不创建标记计划或修改模型。后续与相关原生改动合批冻结，再做整批要求的回归与具体注册申请；新建房间/围护夹具的旧阻塞继续保留。

## 2026-10-29 标记目标关联回读，与引线修正合批

已有引线回读不能证明标记关联了请求的元素。本次选择性适配 rvt-mcp 的本地目标提取方式，保留现有创建分支，新增 `tag-target-readback`：所有 `create_tag` 都在创建后、事务提交前后检查标记ID、预期原生类别、所属视图、类型及唯一的本地目标。目标和类型在通用参数写入前固定；未指定类型时固定原生创建实际选择的类型，不新增默认族选择策略。

RoomTag 同时读取 Room、TaggedLocalRoomId 和 TaggedRoomId 并检查一致性；IndependentTag 使用 GetTaggedElementIds，保留 HostElementId、LinkInstanceId、LinkedElementId，拒绝孤立、缺失、额外或链接目标。API 文档明确孤立 IndependentTag 仍可能返回有效ID，因此不能只检查ID非空。原生读取异常会使创建验证失败并进入现有事务回滚流程，不把未知当成功。文档绑定沿用原生 Document。

既有 `inspect` 对这两类标记增加 `tagCreation` 快照，仅声明单一本地目标范围；其它标记情况返回 `supported=false` 与原因，其它元素不增加非空字段。此快照不认证引线端点、字形边界、几何、全模型副作用或视觉。任何标记预览都要求实载 `tag-target-readback`；显式 leader 仍同时要求 `tag-leader-readback`，缺省 leader 行为保持。

契约和离线状态记录在队列 `architecture.rooms.developmentSlices.tagTargetReadback`，具体候选、日志及源码摘要以该条目引用的 `build-verification.json` 为准。两项标记修正共享一个候选；本轮无模型计划、写入、保存或重启，原围护及房间写入阻塞保持。源码来源和Apache-2.0许可见 [THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md)。后续实机先用当前已有标记做只读核验；新建标记仍需要独立基线与具体 planId 批准。

### 合批构建实载与既有标记限定只读验收

2026-10-29，用户手动加载后，MVID `1a8a68d7-9100-4ac5-abaf-ab87491167d5`、PID30528及两项tag能力实载通过。新run `7c07e48f-1e21-4558-a859-3b037241d6bb` 经当前聊天工具读取唯一既有房间标记2295836：其本地房间2295770、类型55347、所属视图2295811均与独立元素读取一致；非孤立、无链接引用，两次完整标记快照相同。完整context及RVT文件摘要/大小/mtime保持。证据见该run的summary.json、tag-inspection.json、target-view-type-inspection.json和readback.json；未重复100scope或旧写入验收。

仅此既有RoomTag的读取子范围为readonly-accepted。所查灯具/配电设备标记类别均为空，不能推断其它类别或IndependentTag已通过；创建、显式leader设置、事务回滚、几何/副作用/保存/视觉仍未验收。当前标记读取没有引线字段，不冒充setter验证。原围护及房间写入阻塞保持；无需再注册、重启、保存或重复本run。

### 既有房间的单枚带引线标记预览

run `e480b560-1a4a-4dd2-a302-af28d8894b7d` 使用新的文档identity `078d87dca397d08bc5e87e3d1046dcf4`、revision0，仅对既有房间2295770准备一枚标记：视图2295811、类型55347、位置(34000,4200,0)mm、leader=true，保留原标记2295836。这不依赖位于X42000–46000的受阻围护夹具，也不新增房间或墙。

55项已返回原生快照、完整context及RVT摘要在预览前后相同；4096px原生平面PNG已归档。原生计划 `3ccb0ff69c215b0ccc2d6321b96f0661` 无警告，有效至上海时间2026-10-29 19:02:10，Confirm=0。当前只接受这份预览，等待用户对该具体planId批准；过期或会话变化时不可复用。摘要及SHA见该run的summary.json和preview.json。显式引线实际设置、端点/几何、副作用与保存重开均尚未通过。

### 同一计划获批后已单次提交，整体仍有限制

用户批准后，写入前复核原计划摘要、完整context、插件及源码和RVT摘要，再以flush的wx attempt单次Confirm。新增RoomTag2296196；创建后及提交后的目标/类型/视图核验和HasLeader=true通过，外部inspect的原生参数-1006502（引线）为1，与属性回执一致。事件仅新增该标记，修改/删除均为0；55项既有快照所有已返回字段不变。房间边界保持，房间与视图的逻辑依赖仅增加新标记，旧标记保留。

通用LocationPoint返回(34000,3000,约1200)mm，与输入(34000,4200,0)mm不同；当前入口未暴露TagHeadPosition，不能据此认证标记头/端点位置，也不能直接断言实际标记头错误。后续先补特定属性只读证据，不自动移动或重建。PNG精确RGB比较共2345像素变化，其中目标房间区域961、远端楼梯文字1384，后者原因未证实；标记可见不等于完整视觉通过。整体case保持blocked，目标关联与显式true子范围通过；IndependentTag/false/回滚未验收。标准execution/readback/visual/summary已归档，预览阶段summary保留为summary.preview.json。

当前revision1、isModified=true；模型未由插件保存，RVT磁盘仍为执行前摘要。下一步需要用户决定是否手动保存本次已批准结果，保存后只读核验，再请求关闭重开。原计划已committed且Confirm=1，不得再次确认；无需重新注册或重启。

### 人工保存后的限定核验通过，待关闭重开

用户回复“已保存”后，当前会话c6a62f19…/revision1/isModified=false；56项已返回快照与执行后严格一致，房间边界、两枚房间标记及四项依赖查询也保持一致。标签2296196的关联和引线参数-1006502=1保持。保存文件SHA-256为`b62d6ae809e172662205b698ef229efcce4299c810c1a8d97377e4f271f60d16`，大小/mtime在核验期间稳定；关闭前机器保存状态已写入同run的saved.json和saved-observations.json。

本步骤没有再次Confirm、写模型、保存或重启。下一步用户只关闭模型文件并重开同一副本，无需再次保存或重启Revit；随后验证新identity/revision0及声明范围持久化。通用位置解释和远端楼梯PNG限制仍在，持久化门槛尚未升级。

### 关闭重开限定持久化与归档通过

新identity `37d045a215ea50dd50a4607b51be0d36`、revision0、未修改；56项已返回快照及房间/标记/依赖与保存前严格一致，参数-1006502仍为1，RVT文件摘要/大小/mtime保持。reopen.json记录了旧/新会话，标准archive-audit.json通过，不改变整体blocked结论。无需再保存、重开、重启或执行原计划。

重开PNG与执行后相差2835像素，均位于远端楼梯注释区域；与执行前相差2412像素，其中既有房间标记变化区域仍为961像素。该区域没有新增差异不代表精确标记头、引线端点或整图视觉通过。全部比较保留原图与坐标，不进行裁剪或容差归一化。

### 下一项：标记头坐标只读快照

为查明通用LocationPoint与输入的差异，复用既有inspect，新增`tagPosition`及feature `tag-head-position-snapshot`。RoomTag直接读取SpatialElementTag.TagHeadPosition，IndependentTag读取自己的TagHeadPosition；分别返回headPosition、genericLocationPoint和hasLeader的known/unavailable/unknown状态。getter异常、非有限点或缺值不使用原点、通用位置或false替代；保持完整精度，仅做feet→mm换算。

这是观察数据，不移动标记，不修改既有创建与事务核验规则，不认证输入坐标或引线端点。支持的原生类可能有个别unknown字段；调用方逐字段判断，不能把supported=true当成所有值已知。来源getter选择已固定上游commit/blob并保留Apache许可。代码状态/候选及日志见队列tagHeadPositionReadback子项；加载后先读已保存标记2296196，无需新模型计划。Node及工具schema不变，不要求重新加载MCP；新DLL仍需单独批准注册与一次手动Revit加载。

用户已批准具体申请`1b7a68231c7f79b20fa002c3e56fbcb4`（SHA-256 `C97D92CC3636B50312F542BFA344F8F848D7108055850FA3331599A99C0A7771`），注册恰好一次，回执为REGISTERED_MANUAL_RESTART_PENDING。新MVID `98d37ddb-378f-49ea-a195-df4adc0068bd`；清单、备份和保护设置核验通过，回执见候选目录registration-receipt.json。当前仅注册完成，新getter的实际加载/读取尚未验证；下一步一次手动重启Revit并打开同一已保存副本，无需MCP重载或重复模型验收。

### 2026-10-30 标记头疑点已由直接原生属性解除

run `ee3560d7-d4ea-4dd5-a610-5de6d146f016` 实载104d4e07/PID36116，当前干净会话4d214e76…/revision0，文件与已保存案例的b62d6ae8…摘要/大小/mtime相同。两次读取5个相关元素并核对所有旧字段，两个RoomTag只新增明确的tagPosition字段，原几何/参数没有删减或容差归一化。

新标记2296196的真正TagHeadPosition精确为(34000,4200,0)mm，逐轴与原批准计划相同；通用LocationPoint仍为(34000,3000,约1200)mm。旧标记2295836的头/通用位置均为(34000,3000,0)mm。两枚标记的HasLeader分别false/true，与原生参数0/1一致。旧案例追加tag-head-position-addendum-20261030.json，只解除当前持久化头坐标证据缺口，不倒推原事务当时已核对头坐标。

四个墙/门/窗/多类别标签查询均完整为空，因此IndependentTag仍无本次实机样本；引线端点与整图PNG限制保持。无新计划、写入、保存或重开；不用重复已完成的持久化流程。

### 标记输入拒绝修复合批

离线复现证明create_tag原先接受并忽略hasLeader等未知字段。下一候选同时在Node和Native PlanRules拒绝未声明字段，保留id/dependencies/mark/parameters及既有标记字段，重用已有rvt-mcp参数名诊断；不会自动更正或回显值。显式tagTypeId必须为有效ID/先前引用。与尺寸引用输入修复共享annotation-input-contracts构建，当前只离线/编译验证，未通过新原生拒绝路径；状态以队列子项为准。

## 2026-10-24 已批准构建单次注册

- 用户明确批准“注册房间回读构建”后，核对原 DLL SHA-256/MVID 和 80 项构建来源摘要一致；首次注册前完整读取 243 个实例、26 个相关类型与 2 个系统观察元素，两轮已读范围一致。隔离副本 identity `95bd5a9a886e9e16a5c7a1ea581a572b`、revision `0`、`isModified=false`。
- 注册请求 `9a3b937d317450d590f831024db39657`，独立固定请求摘要 `F5C185D5EE775A4772AFD91CCB3071205E3D462AE08A793EDF8AACC058F3C51C`。Prepare 后复核仅 Assembly 清单差异、DLL、保护快照和基线，Confirm 只执行一次。
- 回执状态 `REGISTERED_MANUAL_RESTART_PENDING`，SHA-256 `D4E751D458C92EA877953E5DCD947C17E2FC78FBDD75170ACED5067A5818DA41`；安装清单匹配拟用字节，原清单备份、桥接/ACL、2025 清单和客户端配置及基线均复核通过。精简证据：`bin/Release/room-readback-20261023T181039Z/registration-verification.json`，原始请求、attempt、回执和基线保留在私有 runtime。
- 注册后只读 context 与此前完整相同，Revit PID `42208` 仍加载旧 MVID `51ec430d-e749-4205-ac99-d4217aead546`。需要用户手动重启并重新打开 `acceptance/models/floor-side-effect-isolated-20261020.rvt`，才可核验新 MVID `ec3b91b2-a859-40dc-a66e-7e7b45685951` 和能力；注册成功不代表新模块已实载。
- 未创建模型计划、未写模型、未自动保存或重启；任务代码门槛保持 `compiled`，实机房间验收仍待后续新 run，不重复本次注册或历史模型计划。

## 2026-10-24 人工重启后实载与只读验收通过

- 用户手动重启并打开同一隔离副本后，实际 Revit PID `43964`、MVID `ec3b91b2-a859-40dc-a66e-7e7b45685951` 与获批 DLL 一致，`room-creation-readback` 已加载；当前 identity `cde23dd390ac431cc6b7628135cdfd79`、revision `0`、`isModified=false`。旧会话身份不用于新计划。
- 新 run `3653e000-ba9c-42c3-ab77-f088a5f20ebf` 保存实际 MCP 工具契约及哈希，45 个显式只读 scope 全部采集通过。243 个实例、26 个相关类型、2 个系统观察元素两轮快照一致；类别成员、既有全部已捕获字段、名称/编号、坐标及面积与注册前证据一致。读取过程中当前 context（含活动视图、选择集和保存状态）保持完整相同。
- 7 个既有房间原先没有 `architecturePrimary`。本次显式记录该新增字段，对所有原有字段逐一严格比较；新字段的名称/编号和面积绑定旧原生参数，点位绑定旧 summary，Finish 边界分段、起中终点及长度逐项与当前独立 `revit_room_get` 结果交叉核对。当前这 7 个房间的分段均为 Line。没有丢弃历史几何或未知字段；旧版未捕获的新边界字段没有历史前值，不能称为历史完整边界比较。
- 该结果只接受实载与既有房间读取，未证明新建房间、失败回滚、持久化、视觉或全模型副作用。系统元素 `86962`、`293247` 的楼板修改因果仍未解决。
- 独立候选审查记录于 `room-candidate-review.json`：已知测试围护内已有房间 `2295770`（`AI-ARCH-001`），当前没有经核实的空闲房间目标；不能在旧房间点位重复放置，也不能把孤立楼板或单墙当成封闭空间。下一步先准备独立空闲围护夹具方案，仍按单能力预览和具体计划聊天批准分步执行。此 run 未创建计划、未 Confirm、未修改模型、未保存或重启；当前无需再次重启。

## 2026-10-24 独立围护夹具准备

- 新增任务 `architecture.rooms-enclosure-fixture` 与 `docs/room-enclosure-acceptance.md`。候选四面墙中心线范围 X=42000–46000、Y=1000–5000 mm，高 3000 mm，拟用现有 100 mm 墙类型 `763588`、标高 `311`。机器配方 `mcp/acceptance-recipes/architecture-room-enclosure.json` 只含四个 `create_wall`，后续房间点位 `(44000,3000,0)` 单列，不混入夹具计划。
- 配方是离线候选，不含当前 identity/revision/planId。历史范围与位置样本不能认证当前空闲空间、完整碰撞或原生房间回路；必须重新读取当前模型和 PNG。夹具墙需逐一回读 `WALL_ATTR_ROOM_BOUNDING=1`，原生变更及既有房间范围无未知变化后，才为单房间验收另建 run。
- 本轮当前 context 查询返回 `ECONNREFUSED`，未检测到 Revit 进程；等待手动启动并打开隔离副本，不重复注册。只读验收 run 与门槛保持；未新建验收 run、原生预览或执行，未保存或重启。

## 2026-10-24 围护夹具预览已生成

- 手动打开隔离副本后，当前 identity `22d226cc445142c9b0dbb578d5d2f566`、revision `0`、未修改；新版 MVID 与注册构建一致。夹具 run `b836c349-e3c4-46fd-acf9-d3d5532f0db8` 两轮采集 254 个实例、29 个类型、7 个房间和 2 个系统观察元素；原有全部已捕获字段一致。新增数量仅表示扩大只读管件范围。
- 两个误用三维视图的平面设置查询在原基线保留为失败；同 run 用 `view-addendum.json` 补充正确平面和三维 inspect，`preflight.json` 明确组合核验。当前平面/三维 PNG 与原生位置、轮廓核对支持候选选址，未认证精确碰撞或原生房间回路。
- 四墙计划 `ef4eec57aa32d8a4f1ee164fde3929ec` 无警告、`pending`，有效至上海 2026-10-24 07:16:49；仅生成预览，未 Confirm/写模型/保存/重启。夹具为 `preview-accepted`，房间仍 `readonly-accepted`；只有夹具执行及副作用核验通过后才另建单房间 run。

## 2026-10-24 围护夹具单次提交后的限制

- 用户批准后 Confirm 一次，四墙 `2296051–2296054` 主参数/曲线和房间边界开关回读通过；254 个既有实例、29 个类型、7 个房间的完整已捕获字段及类别成员核验通过，平面/三维 PNG 的四墙限定视觉通过。当前 revision `1`、未保存，未创建新房间。
- 原生事件仍修改 `86962` 与 `2289997`，删除和附加新增为零。依赖只证明 `2289997` 在系统数据 `86962` 的依赖集合内；同样修改 ID 曾见于旧单墙 run，不能据此认定无害。本 run 缺少 `2289997` 事务前快照，内部变化尚未解释。
- 夹具 `blocked`，整体 `writeAccepted=false`、`allModelSideEffectsVerified=false`；房间保持既有 `readonly-accepted`。先等待用户的人工保存决策并继续只读调查，不创建/执行房间计划、不重放四墙、不自动保存或重启。原始执行、全部回读、限定视觉与最新 summary 都已归档。

## 2026-10-24 夹具人工保存与保存后核验

- 用户已手动保存，同 identity/revision1、`isModified=false`；258 实例、29 类型、7 房间和3系统观察元素的全部已捕获字段及类别成员与执行后范围一致。真实 MCP 契约、完整两轮结果、保存状态及稳定文件哈希已归档为 `saved-readonly-batch.json`、`saved.json`。
- 修复本地只读编排器把 `revit_saved_verify` 误判为 save 动作的问题，保留精确白名单及契约/pin 限制，37 项相关回归通过；不改 Revit DLL，无需注册或重启。
- 关闭重开持久化仍待用户操作；系统附加修改因果仍未证实，夹具继续 `blocked`，房间保持 `readonly-accepted`。后续仅做同文件关闭重开的只读核验，不创建模型计划或重复 Confirm。

## 2026-10-24 夹具重开持久化与限定视觉通过，整体仍 blocked

- 重开后同路径、新 identity `bb1489862de8cc7120fe0dff233ee14f`、revision0、未修改，实际新 PID15556，获批 MVID 一致。56 scopes 的完整两轮保存范围（258实例/29类型/7房间/3观察元素）全部已捕获字段一致，四墙及房间边界开关仍在；两张新 PNG 与执行后文件逐字节相同。
- 限定持久化已接受；当前 RVT 字节哈希不同，原保存摘要精确匹配 `.0007.rvt` 备份，文件版本差异单列记录，不推断原因。界面活动视图变化也单列，模型几何没有被剔除比较。
- 系统86962/2289997因果仍阻塞，另有11项严格归档字段/格式差异已报告并追加审查；保存/重开不能使它们自动通过。房间能力仍 `readonly-accepted`，夹具整体blocked；不再重复人工保存/重开，下一步只做离线编排对齐和有新证据的系统调查。


## 2026-10-30 房间标记引线几何只读回读

既有revit.inspect增加独立tagLeaderGeometry字段，不改变tagPosition头坐标/LocationPoint语义，也不创建或移动标记。当前子范围为RoomTag，使用Revit2027.3 SpatialElementTag的HasLeader、HasElbow、LeaderEnd和LeaderElbow；真实XYZ仅从内部英尺转mm，不投影、舍入或用头坐标替代。feature为room-tag-leader-geometry-snapshot。

每个观察为known、unknown、unavailable或not-applicable，并保留显式null。HasLeader=false时不访问下游API；无折点时不读LeaderElbow；上游存在性读取失败则保留unknown，不猜false。端点与折点独立，单个读取失败不丢弃另一项。取消或内存耗尽继续传播。默认头坐标快照保持原样。IndependentTag需逐Reference读取且区分attached/free/可见性，当前明确返回unsupported，不拿RoomTag规则替代。

这只是现存几何的只读证据；requestedGeometryVerified、endInsideRoomVerified和visualVerified均false。它不会倒推原标记事务已验证端点，也不证明点在房间内、引线视觉清洁或全模型副作用无害。既有2296196的单次创建及56快照保存重开无需重做。

409项核心和23项相关Node/SDK检查已通过，覆盖直/折线、无引线、未知存在性、单端失败、非有限点、显式null和控制异常；SDK检查真实传输形状与单次只读请求，不是原生几何认证。与图框族分页/显式视图包围盒合批，最终构建、实载与验收状态以任务队列为准。
