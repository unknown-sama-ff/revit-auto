using System.Text;
using System.Text.Json;
using RevitAutoV27;

internal static class CommandResponseBudgetTests
{
    internal static void Run(Action<string, Action> test)
    {
        test("response budget includes exact wire newline and reserved future capture", () =>
        {
            CommandResponseBudget.RequireFits(new string('a', CommandResponseBudget.MaxWireBytes - 2));
            Reject("response_too_large", () => CommandResponseBudget.RequireFits(new string('a', CommandResponseBudget.MaxWireBytes - 1)));
            CommandResponseBudget.RequireFits("a", CommandResponseBudget.MaxWireBytes - 3);
            Reject("response_too_large", () => CommandResponseBudget.RequireFits("a", CommandResponseBudget.MaxWireBytes - 2));
        });
        test("response budget measures UTF8 bytes instead of string character count", () =>
        {
            var encoded = new string('汉', CommandResponseBudget.MaxWireBytes / 3);
            Reject("response_too_large", () => CommandResponseBudget.RequireFits(encoded));
        });
        test("prospective success serialization rejects nonfinite evidence before transport fallback", () =>
        {
            var result = CommandResult.Success(new { dimensions = new[] { double.NaN } });
            Reject("response_serialization_failed", () => result.PrepareBounded());
            using var fallback = JsonDocument.Parse(result.Serialize());
            if (fallback.RootElement.GetProperty("ok").GetBoolean()) throw new Exception("Transport fallback claimed successful evidence.");
        });
        test("prepared success wire is immutable after prospective receipt passes", () =>
        {
            var evidence = new Dictionary<string, object> { ["status"] = "committed" };
            var response = CommandResult.Success(evidence).PrepareBounded();
            var wire = response.Serialize();
            evidence["unexpected"] = double.NaN;
            if (response.Serialize() != wire) throw new Exception("Evidence changed after wire was prepared.");
        });
        test("recoverable committed plan response includes duplicated warnings and operations in its budget", () =>
        {
            var plan = new ModelPlan { DocumentIdentity = "doc", DocumentRevision = 0, Summary = "review", Operations = [] };
            plan.Warnings.Add(new string('x', 4096));
            var receipt = new { status = "committed", warnings = plan.Warnings.ToArray() };
            var receiptWire = CommandResult.Success(receipt).PrepareBounded().Serialize();
            var planWire = CommandResult.Success(plan.ProspectiveCommittedView(receipt)).PrepareBounded().Serialize();
            if (planWire.Length <= receiptWire.Length + 4096) throw new Exception("Recoverable plan fields were omitted.");
            using var decoded = JsonDocument.Parse(planWire);
            if (decoded.RootElement.GetProperty("result").GetProperty("status").GetString() != "committed" || plan.Status != "pending" || plan.Receipt is not null)
                throw new Exception("Prospective receipt changed live pending plan state.");
        });
        test("native capture reservation covers maximal escaped labels and ID arrays and tracks custom caps", () =>
        {
            var identity = new string('\u0001', 32);
            var recorder = new NativeChangeReceipt(identity, 0);
            var ids = Enumerable.Range(0, NativeChangeReceipt.DefaultElementLimit).Select(i => long.MaxValue - i).ToArray();
            var names = Enumerable.Repeat(new string('\u0001', 500), 3).ToArray();
            for (var revision = 1; revision <= NativeChangeReceipt.DefaultEventLimit; revision++)
                recorder.Record(identity, revision, new string('\u0001', 120), names, ids, ids, ids);
            var evidence = recorder.Snapshot(NativeChangeReceipt.DefaultEventLimit, "committed", [], []);
            var bytes = Encoding.UTF8.GetByteCount(JsonSerializer.Serialize(new { nativeChanges = evidence }, JsonDefaults.Options));
            if (bytes >= recorder.ResponseSizeReservationBytes || recorder.ResponseSizeReservationBytes >= 4 * 1024 * 1024)
                throw new Exception("Default native capture reservation does not cover worst-case serialized evidence.");
            var expanded = new NativeChangeReceipt(identity, 0, elementLimit: 100000, eventLimit: 1024);
            if (expanded.ResponseSizeReservationBytes <= recorder.ResponseSizeReservationBytes)
                throw new Exception("Native response bound did not follow actual evidence caps.");
        });
    }

    private static void Reject(string code, Action action)
    {
        try { action(); }
        catch (BridgeException error) when (error.Code == code) { return; }
        throw new Exception("Expected " + code);
    }
}
