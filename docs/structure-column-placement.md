> 发布副本说明：本机路径、模型名称及运行标识已匿名化。原始私有证据未随源码发布；历史验收不代表当前会话授权或完整业务认证。

# 结构柱单能力放置验收

任务 `structure.column-placement` 承接已有 `create_structural_column` 和 `controlled-structural-columns`，不增加建模操作。本次只测试既有类型的单个实例放置；不重复柱类型复制，也不改写楼板、四墙、轴网和类型复制的副作用阻塞。

## 已有契约与执行边界

明确输入现有 TwoLevelsBased 结构柱类型、底/顶标高、两个偏移、XY 和可选旋转；Z 由底标高及底偏移得到。既有实现核对类型、结构类别、原生底/顶约束、偏移、三维位置与旋转，在计划结束和原生事务提交后复核；失败仍进入既有事务组回滚窗口。原生主元素正确不等于完整副作用、持久化、视觉或结构设计通过。

每个具体计划经聊天批准后，先复核 pending 状态、当前 identity/revision、预览摘要与当前范围，再持久化独占执行 attempt，最多 Confirm 一次。断线先查询原计划；不自动保存、关闭或重启 Revit。保存和关闭重开由用户手动完成。

## 2026-10-24 同会话复用基线并补查

新 run `285f9997-1ff5-45ac-a79b-acb2c567a231` 在 PID `15164`、MVID `95d19406-5368-46b0-ad0b-6e5ca1dfecd2`、identity `7f9d2dcbc7adf8a9d23ef9a828155277`、revision `0`、未修改的同一隔离副本上准备验收。完整 context 和 RVT 字节保持轴网重开时状态，文件 SHA-256 为 `c439bedb97acf3b97275a530bfaf7cf950edffa270a43cbd4e3aeb06b2d919ac`。

复用 run `57125ea7-89f9-4424-af53-d11abb6aa538` 的 57 个只读 scope（259 实例、29 类型、7 房间、4 观察元素），另执行 6 个补充 scope：当前柱集合、两轮 18 根柱、两轮类型/标高/观察元素及候选平面视图。全部已有字段、集合与两轮结果一致。`baseline-reuse.json` 记录来源、摘要和同会话条件；不把原 57 次读取重标为本次新采集。

本地搜索结果断言误用了不存在的 `total` 字段，原始 accepted 基线及报错均保留；恢复按实际 `items/offset/limit/hasMore` 校验完整集合，没有重采 6 个 scope。恢复脚本还曾误读插件 MVID 字段，在写证据前停止；改用原始 `moduleVersionId` 后核验通过。源类型 `2281799` 的 b/h 原生 Double 值换算均为 500 mm，TwoLevelsBased，18 个既有实例使用该类型；不使用历史测试复制类型。

## 单柱具体预览

- 计划 `def401beb0875f01c3aa9b34fe7809d4`，状态 `pending`，仅一项 `create_structural_column`。
- 类型 `2281799`：混凝土-矩形-柱 / 500 x 500 mm，已激活，无激活或类型修改请求。
- 底标高 `311`（1F，0 mm）、顶标高 `694`（2F，约 4000 mm），底/顶偏移均为 0。
- 位置 `(50000,3000,0)` mm，旋转 `0°`。与已捕获柱点位分离；不把点位距离及 PNG 空白当作精确实体净距证明。
- 原生预览 SHA-256 `3a347a5faf77620f28c0591d38e43e1a490501b001048c0f4e41b8a34bd1462a`，摘要范围 `native-preview-pretty-json-v1`；有效至上海时间 **2026-10-24 19:45:42**。
- 有 1 条原生约束/激活信息及独立结构设计、副作用核验提示，不能写成“无警告”。

预览只创建一次，原计划查询仍为 pending；完整 context 与磁盘文件不变。当前平面 PNG 复用同会话、同视图、未修改模型的已查看图像，并明确记录来源；尚未出现拟建柱的像素，不接受执行后视觉。

