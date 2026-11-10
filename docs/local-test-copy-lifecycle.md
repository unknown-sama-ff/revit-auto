> 发布副本说明：本机路径、模型名称及运行标识已匿名化。原始私有证据未随源码发布；历史验收不代表当前会话授权或完整业务认证。

# 本地测试副本的保存与重启

依据用户于 2026-10-10 批准的[设计](superpowers/specs/2026-10-10-local-test-copy-lifecycle-design.md)，生命周期流程只处理私有登记中指定的一个本地测试副本。登记绑定既有保存证据与固定读取配方，文档会话和进程身份由每份预览另行绑定。普通模型计划仍不自动保存。

## 状态与授权

软件实现、具体构建注册、具体生命周期执行分别记录。当前实现及隔离验证完成，2026-10-11 最终具体构建获准单次注册且回执独立复核通过；用户随后手动重启并打开同一测试副本，实际加载核验已通过。实载证据为 `runtime/local-test-copy-lifecycle-loaded-1791664869517-2f21887f-b5d2-4d63-a107-62c5b502edf5.json`，状态为 `LOCAL_TEST_COPY_LIFECYCLE_LOADED_SAVED_READ_SCOPES_VERIFIED`，MVID 为 `24cb2862-77a4-491c-adcb-5fe2e493b4a1`，29 个固定读取配方及保存字节稳定性通过；尚未执行实机保存、退出或打开。安装预检、API 编译和模拟测试不代表实机保存或重开验收通过。

已加载的旧构建没有生命周期能力。新版能力已在当前 Revit 会话加载并核验，随后生成的具体预览仍须单独批准后才能执行。

AL1 表格移动、柱类型复制不在此流程中重新执行。附加原生元素的用途仍 unresolved，`typeCopyExecutionAccepted=false`、`allModelSideEffectsVerified=false`；保存、重开及已读范围核验不解除这些限制。

## 外部入口

从包目录运行 PowerShell 7.5 或更新版本（本机验证为 7.6.5）：

```powershell
pwsh -NoProfile -File tools/test-copy-restart.ps1 -Mode Prepare
```

Prepare 读取固定文件、模型范围、Revit 进程和桥接配置，返回 operationId、请求 SHA-256、有效期和 saveAction。它不保存、退出、打开项目或取得执行租约。预览有效期为十分钟。

可信助手核验用户已经批准这份具体预览后，提交其固定 ID 和摘要：

```powershell
pwsh -NoProfile -File tools/test-copy-restart.ps1 -Mode Execute `
  -OperationId '<具体预览的32位小写十六进制ID>' `
  -ExpectedRequestSha256 '<具体预览的64位小写SHA-256>'
```

入口不接受模型路径、可执行文件路径、命令或另存为目标。登记、桥接配置与所有运行证据保留在 Git 忽略的私有 runtime 中；不会在日志打印 bridge token。

## 流程与证据

外部监督器保留原 Revit 进程句柄，核对 PID、启动时间、可执行文件、用户和交互会话。保存前独立复制现有磁盘 RVT 字节，核对备份大小与摘要；该备份不包含尚未保存的内存修改，也不自动覆盖原文件。

原生插件在 UI 线程取得队列租约，复核固定文档、版本、插件和完整范围。已有保存内容采用 `noop_already_saved`；有待保存修改的分支只调用一次 `Document.Save()`。保存后通过两轮固定读取和稳定磁盘摘要，再排队一次正常退出。每项原生动作及外部启动都有落盘的单次标记。

正常退出排队后立即结束当前 ExternalEvent 批次。监督器只有观察到原进程自然退出、完整关闭事件日志、端口释放与稳定文件后才启动一个空 Revit。新进程与插件握手核对通过后，生成跨进程许可，由 ExternalEvent 一次打开登记文件。新 identity、revision=0、无待保存修改及两轮固定范围一致才返回 `REOPEN_VERIFIED`。

固定范围包括已保存的类别/类型完整分页成员、完整 inspect 快照及四根依赖关系。几何、投影和未知字段保留；只采用既有声明的无序集合及负零规范化。生命周期动作不能扩展查询配方或复活旧模型计划。

## 受限保存分支

当前登记来自已核验的保存证据。有待保存修改时，Prepare 仍要求可观察模型范围、成员和依赖关系与该证据一致，只允许显式变化的会话、revision、保存状态及重开后的 UI 恢复。可观察范围变化需要另行受控基线，不能由监督器默认为新的保存许可。

`noop_already_saved` 的实机通过只能证明已有保存内容的重启与重开。真正的保存分支仍需独立具体预览、批准和实机验收；不会为制造修改而再次移动 AL1、复制类型或修改模型。

