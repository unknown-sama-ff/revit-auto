# 旧版功能对等迁移矩阵

## 事实来源与覆盖

机器可读矩阵为 `mcp/legacy-source-matrix.json`，逐项登记全部 **51 个根目录 .csx + ModelBuilder.cs**，共52个来源。`mcp/source-matrix-reviewed-generator.mjs` 维护审阅过的分类；覆盖测试会在新增/删除源文件但未更新登记时失败，防止只统计工作流名称而遗漏旧脚本。

每项记录包含 legacyFeature、legacyScript、newWorkflow、supportedInputs、generatedOperations、readOnlyQueries、writeCategories、rollbackScope、acceptanceStatus、源文件角色和旧版副作用审查。登记不是运行权限；MCP不提供.csx路径/C#执行入口。

## 状态

- `implemented-and-accepted`：指定能力已有原生验收证据，范围明确；只读项不伪造事务/保存验收。
- `implemented-not-accepted`：有结构化操作迁移，但还未完成独立的原生结果、异常回滚和副作用验收。
- `implemented-needs-safe-adapter`：旧逻辑存在，但安全适配未完成。
- `legacy-source-needs-redesign`：事务探针、API反射参考、外部族/样板读取或特殊事务业务，不能原样接入普通MCP。
- `intentionally-not-exposed`：不迁移其自动执行行为。例如固定路径自动SaveAs；用户仍可手动保存。

注册表中的 `implemented-not-fully-migrated` 是工作流级概况，不等同每个来源都通过。不能以enabled、单元测试或源文本匹配证明全部旧版业务验收。

## 当前启用的安全入口

- 照明/电气：lighting.full、lighting.place、electrical.circuit、electrical.wire、electrical.sheet。
- 建筑：architecture.build、architecture.rooms、architecture.openings、architecture.documentation、architecture.stairs（受控 StairsEditScope 预览/执行基础层，仍待实机验收）。
- 泵房：pump_room.build。复用的是现有2027结构化API能力，不是当前旧ModelBuilder.Build中不存在的管道实现。
- 只读：audit、families.audit、verification.saved。参数导入：imports.parameter_table（CSV/TSV/XLSX/JSON，显式字段映射，预览后确认）。族加载：families.load（受控白名单 RFA；keep_existing 分支已完成 Revit 实机验收，实际新 RFA load/replace 仍未验收）。只读注册项具有readAdapter，不进入模型operationBuilder。

电气、房间、门窗、图纸细分适配器已通过构建/契约测试但仍待逐项原生写入、回滚、保存后结果验证。没有给普通客户端原样执行旧脚本的权限。

## 必须避免的错误对等关系

- `openings.csx` 原生逻辑是宿主门窗及类型复制，不是墙洞/竖井Opening API；architecture.openings的当前支持范围仅门窗。裸洞口能力仍需要单独实现和验收。
- 当前 `ModelBuilder.Build` 抛NotImplementedException；Preflight涉及外部样板族提取、RFA导出和固定路径。不能将它统计为已成熟的旧管道/风管后端。
- `inspect-*` 中若含临时实例/事务回滚，则是验收探针，不是纯只读生产接口。反射API枚举也不是新建模功能。
- `audit-template.csx`、`audit-windows.csx` 涉及外部样板/RFA；当前模型族目录不能被称为它们的完整迁移。
- `save-as.csx` 的自动另存为不进入普通AI入口；保存核验应只查询证据，保存动作由用户完成。

## 本批真实族库审计迁移

`check-families.csx` 对应的当前项目精确族名目录已经迁移至共享 `auditFamilies` 适配器：

- `revit_workflow_run` 使用name=families.audit与input.names。
- 可选别名工具 `revit_families_audit` 使用相同逻辑；数据与统一入口一致。
- 接受当前documentIdentity/expectedRevision及显式族名；按原生FamilySymbol精确匹配，不把相似族当作唯一类型。
- 分页受每族/全局预算约束，区分found、missing、partial、not_scanned；截断不判缺失或完整通过。
- 每个分页和结束复核同一identity/revision，模型变更时丢弃结果；读取失败不自动重试。
- 不加载RFA、不读取外部样板、不创建建模计划、不保存模型；原生符号ID仅是候选证据，不替用户选择类型。

2026-10-07：实际本机stdio MCP和原生Revit查询完成12项验收：水泵1型、子母门4型、照明配电箱28型可读取；故意不存在的名称返回missing；直接工具/统一工作流结果相同；错误revision被拒绝；identity、revision、计数、保存状态、视图与选择集不变。原生证据仅存本机acceptance，不上传仓库。仅这一明确的只读目录能力标记accepted；外部文件族审计仍未完成。族加载本批已完成目录绑定、哈希锁定、冲突策略、事务回滚接入和 MCP 契约测试，但仍未完成真实 RFA 的预览/提交/回滚实机验收。



2026-10-07：`families.load` 的 `keep_existing` 分支完成 Revit 2027.3 原生验收：聊天确认后提交 1 个受控计划；照明配电箱族（族 ID 2288583）和 `LB404` 类型核验通过，原生类型证据共28项；创建/修改元素均为0，文档 revision 保持0，`isModified=false`，未自动保存。证据保存在被忽略的 `acceptance/family-load-keep-existing-20261007.json`。这不代表新的 RFA 加载或 replace 分支已验收。

## 后续依旧保留的完整目标

- 专门原生实现：裸墙洞/竖井、泵房路线生成及连接工作流；楼梯已加入专用 StairsEditScope 基础层，受控族加载已实现基础层；两者仍需对应实机验收。
- 参数表导入已完成受控解析、显式字段映射、identity/revision 锁定和预览链路，仍需 Revit 原生提交、回滚、保存后复查；DWG/图片仍是候选导入。保存后核验已接入统一只读注册适配器，仍需 Revit 实机和保存/重开验收。
- 全部来源逐项写入/回滚/人工保存/复查（只读来源用只读合同），不以工作流别名替代结果对等迁移。
- 发布前完成干净环境安装、许可证/安全说明、双客户端验收；当前仓库私有状态不自动改变。

Revit 2025源码和程序集不修改；本批只改变Node MCP与元数据，无需重启Revit加载DLL。已有MCP进程需重连才能发现新客户端代码。
