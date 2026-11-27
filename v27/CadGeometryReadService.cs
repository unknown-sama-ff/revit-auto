using System.Text;
using System.Text.Json;
using Autodesk.Revit.DB;

namespace RevitAutoV27;

// Strictly read-only extractor for Revit linked/imported CAD ImportInstance geometry.
// Unfolds nested CAD blocks via GeometryInstance.GetInstanceGeometry(), maps each primitive
// to its CAD layer name (GraphicsStyleCategory), optionally filters by layer/crop-box/view-crop,
// and optionally streams full geometry to a local geometry.jsonl file compatible with our 2D solver.
internal static class CadGeometryReadService
{
    private const int MaxRecursionDepth = 8;

    public static object Read(Document doc, JsonElement request, CancellationToken cancellation)
    {
        var input = CadGeometryReadRules.Parse(request);
        if (doc.GetElement(new ElementId(input.CadInstanceId)) is not ImportInstance cad || !cad.IsValidObject)
            throw CadGeometryReadRules.Invalid($"CAD ImportInstance {input.CadInstanceId} was not found in the active document.");

        var warnings = new List<string>();
        var crop = input.CropBounds;
        if (input.CropViewId is long cropViewId)
        {
            if (doc.GetElement(new ElementId(cropViewId)) is not View view || !view.IsValidObject)
                throw CadGeometryReadRules.Invalid($"cropViewId {cropViewId} is not an existing view.");
            crop = ResolveViewCropBoxMm(view, warnings);
        }

        var layerFilter = input.Layers is { Length: > 0 }
            ? new HashSet<string>(input.Layers, StringComparer.OrdinalIgnoreCase)
            : null;

        var typeElement = cad.GetTypeId() != ElementId.InvalidElementId ? doc.GetElement(cad.GetTypeId()) : null;
        var cadName = typeElement?.Name ?? cad.Name;

        var layerCounts = new Dictionary<string, int>(StringComparer.Ordinal);
        var countsByType = new Dictionary<string, int>(StringComparer.Ordinal);
        var primitives = new List<object>();
        var truncated = false;
        double minX = double.PositiveInfinity, minY = double.PositiveInfinity;
        double maxX = double.NegativeInfinity, maxY = double.NegativeInfinity;
        int matchedCount = 0;

        StreamWriter? jsonlWriter = null;
        int writtenJsonlCount = 0;
        try
        {
            if (input.OutputJsonlPath is { } outPath)
            {
                var dir = Path.GetDirectoryName(outPath);
                if (!string.IsNullOrWhiteSpace(dir)) Directory.CreateDirectory(dir);
                jsonlWriter = new StreamWriter(outPath, false, new UTF8Encoding(false));
            }

            using var options = new Options
            {
                IncludeNonVisibleObjects = false,
                ComputeReferences = false,
                DetailLevel = ViewDetailLevel.Fine
            };
            var rootGeom = cad.get_Geometry(options);
            if (rootGeom is null)
            {
                warnings.Add("ImportInstance returned null GeometryElement.");
            }
            else
            {
                WalkGeometry(
                    doc, rootGeom, 0, input, layerFilter, crop,
                    layerCounts, countsByType, primitives, jsonlWriter,
                    ref matchedCount, ref writtenJsonlCount, ref truncated,
                    ref minX, ref minY, ref maxX, ref maxY,
                    warnings, cancellation);
            }
        }
        finally
        {
            jsonlWriter?.Flush();
            jsonlWriter?.Dispose();
        }

        var (paged, hasMore) = LinksReadRules.Paginate(primitives, input.Offset, input.Limit);
        var extentsMm = double.IsFinite(minX) && double.IsFinite(maxX)
            ? new
            {
                min = new { xMm = Round2(minX), yMm = Round2(minY) },
                max = new { xMm = Round2(maxX), yMm = Round2(maxY) }
            }
            : null;

