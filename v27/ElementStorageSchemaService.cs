using System.Reflection;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.ExtensibleStorage;
using Autodesk.Revit.UI;

namespace RevitAutoV27;

internal static class ElementStorageSchemaService
{
    public static object Get(UIApplication app,System.Text.Json.JsonElement parameters,CancellationToken cancellation)
    {
        var input=ElementStorageSchemaRules.Parse(parameters);
        cancellation.ThrowIfCancellationRequested();
        var doc=app.ActiveUIDocument?.Document??throw new BridgeException("no_active_document","Open the reviewed project first.");
        if(!doc.IsValidObject)throw new BridgeException("document_changed","The native document is no longer valid.");
        if(doc.IsFamilyDocument)throw new BridgeException("project_required","Storage schema metadata requires an active project document.");
        var identity=RevitCommandRouter.Identity(doc);var revision=RevitCommandRouter.Revision(doc);
        if(input.DocumentIdentity!=identity)throw new BridgeException("document_changed","The active project differs from the requested schema metadata document.");
        if(input.ExpectedRevision!=revision)throw new BridgeException("document_revision_changed","The document revision differs from the requested schema metadata revision.");
        var path=doc.PathName;var modified=doc.IsModified;var readOnly=doc.IsReadOnly;
        if(doc.IsModifiable)throw new BridgeException("document_busy","Storage schema metadata requires a stable nontransactional read context.");
        var started=System.Diagnostics.Stopwatch.StartNew();
        void Check()
        {
            cancellation.ThrowIfCancellationRequested();
            if(started.Elapsed>TimeSpan.FromSeconds(20))
                throw new BridgeException("element_storage_schema_timeout","Schema metadata query exceeded its 20 second read budget; narrow the explicit element list.");
            if(!doc.IsValidObject||app.ActiveUIDocument?.Document is not { } active||!active.Equals(doc)||!active.IsValidObject||
               RevitCommandRouter.Identity(active)!=identity||active.IsFamilyDocument||!string.Equals(doc.PathName,path,StringComparison.Ordinal))
                throw new BridgeException("document_changed","The pinned schema metadata document changed during the read.");
            if(RevitCommandRouter.Revision(doc)!=revision)
                throw new BridgeException("document_revision_changed","The pinned schema metadata revision changed during the read.");
            if(doc.IsModified!=modified||doc.IsReadOnly!=readOnly||doc.IsModifiable)
                throw new BridgeException("document_state_changed","Document save or transaction state changed during schema metadata reads.");
        }
        Check();
        var items=new List<ElementStorageSchemaItem>();var totalSchemas=0;var totalFields=0;
        foreach(var elementId in input.ElementIds)
        {
            Check();
            var element=doc.GetElement(new ElementId(elementId));
            if(element is null)
            {
                items.Add(new(elementId,false,null,new(false,false,null,false,[],"element_not_found")));
                continue;
            }
            if(!element.IsValidObject||element.Id.Value!=elementId)
                throw new BridgeException("element_storage_schema_invalid_native_evidence","A requested native element became invalid or resolved to another ID.");
            var category=element.Category;
            var summary=new ElementDependencySummary(elementId,
                ElementStorageSchemaRules.RequireNativeText(element.UniqueId,"uniqueId",256),
                ElementStorageSchemaRules.RequireNativeText(element.Name,"name",ElementStorageSchemaRules.MaxSchemaNameLength,true),
                ElementStorageSchemaRules.RequireNativeText(element.GetType().Name,"className",128),
                category?.Name,category is null?null:ElementDependencyRules.RequireSignedSafeId(category.Id.Value),
                ElementDependencyRules.RequireSignedSafeId(element.GetTypeId().Value),
                ElementDependencyRules.RequireSignedSafeId(element.OwnerViewId.Value),
                ElementDependencyRules.RequireSignedSafeId(element.LevelId.Value));
            var guidEvidence=ElementStorageSchemaRules.ReadSchemaGuids(element.GetEntitySchemaGuids,Check,ref totalSchemas);
            if(!guidEvidence.Supported)
            {
                items.Add(new(elementId,true,summary,new(false,false,null,false,[],guidEvidence.Reason)));
                continue;
            }
            var schemas=new List<ElementStorageSchemaMetadata>();
            foreach(var guid in guidEvidence.Guids)
            {
                Check();
                var schema=Schema.Lookup(guid);
                if(schema is null)
                {
                    schemas.Add(new(guid,"not_loaded",null,null,null,null,null,[]));
                    continue;
                }
                if(!schema.IsValidObject)
                {
                    schemas.Add(new(guid,"metadata_unavailable",null,null,null,null,null,[]));
                    continue;
                }
                try
                {
                    var name=ElementStorageSchemaRules.RequireNativeText(schema.SchemaName,"schemaName",ElementStorageSchemaRules.MaxSchemaNameLength);
                    var vendor=schema.VendorId;
                    if(vendor is {Length:>0})vendor=ElementStorageSchemaRules.RequireNativeText(vendor,"vendorId",ElementStorageSchemaRules.MaxVendorIdLength);
                    var applicationGuid=schema.ApplicationGUID;
                    var read=schema.ReadAccessLevel.ToString();var write=schema.WriteAccessLevel.ToString();
                    var fields=schema.ListFields().OrderBy(field=>field.FieldName,StringComparer.Ordinal).ToArray();
                    ElementStorageSchemaRules.RequireSchemaFieldBudget(fields.Length,ref totalFields);
                    var metadata=fields.Select(field=>
                    {
                        Check();
                        var fieldName=ElementStorageSchemaRules.RequireNativeText(field.FieldName,"fieldName",ElementStorageSchemaRules.MaxFieldNameLength);
                        var valueType=ElementStorageSchemaRules.RequireNativeText(field.ValueType.FullName??field.ValueType.Name,"valueType",ElementStorageSchemaRules.MaxValueTypeLength);
                        var container=field.ContainerType.ToString();
                        var spec=field.GetSpecTypeId();
                        string? specId=spec is null||spec.Empty()?null:ElementStorageSchemaRules.RequireNativeText(spec.TypeId,"specTypeId",ElementStorageSchemaRules.MaxSpecTypeIdLength);
                        return new ElementStorageSchemaFieldMetadata(fieldName,valueType,container,specId);
                    }).ToArray();
                    schemas.Add(new(guid,"resolved",name,vendor,applicationGuid,read,write,metadata));
                }
                catch(Autodesk.Revit.Exceptions.ArgumentException)
                {
                    schemas.Add(new(guid,"read_denied",null,null,null,null,null,[]));
                }
                catch(Autodesk.Revit.Exceptions.InvalidOperationException)
                {
                    schemas.Add(new(guid,"read_denied",null,null,null,null,null,[]));
                }
            }
            items.Add(new(elementId,true,summary,new(true,true,schemas.Count,false,schemas.ToArray())));
            Check();
        }
        Check();
        var frozen=NativeReadSnapshot.Freeze(new
        {
            documentIdentity=identity,documentRevision=revision,items,
            schemaScope="attached-extensible-storage-schema-definitions-only",entityValuesReturned=false,
            modelWritesRequested=false,automaticSave=false,allModelSideEffectsVerified=false
        });
        ElementStorageSchemaRules.RequireResponseBudget(CommandResult.Success(frozen).Serialize());
        Check();
        return frozen;
    }
}
