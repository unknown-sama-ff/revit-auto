> 发布副本说明：本机路径、模型名称及运行标识已匿名化。原始私有证据未随源码发布；历史验收不代表当前会话授权或完整业务认证。

# 具名直线轴网创建与最终回读

任务：`structure.grid-creation`。本轮补齐已有 `create_grid` 的提交边界校验，没有增加新的建模操作，也没有创建或执行 Revit 计划。

## 原生契约

输入仍为明确的唯一名称、水平直线 start/end，坐标为 Revit 内部原点毫米；省略 Z 时为 0。名称冲突、非水平、退化或短于 Revit 原生短曲线容差的输入仍由原适配器拒绝。圆弧只读支持不代表圆弧创建已实现。

`GridCreationReadbackRules` 比较完整名称和两个三维端点，允许整段方向反转，端点距离容差为 0.01 mm；拒绝非有限值、曲线和无界线。实际值来自当前 `Grid.Curve` 和 `Grid.Name`，不会用历史快照、预览值或前次回读替代。

`ModelExecutor` 保存原始操作副本、创建的原生 ID 和文档对象。创建后、全部计划操作完成后但事务提交前、Revit 提交处理后但事务组归并前，均检查原生结果。轴网丢失、换类、跨文档、名称或端点漂移时抛错；两个最终检查都处于现有整体回滚窗口。

创建回执的 `operationEvidence` 保存首次核验；最终回执的 `gridCreationVerification` 保存最终阶段、数量和逐项结果，并参与既有完整响应容量预检。每项仍明确 `sideEffectsVerified=false`、`persistenceVerified=false`、`visualVerified=false`、`engineeringComplianceVerified=false`。原生主元素正确不能解释系统元素修改或替代完整副作用验收。

## 构建与实机状态

新增能力指纹 `grid-creation-readback`；旧插件的 `explicit-grid-geometry` 仅证明原有创建即刻检查。独立测试覆盖名称/坐标漂移、端点反转、非零绝对平面、非有限坐标、三维容差和事务边界接线。

本次隔离构建证据：`bin/Release/grid-readback-20261024T080246Z/build-verification.json`。代码门槛为 `compiled`；原任务既有只读结论保留，但不代表本构建已注册或实载。新构建的原生写入、回滚、保存重开和视觉验收均未进行。

后续先批准并注册具体构建，再由用户手动重启；同一新会话批量核对 MVID、能力、完整基础只读范围及柱/轴网。只有这些通过后，才为一个明确新轴网建立独立 run 和具体预览，经该 planId 聊天批准后单次 Confirm。使用共享证据生产函数和独占 attempt；超时先查原任务，禁止重复执行旧计划。

楼板、房间四墙夹具和柱类型复制的未知副作用阻塞保留；这次轴网回读补齐不升级它们的验收状态。当前没有需要用户保存、关闭重开或重启的操作。

## 2026-10-24 注册前基线与具体申请已准备

新 run `5cb9a8c1-1859-44ba-a401-a9d99630729d` 在当前真实 Revit 会话完成注册前只读核验：31 个类别、56 个 scope，258 个实例、29 个类型、7 个房间、3 个系统观察元素，两轮结果和历史已捕获的全部模型字段一致。实际仍加载旧房间回读 MVID `ec3b91b2-a859-40dc-a66e-7e7b45685951`，PID `9360`；文档 identity `8b779b5115e32423190182b547153c52`、revision `0`、未修改。完整当前 context 前后相同，当前磁盘文件也匹配此前重开的文件摘要；原保存快照与重开文件的版本差异仍不作解释。

受限环境的进程查询漏报，正常权限复核在生成离线基线前发现 Revit 正在运行，故改为上述真实只读批次。最初的历史房间比较把跨重开的 `documentIdentity` 当成模型字段，审查在该断言处停止；原始 `baseline.json` 和 `baseline-error.json` 保留。`baseline-recovery.json` 使用同一批已捕获结果，分别核对各自会话 identity/revision，再逐字段严格比较其它值，不删几何、投影或未知模型字段，不重复采集 scope。原脚本停止前没有持久化最初的内存文件哈希，因此不补造该缺失观察；恢复时两次磁盘读取稳定且匹配历史重开摘要。