        return NativeReadSnapshot.Freeze(new
        {
            documentIdentity = RevitCommandRouter.Identity(doc),
            documentRevision = RevitCommandRouter.Revision(doc),
            readOnly = true,
            coordinateFrame = "Revit internal/project origin, millimeters",
            cadInstanceId = cad.Id.Value,
            uniqueId = cad.UniqueId,
            cadName,
            isLinked = cad.IsLinked,
            appliedCropMm = crop is { } c ? new { min = new { xMm = Round2(c.MinXMm), yMm = Round2(c.MinYMm) }, max = new { xMm = Round2(c.MaxXMm), yMm = Round2(c.MaxYMm) } } : null,
            extentsMm,
            totalMatchedPrimitives = matchedCount,
            truncated,
            maxPrimitives = input.MaxPrimitives,
            outputJsonlPath = input.OutputJsonlPath,
            writtenJsonlCount = input.OutputJsonlPath is not null ? (int?)writtenJsonlCount : null,
            countsByType,
            countsByLayer = layerCounts.OrderByDescending(kv => kv.Value).ToDictionary(kv => kv.Key, kv => kv.Value),
            offset = input.Offset,
            limit = input.Limit,
            hasMore,
            primitives = paged,
            warnings
        });
    }

    private static void WalkGeometry(
        Document doc,
        GeometryElement geom,
        int depth,
        CadGeometryReadInput input,
        HashSet<string>? layerFilter,
        CadCropBoxMm? crop,
        Dictionary<string, int> layerCounts,
        Dictionary<string, int> countsByType,
        List<object> primitives,
        StreamWriter? jsonlWriter,
        ref int matchedCount,
        ref int writtenJsonlCount,
        ref bool truncated,
        ref double minX, ref double minY, ref double maxX, ref double maxY,
        List<string> warnings,
        CancellationToken cancellation)
    {
        if (depth > MaxRecursionDepth)
        {
            warnings.Add($"Nested CAD block depth exceeded {MaxRecursionDepth}; deeper instances were skipped.");
            return;
        }

        foreach (var obj in geom)
        {
            cancellation.ThrowIfCancellationRequested();
            if (matchedCount >= input.MaxPrimitives)
            {
                truncated = true;
                return;
            }

            switch (obj)
            {
                case GeometryInstance instance:
                    var instanceGeom = instance.GetInstanceGeometry();
                    if (instanceGeom is not null)
                    {
                        WalkGeometry(
                            doc, instanceGeom, depth + 1, input, layerFilter, crop,
                            layerCounts, countsByType, primitives, jsonlWriter,
                            ref matchedCount, ref writtenJsonlCount, ref truncated,
                            ref minX, ref minY, ref maxX, ref maxY,
                            warnings, cancellation);
                    }
                    break;

                case GeometryElement nested:
                    WalkGeometry(
                        doc, nested, depth + 1, input, layerFilter, crop,
                        layerCounts, countsByType, primitives, jsonlWriter,
                        ref matchedCount, ref writtenJsonlCount, ref truncated,
                        ref minX, ref minY, ref maxX, ref maxY,
                        warnings, cancellation);
                    break;

                case Line line when input.IncludeLines && line.IsBound:
                {
                    var layer = ResolveLayer(doc, line);
                    Increment(layerCounts, layer);
                    if (layerFilter is not null && !layerFilter.Contains(layer)) break;

                    var p1 = line.GetEndPoint(0);
                    var p2 = line.GetEndPoint(1);
                    var x1 = JsonDefaults.InternalToMm(p1.X);
                    var y1 = JsonDefaults.InternalToMm(p1.Y);
                    var x2 = JsonDefaults.InternalToMm(p2.X);
                    var y2 = JsonDefaults.InternalToMm(p2.Y);
                    if (!double.IsFinite(x1) || !double.IsFinite(y1) || !double.IsFinite(x2) || !double.IsFinite(y2)) break;
                    if (crop is { } box && !CadGeometryReadRules.SegmentIntersectsCrop(x1, y1, x2, y2, box)) break;

                    ExpandExtents(x1, y1, ref minX, ref minY, ref maxX, ref maxY);
                    ExpandExtents(x2, y2, ref minX, ref minY, ref maxX, ref maxY);
                    Increment(countsByType, "LINE");
                    matchedCount++;

                    var rx1 = Round2(x1); var ry1 = Round2(y1);
                    var rx2 = Round2(x2); var ry2 = Round2(y2);
                    if (jsonlWriter is not null)
                    {
                        jsonlWriter.WriteLine(JsonSerializer.Serialize(new
                        {
                            t = "LINE",
                            l = layer,
                            p1 = new[] { rx1, ry1 },
                            p2 = new[] { rx2, ry2 }
                        }));
                        writtenJsonlCount++;
                    }
                    if (primitives.Count < input.Offset + input.Limit)
                    {
                        primitives.Add(new { type = "LINE", layer, p1 = new[] { rx1, ry1 }, p2 = new[] { rx2, ry2 } });
                    }
                    break;
                }

                case PolyLine poly when input.IncludePolylines:
                {
                    var layer = ResolveLayer(doc, poly);
                    Increment(layerCounts, layer);
                    if (layerFilter is not null && !layerFilter.Contains(layer)) break;

                    var coords = poly.GetCoordinates();
                    if (coords is null || coords.Count < 2) break;

                    var pts = new List<double[]>(coords.Count);
                    double bMinX = double.PositiveInfinity, bMinY = double.PositiveInfinity;
                    double bMaxX = double.NegativeInfinity, bMaxY = double.NegativeInfinity;
                    var valid = true;
                    foreach (var pt in coords)
                    {
                        var x = JsonDefaults.InternalToMm(pt.X);
                        var y = JsonDefaults.InternalToMm(pt.Y);
                        if (!double.IsFinite(x) || !double.IsFinite(y)) { valid = false; break; }
                        if (x < bMinX) bMinX = x; if (x > bMaxX) bMaxX = x;
                        if (y < bMinY) bMinY = y; if (y > bMaxY) bMaxY = y;
                        pts.Add([Round2(x), Round2(y)]);
                    }
                    if (!valid) break;
                    if (crop is { } box && !CadGeometryReadRules.BoxIntersectsCrop(bMinX, bMinY, bMaxX, bMaxY, box)) break;

                    ExpandExtents(bMinX, bMinY, ref minX, ref minY, ref maxX, ref maxY);
                    ExpandExtents(bMaxX, bMaxY, ref minX, ref minY, ref maxX, ref maxY);
                    var closed = pts.Count >= 3 &&
                        Math.Abs(pts[0][0] - pts[^1][0]) <= 0.5 &&
                        Math.Abs(pts[0][1] - pts[^1][1]) <= 0.5;
                    if (closed && pts.Count > 3) pts.RemoveAt(pts.Count - 1);

                    Increment(countsByType, "LWPOLYLINE");
                    matchedCount++;
                    if (jsonlWriter is not null)
                    {
                        jsonlWriter.WriteLine(JsonSerializer.Serialize(new
                        {
                            t = "LWPOLYLINE",
                            l = layer,
                            c = closed,
                            pts
                        }));
                        writtenJsonlCount++;
                    }
                    if (primitives.Count < input.Offset + input.Limit)
                    {
                        primitives.Add(new { type = "LWPOLYLINE", layer, closed, pts });
                    }
                    break;
                }

                case Arc arc when input.IncludeArcs:
                {
                    var layer = ResolveLayer(doc, arc);
                    Increment(layerCounts, layer);
                    if (layerFilter is not null && !layerFilter.Contains(layer)) break;

                    var cx = JsonDefaults.InternalToMm(arc.Center.X);
                    var cy = JsonDefaults.InternalToMm(arc.Center.Y);
                    var r = JsonDefaults.InternalToMm(arc.Radius);
                    if (!double.IsFinite(cx) || !double.IsFinite(cy) || !double.IsFinite(r) || r <= 0) break;
                    if (crop is { } box && !CadGeometryReadRules.BoxIntersectsCrop(cx - r, cy - r, cx + r, cy + r, box)) break;

                    ExpandExtents(cx - r, cy - r, ref minX, ref minY, ref maxX, ref maxY);
                    ExpandExtents(cx + r, cy + r, ref minX, ref minY, ref maxX, ref maxY);
                    var isCircle = !arc.IsBound;
                    var typeTag = isCircle ? "CIRCLE" : "ARC";
                    Increment(countsByType, typeTag);
                    matchedCount++;

                    var rcx = Round2(cx); var rcy = Round2(cy); var rr = Round2(r);
                    if (isCircle)
                    {
                        if (jsonlWriter is not null)
                        {
                            jsonlWriter.WriteLine(JsonSerializer.Serialize(new { t = "CIRCLE", l = layer, p = new[] { rcx, rcy }, r = rr }));
                            writtenJsonlCount++;
                        }
                        if (primitives.Count < input.Offset + input.Limit)
                            primitives.Add(new { type = "CIRCLE", layer, center = new[] { rcx, rcy }, radiusMm = rr });
                    }
                    else
                    {
                        var sp = arc.GetEndPoint(0);
                        var ep = arc.GetEndPoint(1);
                        var a1 = Math.Atan2(sp.Y - arc.Center.Y, sp.X - arc.Center.X);
                        var a2 = Math.Atan2(ep.Y - arc.Center.Y, ep.X - arc.Center.X);
                        if (jsonlWriter is not null)
                        {
                            jsonlWriter.WriteLine(JsonSerializer.Serialize(new { t = "ARC", l = layer, p = new[] { rcx, rcy }, r = rr, a1 = Round4(a1), a2 = Round4(a2) }));
                            writtenJsonlCount++;
                        }
                        if (primitives.Count < input.Offset + input.Limit)
                            primitives.Add(new { type = "ARC", layer, center = new[] { rcx, rcy }, radiusMm = rr, startAngleRad = Round4(a1), endAngleRad = Round4(a2) });
                    }
                    break;
                }
            }
        }
    }

