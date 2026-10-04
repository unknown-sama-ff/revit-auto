using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace RevitAutoV27;

// Deterministic settings-only correction. Never creates/deletes model elements or changes the reference view.
internal static class ViewConfigurationService
{
    private static readonly BuiltInCategory[] LightingCategories = [BuiltInCategory.OST_LightingFixtures, BuiltInCategory.OST_LightingDevices, BuiltInCategory.OST_ElectricalEquipment, BuiltInCategory.OST_Wire];
    private static BridgeException Invalid(string message) => new("invalid_view_configuration", message);
    private static double Mm(double value) => UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Millimeters);
    private static object Point(XYZ value) => new { xMm = JsonDefaults.InternalToMm(value.X), yMm = JsonDefaults.InternalToMm(value.Y), zMm = JsonDefaults.InternalToMm(value.Z) };
    private static object Vector(XYZ value) => new { x = value.X, y = value.Y, z = value.Z };
    private static object? ColorValue(Color value) => value.IsValid ? new { red = value.Red, green = value.Green, blue = value.Blue } : null;
    private static object GraphicSettings(OverrideGraphicSettings value) => new { projectionColor = ColorValue(value.ProjectionLineColor), projectionWeight = value.ProjectionLineWeight, projectionPatternId = value.ProjectionLinePatternId.Value, cutColor = ColorValue(value.CutLineColor), cutWeight = value.CutLineWeight, transparency = value.Transparency, halftone = value.Halftone };
    private static object Plane(Document doc, PlanViewRange range, PlanViewPlane plane)
    {
        var levelId = range.GetLevelId(plane);
        return new { levelId = levelId.Value, levelName = (doc.GetElement(levelId) as Level)?.Name, offsetMm = JsonDefaults.InternalToMm(range.GetOffset(plane)) };
    }
    public static object Snapshot(ViewPlan view)
    {
        var doc = view.Document;
        using var range = view.GetViewRange();
        using var shape = view.GetCropRegionShapeManager();
        using var box = view.CropBox;
        return new
        {
            viewId = view.Id.Value, uniqueId = view.UniqueId, name = view.Name, viewType = view.ViewType.ToString(),
            levelId = view.GenLevel?.Id.Value, templateId = view.ViewTemplateId.Value,
            discipline = view.Discipline.ToString(), detailLevel = view.DetailLevel.ToString(), displayStyle = view.DisplayStyle.ToString(), partsVisibility = view.PartsVisibility.ToString(), scale = view.Scale,
            viewRange = new { top = Plane(doc,range,PlanViewPlane.TopClipPlane), cut = Plane(doc,range,PlanViewPlane.CutPlane), bottom = Plane(doc,range,PlanViewPlane.BottomClipPlane), depth = Plane(doc,range,PlanViewPlane.ViewDepthPlane) },
            crop = new { active = view.CropBoxActive, visible = view.CropBoxVisible, shapeSet = shape.ShapeSet, splitRegions = shape.NumberOfSplitRegions,
                min = Point(box.Min), max = Point(box.Max), origin = Point(box.Transform.Origin), basisX = Vector(box.Transform.BasisX), basisY = Vector(box.Transform.BasisY), basisZ = Vector(box.Transform.BasisZ) },
            lightingCategories = LightingCategories.Select(builtin =>
            {
                var category = doc.Settings.Categories.get_Item(builtin);
                var supported = view.CanCategoryBeHidden(category.Id);
                using var graphics = view.GetCategoryOverrides(category.Id);
                return new { category = builtin.ToString(), categoryId = category.Id.Value, name = category.Name, hiddenSupported = supported,
                    hidden = supported ? (bool?)view.GetCategoryHidden(category.Id) : null, graphics = GraphicSettings(graphics) };
            }).ToArray()
        };
    }
    public static object Get(UIApplication app, JsonElement parameters)
    {
        var doc = app.ActiveUIDocument?.Document ?? throw new BridgeException("no_active_document","Open a project first.");
        var id = JsonDefaults.Int64(parameters,"viewId") ?? throw new BridgeException("missing_view","Specify a floor-plan view id.");
        var view = doc.GetElement(new ElementId(id)) as ViewPlan ?? throw Invalid("The selected element is not a plan view.");
        if (view.IsTemplate) throw Invalid("Read a model view rather than a view template.");
        var revision = RevitCommandRouter.Revision(doc);
        var scoped = LightingCategories.Select(category =>
        {
            var ids = new FilteredElementCollector(doc,view.Id).OfCategory(category).WhereElementIsNotElementType().ToElementIds().Select(e => e.Value).Order().ToArray();
            return new { category = category.ToString(), count = ids.Length, elementIds = ids.Take(500).ToArray(), complete = ids.Length <= 500 };
        }).ToArray();
        return new { documentIdentity = RevitCommandRouter.Identity(doc), documentRevision = revision, settings = Snapshot(view), scopedElements = scoped,
            note = "View-scoped collectors are candidate evidence, not proof of drawn pixels. Check exported images. Reading does not change the model or activate the view." };
    }
    public static void Validate(ViewPlan? target, ViewPlan? source, Viewport? viewport, JsonElement op)
    {
        var settings = ViewConfigurationRules.Settings(op);
        if (source is null) throw Invalid("referenceViewId must be an existing inspected plan view, not a newly created reference.");
        if (source.IsTemplate) throw Invalid("The reference must be an actual model view, not a template.");
        if (target is not null)
        {
            if (target.Id == source.Id) throw Invalid("The reference view must not be modified.");
            if (target.IsTemplate || target.ViewTemplateId != ElementId.InvalidElementId) throw Invalid("The target view is a template or controlled by one; no settings are changed.");
            if (target.ViewType != source.ViewType || target.GenLevel?.Id != source.GenLevel?.Id) throw Invalid("Reference and target must use the same plan type and generating level.");
            if (viewport is not null && viewport.ViewId != target.Id) throw Invalid("The viewport does not display the target view.");
        }
        if (settings.Contains("viewRange") && target is not null)
        {
            using var range = source.GetViewRange();
            var errors = target.CheckPlanViewRangeValidity(range);
            if (errors.Count != 0) throw Invalid("The copied view range is invalid for this target: " + string.Join(", ",errors));
        }
        if (settings.Contains("crop"))
        {
            var bounds = ViewConfigurationRules.CropBounds(op);
            // An explicit rectangle never reads or copies the reference crop.
            if (bounds is null)
            {
                using var shape = source.GetCropRegionShapeManager();
                if (shape.ShapeSet || shape.NumberOfSplitRegions > 1) throw Invalid("Reference crop is nonrectangular or split. Review an explicit shape instead of guessing its bounds.");
            }
            if (target is not null)
            {
                using var targetShape = target.GetCropRegionShapeManager();
                if (targetShape.ShapeSet || targetShape.NumberOfSplitRegions > 1) throw Invalid("Target has a nonrectangular or split crop; this operation will not discard it.");
                using var targetBox = target.CropBox;
                var a = targetBox.Transform;
                if (bounds is { } rectangle)
                {
                    if (target.ViewType != ViewType.FloorPlan || a.BasisX.DistanceTo(XYZ.BasisX) > 1e-8 || a.BasisY.DistanceTo(XYZ.BasisY) > 1e-8 || a.BasisZ.DistanceTo(XYZ.BasisZ) > 1e-8)
                        throw Invalid("Explicit cropBounds supports only project-axis-aligned FloorPlan frames; rotated/reflected views require a separately reviewed transform.");
                    if (Mm(rectangle.MaxX-rectangle.MinX) < target.Document.Application.ShortCurveTolerance || Mm(rectangle.MaxY-rectangle.MinY) < target.Document.Application.ShortCurveTolerance)
                        throw Invalid("The explicit crop rectangle is shorter than Revit's ShortCurveTolerance.");
                }
                else
                {
                    using var sourceBox = source.CropBox;
                    var b = sourceBox.Transform;
                    if (a.BasisX.DistanceTo(b.BasisX) > 1e-8 || a.BasisY.DistanceTo(b.BasisY) > 1e-8 || a.BasisZ.DistanceTo(b.BasisZ) > 1e-8 || a.Origin.DistanceTo(b.Origin) > Mm(1))
                        throw Invalid("Reference and target crop coordinate frames differ; no automatic transform is guessed.");
                }
            }
        }
        if (settings.Contains("lightingCategories") && target is not null)
        {
            if (!source.AreGraphicsOverridesAllowed() || !target.AreGraphicsOverridesAllowed()) throw Invalid("Category graphic overrides are not available for these views.");
            foreach (var builtin in LightingCategories)
            {
                var id = source.Document.Settings.Categories.get_Item(builtin).Id;
                if (!source.CanCategoryBeHidden(id) || !target.CanCategoryBeHidden(id)) throw Invalid("Cannot explicitly copy visibility of " + builtin + ".");
            }
        }
        if (JsonDefaults.String(op,"discipline") is { } requested && (!Enum.TryParse<ViewDiscipline>(requested,false,out var discipline) || !Enum.IsDefined(discipline))) throw Invalid("Unknown discipline; use an inspected native discipline name.");
    }
    public static OperationReceipt Apply(ViewPlan target, ViewPlan source, Viewport? viewport, JsonElement op)
    {
        Validate(target,source,viewport,op);
        var settings = ViewConfigurationRules.Settings(op); var doc = target.Document;
        if (settings.Contains("viewRange")) { using var range = source.GetViewRange(); target.SetViewRange(range); }
        if (settings.Contains("discipline")) target.Discipline = JsonDefaults.String(op,"discipline") is { } name ? Enum.Parse<ViewDiscipline>(name) : source.Discipline;
        if (settings.Contains("displayStyle")) target.DisplayStyle = source.DisplayStyle;
        if (settings.Contains("detailLevel")) target.DetailLevel = source.DetailLevel;
        if (settings.Contains("partsVisibility")) target.PartsVisibility = source.PartsVisibility;
        if (settings.Contains("lightingCategories")) foreach (var builtin in LightingCategories)
        {
            var id = doc.Settings.Categories.get_Item(builtin).Id;
            target.SetCategoryHidden(id,source.GetCategoryHidden(id));
            using var graphics = source.GetCategoryOverrides(id); target.SetCategoryOverrides(id,graphics);
        }
        if (settings.Contains("crop"))
        {
            if (ViewConfigurationRules.CropBounds(op) is { } rectangle)
            {
                using var currentBox = target.CropBox;
                using var inverse = currentBox.Transform.Inverse;
                // External inputs are project XY. CropBox setters ignore Transform;
                // convert XY to the existing local frame and preserve native plan Z.
                var min = inverse.OfPoint(new XYZ(Mm(rectangle.MinX),Mm(rectangle.MinY),0));
                var max = inverse.OfPoint(new XYZ(Mm(rectangle.MaxX),Mm(rectangle.MaxY),0));
                using var box = new BoundingBoxXYZ { Min = new XYZ(min.X,min.Y,currentBox.Min.Z), Max = new XYZ(max.X,max.Y,currentBox.Max.Z) };
                target.CropBox = box; target.CropBoxActive = true; target.CropBoxVisible = false;
                doc.Regenerate();
                using var actualBox = target.CropBox;
                var actualMin = actualBox.Transform.OfPoint(actualBox.Min); var actualMax = actualBox.Transform.OfPoint(actualBox.Max);
                if (Math.Abs(actualMin.X-Mm(rectangle.MinX)) > Mm(1) || Math.Abs(actualMin.Y-Mm(rectangle.MinY)) > Mm(1) || Math.Abs(actualMax.X-Mm(rectangle.MaxX)) > Mm(1) || Math.Abs(actualMax.Y-Mm(rectangle.MaxY)) > Mm(1) || !target.CropBoxActive || target.CropBoxVisible)
                    throw Invalid("Revit did not preserve the reviewed crop XY bounds within 1 mm; the entire plan will roll back.");
            }
            else
            {
                using var sourceBox = source.CropBox;
                using var box = new BoundingBoxXYZ { Min = sourceBox.Min, Max = sourceBox.Max };
                target.CropBox = box; target.CropBoxActive = source.CropBoxActive; target.CropBoxVisible = source.CropBoxVisible;
            }
        }
        doc.Regenerate();
        var changed = new List<long> {target.Id.Value};
        if (viewport is not null)
        {
            var point = JsonDefaults.Get(op,"paperPoint");
            viewport.SetBoxCenter(new XYZ(Mm(PlanRules.Number(point,"xMm")),Mm(PlanRules.Number(point,"yMm")),0));
            changed.Add(viewport.Id.Value);
        }
        return new([],changed);
    }
}