82 项构建来源及原构建/测试日志摘要复核一致，注册切换临时夹具测试 10/10。具体申请 `9bf05e3b53f299b0d438f29dc8fa5839` 的 SHA-256 为 `921FEB2A858656BA26A439ED8369EF5E5D98673D39E8DB348CAE7A6D1147E697`；目标 DLL 的 MVID 为 `95d19406-5368-46b0-ad0b-6e5ca1dfecd2`，DLL SHA-256 为 `a074a7c7f41c0eda46c8e249219fa755f3dd330c81184236e145b79001d98974`。

申请处于 `READY_FOR_SPECIFIC_CHAT_APPROVAL`。拟议差异仅为当前用户 Revit 2027 插件清单的 Assembly 路径；安装清单、桥接内容和 ACL、2025 清单和客户端配置均未改变，尚无该申请的 attempt/receipt/backup。审查报告位于同一构建目录的 `registration-preparation-verification.json`。`registration-switch.ps1:125–126` 要求本申请的明确聊天批准和独立审查摘要；此前批准的房间构建不替代本次批准。

批准后先复核同一会话/基线、摘要和保护范围，再仅注册一次；之后才需要用户手动重启 Revit 并打开同一隔离副本，核对新 MVID 与完整只读范围。当前模型计划、模型 Confirm、注册 Confirm、保存及重启均为 0。任务仍为 `compiled`，没有本构建实载或轴网写入验收；所有既有副作用阻塞保持。

## 2026-10-24 已批准构建注册完成，等待人工重启

用户已明确批准上述具体申请。提交前完整 context、旧模块指纹、保存文件摘要、82 项来源及保护范围复核通过；原申请摘要不变。注册器实际仅提交一次，回执为 `REGISTERED_MANUAL_RESTART_PENDING`，安装清单 SHA-256 为 `B0CD455181DB43B2A8E338BB56FBCAC22BA0C59A0E5D56167D89BA3511F593B3`。备份与原清单字节摘要一致，安装清单只有 Assembly 字段变化，桥接/ACL、旧版 2025 清单、客户端配置与基线均未改变。

两个额外提交前检查曾分别因 UTC 解析偏移、PowerShell 默认文件共享方式与 Revit 的 RVT 句柄冲突而停止；两次均在调用注册器前，已查明无 attempt/receipt、原清单未变。UTC 字段改由 `JsonDocument.GetDateTimeOffset()` 保留时区，UTC/上海等时刻校验通过；模型摘要采用共享只读流并核对文件长度和时间。未关闭文件或 Revit，未改变原批准、原申请或注册器；不存在提交后的自动重试。

注册后完整 context、保存文件字节和当前已加载模块与提交前相同：Revit PID `9360` 仍加载旧 MVID `ec3b91b2-a859-40dc-a66e-7e7b45685951`。新 MVID `95d19406-5368-46b0-ad0b-6e5ca1dfecd2` 尚未实载核验；代码状态仍为 `compiled`。证据见构建目录的 `registration-verification.json`，原申请、独占 attempt 和原始回执保留在私有 runtime。

下一步由用户手动重启 Revit，重新打开 `acceptance/models/floor-side-effect-isolated-20261020.rvt`。随后只读核验新 MVID/能力和完整声明范围，不重复本次注册，不复用旧会话或旧模型计划。当前模型计划、模型 Confirm、保存及重启调用均为 0；现有系统副作用和房间写入阻塞保持。

## 2026-10-24 人工重启后，新构建实载与只读范围通过

用户完成手动重启并打开同一隔离副本后，新 run `10bfec48-9dac-4c6e-a91a-5c0b236dd011` 核验实际 PID `15164`、MVID `95d19406-5368-46b0-ad0b-6e5ca1dfecd2` 和 `grid-creation-readback` 能力均匹配。原有能力集合保留，已安装清单摘要及 DLL 摘要仍匹配已批准构建，82 项来源摘要未变。当前文档 identity `b2db7d4f19af8e503bdcd25ec80fac04`、revision `0`、`isModified=false`；旧会话只作为历史比较来源，不绑定新计划。

