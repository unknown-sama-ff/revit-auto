> 发布副本说明：本机路径、模型名称及运行标识已匿名化。原始私有证据未随源码发布；历史验收不代表当前会话授权或完整业务认证。

# 图框替代时自引用依赖的最小修复设计

日期：2026-10-26
任务：documentation.titleblock-change
阶段：用户已批准实施代码、测试和隔离编译；本文件不批准修改模型、注册、保存或重启。
批准来源：request_user_input_async call_xScx9BjnhCm3vHUe8rB8QRAx item0，回复“批准最小修复设计并实施”。

## 问题与已验证事实

原受控契约允许 Revit ChangeTypeId 返回新图框实例，并要求旧实例消失、真实依赖保留、图纸成员只发生这一项替代。GetDependentElements(null) 的原始列表允许包含被查询元素自身。

run 7b699692-6654-4e20-a0fb-df760290a0db 的完整基线中，图框 2296036 的原生依赖是 [2296036]。TitleBlockChangeService 当前直接检查列表中每个 ID 是否仍存在；如果 Revit 真正替代实例，旧实例按契约应当消失，这项检查却会把它当成未批准的从属删除而拒绝。该冲突同时涉及 Apply 与提交前/后的 VerifyReadback，不能只修一个位置。

本次真实写入是原位类型更换：resultingId=2296036、replacementOccurred=false，因此没有触发这个缺陷。原位结果、100 个 scope、623 个完整检查对象、保存/重开及文件摘要已归档；不能把这些证据升级为真正替代分支验收。A3 图框无法容纳既有表格，PNG 仍拒绝。二者分别保留。

权威来源：

- mcp/titleblock-change.mjs：显式三个 ID、独立单操作、替代风险披露。
- v27/TitleBlockChangeService.cs：Capture、Apply、VerifyReadback。
- v27/TitleBlockChangeReadbackRules.cs：原/结果 ID 与替代结果校验。
- tests/CoreTests/TitleBlockChangeRulesTests.cs：已有回读规则测试。
- acceptance/runs/7b699692-6654-4e20-a0fb-df760290a0db/：baseline、execution、saved、reopen、visual、summary 和原始依赖响应。

## 可选实现

1. **推荐：统一的依赖保留规则。** 在既有纯规则类中明确计算必须保留的依赖，将三个检查位置接到同一规则。只有原生结果确为替代时，旧实例自身由“旧对象必须消失”的独立校验负责，其他 ID 一项也不豁免。保留原始依赖列表，附加披露所用规则。
2. **三个位置分别内联同一筛选。** 代码行数少，但 Apply、提交前、提交后容易发生策略漂移，难以针对完整流程测试。
3. **直接拒绝所有替代。** 实现简单，但会缩小原契约覆盖范围，不采用。

## 推荐规则

仍使用当前输入、plan/identity/revision 保护、单次聊天批准和原生事务流程。只修正依赖校验与相关回执表达。

