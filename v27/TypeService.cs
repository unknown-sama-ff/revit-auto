using System.Text;
using System.Text.Json;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace RevitAutoV27;

internal static class TypeService
{
    private static string Normalize(string name) => name.Normalize(NormalizationForm.FormKC).Trim().Replace('×','x');
    public static object Resolve(UIApplication app,JsonElement parameters)
    {
        var doc=app.ActiveUIDocument?.Document??throw new BridgeException("no_active_document","Open a project first.");
        var requested=JsonDefaults.String(parameters,"type")??throw new BridgeException("missing_type","An explicit type name is required.");
        var family=JsonDefaults.String(parameters,"family");var category=JsonDefaults.String(parameters,"category");
        var collector=new FilteredElementCollector(doc).WhereElementIsElementType();
        if(category is not null)
        {
            if(Enum.TryParse<BuiltInCategory>(category,out var builtin)&&Enum.IsDefined(builtin))collector.OfCategory(builtin);
            else
            {
                var matches=doc.Settings.Categories.Cast<Category>().Where(c=>c.Name==category).ToArray();
                if(matches.Length!=1)throw new BridgeException("category_not_found","Use OST_... or an exact localized category name.");
                collector.OfCategoryId(matches[0].Id);
            }
        }
        var types=collector.Cast<ElementType>().Where(t=>Normalize(t.Name)==Normalize(requested)&&(family is null||Normalize(t.FamilyName)==Normalize(family))).Take(21).ToArray();
        var items=types.Take(20).Select(t=>new {id=t.Id.Value,family=t.FamilyName,type=t.Name,category=t.Category?.Name,categoryId=t.Category?.Id.Value,className=t.GetType().Name,placement=t is FamilySymbol symbol?symbol.Family.FamilyPlacementType.ToString():null}).ToArray();
        return new {documentIdentity=RevitCommandRouter.Identity(doc),documentRevision=RevitCommandRouter.Revision(doc),status=types.Length==1?"resolved":types.Length==0?"missing":"ambiguous",resolvedTypeId=types.Length==1?(long?)types[0].Id.Value:null,candidates=items,hasMore=types.Length>20,note="Only Unicode compatibility/trim/multiplication-sign normalization is used. Missing or ambiguous matches are never selected automatically."};
    }
}