同一次 MCP 会话取得实际只读工具契约及摘要，31 个类别、56 个 scope 完整通过；258 个实例、29 个相关类型、7 个房间、3 个系统观察元素的两轮原始结果归档。类别成员与注册前相同，所有已捕获模型字段严格一致；房间会话 identity/revision 分别绑定各自文档，其余字段逐一比较，未删除几何、投影或未知字段。完整当前 context 前后相同；磁盘文件在整个批次前后稳定，且精确匹配注册前文件摘要。

当前任务升级为 `readonly-accepted`，只接受新构建实载和声明范围读取，尚未执行新轴网创建、最终写入回读或失败回滚；本能力的 `previewAccepted/writeAccepted/persistenceAccepted/visualAccepted` 均为 `false`。此前楼板、四墙夹具、柱类型复制和严格归档的阻塞不变。核验未创建模型计划、未 Confirm、未注册、未保存或重启；无需用户再次重启、保存或重开。

完整证据见该 run 的 `baseline.json`、`load-verification.json`、`file-before.json`、`file-after.json` 和 `summary.json`；构建目录的 `loaded-verification-20261024.json` 索引本次结果。下一项为一个明确具名水平直线轴网的独立候选/预览，具体 planId 经聊天批准后再单次执行，不复用旧批准或旧计划。

## 2026-10-24 单轴网预览已生成，等待具体计划批准

用户要求继续下一步后，新 run `57125ea7-89f9-4424-af53-d11abb6aa538` 获取当前会话的新基线：原 56 个范围加候选平面视图共 57 个 scope，完整原始结果与本次实载基线一致，258 个实例、29 个类型、7 个房间和 3 个系统观察元素保持。文档仍为 identity `b2db7d4f19af8e503bdcd25ec80fac04`、revision `0`、未修改，插件 MVID/PID 不变。当前 11 条轴网名称和有界直线端点已核验，测试名称 `AI-GRID-T01` 未占用。

仅创建一次原生预览，planId `304756429710d5e3a9ed82a9e8e4e476`，状态 `pending`、无警告，截止上海时间 **2026-10-24 18:46:57**（原始 UTC `2026-10-24T10:46:57.3785407Z`）。操作只有一个 `create_grid`：名称 `AI-GRID-T01`，端点 `(48000,1000,0)` 至 `(48000,5000,0)` mm，长 4000 mm；不包含改类型、标签、视图、墙或房间操作。`Grid.Create` 使用文档原生默认轴网类型，未承诺或请求显式类型变更；实际新元素类型须执行后回读。

已使用共享 `createPreviewEvidence`：manifest 在批准前绑定 planId，`preview.preview` 保留完整原生 payload，原生摘要 `d33811af61ca7f468f0d3ba1b577ff8edf1a6d88f213595f925d29ad8477242c`，作用域为 `native-preview-pretty-json-v1`。独立 `preview-create-attempt.json` 和私有 reservation 防止断线后盲目重复创建；它们不是 Confirm 的执行许可。原计划已查询，保持 pending；本 run 没有 confirmation、执行 attempt 或 execution 文件，Confirm 为 0。

已导出并目视检查当前原生平面基准 PNG（4096×3562，74,597 字节），它只显示既有模型；拟新增轴网尚未渲染，不能据此认定新轴网文字、整图版面、净距或副作用通过。原 `before-visual.json` 中初始未审核用词不在 schema 枚举，原记录与摘要保留；实际图像审查另存合规的 `before-visual-reviewed.json`（`inconclusive`）并在 `preview-review.json` 明确关联。manifest、baseline、preview、summary 和追加视觉记录 5 份 schema 校验通过；未伪称初始非标准元数据通过。原生预览和批准用摘要未改变。

