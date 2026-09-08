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
        RuntimeGltfLoader loader;Transform contents,actorRoot,leftGrip,rightGrip,cartHandle,bagSocket;GameObject basket,shoppingBag;HandPoseDriver hands;int generation;
        float floorOffset;bool paidBag;

        public async Task BindAsync(RuntimeGltfLoader runtimeLoader,CharacterActor actor)
        {
            loader=runtimeLoader;generation++;ClearContents();
            hands=actor.GetComponent<HandPoseDriver>();actorRoot=actor.transform;
            var sockets=actor.GetComponent<CharacterSockets>();leftGrip=sockets?.Get("CartLeft");rightGrip=sockets?.Get("CartRight");bagSocket=sockets?.Get("Basket")??sockets?.Get("HandLeft");
            if(!basket)
            {
                // Next customers use a trolley throughout their shopping trip.
                // Keep the exact supplied GLB and only correct the isometric
                // source yaw so its handle sits naturally beneath both hands.
                basket=await loader.InstantiateAsync("ShoppingCart",actor.transform,Vector3.zero,Quaternion.identity,Vector3.one);
                // Twenty percent smaller than the former 1.04 m presentation,
                // so it fits the customer and the ordered checkout line.
                basket.name="CustomerShoppingCart";NormalizeWorldSize(basket,5.16f);
                // Its source handle is on +Z. A 180 degree turn puts that handle
                // at the shopper and the basket in front; -56.4 made it cross the
                // doorway almost backwards.
                basket.transform.SetLocalPositionAndRotation(Vector3.zero,Quaternion.Euler(0,180f,0));
                foreach(var collider in basket.GetComponentsInChildren<Collider>(true))collider.enabled=false;
                foreach(var child in basket.GetComponentsInChildren<Transform>(true))if(child.name=="CartHandle"){cartHandle=child;break;}
                var bounds=Bounds(basket);floorOffset=bounds.min.y-basket.transform.position.y;
                contents=new GameObject("CartContents").transform;contents.SetParent(basket.transform,false);contents.position=new Vector3(bounds.center.x,bounds.min.y+bounds.size.y*.61f,bounds.center.z);
            }
            if(!shoppingBag&&bagSocket)
            {
                shoppingBag=await loader.InstantiateAsync("ReusableShoppingBag",bagSocket,Vector3.zero,Quaternion.identity,Vector3.one);
                shoppingBag.name="CustomerPaidShoppingBag";NormalizeWorldSize(shoppingBag,2.35f);
                shoppingBag.transform.SetLocalPositionAndRotation(Vector3.zero,Quaternion.identity);
                foreach(var collider in shoppingBag.GetComponentsInChildren<Collider>(true))collider.enabled=false;
            }
            BeginWithoutCart();
        }

        public void BeginWithoutCart(){paidBag=false;if(basket)basket.SetActive(false);if(contents)contents.gameObject.SetActive(false);AttachBagToHand();if(shoppingBag)shoppingBag.SetActive(false);hands?.SetGrip(true,.14f);hands?.SetGrip(false,.14f);}
        public void TakeCart(){if(basket)basket.SetActive(true);if(contents)contents.gameObject.SetActive(true);hands?.SetGrip(true,.54f);hands?.SetGrip(false,.54f);}
        public void TakeBag()
        {
            paidBag=true;if(!shoppingBag)return;shoppingBag.SetActive(true);
            // Next places the paid bag inside the trolley while the shopper is
            // still returning it, leaving both hands available for the handle.
            if(basket&&basket.activeInHierarchy&&contents)
            {
                shoppingBag.transform.SetParent(contents,true);
                shoppingBag.transform.SetPositionAndRotation(contents.position+contents.up*.18f,actorRoot.rotation);
            }
            else AttachBagToHand();
        }
        public void ReturnCart()
        {
            if(paidBag)AttachBagToHand();
            if(basket)basket.SetActive(false);if(contents)contents.gameObject.SetActive(false);hands?.SetGrip(true,.42f);hands?.SetGrip(false,.14f);
        }

        void AttachBagToHand()
        {
            if(!shoppingBag||!bagSocket)return;
            shoppingBag.transform.SetParent(bagSocket,true);
            shoppingBag.transform.SetPositionAndRotation(bagSocket.position,bagSocket.rotation);
        }

        void LateUpdate()
        {
            if(!basket||!basket.activeInHierarchy||!actorRoot)return;
            basket.transform.rotation=actorRoot.rotation*Quaternion.Euler(0,180f,0);
            basket.transform.position=new Vector3(actorRoot.position.x,actorRoot.position.y-floorOffset,actorRoot.position.z);
            if(!cartHandle||!leftGrip||!rightGrip)return;
            var handMidpoint=(leftGrip.position+rightGrip.position)*.5f;
            var handlePosition=cartHandle.position;
            basket.transform.position+=new Vector3(handMidpoint.x-handlePosition.x,0,handMidpoint.z-handlePosition.z);
        }

        public async void AddProduct(string productId)
        {
            if(loader==null||contents==null||!ProductAssets.TryGetValue(productId,out var assetId))return;var expected=generation;
            GameObject item;
            if(pools.TryGetValue(productId,out var pool)&&pool.Count>0){item=pool.Pop();item.SetActive(true);}
            else item=await loader.InstantiateAsync(assetId,contents,Vector3.zero,Quaternion.identity,Vector3.one);
            if(expected!=generation||!contents){Pool(productId,item);return;}
            item.transform.SetParent(contents,false);NormalizeWorldSize(item,.32f);
            var index=shown.Count;var column=index%3;var row=index/3;
            item.transform.position=contents.position+contents.right*((column-1)*.3f)+contents.up*(row*.2f)+contents.forward*(index%2==0?-.2f:.2f);
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
            generation++;paidBag=false;ClearContents();AttachBagToHand();if(basket)basket.SetActive(false);if(contents)contents.gameObject.SetActive(false);if(shoppingBag)shoppingBag.SetActive(false);hands?.SetGrip(true,.14f);hands?.SetGrip(false,.14f);
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
        static Bounds Bounds(GameObject item)
        {
            var renderers=item.GetComponentsInChildren<Renderer>(true);if(renderers.Length==0)return new Bounds(item.transform.position,Vector3.zero);
            var bounds=renderers[0].bounds;for(var i=1;i<renderers.Length;i++)bounds.Encapsulate(renderers[i].bounds);return bounds;
        }
    }
}
