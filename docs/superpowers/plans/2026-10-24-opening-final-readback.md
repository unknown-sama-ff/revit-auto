# 原生洞口最终回读补齐计划

设计：[opening-final-readback-design](../specs/2026-10-24-opening-final-readback-design.md)。用户已批准最小补齐方案；按已有第一阶段开发流程实施，无需另找 writing-plans 技能。

1. 登记：保留 `architecture.native-openings` 的旧验收状态；记录即时检查与最终检查缺口，核验当前源码和现有测试基线。
2. 回归：为未知/非有限/非法容差/漂移偏移增加 CoreTests；为原始输入/Document 绑定及 Commit 前后、Assimilate 前的调用顺序增加 MCP 接线守卫，先观察失败。
3. 核心：在 `OpeningRules` 增加严格零偏移规则，在 `OpeningService` 保留未知参数并应用规则；在 `ModelExecutor` 保存独立操作、原生 Document/Opening ID 并提供最终复核。
4. 事务：在 `RevitCommandRouter` 两个已存在回滚检查边界调用洞口最终核验；增加最终证据和能力指纹，保留现有容量预检及副作用未验证标志。
5. 验证：运行 CoreTests、洞口/回读定向测试、完整 MCP 测试；再隔离编译 Revit 2027.3，安装 CheckOnly；保留日志、来源摘要、DLL 摘要与 MVID。
6. 归档：更新 `docs/openings.md`、任务队列和进度文档，明确新构建最高门槛、既有历史实机状态、注册/重启/原生单能力验收仍待安排。

边界：不注册插件，不调用任何 Revit 计划或模型写入，不保存、不关闭、不重启 Revit，不提交 Git。独立构建目录避免覆盖当前被 Revit 加载的 DLL。

## 实施记录 — 2026-10-24

1–6 项已完成。新偏移规则 CoreTests 与原生事务接线守卫已先失败后通过；提交后的检查保持只读，重生成仅位于创建事务中。最终回执仍受现有容量预检保护，未知副作用和切割方向认证边界不变。

CoreTests 320/320，定向 MCP 24/24，全量 MCP 982 通过、0 失败、1 跳过。Revit 2027.3 隔离编译 0 警告/0 错误，安装 CheckOnly 通过；构建目录 `bin/Release/opening-readback-20261024T125425Z`，完整来源/日志摘要与指纹见其中 `build-verification.json`。代码状态 compiled；队列整体 blocked，真实洞口验收没有升级。

已更新洞口说明、队列和进度文档，历史轴网/柱/四墙来源摘要与归档结论保持。未注册、未做本构建实载核验，未连接 Revit、未创建或确认模型计划、未保存或重启。
