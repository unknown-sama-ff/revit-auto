double Mm(double value) => UnitUtils.ConvertToInternalUnits(value, UnitTypeId.Millimeters);
XYZ Point(double x, double y) => new XYZ(Mm(x), Mm(y), 0);
var levels = new FilteredElementCollector(document).OfClass(typeof(Level)).Cast<Level>()
    .OrderBy(level => level.Elevation).Take(2).ToList();
var assemblyName = new System.Reflection.AssemblyName("RevitStairPreprocessor" + Guid.NewGuid().ToString("N"));
var assembly = System.Reflection.Emit.AssemblyBuilder.DefineDynamicAssembly(assemblyName,
    System.Reflection.Emit.AssemblyBuilderAccess.Run);
var module = assembly.DefineDynamicModule(assemblyName.Name);
var typeBuilder = module.DefineType("StairPreprocessor",
    System.Reflection.TypeAttributes.Public | System.Reflection.TypeAttributes.Class);
typeBuilder.AddInterfaceImplementation(typeof(IFailuresPreprocessor));
var methodBuilder = typeBuilder.DefineMethod("PreprocessFailures",
    System.Reflection.MethodAttributes.Public | System.Reflection.MethodAttributes.Virtual,
    typeof(FailureProcessingResult), new[] { typeof(FailuresAccessor) });
var generator = methodBuilder.GetILGenerator();
generator.Emit(System.Reflection.Emit.OpCodes.Ldc_I4, (int)FailureProcessingResult.Continue);
generator.Emit(System.Reflection.Emit.OpCodes.Ret);
typeBuilder.DefineMethodOverride(methodBuilder, typeof(IFailuresPreprocessor).GetMethod("PreprocessFailures"));
var preprocessor = (IFailuresPreprocessor)Activator.CreateInstance(typeBuilder.CreateType());
var scope = new StairsEditScope(document, "照明模型 - 楼梯");
try
{
    var stairsId = scope.Start(levels[0].Id, levels[1].Id);
    Autodesk.Revit.DB.Architecture.StairsRun firstRun;
    Autodesk.Revit.DB.Architecture.StairsRun secondRun;
    using (var transaction = new Transaction(document, "两跑楼梯与平台"))
    {
        transaction.Start();
        firstRun = Autodesk.Revit.DB.Architecture.StairsRun.CreateStraightRun(document, stairsId,
            Line.CreateBound(Point(3800, 9000), Point(3800, 12300)),
            Autodesk.Revit.DB.Architecture.StairsRunJustification.Center);
        firstRun.ActualRunWidth = Mm(1200);
        secondRun = Autodesk.Revit.DB.Architecture.StairsRun.CreateStraightRun(document, stairsId,
            Line.CreateBound(Point(5300, 12300), Point(5300, 9000)),
            Autodesk.Revit.DB.Architecture.StairsRunJustification.Center);
        secondRun.ActualRunWidth = Mm(1200);
        if (Autodesk.Revit.DB.Architecture.StairsLanding.CanCreateAutomaticLanding(document, firstRun.Id, secondRun.Id))
            Autodesk.Revit.DB.Architecture.StairsLanding.CreateAutomaticLanding(document, firstRun.Id, secondRun.Id);
        if (transaction.Commit() != TransactionStatus.Committed)
            throw new InvalidOperationException("Stair run transaction did not commit.");
    }
    scope.Commit(preprocessor);
    document.Save();
    return "stairs=" + stairsId.Value + " firstRisers=" + firstRun.ActualRisersNumber
        + " secondRisers=" + secondRun.ActualRisersNumber;
}
catch (Exception exception)
{
    scope.Cancel();
    return exception.ToString();
}
finally
{
    scope.Dispose();
}
