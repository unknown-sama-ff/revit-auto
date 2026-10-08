# Revit 2027 portable build and installation

This repository does not redistribute Autodesk binaries. A local Revit 2027.3 (27.3.x) installation is required to compile the add-in.

## Build from any working directory

From the repository root:

```powershell
.\build-v27.ps1 -RevitInstallDir 'C:\Program Files\Autodesk\Revit 2027'
```

If Revit is installed elsewhere, pass its directory explicitly. The directory must contain both `RevitAPI.dll` and `RevitAPIUI.dll`, and both must report Revit 2027.3 or later in the 2027 series.

```powershell
$repo = 'C:\src\revit-auto'
& "$repo\build-v27.ps1" `
  -RevitInstallDir 'D:\revit 2027\Autodesk\Revit 2027' `
  -OutputDirectory 'v27\bin\Release\net10.0-windows-release-stage'
```

`-OutputDirectory` is optional and must remain inside the repository. Use a unique staging directory when Revit is running; the build never closes Revit or retries over a locked DLL. `-SkipTests` only skips automated tests, not API validation.

The same API directory can be supplied through `REVIT_2027_INSTALL_DIR`. The default fallback is `%ProgramW6432%\Autodesk\Revit 2027`.

## Verify a clean clone before installation

The check-only path does not create `runtime`, write the Revit manifest, alter Codex/Claude configuration, or create credentials:

```powershell
& .\install-v27.ps1 -CheckOnly -AssemblyPath '.\v27\bin\Release\net10.0-windows-release-stage\RevitAutoV27.dll'
```

A normal installation uses the default project output, or an explicitly selected assembly within the repository:

```powershell
& .\install-v27.ps1 `
  -AssemblyPath '.\v27\bin\Release\net10.0-windows-release-stage\RevitAutoV27.dll' `
  -RegisterCodex -RegisterClaudeDesktop
```

The installer creates a machine-local `v27\RevitAutoV27.addin` from the tracked `v27\RevitAutoV27.addin.example` template. The generated manifest and bridge credentials are ignored by Git. Existing Revit 2025 files are not changed.

After installation, restart Revit 2027 and Claude/Codex manually only after saving work. This repository does not automatically close applications, save RVT files, or expose a model over the public network.

## Release boundary

- Autodesk Revit API assemblies remain machine dependencies and are never packaged.
- `runtime\bridge.json`, local family catalogs, models, acceptance records, and assistant credentials remain private.
- The public MCP entry point is the controlled `revit-custom` stdio server; arbitrary C# and `.csx` execution is not part of the release interface.
- A successful build or check-only run proves packaging prerequisites, not native Revit business acceptance. Native workflow claims require the acceptance records described in `docs/goal-progress.md`.

## Continuous integration

每次推送到 `main` 或创建 Pull Request 时，GitHub Actions 会在 Windows/Linux 上运行 MCP 契约测试、.NET 核心安全测试和仓库卫生检查。CI 不编译 Revit 插件本体，因为 Autodesk Revit API DLL 不能随仓库分发；带有本机 Revit 2027.3 的 Windows 环境仍需按上面的可移植构建命令做发布候选构建。

仓库卫生检查仅检查当前 Git 跟踪的路径及新版部署入口，不是完整的密钥、内容或 Git 历史扫描。旧版生成的 `audit.json`、`preflight.json` 已停止跟踪，本地文件保留；历史提交可能仍包含报告或项目细节。仓库公开前必须另行审查历史及文档中的私有验收内容，不能仅凭这项检查宣布可公开。

## 2026-10-08 验证记录与剩余边界

- 发布入口改动提交：`222880d`；跨平台 CI/资产门禁提交：`e25819c`。
- 本机 Revit API 27.3.0.28 的独立暂存构建：0 警告、0 错误。暂存 DLL 未安装到当前 Revit。
- 工作区完整测试：144 项核心测试、307 项 MCP 测试通过。
- 独立源码克隆重新安装依赖，从 `mcp` 目录调用仓库构建脚本：144 项核心测试、304 项 MCP 测试通过，3 项依赖私有原生捕获的测试显式跳过；构建与安装检查不依赖原仓库的私有配置。
- 干净克隆 `install-v27.ps1 -CheckOnly` 通过，未创建 `runtime` 或生成 `.addin`。这属于同一台开发机上的独立源码验证，不是独立 Windows 机器的安装认证。
- GitHub Actions run `37775132193`：Windows/Linux 的契约测试和仓库卫生共 4 个任务全部成功；云端使用 Node 22 和 .NET 10，未启动 Revit。

以上不是稳定版发布承诺。功能矩阵逐项原生验收、实际安装/双客户端联调、Claude Code 启动入口的干净包核验、仓库历史隐私检查以及许可证仍待完成。新增变更收据与楼梯清理证据能力只有源码/暂存构建验证，尚未在运行中的 Revit 插件上验收；本轮没有模型写入或应用重启。

### Claude Code 便携式入口进展

`start-claude-2027.ps1` 已按包位置生成专用配置，不再要求开发机绝对路径。源码模板只有单一 `revit-custom`；只检查模式无配置写入，正常启动不改全局配置、不添加权限绕过、不重试客户端失败。新增 17 项启动器测试及本机 Claude Code 2.1.292 配置检查通过，完整测试为 144 核心 + 324 MCP。实际客户端工具发现仍须真实会话验收；详见 `docs/claude-code.md`。

