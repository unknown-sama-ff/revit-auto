using RevitAutoV27;

internal static class UnassignedEquipmentConnectionRulesTests
{
    private static PipingPortNativeEvidence Equipment() => new(new(10, 3, "UndefinedSystemType", null, null),
        "equipment-uid", "FamilyInstance", "OST_MechanicalEquipment", "DomainPiping", "End", true,
        new(true, false, null, null, PipingAssignmentReadSource.SelectedConnectorMepSystem));
    private static PipingPortNativeEvidence Pipe() => new(new(20, 0, "UndefinedSystemType", 500, "SupplyHydronic"),
        "pipe-uid", "Pipe", "OST_PipeCurves", "DomainPiping", "End", true,
        new(true, true, 500, "SupplyHydronic", PipingAssignmentReadSource.PipeSystemTypeParameter));
    private static PipingPortNativeEvidence Assigned(PipingPortNativeEvidence e, long typeId = 500, string classification = "SupplyHydronic") =>
        e with { Piping = e.Piping with { ConnectorClass = classification, AssignedSystemTypeId = typeId, AssignedClass = classification },
            Assignment = new(true, true, typeId, classification, PipingAssignmentReadSource.SelectedConnectorMepSystem) };
    private static PipingConnectionDecision Allow(PipingPortNativeEvidence? first = null, PipingPortNativeEvidence? second = null) =>
        UnassignedEquipmentConnectionRules.RequireCompatible(first ?? Equipment(), second ?? Pipe(), true);
    private static UnassignedEquipmentConnectionReadback Connected() => new(Assigned(Equipment()), Assigned(Pipe()), true, true);
    private static void Reject(Action action, string? expected = null)
    {
        try { action(); } catch (BridgeException e) when (expected is null || e.Code == expected) { return; }
        throw new Exception("Expected refusal" + (expected is null ? "." : ": " + expected));
    }
    internal static void Run(Action<string, Action> test)
    {
        test("unassigned equipment allowance defaults off and remains unavailable to fittings", () =>
        {
            Reject(() => UnassignedEquipmentConnectionRules.RequireCompatible(Equipment(), Pipe()), "piping_classification_unknown");
            foreach (var operation in new[] { "create_fitting", "create_pipe", "other", "" })
                Reject(() => UnassignedEquipmentConnectionRules.RequireCompatible(Equipment(), Pipe(), true, operation), "piping_classification_unknown");
        });
        test("explicit allowance binds known unassigned equipment in either endpoint order", () =>
        {
            var first = Allow(); var second = Allow(Pipe(), Equipment());
            if (!first.UsesUnassignedEquipmentAllowance || first.UnassignedEndpoint != "first" ||
                second.UnassignedEndpoint != "second" || first.Classification != "SupplyHydronic" ||
                first.RequiredSystemTypeId != 500 || first.First != Equipment() || first.Second != Pipe())
                throw new Exception("Native prebinding proof was lost.");
            Allow(second: Pipe() with { Assignment = Pipe().Assignment with { Source = PipingAssignmentReadSource.SelectedConnectorMepSystem } });
        });
        test("classified legacy matches including differing type ids are unchanged with either flag", () =>
        {
            var equipment = Assigned(Equipment(), 600); var pipe = Assigned(Pipe());
            foreach (var flag in new[] { false, true })
            {
                var decision = UnassignedEquipmentConnectionRules.RequireCompatible(equipment, pipe, flag);
                if (decision.UsesUnassignedEquipmentAllowance || decision.RequiredSystemTypeId is not null)
                    throw new Exception("Legacy match unnecessarily entered allowance.");
                // Existing strict policy has no dependency on the added metadata or native-error fields.
                UnassignedEquipmentConnectionRules.RequireCompatible(equipment with { ConnectorClassReadSucceeded = false,
                    Assignment = equipment.Assignment with { Succeeded = false }, NativeError = "legacy metadata" }, pipe, flag);
            }
        });
        test("classified legacy mismatches and contradictory evidence are never bypassed", () =>
        {
            foreach (var flag in new[] { false, true })
            {
                Reject(() => UnassignedEquipmentConnectionRules.RequireCompatible(Assigned(Equipment()), Assigned(Pipe(), 500, "ReturnHydronic"), flag), "piping_classification_mismatch");
                Reject(() => UnassignedEquipmentConnectionRules.RequireCompatible(Assigned(Equipment()) with {
                    Piping = new(10, 3, "ReturnHydronic", 500, "SupplyHydronic") }, Pipe(), flag), "piping_classification_conflict");
            }
        });
        test("unassigned allowance rejects unreadable unknown unsupported or errored assignment", () =>
        {
            var e = Equipment();
            foreach (var assignment in new[] { e.Assignment with { Succeeded = false }, e.Assignment with { HasAssignedType = null },
                e.Assignment with { Source = PipingAssignmentReadSource.Unknown }, e.Assignment with { NativeError = "failure" },
                e.Assignment with { Source = PipingAssignmentReadSource.PipeSystemTypeParameter } })
                Reject(() => Allow(e with { Assignment = assignment }));
            Reject(() => Allow(e with { ConnectorClassReadSucceeded = false }));
            Reject(() => Allow(e with { NativeError = "failure" }));
            Reject(() => Allow(e with { Piping = e.Piping with { NativeError = "failure" } }));
            Reject(() => Allow(e with { Piping = e.Piping with { ConnectorClass = null } }));
            Reject(() => Allow(e with { Piping = e.Piping with { ConnectorClass = "UndefinedSystemClassification" } }));
        });
        test("unassigned allowance rejects invalid owner category domain identity and logical ports", () =>
        {
            var e = Equipment(); var p = Pipe();
            foreach (var invalid in new[] { e with { OwnerKind = "MEPCurve" }, e with { Category = "OST_PipeFitting" },
                e with { OwnerUniqueId = "" }, e with { Domain = "DomainHvac" }, e with { ConnectorType = "Logical" },
                e with { Piping = e.Piping with { ElementId = 0 } }, e with { Piping = e.Piping with { ConnectorId = -1 } } })
                Reject(() => Allow(invalid));
            foreach (var invalid in new[] { p with { OwnerKind = "FamilyInstance" }, p with { Category = "OST_MechanicalEquipment" },
                p with { Domain = "DomainHvac" }, p with { ConnectorType = "Logical" }, p with { OwnerUniqueId = "" },
                p with { Piping = p.Piping with { ElementId = e.Piping.ElementId } } })
                Reject(() => Allow(second: invalid));
        });
        test("unassigned allowance rejects two unassigned ports and false absence with assigned facts", () =>
        {
            var e = Equipment();
            Reject(() => Allow(e, e with { Piping = e.Piping with { ElementId = 30 } }));
            foreach (var invalid in new[] { e with { Assignment = e.Assignment with { HasAssignedType = true } },
                e with { Assignment = e.Assignment with { TypeId = 500 } }, e with { Assignment = e.Assignment with { Classification = "SupplyHydronic" } },
                e with { Piping = e.Piping with { AssignedSystemTypeId = 500 } }, e with { Piping = e.Piping with { AssignedClass = "SupplyHydronic" } } })
                Reject(() => Allow(invalid));
        });
        test("unassigned allowance requires actual pipe assigned type and consistent concrete class", () =>
        {
            var p = Pipe();
            foreach (var assignment in new[] { p.Assignment with { Succeeded = false }, p.Assignment with { HasAssignedType = false },
                p.Assignment with { HasAssignedType = null }, p.Assignment with { TypeId = null }, p.Assignment with { TypeId = -1 },
                p.Assignment with { TypeId = 501 }, p.Assignment with { Classification = "ReturnHydronic" },
                p.Assignment with { Source = PipingAssignmentReadSource.Unknown }, p.Assignment with { NativeError = "failure" } })
                Reject(() => Allow(second: p with { Assignment = assignment }));
            Reject(() => Allow(second: p with { Piping = p.Piping with { ConnectorClass = "ReturnHydronic" } }), "piping_classification_conflict");
            Reject(() => Allow(second: p with { Piping = p.Piping with { AssignedClass = "Other" }, Assignment = p.Assignment with { Classification = "Other" } }));
            Reject(() => Allow(second: p with { ConnectorClassReadSucceeded = false }));
            Reject(() => Allow(second: p with { NativeError = "failure" }));
        });
        test("allowance readback retains prebinding proof while equipment gains system assignment", () =>
        {
            var expected = Allow(); var actual = Connected();
            UnassignedEquipmentConnectionRules.RequireReadback(expected, actual);
            UnassignedEquipmentConnectionRules.RequireReadback(Allow(Pipe(), Equipment()),
                new(actual.Second, actual.First, true, true));
            // Instantaneous connector class may remain undefined when verified assigned type provides the class.
            UnassignedEquipmentConnectionRules.RequireReadback(expected,
                actual with { First = actual.First with { Piping = actual.First.Piping with { ConnectorClass = "UndefinedSystemType" } } });
        });
        test("allowance readback rejects unilateral absent or substituted endpoint connections", () =>
        {
            var expected = Allow(); var actual = Connected();
            foreach (var invalid in new[] { actual with { FirstReferencesSecond = false }, actual with { SecondReferencesFirst = false },
                actual with { First = actual.First with { OwnerUniqueId = "substituted" } },
                actual with { Second = actual.Second with { Piping = actual.Second.Piping with { ConnectorId = 1 } } },
                actual with { First = actual.First with { Piping = actual.First.Piping with { ElementId = 11 } } },
                actual with { First = actual.First with { Category = "OST_PipeFitting" } } })
                Reject(() => UnassignedEquipmentConnectionRules.RequireReadback(expected, invalid));
        });
        test("allowance readback rejects missing unknown mismatched or contradictory assignment", () =>
        {
            var expected = Allow(); var actual = Connected();
            foreach (var endpoint in new[] { Equipment(), Assigned(Equipment(), 501), Assigned(Equipment(), 500, "ReturnHydronic"),
                actual.First with { ConnectorClassReadSucceeded = false },
                actual.First with { Assignment = actual.First.Assignment with { Succeeded = false } },
                actual.First with { Piping = actual.First.Piping with { NativeError = "failure" } },
                actual.First with { Piping = actual.First.Piping with { ConnectorClass = "ReturnHydronic" } } })
                Reject(() => UnassignedEquipmentConnectionRules.RequireReadback(expected, actual with { First = endpoint }));
            Reject(() => UnassignedEquipmentConnectionRules.RequireReadback(expected,
                actual with { Second = Assigned(Pipe(), 501) }));
        });
        test("allowance readback refuses forged or ordinary strict decision", () =>
        {
            var expected = Allow();
            foreach (var invalid in new[] { expected with { Classification = "ReturnHydronic" },
                expected with { RequiredSystemTypeId = 501 }, expected with { UnassignedEndpoint = "second" },
                expected with { UsesUnassignedEquipmentAllowance = false },
                expected with { First = expected.First with { Assignment = expected.First.Assignment with { Succeeded = false } } } })
                Reject(() => UnassignedEquipmentConnectionRules.RequireReadback(invalid, Connected()));
        });
    }
}