预览已完整落盘后，本地校验器将 `candidate.json` 的候选元数据误作完整原生 readback，缺少 `comparison` 而停止。原 candidate、错误、预览及其摘要未改写；追加 `preview-review.json` 解释边界，并只查询同一计划完成恢复，没有重建预览。候选元数据不计为通过 schema 的原生回读。manifest、baseline、preview、before-visual、preview-review、summary 共 6 份记录通过 schema，summary 索引 26 项原始来源；未执行完整已提交归档审计。

任务推进至 `preview-accepted`，Confirm=0、模型写入=0。仍待该具体计划聊天批准；执行后须核对完整变更收据、新柱约束和全部既有范围，未知附加变化阻止整体通过。失败回滚、手动保存/重开及执行后 PNG 均未验收。无需重新注册插件或重启。

## 2026-10-24 用户批准后单次提交，主结果通过，整体副作用阻塞

用户对具体计划回复“批准执行该单柱计划”后，原 pending 状态、预览摘要、完整 context、RVT 字节及 6 个补充 scope 再核验一致。实际批准原文与来源写入 `confirmation.json`，独占 `wx` attempt 落盘并 fsync 后，只调用一次 Confirm。原生结果 `committed`，新增柱 `2296056`；后续只查询该同一计划，原始工具响应与回执均已归档。

柱的既有类型 `2281799`、TwoLevelsBased 结构柱类别、底/顶约束 `311/694`、零偏移、`(50000,3000,0)` mm 位置、零旋转均原生回读通过。类型原先已激活，没有类型复制或激活写入；最终回执的单个放置类型检查通过。柱数量 18→19，原完整 259 实例和 29 类型、7 房间及 4 个观察元素两轮字段均一致，当前完整范围为 260 实例。类别只新增此柱，视图设置与所有其它已捕获字段保持；文档 revision 0→1、`isModified=true`，磁盘 RVT 字节仍未变。

完整事务变更捕获 `captureComplete=true`：仅新增 `2296056`，没有附加新增或删除；另修改系统元素 `86962`、`293247`、`294479`、`2289997`。这次 4 项均有事务前和事务后的完整已暴露快照，公开字段全部一致；它们的隐藏内部修改仍不能解释，不能据此证明无害。`primaryWriteVerified=true`、`capturedExistingScopeVerified=true`，但 `writeAccepted=false`、`allModelSideEffectsVerified=false`，任务整体为 `blocked`，原有其它任务阻塞不变。

执行后原生 PNG 4096×3562、76,336 字节，SHA-256 `fcf4675115d26c5cf12ae8d2c93ad03c5dc0d4ec8e5ecb3c31a80b0943360eb2`，已目视检查：新方形柱截面在测试轴网东侧可见，与四墙夹具和轴网在当前平面中分离。仅接受该新柱当前平面的可见性；不认证精确实体净距、整图版面或工程合规。旧轴网长文字问题保持，`wholeSheetLayoutAccepted=false`。

9 份已有标准阶段记录通过 schema，原预览 summary 准确字节保留为 `summary-preview-stage.json`；保存、重开及失败回滚未发生，不运行完整已提交归档审计。下一步由用户决定是否保留并手动保存同一路径，再做只读保存核验和人工关闭重开；不重放本次计划，不自动保存/关闭/重启，也不继续其它模型写入。

## 2026-10-24 手动保存后，当前会话完整范围通过

用户回复“已手动保存，继续核验”后，同 run `285f9997-1ff5-45ac-a79b-acb2c567a231` 只读确认原计划仍为 `committed`、回执未变，当前 identity `7f9d2dcbc7adf8a9d23ef9a828155277`、revision `1`、`isModified=false`；实际插件 MVID/PID 和完整 context 仅有预期的保存状态改变。

57 个 scope 的两轮原始读取与执行后快照逐字段一致：260 实例、29 类型、7 房间及 4 个观察元素全部保持，类别成员和候选视图设置未变。新柱 `2296056` 的 UniqueId、类型 `2281799`、底/顶约束、偏移、位置及旋转一致；没有删减几何、关系或未知字段，仅按既有规则规范化明确无序集合。

