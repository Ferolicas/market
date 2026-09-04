using System;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Networking;

namespace MiniMarket.Networking
{
    public sealed class MarketApiClient
    {
        readonly string baseUrl;
        public bool RemoteEnabled { get; }
        public MarketApiClient(string configuredBaseUrl = "")
        {
            baseUrl = configuredBaseUrl?.TrimEnd('/') ?? "";
            RemoteEnabled = true;
#if UNITY_WEBGL && !UNITY_EDITOR
            if (string.IsNullOrEmpty(baseUrl) && Uri.TryCreate(Application.absoluteURL, UriKind.Absolute, out var current))
                RemoteEnabled = !current.IsLoopback;
#endif
        }
        string Url(string path) => string.IsNullOrEmpty(baseUrl) ? path : baseUrl + path;

        public async Task<JObject> LoadAsync()
        {
            if (!RemoteEnabled) throw new InvalidOperationException("Backend remoto desactivado en ejecución local");
            using var request = UnityWebRequest.Get(Url("/api/game/save"));
            request.SetRequestHeader("Accept", "application/json");
            await Send(request);
            return JObject.Parse(request.downloadHandler.text);
        }

        public async Task<JObject> SaveAsync(int expectedRevision, string sessionId, JObject state, JArray events)
        {
            if (!RemoteEnabled) throw new InvalidOperationException("Backend remoto desactivado en ejecución local");
            var body = new JObject
            {
                ["expectedRevision"] = expectedRevision,
                ["sessionId"] = sessionId,
                ["state"] = state,
                ["events"] = events ?? new JArray(),
            }.ToString(Newtonsoft.Json.Formatting.None);
            using var request = new UnityWebRequest(Url("/api/game/save"), UnityWebRequest.kHttpVerbPUT)
            {
                uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(body)),
                downloadHandler = new DownloadHandlerBuffer(),
            };
            request.SetRequestHeader("Content-Type", "application/json");
            await Send(request, allowConflict: true);
            var payload = string.IsNullOrWhiteSpace(request.downloadHandler.text) ? new JObject() : JObject.Parse(request.downloadHandler.text);
            payload["httpStatus"] = request.responseCode;
            return payload;
        }

        static async Task Send(UnityWebRequest request, bool allowConflict = false)
        {
            request.timeout = 30;
            var operation = request.SendWebRequest();
            while (!operation.isDone) await Task.Yield();
            if (request.result == UnityWebRequest.Result.Success) return;
            if (allowConflict && request.responseCode == 409) return;
            throw new InvalidOperationException($"HTTP {request.responseCode}: {request.error}");
        }
    }
}
