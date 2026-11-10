# 既有原生洞口的最终回读补齐设计

状态：用户已回复“批准最小补齐方案”（`request_user_input_async call_099f96f6bf0a41cfa3f290a1d0a7064f`）。已进入代码实现与隔离验证；该批准不包含插件注册或模型计划执行。

## 问题与证据

`OpeningService.Verify` 目前只在 `ModelExecutor.Execute` 返回创建结果时调用。`RevitCommandRouter` 已为墙/楼板/门窗、房间、轴网等安排整计划执行结束与事务提交后的复核，但没有对应洞口复核。后续操作、原生重生成或失败处理改变、删除洞口时，创建时证据不能代表最终结果。

竖井偏移当前由 `ReadOffset` 直接读取 `AsDouble()`，没有检查 `HasValue`、存储类型和有限性；`Math.Abs(value) > tolerance` 对 NaN 为 false。缺值不能认证为零，非有限值不能通过偏移验证。这是源码路径上的缺口，尚未在真实 Revit 模型中触发，不能把该发现表述为已复现的原生事故。

## 方案选择

1. **推荐：复用现有校验，补齐两个最终检查边界。** 保存原操作独立副本、洞口原生 ID 与 Document；最终按同一操作重新读取并核对，严格拒绝未知偏移。范围小，与已采用的轴网回读方式一致。
2. 把现有三类洞口整体拆成新的领域几何模型。测试隔离更彻底，但当前没有必要重写已实现的宿主/轮廓校验。
3. 只在外部验收脚本补查。能发现已提交结果异常，但缺少事务组仍可回滚时的内部保护，不足以修复此缺口。

## 推荐方案契约

- 继续仅支持既有 `wall_rectangle`、`floor_profile`、`shaft`，不扩大输入、宿主、切割方向或默认值范围；不新增任意脚本入口。
- 绑定创建时原生 Document、Opening ID 及原操作 `Clone()`，不从后续 inspect 或新快照重设期望值。
- 创建阶段的 `Regenerate()` 保留在已开启的事务中。最终校验只读取原生状态；Commit 后不得在已关闭的事务外再次调用 `Regenerate()`。
- 创建即刻回读保留；全部操作完成后、Transaction.Commit 前复核一次；Commit 的原生失败处理完成后、TransactionGroup.Assimilate 前再复核一次。丢失、换类、跨文档、宿主/边界或竖井约束漂移必须抛错并使用既有整体回滚窗口。
- 原生边界继续由现有 `OpeningService.Verify` 读取，不以预览值代替实际值；既有线段方向/顺序容差规则不变。
- 偏移读取仅对 Double、HasValue 且有限的参数返回毫米值；其它情况返回未知。竖井零偏移规则拒绝未知、NaN、Infinity、非法容差及超出明确容差的值。Snapshot 不把缺值写成零。
- 最终回执增加 `openingCreationVerification`，包含阶段、数量、逐项原生证据；纳入现有完整成功响应容量预检。保持 `sideEffectsVerified=false`、`persistenceVerified=false`、`visualVerified=false`、`engineeringComplianceVerified=false`；切割方向仍只证明传入 API，不能独立认证实际切割方向或完整影响。
- 增加 `opening-creation-readback` 能力指纹，区分只含旧创建即刻核验的 `native-opening`。

## 实施与验收

先对偏移规则和事务接线建立可失败的回归检查，再修复；运行 CoreTests、洞口及回读相关 MCP 测试，随后完整 MCP 测试。用 Revit 2027.3 API 在新的版本化目录隔离编译，执行安装 CheckOnly 并记录来源摘要、DLL SHA-256 与 MVID。

本轮实现范围不注册插件、不创建原生模型预览、不 Confirm、不改模型、不自动保存或重启。之后若需实机使用，具体新构建仍按项目流程单独注册并由用户手动重启；新会话只读核验通过后，洞口的正向写入、失败回滚、保存重开及 PNG 各自取得真实证据。本设计批准不替代任何具体模型 planId 或插件注册申请批准。

现有楼板、四墙、柱、轴网及类型复制的未知内部副作用结论保持；不通过重放旧计划补造事务前证据。代码、测试和编译完成只提升对应代码门槛，不升级真实洞口验收。

## 自审

设计沿用现有事务回滚与响应预算，不引入第二套提交引擎；新增字段只增加证据，不承诺隐藏副作用或工程合规。当前缺口与未来原生实测已分开说明，没有需要通过改写历史证据完成的步骤。

## 实施结果

已按最小方案完成实现、回归与隔离编译；没有新增操作或扩大输入。CoreTests 320 项、定向 MCP 24 项及全量 MCP 982 项通过（1 项跳过），Revit 2027.3 编译和安装 CheckOnly 通过。实际证据与未完成的原生验收边界见 [openings.md](../../openings.md) 和构建目录 `bin/Release/opening-readback-20261024T125425Z/build-verification.json`。本设计的离线实现阶段完成，注册和模型计划仍须各自独立批准。
