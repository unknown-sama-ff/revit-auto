using System.Text.Json;

namespace RevitAutoV27;

internal readonly record struct WallTopologyOrderKey(
    int OriginalIndex,
    string LevelKey,
    double BaseOffsetMm,
    int StructuralRank,
    int JoinEnabledRank,
    double PriorityHint,
    double LengthMm,
    double MinXMm,
    double MinYMm,
    double MaxXMm,
    double MaxYMm);

// Pure deterministic topological ordering for wall-creation batches.
// Primary structural / exterior / join-enabled / longer walls are created first,
// followed by interior partitions and join-disallowed short connectors/caps,
// reducing Revit auto-join priority conflicts and corner endpoint drift.
internal static class WallTopologyOrderRules
{
    public static List<JsonElement> ReorderOperationsSafely(IReadOnlyList<JsonElement> operations)
    {
        var result = new List<JsonElement>(operations.Count);
        var i = 0;
        while (i < operations.Count)
        {
            if (!IsReorderableWall(operations[i]))
            {
                result.Add(operations[i]);
                i++;
                continue;
            }

            var blockStart = i;
            var blockIds = new HashSet<string>(StringComparer.Ordinal);
            while (i < operations.Count && IsReorderableWall(operations[i]))
            {
                if (JsonDefaults.String(operations[i], "id") is { } id) blockIds.Add(id);
                i++;
            }
            var blockCount = i - blockStart;
            if (blockCount <= 1)
            {
                result.Add(operations[blockStart]);
                continue;
            }

            // Never reorder a contiguous wall block if any wall references an @id inside the same block.
            var hasInternalDependency = false;
            for (var k = blockStart; k < i; k++)
            {
                if (ReferencesAny(operations[k], blockIds))
                {
                    hasInternalDependency = true;
                    break;
                }
            }
            if (hasInternalDependency)
            {
                for (var k = blockStart; k < i; k++) result.Add(operations[k]);
                continue;
            }

            var keys = new List<WallTopologyOrderKey>(blockCount);
            for (var k = 0; k < blockCount; k++)
                keys.Add(BuildKey(blockStart + k, operations[blockStart + k]));

            keys.Sort(CompareKeys);
            foreach (var key in keys) result.Add(operations[key.OriginalIndex]);
        }
        return result;
    }

    // Multi-discipline (Architecture + Structure + MEP/Systems) safe DAG topological ordering.
    // Preserves every @id reference and explicit dependencies edge, keeps mutating/delete/move/load
    // operations as hard barriers, and deterministically orders creation/join/connect phases:
    // types -> levels -> grids -> foundations -> columns -> walls (structural/long first) ->
    // wall foundations -> beams (primary/long first) -> floors/ceilings/roofs -> openings/instances ->
    // join_geometry -> MEP straight runs (pipes/ducts/trays/conduits) -> fittings/connections ->
    // circuits/wires -> rebar/rooms -> documentation.
    public static List<JsonElement> ReorderBuildOperationsSafely(IReadOnlyList<JsonElement> operations)
    {
        var result = new List<JsonElement>(operations.Count);
        var i = 0;
        while (i < operations.Count)
        {
            if (!IsMultiDisciplineReorderable(operations[i]))
            {
                result.Add(operations[i]);
                i++;
                continue;
            }

            var blockStart = i;
            while (i < operations.Count && IsMultiDisciplineReorderable(operations[i])) i++;
            var count = i - blockStart;
            if (count <= 1)
            {
                result.Add(operations[blockStart]);
                continue;
            }

            var idToLocal = new Dictionary<string, int>(StringComparer.Ordinal);
            for (var k = 0; k < count; k++)
            {
                if (JsonDefaults.String(operations[blockStart + k], "id") is { } id)
                    idToLocal[id] = k;
            }

            var inDegree = new int[count];
            var dependents = new List<int>[count];
            for (var k = 0; k < count; k++) dependents[k] = [];

            // Preserve explicit @id and dependencies edges within the block.
            for (var k = 0; k < count; k++)
            {
                var deps = ExtractReferencedIds(operations[blockStart + k]);
                foreach (var depId in deps)
                {
                    if (idToLocal.TryGetValue(depId, out var depLocal) && depLocal < k)
                    {
                        dependents[depLocal].Add(k);
                        inDegree[k]++;
                    }
                }
            }

            var ready = new List<int>();
            for (var k = 0; k < count; k++)
                if (inDegree[k] == 0) ready.Add(k);

            var blockKeys = new BuildOrderKey[count];
            for (var k = 0; k < count; k++)
                blockKeys[k] = BuildMultiDisciplineKey(blockStart + k, k, operations[blockStart + k]);

            var ordered = new List<JsonElement>(count);
            while (ready.Count > 0)
            {
                ready.Sort((a, b) => CompareBuildKeys(blockKeys[a], blockKeys[b]));
                var next = ready[0];
                ready.RemoveAt(0);
                ordered.Add(operations[blockStart + next]);
                foreach (var child in dependents[next])
                {
                    if (--inDegree[child] == 0) ready.Add(child);
                }
            }

            // Safety fallback: if a cycle somehow existed (already prevented by PlanRules), preserve original order.
            if (ordered.Count != count)
            {
                for (var k = blockStart; k < i; k++) result.Add(operations[k]);
            }
            else
            {
                result.AddRange(ordered);
            }
        }
        return result;
    }

