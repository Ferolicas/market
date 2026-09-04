using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using MiniMarket.Animations;
using MiniMarket.Assets;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Networking;

namespace MiniMarket.Characters
{
    public sealed class AvatarAppearanceSystem
    {
        readonly RuntimeAssetCatalog catalog;readonly RuntimeGltfLoader loader;JObject manifest;readonly Dictionary<string,List<GameObject>> attachments=new(StringComparer.OrdinalIgnoreCase);
        public AvatarAppearanceSystem(RuntimeAssetCatalog runtimeCatalog,RuntimeGltfLoader runtimeLoader){catalog=runtimeCatalog;loader=runtimeLoader;}
        public async Task LoadAsync()
        {
            if(!catalog.TryGet("HeadAccessoryFitManifest",out var entry))throw new InvalidOperationException("Falta el manifiesto de encajes");
            var url=catalog.Url(entry);string json;
            if(url.Contains("://")){using var request=UnityWebRequest.Get(url);var operation=request.SendWebRequest();while(!operation.isDone)await Task.Yield();if(request.result!=UnityWebRequest.Result.Success)throw new InvalidOperationException(request.error);json=request.downloadHandler.text;}
            else json=await File.ReadAllTextAsync(url);manifest=JObject.Parse(json);
        }
        public async Task ApplyAsync(string characterId,CharacterActor actor,string category,string assetId)
        {
            Clear(category);if(string.IsNullOrWhiteSpace(assetId)||assetId=="none")return;
            JObject character=null;foreach(var token in (JArray)manifest["characters"])if(token.Value<string>("character")==characterId)character=token as JObject;
            if(character==null)throw new InvalidOperationException($"Sin encaje para {characterId}");JObject fit=null;
            foreach(var token in (JArray)character["fits"]?[category])if(token.Value<string>("id")==assetId)fit=token as JObject;
            if(fit==null)throw new InvalidOperationException($"Sin encaje {characterId}/{assetId}");
            var local=(JObject)fit["headLocal"];var p=(JArray)local["location"];var q=(JArray)local["rotationQuaternionWXYZ"];var s=(JArray)local["scale"];
            var position=new Vector3(p[0].Value<float>(),p[2].Value<float>(),-p[1].Value<float>());
            var rotation=new Quaternion(q[1].Value<float>(),q[3].Value<float>(),-q[2].Value<float>(),q[0].Value<float>());
            var scale=new Vector3(s[0].Value<float>(),s[2].Value<float>(),s[1].Value<float>());
            foreach(var head in Heads(actor.transform))
            {
                var item=await loader.InstantiateAsync(assetId,head,position,rotation,scale);item.name=$"Accessory_{assetId}_{head.parent.name}";
                if(!attachments.TryGetValue(category,out var list))attachments[category]=list=new List<GameObject>();list.Add(item);
            }
        }
        static IEnumerable<Transform> Heads(Transform root){foreach(var child in root.GetComponentsInChildren<Transform>(true))if(child.name.Equals("Head",StringComparison.OrdinalIgnoreCase))yield return child;}
        void Clear(string category){if(!attachments.TryGetValue(category,out var list))return;foreach(var item in list)if(item)UnityEngine.Object.Destroy(item);list.Clear();}
    }
}
