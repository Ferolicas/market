using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace MiniMarket.Persistence
{
    public sealed class NativeAtomicFileSaveStore : ILocalSaveStore
    {
        public const string CurrentFileName = "save-current.json";
        public const string PreviousFileName = "save-previous.json";
        public const string TemporaryFileName = "save.tmp";

        readonly string rootDirectory;
        public string Description => rootDirectory;
        public string CurrentPath => Path.Combine(rootDirectory, CurrentFileName);
        public string PreviousPath => Path.Combine(rootDirectory, PreviousFileName);
        public string TemporaryPath => Path.Combine(rootDirectory, TemporaryFileName);

        public NativeAtomicFileSaveStore(string rootPath = null)
        {
            rootDirectory = string.IsNullOrWhiteSpace(rootPath)
                ? Path.Combine(Application.persistentDataPath, "MiniMarket")
                : rootPath;
        }

        public Task<LocalSaveReadResult> ReadAsync(CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var current = ReadFile(CurrentPath, LocalSaveReadStatus.Current);
            if (current.HasSave) return Task.FromResult(current);
            var previous = ReadFile(PreviousPath, LocalSaveReadStatus.Previous);
            if (previous.HasSave) return Task.FromResult(previous);
            var temporary = ReadFile(TemporaryPath, LocalSaveReadStatus.Temporary);
            if (temporary.HasSave) return Task.FromResult(temporary);
            if (current.Status == LocalSaveReadStatus.Corrupt ||
                previous.Status == LocalSaveReadStatus.Corrupt ||
                temporary.Status == LocalSaveReadStatus.Corrupt)
            {
                var detail = string.Join("; ", new[] { current.Detail, previous.Detail, temporary.Detail }).Trim(' ', ';');
                return Task.FromResult(new LocalSaveReadResult(LocalSaveReadStatus.Corrupt, detail: detail));
            }
            return Task.FromResult(new LocalSaveReadResult(LocalSaveReadStatus.Missing));
        }

        public Task WriteAsync(JObject envelope, CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            EnsureValid(envelope);
            Directory.CreateDirectory(rootDirectory);
            WriteThrough(TemporaryPath, envelope.ToString(Formatting.None), cancellationToken);

            var verified = ReadFile(TemporaryPath, LocalSaveReadStatus.Temporary);
            if (!verified.HasSave) throw new IOException($"La copia temporal no superó validación: {verified.Detail}");

            if (File.Exists(CurrentPath))
            {
                var current = ReadFile(CurrentPath, LocalSaveReadStatus.Current);
                if (current.HasSave)
                {
                    try
                    {
                        File.Replace(TemporaryPath, CurrentPath, PreviousPath, true);
                        return Task.CompletedTask;
                    }
                    catch (PlatformNotSupportedException) { }
                    catch (IOException) { }

                    WriteThrough(PreviousPath, current.Envelope.ToString(Formatting.None), cancellationToken);
                }
                File.Delete(CurrentPath);
            }
            File.Move(TemporaryPath, CurrentPath);
            return Task.CompletedTask;
        }

        public Task WriteConflictBackupAsync(JObject envelope, CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            EnsureValid(envelope);
            var directory = Path.Combine(rootDirectory, "conflicts");
            Directory.CreateDirectory(directory);
            var path = Path.Combine(directory, $"save-conflict-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}.json");
            WriteThrough(path, envelope.ToString(Formatting.None), cancellationToken);
            return Task.CompletedTask;
        }

        static LocalSaveReadResult ReadFile(string path, LocalSaveReadStatus successStatus)
        {
            if (!File.Exists(path)) return new LocalSaveReadResult(LocalSaveReadStatus.Missing);
            try
            {
                var envelope = JObject.Parse(File.ReadAllText(path, Encoding.UTF8));
                if (!LocalSaveEnvelope.TryValidate(envelope, out var legacy, out var reason))
                    return new LocalSaveReadResult(LocalSaveReadStatus.Corrupt, detail: $"{Path.GetFileName(path)}: {reason}");
                return new LocalSaveReadResult(legacy ? LocalSaveReadStatus.Legacy : successStatus, envelope);
            }
            catch (Exception exception)
            {
                return new LocalSaveReadResult(LocalSaveReadStatus.Corrupt, detail: $"{Path.GetFileName(path)}: {exception.Message}");
            }
        }

        static void WriteThrough(string path, string content, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var bytes = new UTF8Encoding(false).GetBytes(content);
            using var stream = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough);
            stream.Write(bytes, 0, bytes.Length);
            stream.Flush(true);
        }

        static void EnsureValid(JObject envelope)
        {
            if (!LocalSaveEnvelope.TryValidate(envelope, out var legacy, out var reason) || legacy)
                throw new InvalidOperationException($"No se guardará un sobre local inválido: {reason}");
        }
    }
}