## 停止行为

弹窗、取消、超时、读回不完整、证据或配置变化、错误进程、端口接管和未知结果均停止后续动作。不会自动重试、关闭弹窗、放弃修改、强杀 Revit或从备份恢复。

启动 RPC 期间同样监督持久停止证据，辅助进程在 `Process.Start` 前核对固定请求及停止标记。取消或回执丢失不能证明操作系统尚未启动进程；此时记录 `launchOutcome=unknown`，保留现场和单次启动标记，不重试启动、不打开文件。

`SAVE_OUTCOME_UNKNOWN` 与 `OPEN_OUTCOME_UNKNOWN` 是终态。同步 Save/Open 不能被监督器强制取消；停止只撤销后续自动动作并保留现场。查询既有状态不能重新保存、退出、打开或重新启动。

prepare 和 verify_scope 会创建预览或推进持久读取索引，`idempotentHint=false`；get 只观察。保存、退出、打开和 stop 都明确为非只读、不可自动重试的工具。MCP 严格检查解析后的对象；原生 JsonElement 另拒绝重复字段，不声称标准 MCP SDK 能检测 stdio 的重复 JSON 键。

## 当前具体预览

2026-10-11 用户报告已重启并打开同一测试副本后，加载探针只读通过。当前文档 identity 为 `c25be0e3aa9b9e7796065ba4b8992bb1`，PID 为 `32624`，revision=0、isModified=false，RVT 摘要为 `f418b4f4520e0f87999e63cab4d3ccf22ac4399850d53fc12a8a0f77616e7a62`。`Prepare` 已生成 `PREVIEW_READY` 请求：operationId `a04e766bf8bca0d4ebae691981ca780e`，request SHA-256 `af89d67308df818cc2af08beb6ff1c0cc2fed3b8f81fa9a9883931a339ff6a25`，北京时间 2026-10-11 04:52:42 到期，`saveAction=noop_already_saved`。该预览只绑定当前本地测试副本，尚未取得执行批准；未保存、退出、启动、打开或创建模型计划。

用户随后批准该具体预览并执行一次。`noop_already_saved`、58 项固定读回、RVT 摘要、正常退出、退出码 0、端口释放和关闭事件均通过；证据包括 `lifecycle-a04e766bf8bca0d4ebae691981ca780e-exit-observed.json`。在单次启动 RPC 阶段发生 `os_inspection_failed`，只留下 `launch-attempt.json`，没有 `launch-observed`、`continuation` 或打开动作；监督器写入 `supervisor-stop.json`，状态 `STOPPED`，`launchOutcome=unknown`。该 operation 不得重试或补启动；需要人工重新启动 Revit 并打开同一副本后，才能生成新的只读预览。

用户已手动重新启动 Revit 并打开同一测试副本。新的加载探针通过后，`Prepare` 已生成 operationId `f9a2b6b3363ee68a76ef2de1ef84e110`，请求 SHA-256 `06337398d34484961b025c21c0b9d280dbc34deac2ce569fb87e82fab99f61f1`，北京时间 2026-10-11 05:06:31 到期；当前文档 identity 为 `fdfd51b92de621b024d08e19c5bf0118`、PID 为 `28324`，RVT 摘要保持不变，`saveAction=noop_already_saved`。该新预览尚未批准执行。

针对上次启动未知，监督器启动器已完成修复并通过 59 项定向回归（58 通过、1 项环境跳过）：启动时设置 Revit 所在工作目录，避免在启动 RPC 中提前访问子进程句柄；PowerShell helper 返回受限结构化错误，外部状态链保存诊断详情；单次启动、端口、PID/启动时间、MVID 握手门禁保持不变。修复后重新生成的预览为 operationId `7fc4ebc54c8467011bda8a52cbd5306e`，请求 SHA-256 `cfcc020d9e4bb8bf86068866b40acdd893a8afa88f30eef503840e4c73439f71`，北京时间 2026-10-11 05:16:53 到期，仍为 `noop_already_saved`；尚未执行。

该预览于 2026-10-11 05:10 至 05:11 执行一次。备份、`noop_already_saved`、58 项固定读回、`SAVE_VERIFIED`、正常退出、退出码 0、`shutdown_closed` 和端口释放均通过；随后在单次空 Revit 启动的 OS helper 核验中停止。根因是监督器持有 `local-test-copy-supervisor.lock` 的互斥句柄时，helper 使用 `ReadAllBytes` 读取同一锁文件，Windows 共享规则返回 `os_inspection_failed`（PowerShell 第 160 行），因此终态为 `STOPPED`、`launchOutcome=unknown`。没有 `launch-observed`、continuation 或打开动作，没有第二个 Revit 启动证据，也没有模型写入。该 operation 永久不可重试。

