using System;
using System.Threading;
using System.Threading.Tasks;
using MiniMarket.Core;
using MiniMarket.Data;
using MiniMarket.Networking;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace MiniMarket.Persistence
{
    public sealed class SaveCoordinator : IDisposable
    {
        const string SessionKey = "mini-market-unity-session-v1";
        const float LocalFlushSeconds = 10f;
        public const float RemoteSyncSeconds = 30f * 60f;

        readonly MarketApiClient api;
        readonly GameSignals signals;
        readonly ILocalSaveStore localStore;
        readonly object localWriteLock = new();
        GameStateDocument state;
        float lastLocalFlush;
        float lastRemoteAttempt;
        bool syncing;
        int serverRevision;
        JArray pendingEvents = new();
        string sessionId;
        JObject pendingLocalEnvelope;
        Task localWriteTask = Task.CompletedTask;

        public int ServerRevision => serverRevision;
        public string Status { get; private set; } = "local";
        public int PendingEventCount => pendingEvents.Count;
        public LocalSaveReadStatus LastLocalReadStatus { get; private set; } = LocalSaveReadStatus.Missing;
        public JArray PendingEventsSnapshot() => (JArray)pendingEvents.DeepClone();

        public SaveCoordinator(MarketApiClient client, GameSignals gameSignals, ILocalSaveStore saveStore = null)
        {
            api = client; signals = gameSignals;
            localStore = saveStore ?? LocalSaveStoreFactory.Create();
            sessionId = PlayerPrefs.GetString(SessionKey, "");
            if (!Guid.TryParse(sessionId, out var parsedSession))
            {
                parsedSession = Guid.NewGuid();
            }
            sessionId = parsedSession.ToString("D");
            PlayerPrefs.SetString(SessionKey, sessionId);
        }

        public async Task<GameStateDocument> LoadAsync(GameSpecRepository spec)
        {
            JObject local = null;
            try
            {
                var localResult = await localStore.ReadAsync();
                LastLocalReadStatus = localResult.Status;
                local = localResult.Envelope;
                if (localResult.Status is LocalSaveReadStatus.Previous or LocalSaveReadStatus.Temporary)
                {
                    Debug.LogWarning($"SAVE recuperación local desde {localResult.Status}: {localStore.Description}");
                    Status = "recovered-local";
                }
                else if (localResult.Status == LocalSaveReadStatus.Corrupt)
                {
                    Debug.LogWarning($"SAVE ninguna copia local válida: {localResult.Detail}");
                }
            }
            catch (Exception exception) { Debug.LogWarning($"SAVE recuperación local inválida: {exception.Message}"); }

            JObject selected = local?["state"] as JObject;
            serverRevision = local?.Value<int?>("saveRevision") ?? 0;
            pendingEvents = local?["pendingEvents"] as JArray ?? new JArray();
            if (selected == null) selected = spec.CreateInitialState();

            try
            {
                var remote = await api.LoadAsync();
                var remoteState = remote["state"] as JObject;
                var remoteRevision = remote.Value<int?>("saveRevision") ?? 0;
                var localStateRevision = selected.Value<int?>("revision") ?? 0;
                var remoteStateRevision = remoteState?.Value<int?>("revision") ?? 0;
                if (remoteState != null && (local == null || remoteRevision != serverRevision || remoteStateRevision >= localStateRevision))
                {
                    selected = remoteState;
                    pendingEvents = new JArray();
                }
                serverRevision = remoteRevision;
                Status = localStateRevision > remoteStateRevision && remoteRevision == serverRevision ? "dirty" : "saved";
            }
            catch
            {
                Status = local == null ? "offline-new" : "offline";
            }

            state = new GameStateDocument((JObject)selected.DeepClone(), signals);
            state.Root["lastServerTime"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            SaveLocal(forceFlush: true);
            return state;
        }

        public void Tick(float unscaledTime)
        {
            if (state == null) return;
            if (state.IsDirty && unscaledTime - lastLocalFlush >= LocalFlushSeconds) SaveLocal(forceFlush: true);
            if (state.IsDirty && !syncing && unscaledTime - lastRemoteAttempt >= RemoteSyncSeconds) _ = SyncRemoteAsync(unscaledTime);
        }

        public void QueueEvent(string category, string description, long amountMinor = 0,
            string franchiseId = null, string scope = "franchise")
        {
            var eventId = Guid.NewGuid().ToString("D");
            var sequence = (state.Root.Value<int?>("eventSequence") ?? 0) + 1;
            var occurredAt = DateTime.UtcNow.ToString("O");
            var payload = new JObject { ["scope"] = scope };
            var domainEvent = new JObject
            {
                ["eventId"] = eventId,
                ["idempotencyKey"] = eventId,
                ["franchiseId"] = franchiseId ?? state.CurrentFranchise.Value<string>("id"),
                ["category"] = category,
                ["description"] = description,
                ["amountMinor"] = amountMinor,
                ["sequence"] = sequence,
                ["occurredAt"] = occurredAt,
                ["type"] = category,
                ["payload"] = payload,
            };
            pendingEvents.Add(domainEvent);
            state.Root["eventSequence"] = sequence;
            if (state.Root["processedEventIds"] is not JArray processed) state.Root["processedEventIds"] = processed = new JArray();
            processed.Add(eventId);
            while (processed.Count > 1000) processed.RemoveAt(0);
            state.Changed();
            SaveLocal(false);
        }

        public void SaveLocal(bool forceFlush)
        {
            if (state == null) return;
            pendingLocalEnvelope = LocalSaveEnvelope.Create(state.CloneRoot(), serverRevision, (JArray)pendingEvents.DeepClone());
            if (forceFlush)
            {
                lastLocalFlush = Time.unscaledTime;
                ScheduleLocalWrite((JObject)pendingLocalEnvelope.DeepClone());
            }
            if (state.IsDirty) Status = "dirty";
        }

        public Task FlushLocalAsync(CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (state == null) return Task.CompletedTask;
            SaveLocal(forceFlush: true);
            lock (localWriteLock) return localWriteTask;
        }

        void ScheduleLocalWrite(JObject envelope)
        {
            lock (localWriteLock)
                localWriteTask = WriteAfterAsync(localWriteTask, envelope);
        }

        async Task WriteAfterAsync(Task previous, JObject envelope)
        {
            try
            {
                await previous;
                await localStore.WriteAsync(envelope);
            }
            catch (Exception exception)
            {
                Status = "local-error";
                Debug.LogError($"SAVE no pudo persistir en {localStore.Description}: {exception.Message}");
            }
        }

        public async Task<bool> SyncRemoteAsync(float unscaledTime = -1f)
        {
            if (state == null || syncing) return false;
            if (!api.RemoteEnabled)
            {
                Status = "local";
                SaveLocal(forceFlush: true);
                return false;
            }
            syncing = true;
            lastRemoteAttempt = unscaledTime >= 0 ? unscaledTime : Time.unscaledTime;
            Status = "syncing";
            var sentEvents = (JArray)pendingEvents.DeepClone();
            try
            {
                var snapshot = state.CloneRoot();
                snapshot["lastSavedAt"] = DateTime.UtcNow.ToString("O");
                // The snapshot is now in flight. Any gameplay mutation while
                // awaiting HTTP marks the live document dirty again and must
                // survive the successful response instead of being erased.
                state.MarkSaved();
                var response = await api.SaveAsync(serverRevision, sessionId, snapshot, sentEvents);
                if (response.Value<long?>("httpStatus") == 409)
                {
                    state.MarkDirty();
                    var conflict = LocalSaveEnvelope.Create(state.CloneRoot(), serverRevision, (JArray)pendingEvents.DeepClone());
                    await localStore.WriteConflictBackupAsync(conflict);
                    Status = "conflict";
                    signals.PublishNotification("Conflicto remoto: se conservó una copia local");
                    return false;
                }
                serverRevision = response.Value<int?>("saveRevision") ?? serverRevision + 1;
                var sentIds = new System.Collections.Generic.HashSet<string>();
                foreach (var item in sentEvents) sentIds.Add(item.Value<string>("eventId"));
                var remaining = new JArray();
                foreach (var item in pendingEvents) if (!sentIds.Contains(item.Value<string>("eventId"))) remaining.Add(item);
                pendingEvents = remaining;
                if (pendingEvents.Count > 0) state.MarkDirty();
                Status = state.IsDirty ? "dirty" : "saved";
                SaveLocal(forceFlush: true);
                return true;
            }
            catch (Exception exception)
            {
                state.MarkDirty();
                Status = "offline";
                SaveLocal(forceFlush: true);
                Debug.LogWarning($"Sincronización aplazada: {exception.Message}");
                return false;
            }
            finally { syncing = false; }
        }

        public void Dispose()
        {
            SaveLocal(forceFlush: true);
            try
            {
                Task pending;
                lock (localWriteLock) pending = localWriteTask;
                pending.GetAwaiter().GetResult();
            }
            catch (Exception exception)
            {
                Debug.LogError($"SAVE cierre local incompleto: {exception.Message}");
            }
        }
    }
}
