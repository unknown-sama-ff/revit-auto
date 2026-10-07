# Revit 2027 AI 建模桥接器 v0.4.0

## 当前状态

2026-10-07：v0.4.0 代码、MCP 契约和 Revit 2027/.NET 10 编译已通过；族加载 keep_existing 分支已完成原生验收。用户批准的泵房右侧避让计划19项操作已提交，23项原生连接/参数/范围核验通过；新路线10项单目标局部实体核查未发现碰撞，未知0、未截断。水泵位置、200/80 mm管径及供水系统类型保持，80 mm管远端保留、近端调整并以新ID重建。已核实用户手动保存，保存后10个局部范围复查仍为碰撞0/未知0/未截断；维护净距、链接模型及水力流向另行报告，8条流向/流量警告保留。详见 docs/collision-check-acceptance.md。

已编译独立 .NET 10 / Revit 2027 插件，并提供可被 Claude、Codex 发现的本机 stdio MCP 服务。新增受控族加载、保存结果核验和参数表导入预览工作流。Claude Desktop 和 Codex 的 `revit-custom` 已注册，原配置已备份。旧 Revit 2025 模型、族、脚本和程序集保留；旧项目只增加排除新目录的编译项。

本机实际版本为 **Revit 2027.3（27.3.0.28）**，构建使用本机 API；这不是对 Revit 2027.2 原版的一次独立兼容认证。

**已改为聊天确认模式：预览后由你在聊天中确认，Revit 不再重复弹窗。** 同一文档 identity 漂移、计划过期、端口预留和系统分类证据已加入安全校验。v0.3.23已在本机实际加载并核验新增诊断；更换会话后仍需重新读取identity/revision。新版验收脚本会拒绝在缺少对应能力的旧 DLL 上继续验收。实际业务写入和回滚效果仍需在项目副本中验收。

## 开始使用

1. 保存工作，手动重启 Revit 2027；若提示加载本地 RevitAuto AI 2027，请核对来源。
2. 打开一个项目副本。新插件不自动打开固定模板，也不会自动保存 RVT。
3. 附加模块 → Revit AI → **AI 连接状态** 可查看插件启动错误和日志目录。
4. 重启 Claude/Codex，让新 MCP 配置生效。
5. 在助手中输入：

> 读取当前 Revit 项目、楼层、族类型和照明元素数量。只查询，不修改。

> 按当前族库提出灯具、开关、配电箱、回路和图纸的建模计划。先展示预览，缺少尺寸、类型、宿主时不要猜测。

> 我已核对预览，确认执行刚才的计划；无需在 Revit 再次确认。

自然语言由接入的助手解析；本桥负责确定性的模型查询、校验、流程和执行，不包含一个独立聊天模型。

## v0.4.0 新增工作流

- `families.load`：只允许管理员登记的本地 RFA 白名单；支持 `reject`、`keep_existing`、`replace`，所有写入都必须先预览并在聊天中确认。`keep_existing` 分支已在 Revit 2027.3 验收；实际新 RFA 加载和 replace 仍需独立测试副本验收。
- `verification.saved`：读取当前文档是否有未保存修改及受限变更历史；不保存、不打开其他 RVT、不创建模型计划。
- `imports.parameter_table`：CSV/TSV/XLSX/JSON 显式字段映射和计划预览；不猜测族、类型、楼层，不自动保存。

当前仓库提交为 `942530f`，已推送到私人 GitHub 仓库。实机验收仍需使用项目副本；自动化测试不等于真实 Revit 业务验收。
## 工具和安全

逻辑 API 保留 `revit.context.get` 等点号命名；MCP 实际工具名使用 `revit_context_get` 等下划线，以兼容不同助手。工具描述给出对应逻辑 API。

- 查询：context、search、inspect、audit、collision_check；碰撞核查只读，净距结果为保守候选，类型查询支持分页。
- 计划：plan_create、plan_get、plan_confirm、plan_cancel。
- 专业流程：workflow_run 只生成预览，不直接修改模型。
- 导入：import_preview、import_commit；操作目录见 operations_list 和资源 `revit-custom://operation-guide`。
- 每个计划最多 1000 项、默认 120 分钟过期；创建项可设 id，后续用 `@id` 引用新元素。
- 真正修改前只需在聊天中明确确认已展示的计划；同一未变更的已批准计划不重复询问，也不需要额外填写确认布尔值。助手/客户端负责核实聊天授权，Revit 后端不能读取对话，不再提供独立人工点击保证。
- 当前项目身份和版本必须与预览一致；切换项目或手工编辑后需要重新预览。
- ExternalEvent 单队列 + TransactionGroup；失败/取消时回滚未提交内容；成功是一项可撤销操作。
- 普通事务警告记录并随收据返回聊天，不额外弹确认；错误和文档损坏仍中止并回滚，不自动忽略。
- 连接状态按钮仅在主动点击时显示说明，不是执行确认。操作系统权限提示、Autodesk 启动信任/授权提示和第三方插件弹窗不在本项目的控制范围内，不予绕过。
- 已提交 planId 返回原收据，不重复创建；超时后先查 plan_get，不能盲目重建计划。
- 使用毫米、内部项目原点和绝对 Z；双精度参数必须提供明确的 value+unit，不接受猜测的英尺值。
- localhost + 私有随机令牌；没有公网访问、任意 C# 执行、自动模型保存或自动关闭 Revit。

