using System;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Networking;

namespace MiniMarket.Networking
{
    public enum MarketApiErrorKind { Offline, Timeout, Unauthorized, Conflict, RateLimited, Server, InvalidResponse, Unknown }

    public sealed class MarketApiException : Exception
    {
        public MarketApiErrorKind Kind { get; }
        public long StatusCode { get; }
        public MarketApiException(MarketApiErrorKind kind,long statusCode,string message) : base(message)
        { Kind=kind;StatusCode=statusCode; }
    }

    public sealed class MarketApiClient
    {
        const int TimeoutSeconds=30;
        const int LoadAttempts=3;
        readonly string baseUrl;
        public bool RemoteEnabled { get; }
        public MarketApiClient(string configuredBaseUrl = "")
        {
            var selectedBaseUrl=configuredBaseUrl?.TrimEnd('/')??"";
#if (UNITY_ANDROID || UNITY_IOS) && !UNITY_EDITOR
            if(string.IsNullOrEmpty(selectedBaseUrl))selectedBaseUrl="https://market.olcas.app";
#endif
            baseUrl = selectedBaseUrl;
            RemoteEnabled = true;
#if UNITY_WEBGL && !UNITY_EDITOR
            if (string.IsNullOrEmpty(baseUrl) && Uri.TryCreate(Application.absoluteURL, UriKind.Absolute, out var current))
                RemoteEnabled = !current.IsLoopback;
#endif
        }
        string Url(string path) => string.IsNullOrEmpty(baseUrl) ? path : baseUrl + path;

        public Task<JObject> LoadAsync(CancellationToken cancellationToken=default)
            =>GetWithRetry("/api/game/save",cancellationToken);

        public Task<JObject> LoadConfigAsync(CancellationToken cancellationToken=default)
            =>GetWithRetry("/api/game/config",cancellationToken);

        async Task<JObject> GetWithRetry(string path,CancellationToken cancellationToken)
        {
            if (!RemoteEnabled) throw new InvalidOperationException("Backend remoto desactivado en ejecución local");
            MarketApiException last=null;
            for(var attempt=1;attempt<=LoadAttempts;attempt++)
            {
                using var request = UnityWebRequest.Get(Url(path));
                request.SetRequestHeader("Accept", "application/json");
                try
                {
                    await Send(request,false,cancellationToken);
                    return ParseObject(request.downloadHandler.text,request.responseCode);
                }
                catch(MarketApiException exception) when(attempt<LoadAttempts&&IsRetryable(exception.Kind))
                {
                    last=exception;
                    var delayMs=(int)(250*Math.Pow(2,attempt-1))+UnityEngine.Random.Range(0,151);
                    await Task.Delay(delayMs,cancellationToken);
                }
            }
            throw last??new MarketApiException(MarketApiErrorKind.Unknown,0,"No se pudo cargar el guardado remoto");
        }

        public async Task<JObject> SaveAsync(int expectedRevision, string sessionId, JObject state, JArray events,CancellationToken cancellationToken=default)
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
            // PUT is not retried here. A response can be lost after the server
            // commits; retrying the old expectedRevision would turn that into a
            // false conflict. The coordinator retains the local events and tries
            // again after reloading server state.
            await Send(request, allowConflict: true,cancellationToken);
            var payload = string.IsNullOrWhiteSpace(request.downloadHandler.text) ? new JObject() : ParseObject(request.downloadHandler.text,request.responseCode);
            payload["httpStatus"] = request.responseCode;
            return payload;
        }

        static async Task Send(UnityWebRequest request, bool allowConflict,CancellationToken cancellationToken)
        {
            request.timeout = TimeoutSeconds;
            var operation = request.SendWebRequest();
            try
            {
                while (!operation.isDone)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    await Task.Yield();
                }
            }
            catch(OperationCanceledException)
            {
                request.Abort();
                throw;
            }
            if (request.result == UnityWebRequest.Result.Success) return;
            if (allowConflict && request.responseCode == 409) return;
            var kind=Classify(request);
            throw new MarketApiException(kind,request.responseCode,$"NETWORK {kind} HTTP {request.responseCode}: {request.error}");
        }

        static JObject ParseObject(string text,long statusCode)
        {
            try{return JObject.Parse(text);}
            catch(Exception exception){throw new MarketApiException(MarketApiErrorKind.InvalidResponse,statusCode,$"NETWORK respuesta JSON inválida: {exception.Message}");}
        }

        static MarketApiErrorKind Classify(UnityWebRequest request)
        {
            if(request.responseCode is 401 or 403)return MarketApiErrorKind.Unauthorized;
            if(request.responseCode==409)return MarketApiErrorKind.Conflict;
            if(request.responseCode==429)return MarketApiErrorKind.RateLimited;
            if(request.responseCode>=500)return MarketApiErrorKind.Server;
            if(request.result==UnityWebRequest.Result.ConnectionError)
                return request.error?.IndexOf("timed out",StringComparison.OrdinalIgnoreCase)>=0?MarketApiErrorKind.Timeout:MarketApiErrorKind.Offline;
            return MarketApiErrorKind.Unknown;
        }

        static bool IsRetryable(MarketApiErrorKind kind)
            => kind is MarketApiErrorKind.Offline or MarketApiErrorKind.Timeout or MarketApiErrorKind.RateLimited or MarketApiErrorKind.Server;
    }
}
