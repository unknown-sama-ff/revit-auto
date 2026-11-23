# Optional native DWG export

Use `tools/export-dwg-native.ps1` when an agent needs a local read-only DWG inventory and Autodesk Core Console is already installed and licensed. This standalone CLI opens only a byte-identical, read-only task copy. It does not start GUI AutoCAD, save drawings, configure licensing/security/trusted paths/LISPSYS, convert the original, contact a new API or operate Revit. Keep `tools/native-dwg-readonly.lsp` beside the script.

## Optional MCP import adapter

The existing `imports.dwg_candidate` source path can invoke this CLI directly when the MCP process is explicitly configured with:

```text
REVIT_AI_DWG_EXPORTER=native-console
REVIT_AI_DWG_CONSOLE_PATH=C:\Program Files\Autodesk\AutoCAD 2022\accoreconsole.exe
```

No variable selects the existing COM exporter by default; `REVIT_AI_DWG_EXPORTER=com` also selects it explicitly. Unknown mode names fail. The native mode requires the console's absolute local executable path, its valid Autodesk signature and existing licensing/runtime prerequisites; it does not discover an installation, open GUI CAD or change licensing/security settings. The adapter accepts only the same resolved, permitted DWG input as the existing importer. `REVIT_AI_IMPORT_ROOTS`, the20MB input/output limit, explicit calibration, layer mappings and candidate-only workflow remain in effect. The source request schema has not gained broader path access.

Optional `REVIT_AI_DWG_TIMEOUT_SECONDS` is an integer1–120, default120. `REVIT_AI_IMPORT_ARTIFACTS_DIR` may select an explicit local artifact directory; default is the package `imports` directory. Every invocation creates a fresh `native-console-*` adapter directory with `adapter.json`, CLI logs and one CLI-owned native run. Runtime directories contain a DWG task copy and local evidence: retain them privately and exclude them from redistributed packages. No drawings, credentials, licenses or executable binaries are bundled by this adapter.

Acceptance ignores stdout paths/success words. It loads only the one owned run's fixed `manifest.json`, `export.json`, `source.dwg` and fixed log/native artifacts; checks their hashes/byte counts, source and copy SHA before/after, console exit0, non-timeout status, no save/write request, clean DBMOD and selected inventory counts. Native schema2 identity/type/layer and each known LINE XYZ must exactly match the normalized export, even if the two files have internally consistent hashes. It preserves every known LINE and explicitly unknown entity before passing normalized `{document,entities,extraction}` to the existing calibrated drawing-candidate mapper. Unmapped/unknown counts and mapped-geometry issues remain visible. The candidate workflow returns a bounded `sourceExtraction` summary for verified native-console sources, including retained manifest/state pointers and coverage/integrity evidence. Those fields do not certify whole-drawing decoding or Revit/model acceptance; candidate digest/approval handling is unchanged.

A native failure has no COM fallback and no automatic retry. Partial JSON is never candidate acceptance; failed manifests and logs remain at the reported artifact location. If cancellation was already requested, nothing starts. After starting, cancellation waits for the CLI's own fixed watchdog and exact-process cleanup before rejecting. Node does not kill the cleanup-owning PowerShell process or all CAD processes. The adapter waits at most the native timeout plus60seconds for CLI completion; exceeding this additional budget reports cleanup outcome unknown, preserves pointers and leaves native ownership cleanup with the CLI. A cancellation/error never claims cleanup success merely because a parent process ended.

```powershell
powershell.exe -NoProfile -File .\tools\export-dwg-native.ps1 `
  -SourcePath "C:\Drawings\input.dwg" `
  -ConsolePath "C:\Program Files\Autodesk\AutoCAD 2022\accoreconsole.exe" `
  -OutputDirectory "C:\Exports\dwg" -CheckOnly
