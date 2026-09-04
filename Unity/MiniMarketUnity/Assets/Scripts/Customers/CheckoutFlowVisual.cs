using System;
using System.Collections.Generic;
using MiniMarket.Assets;
using MiniMarket.Store;
using UnityEngine;

namespace MiniMarket.Customers
{
    /// <summary>Physical unload → scan → bag flow; no checkout item teleports.</summary>
    public sealed class CheckoutFlowVisual : MonoBehaviour
    {
        static readonly Dictionary<string,string> ProductAssets=new(StringComparer.OrdinalIgnoreCase)
        {
            ["tomatoes"]="Tomato",["apples"]="Apple",["bread"]="Bread",["eggs"]="Egg",["coffee"]="Coffee",
            ["corn"]="Corn",["milk"]="Milk",["cheese"]="Cheese",["juice"]="Juice",["flour"]="Flour",["wheat"]="Wheat",
        };
        readonly Dictionary<string,Stack<GameObject>> pools=new(StringComparer.OrdinalIgnoreCase);
        readonly List<(string Id,GameObject Item)> bagged=new();
        RuntimeGltfLoader loader;Transform unloadPoint;Transform scanPoint;Transform bagPoint;GameObject active;string activeId;GameObject bag;int generation;
        public bool UnitReady=>active;

        public async void Bind(RuntimeGltfLoader runtimeLoader,StoreWorld storeWorld,int lane)
        {
            loader=runtimeLoader;if(lane<0||lane>=storeWorld.CheckoutBagPoints.Count)return;unloadPoint=storeWorld.CheckoutUnloadPoints[lane];scanPoint=storeWorld.CheckoutScanPoints[lane];bagPoint=storeWorld.CheckoutBagPoints[lane];
            if(!bagPoint||bag)return;
            bag=await loader.InstantiateAsync("CheckoutBag",bagPoint,Vector3.zero,Quaternion.identity,Vector3.one);
            bag.name="CheckoutBag_Runtime";Normalize(bag,.58f);bag.transform.SetLocalPositionAndRotation(Vector3.zero,Quaternion.identity);
            foreach(var collider in bag.GetComponentsInChildren<Collider>(true))collider.enabled=false;
            bag.SetActive(false);
        }

        public void BeginSession(){generation++;Clear();if(bag)bag.SetActive(true);}

        public async void BeginUnit(string productId)
        {
            if(loader==null||!unloadPoint||!ProductAssets.TryGetValue(productId,out var asset))return;
            var expected=generation;GameObject item;
            if(pools.TryGetValue(productId,out var pool)&&pool.Count>0){item=pool.Pop();item.SetActive(true);}
            else item=await loader.InstantiateAsync(asset,unloadPoint,Vector3.zero,Quaternion.identity,Vector3.one);
            if(expected!=generation){Pool(productId,item);return;}
            active=item;activeId=productId;Normalize(item,.15f);Move(unloadPoint,Vector3.zero);
        }

        public void MoveToScanner()=>Move(scanPoint,Vector3.zero);
        public void BagUnit()
        {
            if(!active||!bagPoint)return;
            var index=bagged.Count;Move(bagPoint,new Vector3((index%3-1)*.09f,.05f+(index/3)*.07f,(index%2==0?-.05f:.05f)));
            bagged.Add((activeId,active));active=null;activeId=null;
        }
        public void EndSession(){generation++;Clear();if(bag)bag.SetActive(false);}

        void Move(Transform socket,Vector3 offset)
        {
            if(!active||!socket)return;active.transform.SetParent(socket,false);active.transform.localPosition=offset;active.transform.localRotation=Quaternion.identity;
        }
        void Clear()
        {
            if(active){Pool(activeId,active);active=null;activeId=null;}
            foreach(var entry in bagged)Pool(entry.Id,entry.Item);bagged.Clear();
        }
        void Pool(string id,GameObject item)
        {
            if(!item)return;if(!pools.TryGetValue(id??string.Empty,out var pool))pools[id??string.Empty]=pool=new Stack<GameObject>();item.SetActive(false);pool.Push(item);
        }
        static void Normalize(GameObject item,float target)
        {
            var renderers=item.GetComponentsInChildren<Renderer>(true);if(renderers.Length==0)return;var bounds=renderers[0].bounds;
            for(var i=1;i<renderers.Length;i++)bounds.Encapsulate(renderers[i].bounds);var longest=Mathf.Max(bounds.size.x,Mathf.Max(bounds.size.y,bounds.size.z));if(longest>.0001f)item.transform.localScale*=target/longest;
        }
    }
}
