using System.Text.Json;

namespace RevitAutoV27;

// Must be called during the ExternalEvent API context. The returned JSON owns only
// data; its later bridge-thread serialization never re-enumerates native wrappers.
internal static class NativeReadSnapshot
{
    public static JsonElement Freeze(object value) => JsonSerializer.SerializeToElement(value, JsonDefaults.Options);
}