### 固定上下文的通用审计

通用 `audit` 工作流已修复忽略 identity/revision 的缺口：校验嵌套输入与报告来源，查询前后检查项目、revision、路径和保存状态，变化时拒绝报告、不自动重试。新增 17 项公开 MCP 契约用例，完整 MCP 测试 341 项通过；直接无参数审计保持兼容。

实际 SDK/stdio 只读核验通过，identity/revision/isModified/元素统计均不变，直接接口与工作流的原生集合内容一致，只有端口顺序变化。结果保留未知/截断，并明确不验证工程合规、磁盘持久性或完整专业审计对等；详见 `docs/model-audit.md`。本轮没有修改 Revit DLL 或模型。

### 原生 UI 快照与电气审计迁移（2026-10-08）

新增 NativeReadSnapshot 在 UI API 上下文内冻结审计结果；通用 Audit 的延迟警告、标记枚举和 context 选择集已物化。新增 `revit.electrical.audit`、`electrical.audit` / `audit.electrical`，迁移旧版类别统计/警告、回路号/负载名/配电箱、终端成员及参数读取，具有原生/桥接能力门禁、范围/总预算/时间/响应大小限制及未知值披露。

最终独立暂存目录为 `v27/bin/Release/net10.0-windows-v27-electrical-audit-final-stage-20261008/`，Revit 27.3.0.28 API 编译 0 警告、0 错误；153 项核心测试、361 项 MCP 测试通过。安装只检查流程通过，不修改 runtime 或插件清单。

实际 SDK 对当前旧运行插件核验：新电气审计在方法转发前被 feature_not_loaded 拒绝，identity/revision/isModified/路径/元素统计不变，没有创建/提交计划。**新 DLL 没有部署，新原生审计尚未实机验收**；此门禁拒绝证据不是电气审计成功证据。业务对等及发布目标继续保持未完成，详见 docs/electrical-audit.md。

电气审计提交 `a6ea542` 的 GitHub Actions run `37788809856` 已完成：Windows/Linux 契约测试及发布卫生共 4 个任务全部成功。独立源码克隆重新构建为 0 警告、0 错误，358 项 MCP 测试通过、3 项私有捕获测试显式跳过；153 核心测试通过。最终暂存 DLL 与独立克隆的安装只检查均通过，未创建私有 runtime、更新安装清单或启动/重启应用。这是构建与发布门禁证据，不是新原生业务验收。

### 受控洞口工作流（2026-10-08）

新增 `openings.create`，与旧版 `architecture.openings` 的门窗能力分离。支持显式 wall rectangle、floor/roof/ceiling profile 和 shaft 三种 `Document.NewOpening` 路径；加入完整 XYZ、宿主/标高存在性、平面/面积/自交/短边/容差、墙类型与位置、原生轮廓边段回读校验，以及宿主/竖井候选影响预览。模糊输入使用 ask，明确输入才生成预览，允许推断时保留 candidate-only；结构、防火、加固、净距和精确副作用不由插件认证。

洞口暂存版编译：Revit 27.3.0.28 API，0 警告、0 错误；157 项核心测试、372 项 MCP 测试通过。当前运行插件未部署 `native-opening`，因此墙/楼板/竖井的原生创建仍未验收；旧 `openings.csx` 的门窗实机证据不替代洞口验收。详见 `docs/openings.md`。

洞口提交 `7af50de` 的 GitHub Actions run `37794876557` 已完成，Windows/Linux 四项任务全部成功。独立源码克隆重新构建通过：157 核心测试、369 MCP 测试通过，3 项私有原生记录测试明确跳过；未创建 runtime。暂存安装只检查通过，当前旧运行插件的真实 SDK 请求在新洞口预览创建前被能力门禁拒绝，前后项目状态/元素统计不变。新洞口实际创建、回滚及原生副作用验收仍未完成，不用这些门禁测试替代业务验收。

### 显式楼梯类型与草绘平台（2026-10-08）

`architecture.stairs` 已升级为严格显式类型/几何契约：现有 stairTypeId、上下标高、总及每跑踢面数、踏面深度、完整水平路径 XYZ 和容差；none/automaticBetweenRuns/sketched 平台模式均不得静默互换。空楼梯在创建组件前绑定到审阅类型，仅修改新实例、不改类型定义。事务提交前和范围提交后核对原生类型、集合、数量、宽度、标高、路径及明确的平台轮廓；旧清理证据继续区分取消返回和可能已提交，不声称已回滚验证。

暂存构建 Revit 27.3.0.28 API 0 警告、0 错误；162 核心测试、384 MCP 测试通过。全量测试曾暴露取消夹具的定时器竞态，已改为确认模拟命令收到后取消并给等待设置上限；仅停止了已核实的本轮挂起 Node 测试进程，未停止 Revit/真实助手。新 DLL 未部署，新显式契约与草绘平台尚未原生实机验收；旧 none-only 验收记录只作为历史证据，不能为新契约背书。详见 `docs/stairs-explicit.md`。
