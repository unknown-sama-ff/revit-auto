var testDocument = document;
var output = new List<string>();
try
{
    double Mm(double value) => UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Millimeters);
    var stair = new FilteredElementCollector(testDocument)
        .OfClass(typeof(Autodesk.Revit.DB.Architecture.Stairs))
        .Cast<Autodesk.Revit.DB.Architecture.Stairs>().Single();
    var runs = stair.GetStairsRuns()
        .Select(id => (Autodesk.Revit.DB.Architecture.StairsRun)testDocument.GetElement(id))
        .OrderBy(run => run.Id.Value).ToList();
    var assemblyName = new System.Reflection.AssemblyName("StairRepair" + Guid.NewGuid().ToString("N"));
    var assembly = System.Reflection.Emit.AssemblyBuilder.DefineDynamicAssembly(assemblyName,
        System.Reflection.Emit.AssemblyBuilderAccess.Run);
    var typeBuilder = assembly.DefineDynamicModule(assemblyName.Name)
        .DefineType("StairPreprocessor", System.Reflection.TypeAttributes.Public);
    typeBuilder.AddInterfaceImplementation(typeof(IFailuresPreprocessor));
    var methodBuilder = typeBuilder.DefineMethod("PreprocessFailures",
        System.Reflection.MethodAttributes.Public | System.Reflection.MethodAttributes.Virtual,
        typeof(FailureProcessingResult), new[] { typeof(FailuresAccessor) });
    var generator = methodBuilder.GetILGenerator();
    generator.Emit(System.Reflection.Emit.OpCodes.Ldc_I4, (int)FailureProcessingResult.Continue);
    generator.Emit(System.Reflection.Emit.OpCodes.Ret);
    typeBuilder.DefineMethodOverride(methodBuilder, typeof(IFailuresPreprocessor).GetMethod("PreprocessFailures"));
    var preprocessor = (IFailuresPreprocessor)Activator.CreateInstance(typeBuilder.CreateType());
    var scope = new StairsEditScope(testDocument, "Repair two-flight stair");
    try
    {
        scope.Start(stair.Id);
        using (var transaction = new Transaction(testDocument, "Set connected flight heights"))
        {
            transaction.Start();
            output.Add("before=" + runs[0].BaseElevation + "/" + runs[0].TopElevation + ","
                + runs[1].BaseElevation + "/" + runs[1].TopElevation);
            runs[0].LookupParameter("相对顶部高度").Set(Mm(2000));
            runs[1].LookupParameter("相对基准高度").Set(Mm(2000));
            runs[1].LookupParameter("相对顶部高度").Set(Mm(4000));
            testDocument.Regenerate();
            output.Add("after=" + runs[0].BaseElevation + "/" + runs[0].TopElevation + ","
                + runs[1].BaseElevation + "/" + runs[1].TopElevation);
            output.Add("automatic=" + Autodesk.Revit.DB.Architecture.StairsLanding.CanCreateAutomaticLanding(
                testDocument, runs[0].Id, runs[1].Id));
            if (Autodesk.Revit.DB.Architecture.StairsLanding.CanCreateAutomaticLanding(testDocument, runs[0].Id, runs[1].Id))
                Autodesk.Revit.DB.Architecture.StairsLanding.CreateAutomaticLanding(testDocument, runs[0].Id, runs[1].Id);
            transaction.Commit();
        }
        scope.Commit(preprocessor);
        output.Add("warnings=" + string.Join(" | ", testDocument.GetWarnings().Select(warning => warning.GetDescriptionText())));
        output.Add("landings=" + stair.GetStairsLandings().Count);
        testDocument.Save();
    }
    catch (Exception exception)
    {
        scope.Cancel();
        output.Add("ERROR " + exception.ToString());
    }
    finally
    {
        scope.Dispose();
    }
}
finally
{
}
return string.Join("\n", output);
