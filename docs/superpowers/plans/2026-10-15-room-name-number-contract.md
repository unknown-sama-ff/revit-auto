# Room Name and Number Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require explicit, nonblank, unpadded JSON string values for both `name` and `number` when creating a Revit room, and write those exact values to the created room.

**Architecture:** Keep room geometry and boundary behavior unchanged. Enforce the same field contract in the MCP validator and native `PlanRules.Validate`, then make `ModelExecutor` assign the validated values unconditionally. Regression tests cover both validators; an isolated Revit 2027.3 build checks the executor integration without installing the plugin.

**Tech Stack:** Node.js built-in test runner, JavaScript ES modules, .NET 10, System.Text.Json, Revit 2027.3 API.

**Spec:** `docs/superpowers/specs/2026-10-15-room-name-number-contract-design.md`

## Global Constraints

- The MCP operation validator and native `PlanRules.Validate` require `name` and `number` as JSON strings containing non-whitespace text.
- Values with leading or trailing whitespace are rejected rather than silently normalized.
- The executor assigns both accepted values to the created Revit room.
- MCP validation mirrors the native .NET whitespace predicate: U+0085 is whitespace and U+FEFF is not.
- Room placement continues to use the existing explicit level and XY point; Revit derives the room boundary from the surrounding model.
- Do not add caller-supplied boundary polygons, automatic room numbering, inferred names, duplicate-number prequeries, tags, schedules, or other operations.
- This code change does not mutate a Revit model, register a plugin, save a model, or restart Revit; native Revit acceptance remains a later gate.
- Preserve all pre-existing worktree changes. Do not stage or commit whole modified files because they already contain unrelated edits.

---

### Task 1: Enforce the room identity contract in MCP

**Files:**
- Modify: `mcp/workflows.mjs:19-21,115`
- Modify: `mcp/tests/architecture-elements.test.mjs`
- Modify: `mcp/tests/validation.test.mjs:9` to keep its valid prior-reference fixture valid under the stricter contract.
- Modify: `mcp/tests/import-row-issues.test.mjs:59,132` to keep successfully mapped room operations valid under the stricter contract.
- Verify: `mcp/tests/workflow-registry.test.mjs:84-88`

**Interfaces:**
- Consumes: `validateOperations(operations)` and the existing `create_room` operation shape.
- Produces: `validateRoomIdentity(op)`, called by the `create_room` branch before returning from `validateOperations`.
- Reject missing, `null`, non-string, empty, whitespace-only, and leading/trailing-whitespace `name` or `number`; accept valid original strings unchanged.

- [x] **Step 1: Add the MCP regression test first**

Append a room fixture and one validator test to `mcp/tests/architecture-elements.test.mjs`:

```js
const room = () => ({operationType:'create_room',levelId:311,xMm:1000,yMm:1000,zMm:0,name:'办公室',number:'101'});

test('room creation requires explicit nonblank unpadded name and number strings', () => {
  assert.doesNotThrow(() => validateOperations([room()]));
  for (const field of ['name','number']) {
    for (const value of [undefined,null,42,'','   ',' 101','101 ']) {
      const op=room();
      if (value===undefined) delete op[field];
      else op[field]=value;
      assert.throws(() => validateOperations([op]));
    }
  }
});
```

- [x] **Step 2: Run the focused test and verify it fails**

Run from `mcp/`:

```powershell
node --test tests/architecture-elements.test.mjs
```

Expected: the new test fails because `create_room` currently validates only coordinates.

- [x] **Step 3: Add the minimal MCP validator**

Add this helper beside `requireField()` in `mcp/workflows.mjs`, then call it from the `create_room` switch case before `point(op)`:

```js
function validateRoomIdentity(op) {
  for (const field of ['name','number']) {
    const value=op[field];
    if (typeof value!=='string' || value.trim().length===0 || value!==value.trim())
      throw new Error(`create_room: ${field} must be a nonblank string without leading or trailing whitespace.`);
  }
}
```

```js
case 'create_room': validateRoomIdentity(op); point(op); break;
```

- [x] **Step 4: Run MCP room tests**

Run from `mcp/`:

```powershell
node --test tests/architecture-elements.test.mjs tests/workflow-registry.test.mjs
```

Expected: the focused files pass, including the existing `architecture.rooms` adapter case with `办公室` and `101`, the valid earlier-level room reference with explicit identity fields, and successful table-import room mappings.

### Task 2: Enforce and apply the same contract in the native executor

**Files:**
- Modify: `v27/ProtocolTypes.cs:149-200,252-256`
- Modify: `v27/ModelExecutor.cs:462-466`
- Modify: `tests/CoreTests/Program.cs:54`

**Interfaces:**
- Consumes: native `PlanRules.Validate(JsonElement input)` and `JsonDefaults.Get(op, field)`.
- Produces: a private `PlanRules.RequireRoomIdentity(JsonElement op, string field)` helper. A missing property uses `missing_field`; a present property that is `null`, non-string, blank, or padded uses `invalid_room_identity`.
- `ModelExecutor` assigns `room.Name` and `room.Number` from the validated JSON strings without optional branches or normalization.

- [x] **Step 1: Update the valid native room test and add invalid cases**

