using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using MiniMarket.Assets;
using MiniMarket.Data;
using MiniMarket.Store;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace MiniMarket.Farm
{
    /// <summary>Visual state follows crop data; it never owns production rules.</summary>
    public sealed class FarmVisualSystem
    {
        readonly RuntimeGltfLoader loader;
        readonly StoreWorld world;
        readonly GameStateDocument state;
        readonly Dictionary<string,string> activeStage=new(StringComparer.OrdinalIgnoreCase);
        readonly Dictionary<string,Dictionary<string,GameObject>> instances=new(StringComparer.OrdinalIgnoreCase);
        readonly HashSet<string> refreshing=new(StringComparer.OrdinalIgnoreCase);
        long nextRefresh;

        public FarmVisualSystem(RuntimeGltfLoader runtimeLoader,StoreWorld storeWorld,GameStateDocument document)
        {loader=runtimeLoader;world=storeWorld;state=document;}

        public void Tick(long nowMs)
        {
            if(nowMs<nextRefresh)return;nextRefresh=nowMs+500;
            foreach(var token in state.Array("crops"))if(token is JObject crop)_=RefreshAsync(crop,nowMs);
        }

        async Task RefreshAsync(JObject crop,long nowMs)
        {
            var cropId=crop.Value<string>("id");if(string.IsNullOrWhiteSpace(cropId)||!world.CropVisualRoots.TryGetValue(cropId,out var root)||!refreshing.Add(cropId))return;
            try
            {
                var asset=StageAsset(crop,nowMs);
                if(activeStage.TryGetValue(cropId,out var current)&&current==asset)return;
                if(!instances.TryGetValue(cropId,out var cache))instances[cropId]=cache=new Dictionary<string,GameObject>(StringComparer.OrdinalIgnoreCase);
                foreach(var item in cache.Values)if(item)item.SetActive(false);
                activeStage[cropId]=asset;
                if(string.IsNullOrEmpty(asset))return;
                if(!cache.TryGetValue(asset,out var visual)||!visual)
                {
                    visual=await loader.InstantiateAsync(asset,root,Vector3.up*.16f,Quaternion.identity,Vector3.one);visual.name=$"CropVisual_{cropId}_{asset}";
                    foreach(var collider in visual.GetComponentsInChildren<Collider>(true))collider.enabled=false;
                    NormalizeWorldSize(visual,TargetSize(asset));cache[asset]=visual;
                }
                visual.SetActive(true);
            }
            catch(Exception exception){Debug.LogWarning($"Cultivo visual {cropId}: {exception.Message}");}
            finally{refreshing.Remove(cropId);}
        }

        static string StageAsset(JObject crop,long nowMs)
        {
            var status=crop.Value<string>("status");if(status is "LOCKED" or "EMPTY")return string.Empty;
            var product=crop.Value<string>("productId");
            if(status=="READY")return product switch{"wheat"=>"WheatRipe","corn"=>"CornRipe",_=>"TomatoRipe"};
            var planted=crop.Value<long?>("plantedAt")??nowMs;var ready=Math.Max(planted+1,crop.Value<long?>("readyAt")??planted+1);
            var progress=Math.Clamp((nowMs-planted)/(double)(ready-planted),0,1);
            return progress<.2?"CropSeed":progress<.45?"CropSprout":progress<.72?"CropSmall":"CropGrowing";
        }

        static float TargetSize(string asset)=>asset switch{"CropSeed"=>.35f,"CropSprout"=>.55f,"CropSmall"=>.78f,"CropGrowing"=>1.05f,_=>1.25f};
        static void NormalizeWorldSize(GameObject item,float targetLongest)
        {
            var renderers=item.GetComponentsInChildren<Renderer>(true);if(renderers.Length==0)return;
            var bounds=renderers[0].bounds;for(var i=1;i<renderers.Length;i++)bounds.Encapsulate(renderers[i].bounds);
            var longest=Mathf.Max(bounds.size.x,Mathf.Max(bounds.size.y,bounds.size.z));if(longest>.0001f)item.transform.localScale*=targetLongest/longest;
        }
    }
}
