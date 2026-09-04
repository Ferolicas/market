using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using MiniMarket.Animations;
using MiniMarket.Assets;
using UnityEngine;

namespace MiniMarket.Customers
{
    /// <summary>Reusable supplied shopping cart and physical contents following each customer.</summary>
    public sealed class CustomerBasketVisual : MonoBehaviour
    {
        static readonly Dictionary<string,string> ProductAssets=new(StringComparer.OrdinalIgnoreCase)
        {
            ["tomatoes"]="Tomato",["apples"]="Apple",["bread"]="Bread",["eggs"]="Egg",["coffee"]="Coffee",
            ["corn"]="Corn",["milk"]="Milk",["cheese"]="Cheese",["juice"]="Juice",
        };
        readonly Dictionary<string,Stack<GameObject>> pools=new(StringComparer.OrdinalIgnoreCase);
        readonly List<(string Id,GameObject Item)> shown=new();
        RuntimeGltfLoader loader;Transform contents;GameObject basket;HandPoseDriver hands;int generation;

        public async Task BindAsync(RuntimeGltfLoader runtimeLoader,CharacterActor actor)
        {
            loader=runtimeLoader;generation++;ClearContents();
            hands=actor.GetComponent<HandPoseDriver>();
            if(!basket)
            {
                // Next customers use a trolley throughout their shopping trip.
                // Keep the exact supplied GLB and only correct the isometric
                // source yaw so its handle sits naturally beneath both hands.
                basket=await loader.InstantiateAsync("ShoppingCart",actor.transform,Vector3.zero,Quaternion.identity,Vector3.one);
                basket.name="CustomerShoppingCart";NormalizeWorldSize(basket,1.08f);
                basket.transform.SetLocalPositionAndRotation(new Vector3(0,0,.66f),Quaternion.Euler(0,-56.4f,0));
                foreach(var collider in basket.GetComponentsInChildren<Collider>(true))collider.enabled=false;
                contents=new GameObject("CartContents").transform;contents.SetParent(actor.transform,false);contents.localPosition=new Vector3(0,.63f,.72f);
            }
            basket.SetActive(true);if(contents)contents.gameObject.SetActive(true);hands?.SetGrip(true,.54f);hands?.SetGrip(false,.54f);
        }

        public async void AddProduct(string productId)
        {
            if(loader==null||contents==null||!ProductAssets.TryGetValue(productId,out var assetId))return;var expected=generation;
            GameObject item;
            if(pools.TryGetValue(productId,out var pool)&&pool.Count>0){item=pool.Pop();item.SetActive(true);}
            else item=await loader.InstantiateAsync(assetId,contents,Vector3.zero,Quaternion.identity,Vector3.one);
            if(expected!=generation||!contents){Pool(productId,item);return;}
            item.transform.SetParent(contents,false);NormalizeWorldSize(item,.12f);
            var index=shown.Count;var column=index%3;var row=index/3;
            item.transform.localPosition=new Vector3((column-1)*.085f,row*.075f,(index%2==0?-.06f:.06f));
            item.transform.localRotation=Quaternion.Euler(0,index*47f,0);shown.Add((productId,item));
        }

        public bool RemoveProduct(string productId)
        {
            for(var index=shown.Count-1;index>=0;index--)
            {
                if(!string.Equals(shown[index].Id,productId,StringComparison.OrdinalIgnoreCase))continue;
                var entry=shown[index];shown.RemoveAt(index);Pool(entry.Id,entry.Item);return true;
            }
            return false;
        }

        public void ResetForPool()
        {
            generation++;ClearContents();if(basket)basket.SetActive(false);if(contents)contents.gameObject.SetActive(false);hands?.SetGrip(true,.14f);hands?.SetGrip(false,.14f);
        }

        void ClearContents(){foreach(var entry in shown)Pool(entry.Id,entry.Item);shown.Clear();}
        void Pool(string id,GameObject item)
        {
            if(!item)return;if(!pools.TryGetValue(id,out var pool))pools[id]=pool=new Stack<GameObject>();item.SetActive(false);pool.Push(item);
        }
        static void NormalizeWorldSize(GameObject item,float targetLongest)
        {
            var renderers=item.GetComponentsInChildren<Renderer>(true);if(renderers.Length==0)return;var bounds=renderers[0].bounds;
            for(var i=1;i<renderers.Length;i++)bounds.Encapsulate(renderers[i].bounds);var longest=Mathf.Max(bounds.size.x,Mathf.Max(bounds.size.y,bounds.size.z));
            if(longest>.0001f)item.transform.localScale*=targetLongest/longest;
        }
    }
}