## 已实现的业务操作

- **照明电气**：族类型复制、灯具/开关/配电箱（含墙面宿主）、严格参数、回路/配电箱关联、连接器导线、平面图、配电盘表/明细表、图纸和视图放置。
- **建筑**：标高、轴网、墙、门窗族实例、楼板、封闭房间、视图、房间/分类标记、基于已有稳定几何引用的尺寸标注。
- **泵房机电**：设备、管道/风管及尺寸、连接器、弯头/直接头/变径。设备 `clearanceMm` 为包围盒净距粗筛，不是精确碰撞或法规审查。

这是参数化工具集，不是无尺寸/族库即可从图片生成完整施工模型。族、工程系统类型、配电制式必须在目标模型中可用；不会猜测或下载未知族。

## 表格、DWG 和图片

- CSV/TSV/JSON/XLSX：显式字段映射、单位、默认操作类型及计划校验。
- XLSX 支持基本值、共享字符串和工作表选择；公式、宏、外部链接、过大压缩包拒绝。旧 XLS 请另存为 XLSX。
- DWG：读取在 AutoCAD 中已打开的指定图纸，或使用现有提取 JSON；不自动启动/打开/保存 AutoCAD。
- 图片：使用所接入助手的视觉能力；本桥没有独立视觉模型。候选结果必须提供比例、原点、旋转和楼层标定。
- DWG/图片 **只生成候选操作**，不能直接 import_commit。核对后仍需 plan_create 和聊天确认，不再追加 Revit 确认。
- 文件读取默认限制在工作区；其他目录需明确配置 REVIT_AI_IMPORT_ROOTS。

## 官方 MCP 双通道

自定义通道已注册。Autodesk 官方 Public MCP **尚未安装/实测**，不能把已有 Autodesk Assistant 当作它已接通的证明。

详见 `docs/official-mcp.md`。已提供严格白名单的官方只读代理，但不会猜测官方命令或注册未验证组件。必须选择官方 Read 配置，不使用 Write/Experimental。原社区 MCP 的写入工具也不受本桥的确认机制保护，请勿同时暴露旧 send_code_to_revit 等写工具。

## 文档身份、连接器检查与写入／回滚验收

v0.3.1 的 identity 稳定性已在测试副本中通过五次连续只读查询。v0.3.3 将配电箱连接器的 IsConnected、Origin、Domain、Shape 统一改为能力感知查询：返回 connectorType 及各属性的 supported 标记和原因，未知状态不误报未连接，未知坐标不填为零；不跳过配电箱参数或回路信息。该连接器修复仍需重启后的实机核验。

v0.3.1 使用 Document.Equals 匹配同一底层文档，并在成功 DocumentClosed 后清理。取消关闭不会重置身份；执行前也不再使用托管对象引用比较。context 返回 isModified，不能将 revision=0 当成没有未保存修改。

真实验收步骤、独立副本及失败进度核验见 `docs/identity-acceptance.md`。新增错误收据包含 completedOperationCount 和一基 failedOperationIndex。

## 构建与验收

需要 .NET 10 SDK、Node 20.11+。开发测试运行 `build-v27.ps1`。

只读实机检查：

```powershell
node D:\Desktop\revitt\revit-auto\mcp\health.mjs
node D:\Desktop\revitt\revit-auto\mcp\acceptance.mjs
```

第二项只创建内存预览并取消，不写模型。照明样例必须替换为目标文档的真实 ids/点位后另存 reviewed 文件：

```powershell
node D:\Desktop\revitt\revit-auto\mcp\acceptance.mjs --lighting D:\Desktop\revitt\revit-auto\examples\lighting.reviewed.json
```

默认预览后取消；独立命令行验收的 `--confirm` 是写入开关，只能在用户已于聊天中批准该计划后使用，不会再弹 Revit 确认窗口。

自动化测试覆盖协议、认证数据流、中文分块传输、两个模拟助手、导入、只读代理、引用和计划生命周期。**模拟测试不是 Revit 业务验收，不应宣称回路、导线、宿主和回滚已经在真实项目中验证成功。**

## 安装和回退

`install-v27.ps1 -RegisterCodex -RegisterClaudeDesktop` 会安装清单、私有设置并合并助手配置；不关闭 Revit、不改模型。重跑保留令牌、备份配置。

停用时在 Revit 附加模块管理中禁用 RevitAuto AI 2027 后重启，移除助手中的 revit-custom 即可。原 2025 清单、DLL、族和 csx 不删除，RVT 不自动升级/覆盖。

日志在 `runtime/revit-ai.log`；不要分享令牌、私有配置和含项目细节的日志。

## v0.3.4 新增与未完成项

新增事务变更历史、类型解析、房间布灯预览、PNG 视图证据导出。当前源码已编译并通过自动化测试，实机需重启后核验。完整目标进度和未完成边界见 docs/goal-progress.md；Claude Code 的自然语言行为约定见 CLAUDE.md。
