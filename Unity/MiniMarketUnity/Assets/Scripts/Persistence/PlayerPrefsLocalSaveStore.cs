using System;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace MiniMarket.Persistence
{
    public sealed class PlayerPrefsLocalSaveStore : ILocalSaveStore
    {
        public const string CurrentKey = "mini-market-unity-recovery-v1";
        public const string PreviousKey = "mini-market-unity-recovery-previous-v1";
        const string ConflictPrefix = "mini-market-unity-conflict-";

        public string Description => "PlayerPrefs";

        public Task<LocalSaveReadResult> ReadAsync(CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var current = ReadKey(CurrentKey, LocalSaveReadStatus.Current);
            if (current.HasSave) return Task.FromResult(current);
            var previous = ReadKey(PreviousKey, LocalSaveReadStatus.Previous);
            if (previous.HasSave) return Task.FromResult(previous);
            if (current.Status == LocalSaveReadStatus.Corrupt || previous.Status == LocalSaveReadStatus.Corrupt)
                return Task.FromResult(new LocalSaveReadResult(LocalSaveReadStatus.Corrupt, detail: JoinDetails(current.Detail, previous.Detail)));
            return Task.FromResult(new LocalSaveReadResult(LocalSaveReadStatus.Missing));
        }

        public Task WriteAsync(JObject envelope, CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            EnsureValid(envelope);
            var existing = ReadKey(CurrentKey, LocalSaveReadStatus.Current);
            if (existing.HasSave) PlayerPrefs.SetString(PreviousKey, existing.Envelope.ToString(Formatting.None));
            PlayerPrefs.SetString(CurrentKey, envelope.ToString(Formatting.None));
            PlayerPrefs.Save();
            return Task.CompletedTask;
        }

        public Task WriteConflictBackupAsync(JObject envelope, CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            EnsureValid(envelope);
            var key = ConflictPrefix + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            PlayerPrefs.SetString(key, envelope.ToString(Formatting.None));
            PlayerPrefs.Save();
            return Task.CompletedTask;
        }

        static LocalSaveReadResult ReadKey(string key, LocalSaveReadStatus successStatus)
        {
            var text = PlayerPrefs.GetString(key, "");
            if (string.IsNullOrWhiteSpace(text)) return new LocalSaveReadResult(LocalSaveReadStatus.Missing);
            try
            {
                var envelope = JObject.Parse(text);
                if (!LocalSaveEnvelope.TryValidate(envelope, out var legacy, out var reason))
                    return new LocalSaveReadResult(LocalSaveReadStatus.Corrupt, detail: $"{key}: {reason}");
                return new LocalSaveReadResult(legacy ? LocalSaveReadStatus.Legacy : successStatus, envelope);
            }
            catch (Exception exception)
            {
                return new LocalSaveReadResult(LocalSaveReadStatus.Corrupt, detail: $"{key}: {exception.Message}");
            }
        }

        static void EnsureValid(JObject envelope)
        {
            if (!LocalSaveEnvelope.TryValidate(envelope, out var legacy, out var reason) || legacy)
                throw new InvalidOperationException($"No se guardará un sobre local inválido: {reason}");
        }

        static string JoinDetails(string left, string right)
            => string.Join("; ", new[] { left, right }).Trim(' ', ';');
    }
}