    private static CadCropBoxMm ResolveViewCropBoxMm(View view, List<string> warnings)
    {
        if (!view.CropBoxActive)
            warnings.Add($"View '{view.Name}' ({view.Id.Value}) does not have CropBoxActive=true; using its CropBox extents anyway.");
        var bb = view.CropBox ?? throw CadGeometryReadRules.Invalid($"View '{view.Name}' has no CropBox.");
        var tr = bb.Transform ?? Transform.Identity;
        double minX = double.PositiveInfinity, minY = double.PositiveInfinity;
        double maxX = double.NegativeInfinity, maxY = double.NegativeInfinity;
        double[] xs = [bb.Min.X, bb.Max.X];
        double[] ys = [bb.Min.Y, bb.Max.Y];
        double[] zs = [bb.Min.Z, bb.Max.Z];
        foreach (var x in xs)
            foreach (var y in ys)
                foreach (var z in zs)
                {
                    var p = tr.OfPoint(new XYZ(x, y, z));
                    var px = JsonDefaults.InternalToMm(p.X);
                    var py = JsonDefaults.InternalToMm(p.Y);
                    if (px < minX) minX = px; if (px > maxX) maxX = px;
                    if (py < minY) minY = py; if (py > maxY) maxY = py;
                }
        if (!double.IsFinite(minX) || maxX - minX < 1 || maxY - minY < 1)
            throw CadGeometryReadRules.Invalid($"View '{view.Name}' CropBox produced invalid XY bounds.");
        return new(minX, minY, maxX, maxY);
    }

    private static string ResolveLayer(Document doc, GeometryObject obj)
    {
        var styleId = obj.GraphicsStyleId;
        if (styleId == ElementId.InvalidElementId) return "0";
        return doc.GetElement(styleId) is GraphicsStyle gs && gs.GraphicsStyleCategory is { } cat && !string.IsNullOrWhiteSpace(cat.Name)
            ? cat.Name
            : "0";
    }

    private static void Increment(Dictionary<string, int> map, string key) =>
        map[key] = map.TryGetValue(key, out var c) ? c + 1 : 1;

    private static void ExpandExtents(double x, double y, ref double minX, ref double minY, ref double maxX, ref double maxY)
    {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
    }

    private static double Round2(double v) => Math.Round(v, 2);
    private static double Round4(double v) => Math.Round(v, 4);
}