已修复启动器竞态：互斥锁仍由监督器以打开句柄持有；获得锁后另写一个已关闭的 `lifecycle-<operationId>-supervisor-lease.json` 供 helper 读取，退出或失败时与锁文件一起清理。监督器回归为 60 项（59 通过、1 项环境跳过），PowerShell 语法检查通过。修复后必须在用户人工恢复并重新打开同一测试副本后重新 `Prepare`，取得新的具体批准；不得复用本次已停止的 operation。

用户随后报告已重启并打开副本。只读加载核验通过：MVID `24cb2862-77a4-491c-adcb-5fe2e493b4a1`、29 项固定配方、保存范围和 RVT 摘要一致，未发生写入、计划创建、生命周期预览或动作。新的 `Prepare` 生成 operationId `2d80cae3e36ad798674b23111fa60d7b`，request SHA-256 `9228226b5deca8c417546f4577f67506eeb57def7a29fab9509fcbe06b13bdda`，北京时间 2026-10-11 20:33:16 到期，绑定 PID `26220`、文档 identity `e7547203e3713868aca160b14046350d`、revision `0`、`isModified=false` 和稳定 RVT 摘要；`saveAction=noop_already_saved`。该预览尚未执行，需用户单独确认。

用户于 2026-10-11 20:42:57（北京时间）确认执行该 operation，但预览已于 20:33:16 到期。监督器在保存、退出、启动和打开之前以 `lifecycle_supervisor_rejected` 永久停止；没有动作标记或 Revit 副作用，当前会话保持打开。该 operation 不可续期或重试，需重新生成预览并在十分钟有效窗口内确认。

随后在当前仍打开的会话上重新执行只读 `Prepare`，生成 operationId `5823fbbb45c81a063bb4ba005ba20cab`，request SHA-256 `ba79d0a1eb465d47283aadabe17c1077a7edbf625c9f0d79bc256c62e73c47f6`，北京时间 2026-10-11 20:56:25 到期；`recipeCount=29`、`saveAction=noop_already_saved`。该新预览尚未执行，需单独确认。

该 operation 于 2026-10-11 20:48 至 20:51 执行一次。备份、保存读回、正常退出、关闭事件、端口释放和原文件摘要均通过；新 Revit 启动后未完成插件握手即崩溃，监督器终态为 `STOPPED / lifecycle_supervisor_rejected`，没有打开副本证据。Revit Journal `journal.0066.txt` 记录授权初始化完成后出现 `VendorCode 22: Unable to connect with a Licensing component`；Autodesk Licensing Service 日志记录授权 Agent 30 秒连接超时。该证据指向本机授权组件连接故障，不是 RVT 写入或许可证文件被删除。已在 2026-10-11 21:00（北京时间）只重启 `AdskLicensingService`，状态恢复为 `Running / Automatic`。本 operation 不可重试，需手动启动 Revit 验证许可证后重新生成预览。

operation `b7bd7c51266d64598a8097449c096223` 随后执行一次：备份、保存读回、正常退出和旧进程退出均通过；新 Revit 启动阶段再次出现 `VendorCode 22`，未完成握手，监督器以 `STOPPED / lifecycle_supervisor_rejected` 终止。第二次 Journal `journal.0068.txt` 同样记录 `License initialization complete` 后 30 秒授权组件连接失败，且父进程仍为 `pwsh.exe`。该 operation 不可重试。为避免 PowerShell 子进程启动影响 Autodesk Licensing Agent，启动器已改为 `UseShellExecute=$true` 的 Windows ShellExecute；60 项监督器回归为 59 通过、1 项环境跳过，PowerShell 语法检查通过。修复后必须人工启动 Revit 并重新打开同一副本，再生成新的预览。

## 验证记录

最终 CoreTests、MCP 契约/监督器回归、实际 27.3 API 隔离编译、安装 CheckOnly 与具体构建申请复审结果在 `goal-progress.md` 记录。真实保存、自然退出、插件重载与固定文件打开在首次加载后分别验收。

2026-10-11 最终 CoreTests **255/255**，MCP **793 通过、0 失败、1 项实际端口烟测隔离**；隔离烟测另已通过。Revit 27.3 API 编译 **0 警告/0 错误**、CheckOnly、新 fresh baseline及具体申请独立复核通过。普通全量默认不启动真实 CIM 烟测；单独设置 `REVIT_LIFECYCLE_OS_SMOKE=1` 可运行该只读环境核验，生产 helper 15 秒预算保持不变。
