using Newtonsoft.Json.Linq;
using UnityEngine;

namespace MiniMarket.Diagnostics
{
    public static class RuntimeBuildInfo
    {
        static JObject data;
        static JObject Data
        {
            get
            {
                if(data!=null)return data;
                var asset=Resources.Load<TextAsset>("MiniMarketBuildInfo");
                try{data=asset?JObject.Parse(asset.text):new JObject();}
                catch{data=new JObject();}
                return data;
            }
        }

        public static string Version=>Data.Value<string>("version")??Application.version;
        public static string BuildNumber=>Data.Value<string>("buildNumber")??"local";
        public static string GitCommit=>Data.Value<string>("gitCommit")??"unknown";
        public static string ContentCatalog=>Data.Value<string>("contentCatalogVersion")??"unknown";
        public static int SaveSchema=>Data.Value<int?>("saveSchemaVersion")??Persistence.LocalSaveEnvelope.CurrentSchemaVersion;
    }
}
