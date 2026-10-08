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