```

Remove `-CheckOnly` to export. All three paths are explicit absolute local paths. Reparse points/network shares, an unknown DWG header, a missing companion file or a console without a valid Autodesk signature are refused. Source files and normalized outputs are limited to20MB. `-CheckOnly` reads metadata/header/hashes and verifies the signature; it creates no output, starts no process and does not test licensing or native readability.

An export refuses if AutoCAD/Core Console is already running. Each run creates `native-dwg-<unique-id>` under the supplied output directory and a unique `/isolate` profile. This task profile may receive normal Autodesk runtime state; the CLI does not edit the user's CAD settings. Runtime prerequisites include an existing valid license and LISPSYS1/2; an unsupported Unicode engine is reported without changing it or requesting restart.

`-TimeoutSeconds` accepts1–120 (default120). The console has no visible window, receives `/readonly`, and works only on the task copy marked ReadOnly. The extraction loop has an additional45-second/10000-entity budget. Cleanup verifies exact owned PID/start time/executable and can stop that process only; no global CAD cleanup or child/licensing process termination. Allow up to10 additional seconds for owned shutdown and raw-log draining. Failed native runs exit nonzero and retain `manifest.json`, raw logs and partial artifacts; failures before a run directory can be established report to stderr without a manifest. Preserve failed directories for diagnosis, rather than treating console exit0 as success.

Successful command stdout gives the manifest path. Its status `scoped-export-complete-review-logs` means automatic integrity/scope checks passed; agents must review complete warnings before accepting the intended scope. Files include:

- `manifest.json`: command, exact process ownership, timeout/exit/failure, original/copy/executable/LISP/artifact SHA256 values.
- `stdout.log`, `stderr.log`: untouched bytes; `console.decoded.log` is a convenience decode.
- `native.json`: selected ModelSpace inventory and per-entity owner330/BLOCK_RECORD,67,410 evidence; per-type/supported/unknown counts; LINE coordinate arrays.
- `export.json`: `{document,entities,extraction}` matching the existing JSON drawing-candidate input shape. LINE becomes `AcDbLine`, `start/end:{x,y,z}` and `coordinateSpace:'native-world-xyz'`; other types retain `nativeType`, identity/layer and `geometryUnknown:true` without invented geometry.
- `source.dwg`, `extract.scr`, `profile/`: owned input and reproducible invocation evidence. The tool preserves them; remove a completed run deliberately when its evidence is no longer needed. Its private source bytes/logs are not public deliverables.

The inventory covers only non-erased main graphical entities returned by `ssget X` with layout410=`Model`, including those on hidden/frozen layers. Every selected entity must share a verified `BLOCK_RECORD` named exactly `*Model_Space`; group67 must be absent(default0) or0 and410 must equal `Model`. Before/after counts and handles must match, DBMOD must remain0, and every emitted LINE has finite world XYZ. An empty selection is explicitly unsupported because this route cannot establish its owner; it fails rather than asserting an empty whole drawing.

Geometry is extracted for LINE only. All other types, including text, dimensions, polylines, arcs, hatches and INSERT/xref references, remain unknown geometry. Attributes/polyline vertices, nested block definitions, external xref contents, paper space, erased and non-graphical objects are excluded. A complete selected inventory is not the entire drawing/database or all geometry. Font replacement/missing-font warnings never validate text appearance. INSUNITS/INSBASE are observed insertion settings, not actual design scale or Revit alignment; the CLI does not calibrate or create candidates/model plans.

The default `.dwg` import path uses the existing active-COM exporter. The explicit native-console option described above reuses this CLI within the same permitted import roots and candidate-only workflow. Alternatively provide a reviewed `export.json` directly as JSON. Unknown mapped geometry produces an issue; it is not silently dropped or converted to default coordinates. A file outside the configured roots remains refused by the importer.

## Implementation review and verification

The implementation adapts a previously verified AutoCAD2022 Core Console/AutoLISP route, retaining `ssget`, `entget`, top-level330 parsing outside102 reactor groups, exact ModelSpace owner/layout validation, world-LINE data and read-only/process/hash safeguards. It replaces private target-handle/count/path assumptions with the first selected entity's verified owner, generic counts and explicit paths; preserves original native JSON; and normalizes LINE data to the existing importer contract. It adds finite log-drain handling, unique run/isolation identifiers, optional input-only checking and validation of normalized unknown semantics. The optional MCP adapter above reuses this CLI without changing its native extraction or ownership rules.

Portable Node tests parse PowerShell5.1 grammar on Windows, check LISP structure/safety constraints, validate good/bad synthetic inventories, exercise the actual drawing-candidate contract, and run CheckOnly with a mocked signature on inert fixture files. They do not start CAD. Run `node --test tools/tests/native-dwg-export.test.mjs`; PowerShell-dependent checks skip when that runtime is unavailable, and Windows-only checks skip elsewhere. Installation/signature checks alone are not a licensing/runtime test.

Verification on2026-11-16: the nine targeted tests passed with exit0 in both PowerShell7 and Windows PowerShell5.1, with no skipped tests and no CAD invocation. They include exact-process ownership mocks and an injected byte-copy IO failure that must preserve a failed manifest. The CLI uses .NET SHA256 directly, avoiding dependence on inherited PowerShell module-path availability for hashing; required Authenticode support is loaded from the current host's built-in security module if necessary.

The generalized CLI was then independently run once using an installed AutoCAD2022 console and a local DWG. All 410 selected entity identities/layers and 216 LINE world-XYZ pairs matched the prior scoped native extraction; 194 non-LINE geometries remained unknown. The normalized JSON preserved every identity and known coordinate, source/copy hashes and DBMOD remained unchanged, and the owned console exited normally. Missing-font/substitution warnings were retained. This accepts that file/version's inventory and LINE scenario, not every DWG, whole geometry, text appearance, design calibration or Revit import.

Official references:

- [Core Console switches and API limits](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-Core-Console/files/AUTOCAD_CORE_CONSOLE.html)
- [ssget selection scope](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-AutoLISP-Reference/files/GUID-0F37CC5E-1559-4011-B8CF-A3BA0973B2C3.htm)
- [Entity owner330,67,410 semantics](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-DXF/files/GUID-3610039E-27D1-4E23-B6D3-7E60B22BB5BD.htm)
- [entget and LINE world coordinates](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-AutoLISP/files/GUID-EF8C5586-BA1F-4EA6-BAD1-6BA792B601F0.htm)

The switch/API references are newer Autodesk documentation; they do not establish compatibility with every AutoCAD version, object enabler, application startup customization or license configuration.
