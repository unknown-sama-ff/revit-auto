# Materials

`materials.create` accepts `materials`, `copies` and `assignments` arrays. Each row becomes a controlled operation in the existing Revit plan transaction. The loaded host must provide `controlled-material-creation` for creation or duplication and `controlled-material-assignment` for assignment.

| Operation | Required fields | Optional fields |
| --- | --- | --- |
| `create_material` | A new `name` | `materialClass`, `materialCategory`, `color` with integer `red`, `green`, `blue` from 0 through 255, and integer `transparency` from 0 through 100 |
| `duplicate_material` | A new `name` and an existing native `sourceMaterialId` | None |
| `assign_material` | An existing model instance `elementId`, an exact writable material reference `parameter`, and `materialId` | None |

Use distinct names. Creation applies the fields supplied. Duplication checks the source graphics and reports the actual pattern and asset links of the source and result. Shared asset links may remain after native duplication. Asset contents and rendered appearance require separate verification.

Assignment uses the exact name of a unique instance parameter or an explicit `BIP:` selector. It accepts an existing native material ID or an `@id` from material creation earlier in the same plan. Repeating an already-satisfied assignment reports a no-op. The scope covers instance material references and leaves compound layers and shared family types outside the operation.

`revit_material_quantities` requires `documentIdentity`, `expectedRevision` and 1 to 20 distinct `elementIds`. It requests non-paint materials for each specified element and reports the material ID, area in square meters and volume in cubic meters. A native zero is reported as zero. A failed or unavailable quantity is reported as null. Missing elements, unsupported categories and elements exceeding 64 materials have explicit statuses. The loaded host must provide `readonly-material-quantities`. The query covers the supplied IDs and excludes paint and aggregation across the model.

These capabilities are compiled for Revit 2027.3 and await native acceptance. The create, duplicate and quantity calls are adapted from bimwright/rvt-mcp under Apache-2.0. See [capability status](capability-status.md).