任务当前为 `preview-accepted`，等待该具体 planId 聊天批准。批准后复核原计划状态、当前文档与完整范围、payload 摘要，再用共享函数记录实际批准并持久化独立 `wx` Confirm attempt，只提交一次。执行后先检查原生轴网结果、提交前后回读证据和完整变更收据；未知副作用不放行。保存和关闭重开仍由用户手动完成。当前模型与磁盘文件未变，没有保存或重启，原有其它能力阻塞不变。

## 2026-10-24 已批准单次提交，主结果通过，整体副作用保持阻塞

用户明确批准计划 `304756429710d5e3a9ed82a9e8e4e476` 后，原 pending 状态、当前会话、原生预览摘要、57 个范围和磁盘摘要复核通过。初次复核在连接器无序数组的返回顺序处停止；原始完整捕获保留，按既有 `canonicalInspectionItems` 仅排序已定义无序集合后，所有 ID/坐标/关系及其它字段一致，没有重采范围或重复创建计划。实际批准记录和独立 attempt `f27fc418-2048-414e-acf9-874e589bae70` 均以 `wx` 创建并 fsync。原生 Confirm 恰好调用一次，结果 `committed`，后续只查询原计划，未重复提交。

新轴网 `2296055`（唯一 ID `df84cd27-00fa-48f3-ac93-5ef0943e4a86-002308f7`）的名称、直线端点、Z=0、长度 4000 mm 回读通过；实际类型为既有 `341`（6.5 mm 编号）。`gridCreationVerification` 在 `after-transaction-commit` 阶段返回一项原生核验成功；初次创建回读、最终回执、原始 Confirm 工具响应及查询回执均已保留。

完整事务变更回执 `captureComplete=true`、revision 0→1：只新增 `2296055`，没有附加新增或删除；另修改既有元素 `294479`，名称为“GCS 跟踪器”、原生类 `Element`、无类别。历史 catalog 已存在相同 UniqueId，但本 run 没有它的事务前完整快照。当前只有 5 个通用参数，逻辑依赖仅自身；这些信息不能解释其内部修改或认证无害性。`allModelSideEffectsVerified=false`、`writeAccepted=false`，任务整体为 `blocked`，主轴网回读结果单独保留。

执行后两轮原始读取完整归档：259 个当前实例包含新增轴网；所有既有 258 个实例、29 个类型、7 个房间及原 3 个系统观察元素字段一致。31 类别成员只增一个轴网，Grid 数量 11→12；完整 context 仅 revision、保存状态和 Grid 计数发生预期变化。候选视图设置及既有范围不变。文档仍为同一 identity，revision `1`、`isModified=true`；磁盘 RVT 字节仍与提交前一致，插件未保存。执行后“可复用基线”的状态按未保存文档保持 `unknown`，不影响该次原始回读的已捕获范围核验，也不能被用于新写入预览。

当前平面 PNG 4096×3562、76,310 字节已目视复核。新轴网及两端名称在四墙夹具东侧可见；测试名称超出默认圆形编号框，因此视觉记录为 `inconclusive`，`visualAccepted=false`，不认定标签或整图版面通过。未执行改名、换类型或标签修复。`visual.json`、`readback.json` 和标准执行 summary 已归档，9 份已有标准阶段记录通过 schema；保存/重开尚未发生，未运行完整归档 audit。原预览阶段 summary 的准确字节保留在 `summary-preview-stage.json`，当前 summary 另记阶段来源，原预览摘要和批准绑定不变。

下一步由用户决定是否保留本次测试结果并手动保存同一路径；若保留，随后只读核验保存状态并由用户关闭重开，期间无需重启 Revit。GCS 未解释修改、标签视觉问题及失败回滚门槛继续保留。不得重放此已 committed 计划，不自动保存/退出/重启，不继续其它模型写入。

## 2026-10-24 用户保留并手动保存，保存后完整范围通过

用户回复“已手动保存，继续核验”后，同一 run 只读核验当前 document identity、revision `1`、`isModified=false`，原计划仍为 `committed`、原回执未变。57 个 scope、259 个实例、29 个类型、7 个房间、4 个观察元素（含 GCS）的两轮结果与执行后原始范围逐字段一致；完整 context 仅保存状态改变，没有丢弃几何、参数、连接关系或未知字段。

