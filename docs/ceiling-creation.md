# Controlled ceiling creation

Selected ceiling types and levels cannot be changed or deleted in the same plan, and family loading cannot be mixed with this creation. Use a separate reviewed plan for those source changes; a stable UniqueId alone does not prove unchanged source parameters.

Status: offline implementation candidate for Revit 2027; native creation, rollback, persistence and visual acceptance are pending. Capability advertisement by a loaded host does not establish acceptance. The host must advertise `controlled-ceiling-creation` before a ceiling plan is requested.

`create_ceiling` creates a ceiling from one explicit horizontal polygon. It selectively adapts the `Ceiling.Create` and `CurveLoop` construction pattern from bimwright/rvt-mcp's `CreateSurfaceBasedElementHandler.cs`, fixed commit `b44ee0b8032f0603f8e52656bc05ab43aa599263`, blob `e8b66e4b089bd913bd183bbba70e2b91d1923e74`, Apache-2.0. See `THIRD_PARTY_NOTICES.md`. That upstream handler implements floor and ceiling creation; it provides no roof adapter.

## Operation contract

| Field | Contract |
| --- | --- |
| `operationType` | Required, exactly `create_ceiling`. |
| `ceilingTypeId` | Required, existing positive safe integer native `CeilingType` ID in the current document. |
| `levelId` | Required, existing positive safe integer native `Level` ID in the current document. |
| `boundary` | Required, 3–128 objects containing exactly `xMm`, `yMm`, `zMm`. All coordinates are explicit finite numbers, absolute value ≤ 100,000,000 mm. |
| `id` | Optional operation ID, 1–80 characters, no surrounding whitespace or control characters. |
| `dependencies` | Optional distinct operation ID array, at most 1,000 entries; an operation cannot depend on itself. Plan ordering/resolution is enforced by the shared executor. |

Other fields are rejected. New or deferred type/level references, inferred defaults, multiple loops, holes, curved segments, slope options and caller supplied offsets are unsupported. Select existing native IDs from current document readback. Creating a type or level requires a separate reviewed plan before its resulting ID is used here.

The boundary is a single horizontal simple polygon, with Z coordinates agreeing within 0.01 mm. Do not repeat the first point at the end. Edges must be at least 1 mm and must satisfy the current Revit application's `ShortCurveTolerance`. Duplicate vertices, self intersections/touches, redundant collinear turns, and area below 1 mm² are rejected. Native `BoundaryValidation.IsValidHorizontalBoundary` is an additional requirement; the adapter does not project or repair a rejected polygon.

Example operation below uses illustrative IDs; replace them with IDs read from the active document and use its current identity/revision when previewing the plan.

```json
{
  "operationType": "create_ceiling",
  "id": "ceiling1",
  "ceilingTypeId": 400001,
  "levelId": 400002,
  "boundary": [
    { "xMm": 0, "yMm": 0, "zMm": 6500 },
    { "xMm": 4000, "yMm": 0, "zMm": 6500 },
    { "xMm": 4000, "yMm": 3000, "zMm": 6500 },
    { "xMm": 0, "yMm": 3000, "zMm": 6500 }
  ]
}
```

## Elevation and preview

Coordinates use the Revit internal/project origin in millimeters. Boundary Z is absolute: the level's elevation is never added to it. The preview discloses selected native type/level identities, level `ProjectElevation`, absolute profile Z, complete boundary, segment count, expected signed area, and the exact offset to be applied: `heightOffsetMm = absoluteProfileZMm - levelProjectElevationMm`. For profile Z 6500 mm and project level elevation 4000 mm, the explicit offset is 2500 mm. Negative offsets and an explicitly derived zero are allowed.

The adapter sets native `CEILING_HEIGHTABOVELEVEL_PARAM` (Height Offset From Level) to that result. It does not assume the API's initial offset is zero or claim that input geometry certifies the native result. Any difference between the actual native sketch coordinates and the reviewed absolute profile causes verification to fail. Actual offset/sketch behavior still requires Revit 2027 acceptance.

## Execution and readback

The shared plan executor owns transactions, approval, document identity/revision, effect receipts and rollback. This adapter starts no transaction and performs no save. Creation captures the original operation, native document, element ID and `UniqueId`, selected type/level identities, level project elevation and new sketch ID.

Creation immediately regenerates and rereads the new element. The executor must call the same service's `VerifyCompleted` before transaction commit and after transaction commit. Each pass rereads type, level, actual native height offset and the complete actual `Sketch.Profile`. The sketch must belong to the created ceiling; it must contain exactly one loop of 3–128 bounded native `Line` segments. Every XYZ start/end, continuity, signed area and segment count is compared against the reviewed profile. Only cyclic rotation and complete reversal of loop order are accepted. Missing, non-finite, unavailable or unsupported evidence fails closed.

The bounded inspector returns `null` for unrelated element classes and `supported:false` for ceilings whose complete native evidence cannot be read within these bounds. A supported inspection is a profile/type/level/offset observation; it does not certify a solid or finish surface. Physical native entity, connections, all side effects, engineering compliance, persistence and visual verification remain false. No roof creation capability is implied.
