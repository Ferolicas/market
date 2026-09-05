using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Networking;

namespace MiniMarket.Assets
{
    public sealed class RuntimeAssetCatalog
    {
        public sealed class Entry
        {
            public string Id;
            public string Kind;
            public string Path;
            public string Sha256;
            public long Bytes;
        }

        readonly Dictionary<string, Entry> entries = new(StringComparer.OrdinalIgnoreCase);
        public IReadOnlyDictionary<string, Entry> Entries => entries;

        public async Task LoadAsync()
        {
            // A catalogue can be reloaded after WebGL restores the runtime or
            // when initialization is retried. Never compare the new payload
            // against entries left by an earlier attempt.
            entries.Clear();
            var path = System.IO.Path.Combine(Application.streamingAssetsPath, "Data/runtime-asset-catalog.json");
            string json;
            if (path.Contains("://"))
            {
                // The catalogue's address never changes from build to build, so a
                // browser that once stored it can keep answering from its own HTTP
                // cache for days: the player then boots new code against an old
                // list of assets. It is 40 KB; ask for it by a fresh address every
                // time and let the payloads it names be the ones that are cached.
                using var request = UnityWebRequest.Get($"{path}?t={DateTime.UtcNow.Ticks}");
                request.SetRequestHeader("Cache-Control", "no-cache");
                var operation = request.SendWebRequest();
                while (!operation.isDone) await Task.Yield();
                if (request.result != UnityWebRequest.Result.Success) throw new InvalidOperationException(request.error);
                json = request.downloadHandler.text;
            }
            else json = await File.ReadAllTextAsync(path);
            var root = JObject.Parse(json);
            foreach (var token in (JArray)root["entries"])
            {
                // Character textures are dependencies embedded in the GLB and
                // are never instantiated by ID. Some approved source packages
                // contain both PNG and JPG copies with the same logical name;
                // keeping those auxiliary files in the lookup caused WebGL to
                // abort before the store was created.
                if (token.Value<string>("kind") == "character-texture") continue;
                var entry = new Entry
                {
                    Id = token.Value<string>("id"), Kind = token.Value<string>("kind"), Path = token.Value<string>("path"),
                    Sha256 = token.Value<string>("sha256"), Bytes = token.Value<long>("bytes"),
                };
                // A repeated id is a fault in the catalogue, not a reason to
                // refuse to play: keep the first and say so. Refusing left the
                // game unopenable outside a private window until the browser's
                // copy of the catalogue expired.
                if(!entries.TryAdd(entry.Id,entry))Debug.LogWarning($"ID duplicado en catálogo runtime: {entry.Id}; se conserva {entries[entry.Id].Path} y se ignora {entry.Path}");
            }
        }

        public bool TryGet(string id, out Entry entry) => entries.TryGetValue(id, out entry);
        public string Url(Entry entry) => System.IO.Path.Combine(Application.streamingAssetsPath, entry.Path).Replace("\\", "/");
    }
}
