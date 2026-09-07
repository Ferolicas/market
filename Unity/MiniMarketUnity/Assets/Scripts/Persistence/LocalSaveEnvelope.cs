using System;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace MiniMarket.Persistence
{
    public static class LocalSaveEnvelope
    {
        public const int CurrentSchemaVersion = 1;

        public static JObject Create(JObject state, int saveRevision, JArray pendingEvents)
        {
            if (state == null) throw new ArgumentNullException(nameof(state));
            var envelope = new JObject
            {
                ["schemaVersion"] = CurrentSchemaVersion,
                ["buildVersion"] = Application.version,
                ["stateRevision"] = state.Value<int?>("revision") ?? 0,
                ["saveRevision"] = saveRevision,
                ["pendingEvents"] = pendingEvents?.DeepClone() ?? new JArray(),
                ["savedAtUtc"] = DateTime.UtcNow.ToString("O"),
                ["state"] = state.DeepClone(),
            };
            envelope["checksum"] = CalculateChecksum(envelope);
            return envelope;
        }

        public static bool TryValidate(JObject envelope, out bool legacy, out string reason)
        {
            legacy = false;
            reason = "";
            if (envelope == null)
            {
                reason = "El sobre es nulo";
                return false;
            }
            if (envelope["state"] is not JObject)
            {
                reason = "Falta el estado de juego";
                return false;
            }

            // Builds WebGL already deployed wrote this exact shape. Accept it
            // once and let SaveCoordinator rewrite it with schema and checksum.
            if (envelope["schemaVersion"] == null && envelope["checksum"] == null)
            {
                legacy = true;
                if (envelope["pendingEvents"] == null) envelope["pendingEvents"] = new JArray();
                return true;
            }

            var schemaVersion = envelope.Value<int?>("schemaVersion");
            if (schemaVersion != CurrentSchemaVersion)
            {
                reason = $"Esquema local no compatible: {schemaVersion?.ToString() ?? "ausente"}";
                return false;
            }
            if (envelope["pendingEvents"] is not JArray)
            {
                reason = "Eventos pendientes inválidos";
                return false;
            }
            var expected = envelope.Value<string>("checksum");
            if (string.IsNullOrWhiteSpace(expected))
            {
                reason = "Checksum ausente";
                return false;
            }
            var actual = CalculateChecksum(envelope);
            if (!FixedTimeEquals(expected, actual))
            {
                reason = "Checksum incorrecto";
                return false;
            }
            return true;
        }

        public static string CalculateChecksum(JObject envelope)
        {
            var payload = (JObject)envelope.DeepClone();
            payload.Remove("checksum");
            var canonical = new StringBuilder();
            AppendCanonical(canonical, payload);
            var bytes = Encoding.UTF8.GetBytes(canonical.ToString());
            using var sha = SHA256.Create();
            var hash = sha.ComputeHash(bytes);
            var result = new StringBuilder(hash.Length * 2);
            foreach (var value in hash) result.Append(value.ToString("x2"));
            return result.ToString();
        }

        // JObject keeps insertion order and also parses ISO strings as DateTime
        // by default. Neither implementation detail is part of the save. Sort
        // properties and normalize both representations before hashing.
        static void AppendCanonical(StringBuilder output, JToken token)
        {
            switch (token)
            {
                case JObject objectValue:
                    output.Append('{');
                    var firstProperty = true;
                    foreach (var property in objectValue.Properties().OrderBy(item => item.Name, StringComparer.Ordinal))
                    {
                        if (!firstProperty) output.Append(',');
                        firstProperty = false;
                        output.Append(JsonConvert.ToString(property.Name)).Append(':');
                        AppendCanonical(output, property.Value);
                    }
                    output.Append('}');
                    return;
                case JArray arrayValue:
                    output.Append('[');
                    for (var index = 0; index < arrayValue.Count; index++)
                    {
                        if (index > 0) output.Append(',');
                        AppendCanonical(output, arrayValue[index]);
                    }
                    output.Append(']');
                    return;
                case JValue value when value.Type == JTokenType.Date:
                    output.Append(JsonConvert.ToString(NormalizeDate(value.Value)));
                    return;
                case JValue value when value.Type == JTokenType.String:
                    var text = value.Value<string>();
                    output.Append(JsonConvert.ToString(TryNormalizeDate(text, out var normalized) ? normalized : text));
                    return;
                default:
                    output.Append(token.ToString(Formatting.None));
                    return;
            }
        }

        static string NormalizeDate(object value)
        {
            if (value is DateTimeOffset offset) return FormatUtc(offset.UtcDateTime);
            if (value is DateTime date) return FormatUtc(date.ToUniversalTime());
            return Convert.ToString(value, CultureInfo.InvariantCulture);
        }

        static bool TryNormalizeDate(string value, out string normalized)
        {
            normalized = null;
            if (string.IsNullOrWhiteSpace(value) || value.Length < 20 || value[4] != '-' || value[10] != 'T') return false;
            if (!DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var parsed)) return false;
            normalized = FormatUtc(parsed.UtcDateTime);
            return true;
        }

        static string FormatUtc(DateTime value)
            => value.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'", CultureInfo.InvariantCulture);

        static bool FixedTimeEquals(string left, string right)
        {
            if (left == null || right == null || left.Length != right.Length) return false;
            var difference = 0;
            for (var index = 0; index < left.Length; index++) difference |= left[index] ^ right[index];
            return difference == 0;
        }
    }
}
