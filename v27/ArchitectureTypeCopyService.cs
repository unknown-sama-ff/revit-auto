using System.Text.Json;
using System.Text.Json.Serialization;
using Autodesk.Revit.DB;

namespace RevitAutoV27;

// One instance belongs to one ModelExecutor execution. It never starts/commits
// a transaction; the router must capture sources before any operation executes
// and call VerifyCompletedCopies after its last Regenerate, before Commit.
internal sealed class ArchitectureTypeCopyService
{
    private const int MaxParameters = 2048;
    private const int MaxNativeString = 16384;
    private const int MaxSourceSnapshotBytes = 2_000_000;
    // The bridge response is capped at 16 MiB. Receipts retain source before,
    // source after and the JSON-escaped preview warning, so reserve headroom.
    private const int MaxPlanSnapshotBytes = 2_000_000;
    private const int MaxPlanCopies = 1000;
    private readonly Dictionary<long, SymbolSnapshot> sources = new();
    private readonly List<CompletedCopy> completed = new();
    private readonly HashSet<long> placementActivations = new();
    private readonly Dictionary<string, int> remainingCopies = new(StringComparer.Ordinal);
    private bool sourceCaptureStarted;
    private bool sourceCaptureCompleted;
    private int reviewedCopyCount;
    private Document? capturedDocument;
    private sealed record ParameterSnapshot(long ParameterId, string Name, string StorageType, bool HasValue, bool ReadOnly, string Spec, long AssociatedGlobalParameterId,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] object? Value);
    private sealed record SymbolSnapshot(long TypeId, string UniqueId, string Name, long FamilyId, string FamilyName, long CategoryId, string Placement, bool IsActive, ParameterSnapshot[] Parameters);
    private sealed record CompletedCopy(ArchitectureTypeCopyInput Input, long TypeId, string UniqueId, long FamilyId, string FamilyName, long CategoryId, string Placement, bool InitiallyActive);
    private static BridgeException Invalid(string message) => new("invalid_architecture_type_copy", message);

    public static void Validate(Document doc, JsonElement op)
    {
        var input = ArchitectureTypeCopyRules.Validate(op);
        var source = Source(doc, input);
        _ = Snapshot(source);
        RequireNameAvailable(doc, source.Family.Id, input.Name);
        foreach (var dimension in input.Dimensions) _ = Dimension(source, dimension);
    }

    public static object Preview(Document doc, JsonElement op)
    {
        var input = ArchitectureTypeCopyRules.Validate(op);
        var source = Source(doc, input);
        RequireNameAvailable(doc, source.Family.Id, input.Name);
        var baseline = Snapshot(source);
        var dimensions = input.Dimensions.Select(dimension =>
        {
            var parameter = Dimension(source, dimension);
            return new { dimension.ParameterId, dimension.Name, beforeMm = JsonDefaults.InternalToMm(parameter.AsDouble()), desiredMm = dimension.ValueMm,
                storageType = parameter.StorageType.ToString(), spec = parameter.Definition.GetDataType().TypeId, hasValue = parameter.HasValue, readOnly = parameter.IsReadOnly };
        }).ToArray();
        return new { sourceTypeId = source.Id.Value, sourceName = source.Name, familyId = source.Family.Id.Value, familyName = source.FamilyName,
            input.Category, categoryId = source.Category!.Id.Value, placement = source.Family.FamilyPlacementType.ToString(), targetName = input.Name,
            dimensions, sourceSnapshot = baseline, sourceSnapshotComplete = true, sourceParameterCount = baseline.Parameters.Length,
            sourceMutationRequested = false, activationRequested = false, newTypeIdKnown = false,
            subsequentPlacementMayActivateNewType = true, readbackToleranceMm = ArchitectureTypeCopyRules.ReadbackToleranceMm,
            nativeReadbackVerified = false, sideEffectsVerified = false, automaticSave = false, engineeringComplianceVerified = false };
    }

    // The plan preview must call this before emitting per-operation snapshots;
    // shared sources are charged for every copy because Preview repeats evidence.
    public static void ValidatePlanEvidenceBudget(Document doc, IEnumerable<JsonElement> operations)
    {
        var sizes = new Dictionary<long, int>();
        long totalBytes = 0;
        var copyCount = 0;
        foreach (var op in operations.Where(op => JsonDefaults.String(op, "operationType") == "duplicate_architecture_type"))
        {
            if (++copyCount > MaxPlanCopies)
                throw Invalid("The plan exceeds the supported type-copy operation bound; split it into independently reviewed plans.");
            var input = ArchitectureTypeCopyRules.Validate(op);
            if (!sizes.TryGetValue(input.SourceTypeId, out var bytes))
            {
                bytes = SnapshotBytes(Snapshot(Source(doc, input)));
                sizes.Add(input.SourceTypeId, bytes);
            }
            totalBytes += bytes;
            if (totalBytes > MaxPlanSnapshotBytes)
                throw Invalid("Complete type-copy source evidence exceeds the 2 MB plan budget; split the plan rather than truncate native evidence.");
        }
    }

    public void CaptureSources(Document doc, IEnumerable<JsonElement> operations)
    {
        if (doc.IsModifiable)
            throw Invalid("All reviewed type-copy sources must be captured before the plan opens a writable transaction.");
        if (sourceCaptureStarted)
            throw Invalid("All reviewed type-copy sources and operations must be captured once before the first plan operation; recapture is forbidden.");
        sourceCaptureStarted = true;
        BindDocument(doc);
        var reviewedOperations = operations.Where(op => JsonDefaults.String(op, "operationType") == "duplicate_architecture_type").Take(MaxPlanCopies + 1).ToArray();
        ValidatePlanEvidenceBudget(doc, reviewedOperations);
        foreach (var op in reviewedOperations)
        {
            Validate(doc, op);
            var input = ArchitectureTypeCopyRules.Validate(op);
            var snapshot = Snapshot(Source(doc, input));
            if (sources.TryGetValue(input.SourceTypeId, out var original)) RequireSourceUnchanged(original, snapshot);
            else sources.Add(input.SourceTypeId, snapshot);
            var key = CopyKey(input);
            remainingCopies[key] = remainingCopies.GetValueOrDefault(key) + 1;
            reviewedCopyCount++;
        }
        VerifySources(doc);
        sourceCaptureCompleted = true;
    }

    public OperationReceipt Apply(Document doc, JsonElement op)
    {
        BindDocument(doc);
        var input = ArchitectureTypeCopyRules.Validate(op);
        var key = CopyKey(input);
        if (!sourceCaptureCompleted || !remainingCopies.TryGetValue(key, out var remaining) || remaining <= 0)
            throw Invalid("The exact type-copy operation was not captured in the reviewed plan or has already completed; roll back.");
        if (!sources.TryGetValue(input.SourceTypeId, out var baseline))
            throw Invalid("All type-copy sources must be captured before the first operation of the plan; no mid-plan baseline is accepted.");
        if (!doc.IsModifiable || doc.IsReadOnly || doc.IsFamilyDocument)
            throw Invalid("Type duplication requires the router's active transaction in a writable project document.");
        Validate(doc, op); // Repeat native preflight immediately before Duplicate.
        VerifySources(doc);
        var source = Source(doc, input);
        var type = source.Duplicate(input.Name) as FamilySymbol ?? throw Invalid("Native duplication did not return a FamilySymbol; roll back.");
        if (type.Id.Value <= 0 || type.Id.Value > ArchitectureTypeCopyRules.MaxSafeInteger || type.Id == source.Id || sources.ContainsKey(type.Id.Value) || completed.Any(copy => copy.TypeId == type.Id.Value))
            throw Invalid("Native duplication did not return a distinct new type ID; roll back.");
        var dimensionWrites = new List<object>();
        foreach (var dimension in input.Dimensions)
        {
            var parameter = Dimension(type, dimension);
            var value = UnitUtils.ConvertToInternalUnits(dimension.ValueMm, UnitTypeId.Millimeters);
            if (!double.IsFinite(value)) throw Invalid("Reviewed dimension cannot be represented as a finite native value.");
            var writePerformed = parameter.AsDouble() != value;
            if (writePerformed && !parameter.Set(value)) throw Invalid("Revit refused the reviewed dimension parameter '" + dimension.Name + "'; roll back.");
            dimensionWrites.Add(new { dimension.ParameterId, dimension.Name, desiredMm = dimension.ValueMm, writePerformed });
        }
        doc.Regenerate();
        var copy = new CompletedCopy(input, type.Id.Value, NativeString(type.UniqueId, "New type UniqueId"), baseline.FamilyId, baseline.FamilyName,
            baseline.CategoryId, baseline.Placement, type.IsActive);
        var native = VerifyCopy(doc, copy);
        VerifySources(doc);
        completed.Add(copy);
        remainingCopies[key] = remaining - 1;
        return new([type.Id.Value], [])
        {
            Evidence = new { sourceTypeId = input.SourceTypeId, createdTypeId = type.Id.Value, sourceBefore = baseline, sourceAfter = Snapshot(source),
                sourceParametersComplete = true, sourceUnchanged = true, dimensionWrites, native, nativeReadbackVerified = true,
                activationPerformed = false, createdTypeInitiallyActive = copy.InitiallyActive, activationPolicy = "only a subsequent reviewed placement may activate this new type",
                readbackToleranceMm = ArchitectureTypeCopyRules.ReadbackToleranceMm, finalVerificationRequired = true,
                sideEffectsVerified = false, automaticSave = false, engineeringComplianceVerified = false }
        };
    }

    // Called only when a reviewed placement resolves to a type created by this
    // service. Numeric existing-type activation and source activation are not
    // granted by this method, and type-copy itself never calls Activate.
    public void AllowPlacementActivation(long createdTypeId)
    {
        if (!completed.Any(copy => copy.TypeId == createdTypeId))
            throw Invalid("Placement activation can be granted only to a type created by this execution's reviewed architecture copy.");
        placementActivations.Add(createdTypeId);
    }

    public object VerifyCompletedCopies(Document doc)
    {
        if (sourceCaptureStarted && (!sourceCaptureCompleted || completed.Count != reviewedCopyCount || remainingCopies.Values.Any(count => count != 0)))
            throw Invalid("Not every captured type-copy operation completed exactly once; roll back the entire plan.");
        if (sources.Count == 0 && completed.Count == 0)
            return new { completedCopyCount = 0, reviewedCopyCount = 0, reviewedCopiesComplete = true, sourceBaselinesComplete = true, sourceTypesUnchanged = true, copiedDimensionsVerified = true };
        BindDocument(doc);
        VerifySources(doc);
        var native = completed.Select(copy => VerifyCopy(doc, copy)).ToArray();
        return new { completedCopyCount = completed.Count, reviewedCopyCount, reviewedCopiesComplete = true, sourceTypeIds = sources.Keys.Order().ToArray(), sourceBaselinesComplete = true,
            sourceTypesUnchanged = true, copiedDimensionsVerified = true, copies = native,
            readbackToleranceMm = ArchitectureTypeCopyRules.ReadbackToleranceMm, verifiedBeforeTransactionCommit = true, sideEffectsVerified = false };
    }

    private static string CopyKey(ArchitectureTypeCopyInput input) => JsonSerializer.Serialize(input, JsonDefaults.Options);
    private static int SnapshotBytes(SymbolSnapshot snapshot) => System.Text.Encoding.UTF8.GetByteCount(JsonSerializer.Serialize(snapshot, JsonDefaults.Options));

    private void BindDocument(Document doc)
    {
        if (capturedDocument is null) capturedDocument = doc;
        else if (!capturedDocument.IsValidObject || !capturedDocument.Equals(doc)) throw Invalid("Type-copy evidence belongs to a different native document.");
    }
    private void VerifySources(Document doc)
    {
        foreach (var original in sources.Values)
        {
            var symbol = doc.GetElement(new ElementId(original.TypeId)) as FamilySymbol ?? throw Invalid("A reviewed source type is missing or no longer a FamilySymbol.");
            RequireSourceUnchanged(original, Snapshot(symbol));
        }
    }
    private static void RequireSourceUnchanged(SymbolSnapshot before, SymbolSnapshot after)
    {
        if (before.TypeId != after.TypeId || before.UniqueId != after.UniqueId || before.Name != after.Name || before.FamilyId != after.FamilyId ||
            before.FamilyName != after.FamilyName || before.CategoryId != after.CategoryId || before.Placement != after.Placement || before.IsActive != after.IsActive ||
            !before.Parameters.SequenceEqual(after.Parameters))
            throw Invalid("A source type's identity, activation or complete native parameter snapshot changed; roll back the entire plan.");
    }
    private object VerifyCopy(Document doc, CompletedCopy copy)
    {
        var type = doc.GetElement(new ElementId(copy.TypeId)) as FamilySymbol ?? throw Invalid("A copied type is missing or no longer a FamilySymbol; roll back.");
        if (type.UniqueId != copy.UniqueId || type.Name != copy.Input.Name || type.Family.Id.Value != copy.FamilyId || type.FamilyName != copy.FamilyName ||
            type.Category?.Id.Value != copy.CategoryId || type.Family.FamilyPlacementType.ToString() != copy.Placement)
            throw Invalid("Copied type identity, exact name, family, category or placement differs from the reviewed source and requested name; roll back.");
        RequireNameAvailable(doc, type.Family.Id, copy.Input.Name, copy.TypeId);
        var active = type.IsActive;
        if (active != copy.InitiallyActive && (copy.InitiallyActive || !active || !placementActivations.Contains(copy.TypeId)))
            throw Invalid("Copied type activation changed without its subsequent reviewed placement; roll back.");
        var dimensions = copy.Input.Dimensions.Select(dimension =>
        {
            var parameter = Dimension(type, dimension); var mm = JsonDefaults.InternalToMm(parameter.AsDouble());
            ArchitectureTypeCopyRules.RequireReadback(dimension.ValueMm, mm);
            return new { dimension.ParameterId, dimension.Name, desiredMm = dimension.ValueMm, actualMm = mm, storageType = parameter.StorageType.ToString(),
                spec = parameter.Definition.GetDataType().TypeId, hasValue = parameter.HasValue, readOnly = parameter.IsReadOnly };
        }).ToArray();
        return new { createdTypeId = copy.TypeId, type.UniqueId, type.Name, familyId = copy.FamilyId, familyName = copy.FamilyName, categoryId = copy.CategoryId,
            category = copy.Input.Category, placement = copy.Placement, dimensions, isActive = active, initiallyActive = copy.InitiallyActive,
            activationChanged = active != copy.InitiallyActive, reviewedPlacementActivationAllowed = placementActivations.Contains(copy.TypeId), nativeDimensionsVerified = true };
    }
    private static FamilySymbol Source(Document doc, ArchitectureTypeCopyInput input)
    {
        if (doc.IsFamilyDocument || doc.IsReadOnly) throw Invalid("An existing type from a writable project document is required.");
        var source = doc.GetElement(new ElementId(input.SourceTypeId)) as FamilySymbol ?? throw Invalid("sourceTypeId must identify an existing FamilySymbol in the current document.");
        var category = input.Category switch
        {
            "OST_StructuralColumns" => BuiltInCategory.OST_StructuralColumns,
            "OST_Doors" => BuiltInCategory.OST_Doors,
            "OST_Windows" => BuiltInCategory.OST_Windows,
            _ => throw Invalid("Unsupported architecture category.")
        };
        var placement = category == BuiltInCategory.OST_StructuralColumns ? FamilyPlacementType.TwoLevelsBased : FamilyPlacementType.OneLevelBasedHosted;
        if (source.Category?.Id.Value != (long)category || source.Family.FamilyPlacementType != placement)
            throw Invalid("Source type category or native placement does not match the explicitly reviewed architecture contract.");
        return source;
    }
    private static void RequireNameAvailable(Document doc, ElementId familyId, string name, long? allowedTypeId = null)
    {
        var family = doc.GetElement(familyId) as Family ?? throw Invalid("Native source family is unavailable.");
        var ids = family.GetFamilySymbolIds();
        if (ids.Count > 10000) throw Invalid("Native family type membership exceeds the complete evidence bound.");
        var matches = ids.Select(id => doc.GetElement(id) as FamilySymbol ?? throw Invalid("Native family type membership contains an unreadable FamilySymbol."))
            .Where(symbol => symbol.Name == name).Select(symbol => symbol.Id.Value).ToArray();
        if (allowedTypeId is null ? matches.Length != 0 : matches.Length != 1 || matches[0] != allowedTypeId)
            throw Invalid("The exact requested type name already exists or is ambiguous within the source family; different families may use the same name.");
    }
    private static Parameter Dimension(FamilySymbol symbol, ArchitectureTypeDimension requested)
    {
        var parameters = BoundedParameters(symbol);
        var idMatches = parameters.Where(parameter => parameter.Id.Value == requested.ParameterId).ToArray();
        var nameMatches = parameters.Where(parameter => parameter.Definition.Name == requested.Name).ToArray();
        if (idMatches.Length != 1 || nameMatches.Length != 1 || nameMatches[0].Id.Value != requested.ParameterId || idMatches[0].Definition.Name != requested.Name)
            throw Invalid("Each dimension parameter ID and exact native name must resolve uniquely to the same parameter; no name or width/height inference is permitted.");
        var parameter = idMatches[0];
        if (parameter.StorageType != StorageType.Double || parameter.Definition.GetDataType() != SpecTypeId.Length || !parameter.HasValue || parameter.IsReadOnly ||
            parameter.GetAssociatedGlobalParameter() != ElementId.InvalidElementId ||
            !double.IsFinite(parameter.AsDouble()) || !double.IsFinite(JsonDefaults.InternalToMm(parameter.AsDouble())))
            throw Invalid("Reviewed dimensions must be writable Double Length parameters with known finite values; formulas, missing values and other specs are not supported.");
        return parameter;
    }
    private static Parameter[] BoundedParameters(FamilySymbol symbol)
    {
        var parameters = new List<Parameter>();
        foreach (Parameter parameter in symbol.Parameters)
        {
            if (parameters.Count >= MaxParameters) throw Invalid("Complete native type parameters exceed the supported bound; partial baselines are forbidden.");
            parameters.Add(parameter);
        }
        return parameters.ToArray();
    }
    private static SymbolSnapshot Snapshot(FamilySymbol symbol)
    {
        var parameters = BoundedParameters(symbol).Select(parameter =>
        {
            var id = parameter.Id.Value;
            if (id == 0 || id < -ArchitectureTypeCopyRules.MaxSafeInteger || id > ArchitectureTypeCopyRules.MaxSafeInteger)
                throw Invalid("A native source parameter ID cannot be represented exactly in complete evidence.");
            var name = NativeString(parameter.Definition.Name, "Native parameter name");
            var spec = NativeString(parameter.Definition.GetDataType().TypeId, "Native parameter data type", allowEmpty: true);
            var associatedGlobal = parameter.GetAssociatedGlobalParameter().Value;
            if (associatedGlobal != ElementId.InvalidElementId.Value)
                throw Invalid("Native source parameters associated with global parameters need a separate relationship-preserving adapter; duplication must not silently remove those relationships.");
            var storage = parameter.StorageType; var hasValue = parameter.HasValue; object? value = null;
            if (storage is not (StorageType.Double or StorageType.Integer or StorageType.String or StorageType.ElementId))
                throw Invalid("Native source parameter has an unsupported or unknown storage type; no partial baseline is accepted.");
            if (hasValue)
            {
                value = storage switch
                {
                    StorageType.Double => Finite(parameter.AsDouble()),
                    StorageType.Integer => parameter.AsInteger(),
                    StorageType.String => NativeString(parameter.AsString(), "Native string parameter", allowEmpty: true),
                    StorageType.ElementId => SafeNativeIdValue(parameter.AsElementId().Value),
                    _ => throw Invalid("Native source parameter value is unknown.")
                };
            }
            return new ParameterSnapshot(id, name, storage.ToString(), hasValue, parameter.IsReadOnly, spec, associatedGlobal, value);
        }).OrderBy(parameter => parameter.ParameterId).ThenBy(parameter => parameter.Name, StringComparer.Ordinal).ToArray();
        if (parameters.Length == 0 || parameters.Select(parameter => parameter.ParameterId).Distinct().Count() != parameters.Length)
            throw Invalid("Complete native source parameters are empty or contain duplicate IDs.");
        var snapshot = new SymbolSnapshot(symbol.Id.Value, NativeString(symbol.UniqueId, "Source UniqueId"), NativeString(symbol.Name, "Source type name"),
            symbol.Family.Id.Value, NativeString(symbol.FamilyName, "Source family name"), symbol.Category?.Id.Value ?? throw Invalid("Source category is unknown."),
            symbol.Family.FamilyPlacementType.ToString(), symbol.IsActive, parameters);
        if (SnapshotBytes(snapshot) > MaxSourceSnapshotBytes)
            throw Invalid("Complete native source snapshot exceeds the supported bound; narrow the source family instead of truncating evidence.");
        return snapshot;
    }
    private static string NativeString(string? value, string field, bool allowEmpty = false)
    {
        if (value is null || value.Length > MaxNativeString || !allowEmpty && value.Length == 0)
            throw Invalid(field + " is unknown or exceeds the complete evidence bound.");
        return value;
    }
    private static double Finite(double value)
        => double.IsFinite(value) ? value : throw Invalid("Native source parameter is non-finite; unknown values cannot certify source invariance.");
    private static long SafeNativeIdValue(long value)
        => value >= -ArchitectureTypeCopyRules.MaxSafeInteger && value <= ArchitectureTypeCopyRules.MaxSafeInteger ? value :
            throw Invalid("Native ElementId parameter value cannot be represented exactly in complete source evidence.");
}