保存文件仍为同一路径、97,009,664 字节，SHA-256 `c439bedb97acf3b97275a530bfaf7cf950edffa270a43cbd4e3aeb06b2d919ac`；读取批次前后字节和时间稳定。它与保存前文件摘要不同，实际文件状态已记录。新轴网 `2296055` 的身份、名称、类型 `341`、端点和 4000 mm 长度保持；当前会话保存范围核验通过，但尚未关闭重开，不能据此认定从磁盘重载成功。

`saved.json`、`saved-readonly.json` 和前后文件元数据完整归档，10 份已有标准阶段 schema 通过；旧 summary 原样保留在 `summary-postwrite-stage.json`，当前 summary 记录保存阶段及来源。后续只需用户关闭并重开该同一文件，无需再次保存或重启 Revit。确认累计仍为 1，本次核验的 Confirm/保存/重启调用均为 0。GCS 原因、标签视觉及失败回滚阻塞不变，任务整体继续 `blocked`，不升级持久化或整体验收。

## 2026-10-24 手动关闭重开后，声明范围持久化与归档通过

用户回复“已关闭重开”后，同一 run `57125ea7-89f9-4424-af53-d11abb6aa538` 在新会话 identity `7f9d2dcbc7adf8a9d23ef9a828155277`、revision `0`、`isModified=false` 下完成只读核验；PID `15164`、MVID `95d19406-5368-46b0-ad0b-6e5ca1dfecd2` 保持已批准构建。57 个 scope、259 个实例、29 个类型、7 个房间和 4 个观察元素的两轮原始结果与保存前已捕获范围一致，类别成员及候选视图设置保持；各会话 identity/revision 分别核验，模型字段没有删减。新轴网 `2296055` 的 UniqueId、名称、实际类型 `341`、端点与 4000 mm 长度均保持。

重开文件与手动保存快照同为 97,009,664 字节，SHA-256 均为 `c439bedb97acf3b97275a530bfaf7cf950edffa270a43cbd4e3aeb06b2d919ac`，读取期间文件字节稳定。原生重开 PNG 为 4096×3562、76,310 字节，SHA-256 `cc5727ef8ee8e2da760a31e83bfbd435d4108456f6087f2d10621ec8a6bd3c71`，与执行后 PNG 逐字节一致，已目视复核；长名称超出圆形编号框的问题仍在。

本次仅接受上述已捕获范围的 `persistence-accepted`；不据此解释 GCS `294479` 的内部修改，也不认证未捕获的整模型副作用。`primaryWriteVerified=true`、`persistenceAccepted=true`，但 `writeAccepted=false`、`visualAccepted=false`、`allModelSideEffectsVerified=false`，任务整体继续 `blocked`；失败回滚仍未验收。

`reopen.json`、`reopen-readonly.json`、前后文件元数据和重开 PNG 已归档；11 份标准阶段记录通过 schema，summary 索引 55 项来源，严格归档报告 `archive-audit-20261024.json` 为 `archiveConsistent=true`、0 项发现。该审计只核对离线绑定与字节，不替代原生副作用或视觉验收。保存阶段 summary 和执行后 visual 的原始字节分别保留在 `summary-saved-stage.json`、`visual-postwrite-stage.json`，当前 summary 说明阶段来源；审计报告不纳入 summary 来源哈希，避免循环引用。82 项构建来源和四墙夹具 79 项历史源摘要未变，四墙原有 11 项归档问题保留。

任务队列已同步有限范围持久化结论及剩余阻塞。原计划仍为已单次提交的历史计划，累计 Confirm=1；本次没有新增计划、Confirm、模型写入、保存或重启。无需再次保存、重开、注册或重启。下一步只凭新的可靠 API 语义或事务前证据调查 GCS，或为标签问题准备独立修复方案并另行批准新计划；不得重放本次轴网创建。
