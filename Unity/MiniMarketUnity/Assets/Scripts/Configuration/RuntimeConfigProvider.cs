using System;
using System.Threading;
using System.Threading.Tasks;
using MiniMarket.Networking;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace MiniMarket.Configuration
{
    public interface IRuntimeConfigProvider
    {
        JObject Current { get; }
        bool IsEnabled(string flag);
        void LoadCached();
        Task<bool> RefreshAsync(CancellationToken cancellationToken=default);
    }

    public sealed class RuntimeConfigProvider : IRuntimeConfigProvider
    {
        const string CacheKey="mini-market-runtime-config-v1";
        readonly MarketApiClient api;
        public JObject Current { get; private set; }=Defaults();

        public RuntimeConfigProvider(MarketApiClient client)=>api=client;
        public bool IsEnabled(string flag)=>Current["flags"]?.Value<bool?>(flag)??false;

        public void LoadCached()
        {
            var text=PlayerPrefs.GetString(CacheKey,"");if(string.IsNullOrWhiteSpace(text))return;
            try{var candidate=JObject.Parse(text);if(Valid(candidate))Current=candidate;}
            catch(Exception exception){Debug.LogWarning($"NETWORK remote-config cache inválida: {exception.Message}");}
        }

        public async Task<bool> RefreshAsync(CancellationToken cancellationToken=default)
        {
            if(!api.RemoteEnabled)return false;
            try
            {
                var candidate=await api.LoadConfigAsync(cancellationToken);if(!Valid(candidate))return false;
                Current=candidate;PlayerPrefs.SetString(CacheKey,candidate.ToString(Formatting.None));PlayerPrefs.Save();return true;
            }
            catch(OperationCanceledException){throw;}
            catch(Exception exception){Debug.LogWarning($"NETWORK remote-config usa cache/default: {exception.Message}");return false;}
        }

        static bool Valid(JObject candidate)
            =>candidate?.Value<int?>("schemaVersion")==1&&candidate["flags"] is JObject&&candidate["tuning"] is JObject;

        static JObject Defaults()=>new()
        {
            ["schemaVersion"]=1,["version"]="local-default",
            ["flags"]=new JObject{{"seasonalEvents",false},{"experimentalNpc",false},{"remoteContent",false},{"premiumStore",false}},
            ["tuning"]=new JObject{{"localSaveIntervalSeconds",10},{"remoteSaveIntervalSeconds",1800}},
        };
    }
}
