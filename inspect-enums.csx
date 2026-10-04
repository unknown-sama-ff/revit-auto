return "phase=" + string.Join(",", Enum.GetNames(typeof(Autodesk.Revit.DB.Electrical.ElectricalPhase)))
    + " config=" + string.Join(",", Enum.GetNames(typeof(Autodesk.Revit.DB.Electrical.ElectricalPhaseConfiguration)));
