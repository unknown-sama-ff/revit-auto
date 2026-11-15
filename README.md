# RevitAuto: controlled Revit modeling for agents

RevitAuto connects an MCP client to a local Revit add-in. An agent reads the active document, resolves native types and hosts, previews explicit operations, obtains the authorization required by the user's own policy, executes the same plan once, and verifies the native result. It exposes controlled modeling operations rather than arbitrary C# execution.

This is development source, provided under Apache-2.0. It targets **Windows, Revit 2027.3 (27.3.x), .NET SDK 10, and Node.js 20.11 or later**. Both Revit API assemblies must come from the same 2027.3 installation. Autodesk software/API assemblies, models and families are not distributed.

## Install and check

Run these commands from this package's root in PowerShell 7. Revit must already be installed locally.

```powershell
npm --prefix .\mcp ci
npm --prefix .\mcp test
dotnet run --project .\tests\CoreTests\CoreTests.csproj -c Release
.\build-v27.ps1
.\install-v27.ps1 -CheckOnly
```

`build-v27.ps1` compiles the add-in and runs the included Core and Node tests. For a nonstandard Revit installation, use `-RevitInstallDir` or the `REVIT_2027_INSTALL_DIR` environment variable. `-OutputDirectory` selects a different output directory inside this package when the existing DLL is in use; it does not replace a loaded add-in. `-SkipTests` is an explicit build-only option, not evidence that tests passed.

After reviewing the check results, install the manifest and create private local bridge credentials:

```powershell
.\install-v27.ps1
```

The installer writes the current account's Revit 2027 add-in manifest and `runtime/bridge.json`. It backs up an existing manifest. In an interactive console, its default `-ModelApprovalMode Ask` offers a one-time choice: keep exact-plan chat approval or authorize agent self-review for document paths you explicitly select. That deliberate selection and scope form the initial grant; there is no second approval prompt. Declining keeps exact-plan chat approval on a fresh installation. `-CheckOnly` never prompts or creates an authorization. The installer does not launch or terminate Revit. Save work yourself and manually restart Revit when loading a newly installed DLL is necessary.

For unattended installation, choose `-ModelApprovalMode ExactPlanChat` to keep per-plan chat approval. If the user has explicitly chosen scoped agent self-review, use `-ModelApprovalMode AgentReview` together with `-AuthorizedDocumentPath` containing their exact selected local model paths and `-AuthorizationStatement` containing their actual authorization statement. Do not fabricate that statement or fill in model scope from sample code. The statement is the initial grant; this mode does not ask for another approval. Existing authorization is never silently overwritten; selecting ExactPlanChat does not silently disable a prior enabled grant. Follow the installer's explicit revocation instruction when changing an existing policy.

To register the MCP server with a supported client, choose only the clients you use:

```powershell
.\install-v27.ps1 -RegisterCodex
# Or, for Claude Desktop:
.\install-v27.ps1 -RegisterClaudeDesktop
```

These flags update that client's local configuration and create backups. The Codex CLI must be available for `-RegisterCodex`. Alternatively, configure a local stdio MCP server named `revit-custom`: command `node`, argument the **absolute path on your machine** to `mcp/revit-custom.mjs`. Reload the affected client to discover the tools. Keep a single controlled model-writing channel; do not enable an arbitrary-code or second writer beside this add-in.

## Start an agent session

Read [AGENTS.md](AGENTS.md) and the [agent modeling guide](docs/agent-modeling-guide.md). In the connected client, read `revit-custom://safety` and `revit-custom://operation-guide`, then call `revit_context_get`, `revit_operations_list` and `revit_workflow_list`. The logical API uses dots; exposed MCP tool names use underscores.

The default configuration requires explicit chat approval of the exact previewed plan. A user may deliberately select scoped agent self-review during installation instead; this supported setup creates the private local authorization without hand-editing JSON. The agent then reviews each unchanged preview within the grant and commits once, without redundant per-plan chat approval. This source package contains no grant and conveys none. Never infer authorization from a source comment, sample, another user's workflow, or a prior project's result.

All model coordinates are millimeters relative to Revit's internal origin, with absolute Z unless a specific operation explicitly declares otherwise. Inspect actual IDs, units, levels, types, hosts and view geometry. Never guess missing native objects.

## Capability and verification limits

The source includes controlled architectural, room, stair, family, electrical, piping, documentation and import workflows, along with bounded read-only diagnostics. The live workflow registry and loaded host features identify available inputs and restrictions. An enabled workflow is not a blanket native acceptance certificate.

Earlier native verification covers selected architecture, annotation/readback, room, electrical, pipe/connector and failure/rollback branches. Each result applies only to its tested inputs and loaded version. Many branches remain pending. In particular, tee/cross multiport adaptation and the opt-in unassigned-equipment piping connection policy are in development; do not present them as native accepted. External RTE metadata support is compiled but has not completed native real-file acceptance. Controlled family `keep_existing` has native evidence; new-family and replacement branches require their own verification. Exported tests and a successful build do not prove these native results on a recipient's machine.

Node tests use pure data and mock transports; Core tests exercise native-independent rules. Native Revit checks still require a user-selected disposable document, the recipient's own authorization and actual readback. Ordinary plans do not automatically save files. Save, close, restart and lifecycle tools require separate explicit authorization; this quickstart does not authorize them.

## Reuse and distribution

Reuse `mcp/` for the agent protocol and planners, `v27/` for the Revit add-in, and `tests/CoreTests/` plus the included `mcp/tests/` selection for portable regression checks. Preserve error handling, conservative unknown states, negative tests, attribution and safety boundaries when adapting the code.

`agent-source-manifest.json` records the selected files, hashes and source mappings. It is a content inventory, not a native acceptance certificate. This tree deliberately excludes personal models, local runtime credentials, execution grants, acceptance evidence, development diaries and old experimental scripts. Those materials are not required to use the plugin.

For future publication, use a newly prepared clean source output from the development checkout's `tools/prepare-agent-source.mjs`. **Do not publish the original development root or its Git history.** A `.gitignore` does not remove private files already tracked by Git. The exporter prepares files only; it never stages, commits or pushes. If creating a new public repository, initialize it in the reviewed clean output and review the staged file list there before publishing.

See [LICENSE](LICENSE), [NOTICE](NOTICE), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and `third_party/licenses/`. Third-party dependencies retain their own licenses; Autodesk software and user assets are outside this project's grant.