    private readonly record struct BuildOrderKey(
        int Phase,
        int LocalIndex,
        WallTopologyOrderKey? WallKey,
        BeamTopologyOrderKey? BeamKey);

    private readonly record struct BeamTopologyOrderKey(
        string LevelKey,
        double ZMm,
        int JoinEnabledRank,
        double PriorityHint,
        double LengthMm,
        double MinXMm,
        double MinYMm);

    private static bool IsMultiDisciplineReorderable(JsonElement op)
    {
        if (op.ValueKind != JsonValueKind.Object) return false;
        var kind = JsonDefaults.String(op, "operationType");
        return kind is
            "duplicate_type" or "duplicate_architecture_type" or "create_material" or "duplicate_material" or
            "create_level" or "create_grid" or
            "create_isolated_foundation" or "create_structural_column" or "create_wall" or
            "create_wall_foundation" or "create_structural_beam" or
            "create_floor" or "create_ceiling" or "create_footprint_roof" or
            "create_opening" or "create_family_instance" or "join_geometry" or
            "create_pipe" or "create_duct" or "create_cable_tray" or "create_conduit" or
            "create_fitting" or "connect_elements" or
            "create_circuit" or "create_wire" or
            "create_rebar_set" or "create_rebar_stirrup" or "create_room";
    }

    private static int DisciplinePhase(string? kind) => kind switch
    {
        "create_material" or "duplicate_material" or "duplicate_type" or "duplicate_architecture_type" => 0,
        "create_level" => 1,
        "create_grid" => 2,
        "create_isolated_foundation" => 3,
        "create_structural_column" => 4,
        "create_wall" => 5,
        "create_wall_foundation" => 6,
        "create_structural_beam" => 7,
        "create_floor" or "create_ceiling" or "create_footprint_roof" => 8,
        "create_opening" or "create_family_instance" => 9,
        "join_geometry" => 10,
        "create_pipe" or "create_duct" or "create_cable_tray" or "create_conduit" => 11,
        "create_fitting" or "connect_elements" => 12,
        "create_circuit" or "create_wire" => 13,
        "create_rebar_set" or "create_rebar_stirrup" or "create_room" => 14,
        _ => 15
    };

    private static BuildOrderKey BuildMultiDisciplineKey(int originalIndex, int localIndex, JsonElement op)
    {
        var kind = JsonDefaults.String(op, "operationType");
        var phase = DisciplinePhase(kind);
        WallTopologyOrderKey? wallKey = kind == "create_wall" ? BuildKey(originalIndex, op) : null;
        BeamTopologyOrderKey? beamKey = kind == "create_structural_beam" ? BuildBeamKey(op) : null;
        return new(phase, localIndex, wallKey, beamKey);
    }