Change the existing `prior level reference accepted` fixture to include `"name":"办公室","number":"101"`. Add a separate test using the same valid room operation and, for each field, assert `missing_field` for omission and `invalid_room_identity` for `null`, number, empty, whitespace-only, and padded strings. Use a fixture builder so each test case remains valid JSON:

```csharp
string RoomJson(string? name = "\"办公室\"", string? number = "\"101\"") =>
    "{\"operationType\":\"create_room\",\"levelId\":311,\"xMm\":10,\"yMm\":10" +
    (name is null ? "" : ",\"name\":" + name) +
    (number is null ? "" : ",\"number\":" + number) + "}";
foreach (var field in new[] { "name", "number" })
{
    Throws("missing_field", () => PlanRules.Validate(Json("[" + RoomJson(field == "name" ? null : "\"办公室\"", field == "number" ? null : "\"101\"") + "]")));
    foreach (var replacement in new[] { "null", "42", "\"\"", "\"   \"", "\" 101\"", "\"101 \"" })
        Throws("invalid_room_identity", () => PlanRules.Validate(Json("[" + RoomJson(field == "name" ? replacement : "\"办公室\"", field == "number" ? replacement : "\"101\"") + "]")));
}
```

- [x] **Step 2: Run CoreTests and verify the new assertions fail**

Run from the repository root:

```powershell
dotnet run --project tests/CoreTests/CoreTests.csproj
```

Expected: the new malformed-value assertions fail because the current native room branch accepts missing and malformed identity fields.

- [x] **Step 3: Add native validation and make execution explicit**

Add `RequireRoomIdentity` to `PlanRules` and call it from the existing `create_room` case:

```csharp
private static void RequireRoomIdentity(JsonElement op, string field)
{
    if (!op.TryGetProperty(field, out var value))
        throw new BridgeException("missing_field", $"create_room: {field} is required.");
    var text = value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    if (text is null || string.IsNullOrWhiteSpace(text) || !string.Equals(text, text.Trim(), StringComparison.Ordinal))
        throw new BridgeException("invalid_room_identity", $"create_room: {field} must be a nonblank string without leading or trailing whitespace.");
}
```

```csharp
case "create_room": RequireRoomIdentity(op, "name"); RequireRoomIdentity(op, "number"); Point(op); break;
```

In `ModelExecutor`'s `create_room` branch, replace the two conditional assignments with:

```csharp
room.Name = JsonDefaults.String(op, "name")!;
room.Number = JsonDefaults.String(op, "number")!;
```

- [x] **Step 4: Run CoreTests and verify they pass**

Run:

```powershell
dotnet run --project tests/CoreTests/CoreTests.csproj
```

Expected: all CoreTests pass, including valid earlier-level references and all invalid room identity cases.

### Task 3: Verify combined regression suite and isolated Revit API build

**Files:**
- Verify: `mcp/tests/*.test.mjs`
- Verify: `tests/CoreTests/CoreTests.csproj`
- Verify: `v27/RevitAutoV27.csproj`

**Interfaces:**
- Consumes: the completed MCP validator, native plan validator, and explicit executor assignments.
- Produces: a passing full regression suite and a versioned isolated plugin DLL. This task does not install or register the DLL.

- [x] **Step 1: Run the full MCP suite**

Run from `mcp/`:

```powershell
npm test
```

Expected: all MCP tests pass.

- [x] **Step 2: Build to a fresh versioned output directory**

From the repository root, choose a new timestamped directory for this build and pass it to the guarded build script:

```powershell
$output = 'bin/Release/room-name-number-contract-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
./build-v27.ps1 -SkipTests -RevitInstallDir 'D:/revit 2027/Autodesk/Revit 2027' -OutputDirectory $output
```

Expected: the script validates the installed Revit 2027.3 API and writes `RevitAutoV27.dll` under the new output directory. The full MCP/CoreTests suites have already run in Steps 1 and 2, so `-SkipTests` avoids running them twice. If that exact directory already exists or the build fails because of a locked output, stop and choose a new timestamped directory; do not close Revit or retry over an existing DLL.

- [x] **Step 3: Inspect only the intended diff and verify no installation occurred**

Run:

```powershell
git diff --check
git diff -- mcp/workflows.mjs mcp/tests/architecture-elements.test.mjs v27/ProtocolTypes.cs v27/ModelExecutor.cs tests/CoreTests/Program.cs
```

Expected: changes are limited to the room identity validator, direct name/number assignments, and focused tests. The build script reports no plugin installation or Revit restart. Do not register the DLL or perform Revit model acceptance as part of this implementation plan.

### Review follow-up: Align Unicode whitespace semantics

The final read-only review found that JavaScript `String.prototype.trim()` and .NET `string.IsNullOrWhiteSpace` disagree for U+0085 and U+FEFF. The validators now use the explicit .NET whitespace set in MCP and cover both edge cases in MCP and CoreTests.

- [x] Add U+0085 rejection and U+FEFF acceptance cases to both validator suites.
- [x] Replace MCP `trim()` semantics with the explicit .NET-compatible whitespace predicate.
- [x] Re-run focused MCP tests, CoreTests, and the full MCP suite.
