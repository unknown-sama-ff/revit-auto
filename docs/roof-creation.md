# Footprint roofs

`architecture.roofs` accepts a `roofs` array of `create_footprint_roof` operations. Resolve an existing compound `roofTypeId` and an existing `levelId` from the active document. Supply one horizontal polygon with 3 to 128 straight edges. Points use absolute `xMm`, `yMm` and `zMm` and omit a repeated closing vertex.

`edgeSlopes` must have one rise/run ratio per edge in the same order. The first value applies to the edge between the first and second points. The final value applies from the last point back to the first. A value of zero turns off slope definition for that edge. A value of 0.5 represents one unit of rise over two units of run.

Preview reports the native level and the offset needed to reach the requested base elevation. The receipt checks the native base level and offset, the footprint in plan and the slope of each matched edge before and after transaction commit. Edge matching uses XY endpoints and accounts for reversed or reordered model curves.

The loaded host must provide `controlled-roof-creation`. The current contract covers one outline with an existing compound roof type. First native acceptance will verify the solid geometry and visual result. The implementation uses the Revit 2027.3 `NewFootPrintRoof` API and the project's existing horizontal profile rules. See [capability status](capability-status.md).