    private static BeamTopologyOrderKey BuildBeamKey(JsonElement op)
    {
        var levelKey = op.TryGetProperty("levelId", out var lvl) ? lvl.ToString() : string.Empty;
        var (disStart, disEnd) = GeometryJoinRules.ResolveEndDisallow(op);
        var joinRank = (disStart ? 1 : 0) + (disEnd ? 1 : 0);
        var priorityHint = JsonDefaults.Double(op, "topologyPriority") ?? 0.0;
        var start = JsonDefaults.Get(op, "start");
        var end = JsonDefaults.Get(op, "end");
        var x1 = JsonDefaults.Double(start, "xMm") ?? 0.0;
        var y1 = JsonDefaults.Double(start, "yMm") ?? 0.0;
        var z1 = JsonDefaults.Double(start, "zMm") ?? 0.0;
        var x2 = JsonDefaults.Double(end, "xMm") ?? 0.0;
        var y2 = JsonDefaults.Double(end, "yMm") ?? 0.0;
        var z2 = JsonDefaults.Double(end, "zMm") ?? 0.0;
        var len = Math.Round(Math.Sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1)), 2);
        return new(levelKey, Math.Round((z1 + z2) * 0.5, 2), joinRank, priorityHint, len, Math.Round(Math.Min(x1, x2), 2), Math.Round(Math.Min(y1, y2), 2));
    }

    private static int CompareBuildKeys(BuildOrderKey a, BuildOrderKey b)
    {
        var cmp = a.Phase.CompareTo(b.Phase);
        if (cmp != 0) return cmp;
        if (a.WallKey is { } wa && b.WallKey is { } wb) return CompareKeys(wa, wb);
        if (a.BeamKey is { } ba && b.BeamKey is { } bb)
        {
            cmp = string.Compare(ba.LevelKey, bb.LevelKey, StringComparison.Ordinal);
            if (cmp != 0) return cmp;
            cmp = ba.ZMm.CompareTo(bb.ZMm);
            if (cmp != 0) return cmp;
            cmp = ba.JoinEnabledRank.CompareTo(bb.JoinEnabledRank);
            if (cmp != 0) return cmp;
            cmp = bb.PriorityHint.CompareTo(ba.PriorityHint);
            if (cmp != 0) return cmp;
            cmp = bb.LengthMm.CompareTo(ba.LengthMm);
            if (cmp != 0) return cmp;
            cmp = ba.MinXMm.CompareTo(bb.MinXMm);
            if (cmp != 0) return cmp;
            cmp = ba.MinYMm.CompareTo(bb.MinYMm);
            if (cmp != 0) return cmp;
        }
        return a.LocalIndex.CompareTo(b.LocalIndex);
    }

    private static HashSet<string> ExtractReferencedIds(JsonElement op)
    {
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var dep in JsonDefaults.Array(op, "dependencies"))
            if (dep.ValueKind == JsonValueKind.String && dep.GetString() is { } s) ids.Add(s);
        foreach (var prop in op.EnumerateObject())
        {
            if (prop.Name.EndsWith("Id", StringComparison.Ordinal) &&
                prop.Value.ValueKind == JsonValueKind.String &&
                prop.Value.GetString() is { } s && s.StartsWith('@'))
                ids.Add(s[1..]);
            else if (prop.Name.EndsWith("Ids", StringComparison.Ordinal) && prop.Value.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in prop.Value.EnumerateArray())
                    if (item.ValueKind == JsonValueKind.String && item.GetString() is { } itemStr && itemStr.StartsWith('@'))
                        ids.Add(itemStr[1..]);
            }
        }
        return ids;
    }

    public static int CompareKeys(WallTopologyOrderKey a, WallTopologyOrderKey b)
    {
        var cmp = string.Compare(a.LevelKey, b.LevelKey, StringComparison.Ordinal);
        if (cmp != 0) return cmp;
        cmp = a.BaseOffsetMm.CompareTo(b.BaseOffsetMm);
        if (cmp != 0) return cmp;
        // 1. Structural / exterior walls first (rank 0 before 1).
        cmp = a.StructuralRank.CompareTo(b.StructuralRank);
        if (cmp != 0) return cmp;
        // 2. Join-enabled walls first (0=both enabled, 1=single end disallowed, 2=both disallowed).
        cmp = a.JoinEnabledRank.CompareTo(b.JoinEnabledRank);
        if (cmp != 0) return cmp;
        // 3. Higher explicit priority/thickness hint first.
        cmp = b.PriorityHint.CompareTo(a.PriorityHint);
        if (cmp != 0) return cmp;
        // 4. Longer continuous spine walls first.
        cmp = b.LengthMm.CompareTo(a.LengthMm);
        if (cmp != 0) return cmp;
        // 5. Deterministic spatial tie-breakers.
        cmp = a.MinXMm.CompareTo(b.MinXMm);
        if (cmp != 0) return cmp;
        cmp = a.MinYMm.CompareTo(b.MinYMm);
        if (cmp != 0) return cmp;
        cmp = a.MaxXMm.CompareTo(b.MaxXMm);
        if (cmp != 0) return cmp;
        cmp = a.MaxYMm.CompareTo(b.MaxYMm);
        if (cmp != 0) return cmp;
        return a.OriginalIndex.CompareTo(b.OriginalIndex);
    }

    private static bool IsReorderableWall(JsonElement op) =>
        op.ValueKind == JsonValueKind.Object &&
        JsonDefaults.String(op, "operationType") == "create_wall";

    private static bool ReferencesAny(JsonElement op, HashSet<string> ids)
    {
        if (ids.Count == 0) return false;
        foreach (var dep in JsonDefaults.Array(op, "dependencies"))
            if (dep.ValueKind == JsonValueKind.String && ids.Contains(dep.GetString()!))
                return true;
        foreach (var prop in op.EnumerateObject())
        {
            if (prop.Name.EndsWith("Id", StringComparison.Ordinal) &&
                prop.Value.ValueKind == JsonValueKind.String &&
                prop.Value.GetString() is { } s && s.StartsWith('@') && ids.Contains(s[1..]))
                return true;
        }
        return false;
    }

    private static WallTopologyOrderKey BuildKey(int index, JsonElement op)
    {
        var levelKey = op.TryGetProperty("levelId", out var lvl) ? lvl.ToString() : string.Empty;
        var baseOffsetMm = JsonDefaults.Double(op, "offsetMm") ?? 0.0;
        var structuralRank = JsonDefaults.Bool(op, "structural") ? 0 : 1;
        var (disStart, disEnd) = GeometryJoinRules.ResolveEndDisallow(op);
        var joinRank = (disStart ? 1 : 0) + (disEnd ? 1 : 0);
        var priorityHint = JsonDefaults.Double(op, "topologyPriority") ?? 0.0;

        var start = JsonDefaults.Get(op, "start");
        var end = JsonDefaults.Get(op, "end");
        var x1 = JsonDefaults.Double(start, "xMm") ?? 0.0;
        var y1 = JsonDefaults.Double(start, "yMm") ?? 0.0;
        var x2 = JsonDefaults.Double(end, "xMm") ?? 0.0;
        var y2 = JsonDefaults.Double(end, "yMm") ?? 0.0;
        var lengthMm = Math.Round(Math.Sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1)), 2);

        return new(
            index, levelKey, Math.Round(baseOffsetMm, 2),
            structuralRank, joinRank, priorityHint, lengthMm,
            Math.Round(Math.Min(x1, x2), 2), Math.Round(Math.Min(y1, y2), 2),
            Math.Round(Math.Max(x1, x2), 2), Math.Round(Math.Max(y1, y2), 2));
    }
}
