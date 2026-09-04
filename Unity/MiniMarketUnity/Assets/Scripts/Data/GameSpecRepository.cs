using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Networking;

namespace MiniMarket.Data
{
    public sealed class GameSpecRepository
    {
        public JObject Root { get; private set; }
        public JObject Products => (JObject)Root["catalog"]["PRODUCTS"];
        public JObject ProductConfig => (JObject)Root["productConfig"];
        public JArray Levels => (JArray)Root["levels"];
        public JObject Layouts => (JObject)Root["layouts"];

        public async Task LoadAsync()
        {
            var path = Path.Combine(Application.streamingAssetsPath, "Data/next-game-spec.json");
            string json;
            if (path.Contains("://") || path.Contains(":///"))
            {
                using var request = UnityWebRequest.Get(path);
                var operation = request.SendWebRequest();
                while (!operation.isDone) await Task.Yield();
                if (request.result != UnityWebRequest.Result.Success)
                    throw new InvalidOperationException($"No se pudo cargar la especificación: {request.error}");
                json = request.downloadHandler.text;
            }
            else
            {
                json = await File.ReadAllTextAsync(path);
            }
            Root = JObject.Parse(json);
        }

        public JObject CreateInitialState() => (JObject)Root["initialState"].DeepClone();

        public IEnumerable<string> ProductIds()
        {
            foreach (var property in Products.Properties()) yield return property.Name;
        }

        public long ProductPrice(string productId, string field)
            => Products[productId]?[field]?.Value<long>() ?? 0;

        public long CountryMoneyScaleNumerator(string countryCode)
        {
            var countries = (JObject)Root["catalog"]["COUNTRIES"];
            return countries[countryCode]?["startingCapitalMinor"]?.Value<long>() ?? 220000L;
        }

        public long ScaleMoney(long baseMinor, string countryCode)
        {
            var numerator = CountryMoneyScaleNumerator(countryCode);
            return (long)Math.Round(baseMinor * (double)numerator / 220000d, MidpointRounding.AwayFromZero);
        }

        public long ScaleMoney(double baseMinor, string countryCode)
        {
            var numerator = CountryMoneyScaleNumerator(countryCode);
            return (long)Math.Round(baseMinor * numerator / 220000d, MidpointRounding.AwayFromZero);
        }
    }
}