- Capture 保留完整原始依赖 ID，包含自引用；预览不删除或改写它。
- 原生 ChangeTypeId 完成后，以真实 resultingId 与 originalId 是否不同确定替代，不能根据 targetTypeId 或预览猜测。
- 原位更换和 no-op：所有原始依赖必须仍存在，原实例必须存在且 ID 不变。
- 真正替代：旧实例必须不存在、新实例必须存在且 ID 不同；依赖保留检查只豁免恰好等于 originalId 的自引用。任何其他从属对象丢失都失败/回滚。
- 提交前、提交后与立即执行回读共用该规则；每次重新读取实际存在性，不复用先前的 true。
- 目标类别/类型、所属图纸、图框成员、LocationPoint、旋转及既有容差保持原有检查，不增加位置或几何豁免。
- 依赖列表为空、只含自身、没有自身但含真实从属、同时含自身与真实从属，均按同一规则处理；不把未知/截断查询当完整证据。
- nativeMayReplaceInstance、原始前后依赖、deletedOriginalInstanceIds、addedDependentElementIds 等原始字段保留。
- 若真正替代且旧列表含自身，reviewedDependentsStillExist 不应声称“全部旧 ID 仍在”。保留该字段并让它如实表达全部旧 ID 的存在性；以新增明确的 preservation-check 证据记录应保留依赖及检查结果。已验证的原位分支仍为 true。
- 新增 `dependencyPreservation` 回执对象：`requiredDependentElementIds`、`exemptOriginalSelfReferenceIds`、`missingDependentElementIds` 和 `verified`。列表来源绑定当前操作的原始依赖；豁免列表只能为空或仅含被真正替代的原实例 ID。
- `TitleBlockChangeReadbackRules.Require` 应消费 `dependencyPreservation.verified` 对应的必须保留依赖结果，不能继续把旧 `reviewedDependentsStillExist` 当成功门禁。旧实例消失和新实例存在仍有独立核验；成功替代可以同时出现“旧字段 false、保留检查 true”。
- 必须同时替换 Service 中 `VerifyReadback` 的原列表 `All` 检查、后续 `Any` 检查以及 `Apply` 的 `removedDependents` 筛选（当前源码约第 77、88、120 行），避免残留旧拒绝路径；原始列表和旧字段的真实值不被过滤或伪造。
- 不从依赖规则通过推出 sideEffectsVerified、persistenceVerified、visualVerified 或全模型净差异通过。

## 修改范围

- v27/TitleBlockChangeReadbackRules.cs：小型、可独立测试的依赖保留规则。
- v27/TitleBlockChangeService.cs：立即回读和两阶段最终回读统一消费规则，补充准确的依赖核验回执。
- tests/CoreTests/TitleBlockChangeRulesTests.cs：完整替代与非替代组合、真实依赖丢失拒绝、旧/新 ID 错配拒绝。
- 必要的现有 MCP 回归测试：确认输入契约不变，原始依赖与新增回执证据可以保留；不改变模型写入门禁。
- docs/capability-task-queue.json、docs/drawing-architecture-parity.md、docs/goal-progress.md：区分修复状态、隔离编译、实际加载、真正替代实机验收。
- 已有 acceptance/runs 文件、原始失败/成功证据和已提交计划不改写。

## 验证与完成门槛

1. 先用纯规则测试重现“原始依赖含自身 + 真正替代”误判。
2. 覆盖：原位/no-op 自身存在与缺失；真正替代旧自身允许消失、新实例必须存在；其他真实依赖删除一律拒绝；空列表及无自引用列表；成功替代时旧字段 false 而保留检查 true；立即检查后、提交前或提交后某个真实依赖才消失时仍拒绝，证明每阶段重新读取而非缓存通过值。
3. CoreTests、相关 MCP 测试通过后，执行全量 MCP 回归。
4. 使用新的版本化输出目录做 Revit 2027.3 隔离编译，不覆盖实载 DLL；冻结构建来源与摘要。
5. 本设计批准仅覆盖代码、测试和隔离编译。具体构建注册另行审查；有必要时再请用户手动重启。
6. 真正替代分支要有能实际触发该原生行为的明确夹具、新 run/预览/具体批准和原生结果，才可提升该分支实机状态。没有这种夹具就保留未验收，不重放本次原位测试冒充替代验收。

## 边界与下一步

本次不调整当前 A3/AL1 模型版面，不移动或缩放表格、不恢复 A1、不新增模型计划，不自动保存、关闭或重启。图框边界诊断是独立后续切片，不在此次修复内扩展。

用户已审核批准，实施计划见 ../plans/2026-10-26-titleblock-self-dependency-readback.md。当前已完成的保存重开不需要用户重复操作；具体构建注册与原生替代分支实机验收仍分开处理。

## 设计自查

已核对原始自引用依赖、真实回执的非替代结果、三个检查位置与既有测试。方案保留既有支持范围、原生依赖证据和拒绝删除保护；不存在用自引用豁免删除其他依赖的授权。编译/测试、实载和真正替代验收保持独立。