保存文件为同一路径、97,017,856 字节，SHA-256 `d67efded2e99a9f32af5b3873872fbd1ab022e0dd6a8fde585b50b01d7ac02d1`，批次前后字节及时间稳定；与保存前字节不同，实际状态已归档。当前会话保存范围通过，但尚未关闭重开，`closeReopenPersistenceVerified=false`；四个系统元素隐藏内部修改仍未解释，整体 `blocked`，不升级完整写入或持久化结论。

`saved.json`、`saved-readonly.json`、原计划状态及文件前后元数据均已归档，10 份已有标准阶段记录通过 schema；执行后 summary 的准确字节保留为 `summary-postwrite-stage.json`。本次 Confirm、计划创建、模型写入、保存和重启调用均为 0，累计 Confirm 仍为 1。下一步仅需用户手动关闭并重开同一已保存隔离副本，无需再次保存或重启；随后核验新会话、文件摘要和完整声明范围。不重放柱计划，不继续其它模型写入。

## 2026-10-24 手动关闭重开后，声明范围持久化与归档通过

用户回复“已关闭重开”后，同一 run 在新 identity `154a06374e17958edf5354d818a118c7`、revision `0`、`isModified=false` 下完成核验。Revit PID `15164` 和 MVID `95d19406-5368-46b0-ad0b-6e5ca1dfecd2` 保持；57 个 scope 的两轮原始读取中，260 实例、29 类型、7 房间和 4 观察元素的所有已捕获字段与保存快照一致，类别成员及候选视图设置保持。各自会话 identity/revision 单独核验，未剔除几何、关系或未知模型字段；新柱 `2296056` 的 UniqueId、类型及全部已读取约束、偏移、位置和旋转保持。

重开文件与保存快照同为 97,017,856 字节，SHA-256 均为 `d67efded2e99a9f32af5b3873872fbd1ab022e0dd6a8fde585b50b01d7ac02d1`，读取及 PNG 导出期间文件稳定。重开原生 PNG 4096×3562、76,336 字节，与执行后 PNG 逐字节一致（SHA-256 `fcf4675115d26c5cf12ae8d2c93ad03c5dc0d4ec8e5ecb3c31a80b0943360eb2`），已目视复核。仅接受新柱在当前平面中的可见性，不升级整图排版、精确实体净距或工程合规。

任务新增仅限上述声明范围的 `persistence-accepted`，限定柱视觉结论保留。`primaryWriteVerified=true`、`capturedExistingScopeVerified=true`，但 `writeAccepted=false`、`allModelSideEffectsVerified=false`，整体继续 `blocked`。系统 `86962/293247/294479/2289997` 的公开字段从事务前至重开后保持一致，仍不能解释其隐藏内部修改或认证无害性；失败回滚尚未验收。已声明范围持久化不代表未捕获的整模型副作用通过。

`reopen.json`、完整 `reopen-readonly.json`、文件前后状态及原生 PNG 已归档；11 份标准阶段记录通过 schema，summary 索引 62 项来源，`archive-audit-20261024.json` 严格离线绑定/字节审计为 0 项发现。审计不替代 Revit 副作用和工程验收。保存阶段 summary 与执行后 visual 的准确字节分别保留为 `summary-saved-stage.json`、`visual-postwrite-stage.json`，当前 summary 说明阶段来源；审计报告不纳入 summary 来源哈希，避免循环依赖。82 项构建源摘要未变；轴网原审计仍为 0 项，四墙历史原审计仍有 11 项，未改写历史证据。

本次计划创建、Confirm、模型写入、保存和重启调用均为 0，累计 Confirm 仍为 1。无需再保存、重开、注册或重启。原 committed 柱计划不得重放；后续只凭新的可靠 API 语义/证据调查内部副作用，或推进独立离线开发。
