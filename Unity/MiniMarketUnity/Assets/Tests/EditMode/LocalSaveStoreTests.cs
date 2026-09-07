using System;
using System.IO;
using System.Threading.Tasks;
using MiniMarket.Persistence;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;

namespace MiniMarket.Tests
{
    public sealed class LocalSaveStoreTests
    {
        string directory;
        NativeAtomicFileSaveStore store;

        [SetUp]
        public void SetUp()
        {
            directory = Path.Combine(Path.GetTempPath(), "mini-market-save-tests", Guid.NewGuid().ToString("N"));
            store = new NativeAtomicFileSaveStore(directory);
        }

        [TearDown]
        public void TearDown()
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, true);
        }

        [Test]
        public async Task AtomicWriteReadsValidatedCurrentAndPreservesPendingEvents()
        {
            var envelope = Envelope(7, 2);
            await store.WriteAsync(envelope);

            var result = await store.ReadAsync();

            Assert.That(result.Status, Is.EqualTo(LocalSaveReadStatus.Current));
            Assert.That(result.Envelope["state"].Value<int>("revision"), Is.EqualTo(7));
            Assert.That(((JArray)result.Envelope["pendingEvents"]).Count, Is.EqualTo(2));
        }

        [Test]
        public async Task SecondAtomicWriteKeepsThePreviousValidatedSnapshot()
        {
            await store.WriteAsync(Envelope(3));
            await store.WriteAsync(Envelope(4));

            var current = JObject.Parse(File.ReadAllText(store.CurrentPath));
            var previous = JObject.Parse(File.ReadAllText(store.PreviousPath));

            Assert.That(current["state"].Value<int>("revision"), Is.EqualTo(4));
            Assert.That(previous["state"].Value<int>("revision"), Is.EqualTo(3));
            Assert.That(LocalSaveEnvelope.TryValidate(previous, out _, out _), Is.True);
        }

        [Test]
        public async Task TruncatedCurrentRecoversPrevious()
        {
            await store.WriteAsync(Envelope(10));
            await store.WriteAsync(Envelope(11));
            File.WriteAllText(store.CurrentPath, "{\"schemaVersion\":1,\"state\":");

            var result = await store.ReadAsync();

            Assert.That(result.Status, Is.EqualTo(LocalSaveReadStatus.Previous));
            Assert.That(result.Envelope["state"].Value<int>("revision"), Is.EqualTo(10));
        }

        [Test]
        public async Task InvalidChecksumCurrentRecoversPrevious()
        {
            await store.WriteAsync(Envelope(20));
            await store.WriteAsync(Envelope(21));
            var corrupt = JObject.Parse(File.ReadAllText(store.CurrentPath));
            corrupt["state"]["revision"] = 999;
            File.WriteAllText(store.CurrentPath, corrupt.ToString(Formatting.None));

            var result = await store.ReadAsync();

            Assert.That(result.Status, Is.EqualTo(LocalSaveReadStatus.Previous));
            Assert.That(result.Envelope["state"].Value<int>("revision"), Is.EqualTo(20));
        }

        [Test]
        public async Task MissingFilesReportMissingAndBothCorruptReportCorrupt()
        {
            Assert.That((await store.ReadAsync()).Status, Is.EqualTo(LocalSaveReadStatus.Missing));
            Directory.CreateDirectory(directory);
            File.WriteAllText(store.CurrentPath, "bad-current");
            File.WriteAllText(store.PreviousPath, "bad-previous");

            var result = await store.ReadAsync();

            Assert.That(result.Status, Is.EqualTo(LocalSaveReadStatus.Corrupt));
            Assert.That(result.HasSave, Is.False);
        }

        [Test]
        public async Task InterruptedFirstWriteCanRecoverValidatedTemporaryFile()
        {
            Directory.CreateDirectory(directory);
            File.WriteAllText(store.TemporaryPath, Envelope(30).ToString(Formatting.None));

            var result = await store.ReadAsync();

            Assert.That(result.Status, Is.EqualTo(LocalSaveReadStatus.Temporary));
            Assert.That(result.Envelope["state"].Value<int>("revision"), Is.EqualTo(30));
        }

        [Test]
        public async Task LegacyWebEnvelopeIsAcceptedForOneWayMigration()
        {
            Directory.CreateDirectory(directory);
            var legacy = new JObject
            {
                ["state"] = new JObject { ["revision"] = 40, ["balanceMinor"] = 220000 },
                ["saveRevision"] = 5,
                ["pendingEvents"] = new JArray(),
                ["savedAt"] = DateTime.UtcNow.ToString("O"),
            };
            File.WriteAllText(store.CurrentPath, legacy.ToString(Formatting.None));

            var result = await store.ReadAsync();

            Assert.That(result.Status, Is.EqualTo(LocalSaveReadStatus.Legacy));
            Assert.That(result.Envelope["state"].Value<int>("revision"), Is.EqualTo(40));
        }

        [Test]
        public async Task ConflictBackupIsASeparateValidatedRecoveryArtifact()
        {
            var envelope = Envelope(50, 1);
            await store.WriteConflictBackupAsync(envelope);

            var files = Directory.GetFiles(Path.Combine(directory, "conflicts"), "save-conflict-*.json");
            Assert.That(files, Has.Length.EqualTo(1));
            var backup = JObject.Parse(File.ReadAllText(files[0]));
            Assert.That(LocalSaveEnvelope.TryValidate(backup, out _, out _), Is.True);
            Assert.That(backup["state"].Value<int>("revision"), Is.EqualTo(50));
        }

        static JObject Envelope(int stateRevision, int eventCount = 0)
        {
            var events = new JArray();
            for (var index = 0; index < eventCount; index++)
                events.Add(new JObject { ["eventId"] = $"event-{index}", ["sequence"] = index + 1 });
            return LocalSaveEnvelope.Create(
                new JObject { ["revision"] = stateRevision, ["balanceMinor"] = 220000 },
                stateRevision / 2,
                events);
        }
    }
}
