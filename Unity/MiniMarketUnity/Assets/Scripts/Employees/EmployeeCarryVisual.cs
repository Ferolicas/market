using System;
using System.Collections.Generic;
using MiniMarket.Animations;
using MiniMarket.Assets;
using UnityEngine;

namespace MiniMarket.Employees
{
    /// <summary>Shows the merchandise employees physically transport between stations.</summary>
    public sealed class EmployeeCarryVisual : MonoBehaviour
    {
        static readonly Dictionary<string,string> ProductAssets=new(StringComparer.OrdinalIgnoreCase)
        {
            ["tomatoes"]="Tomato",["apples"]="Apple",["wheat"]="Wheat",["flour"]="Flour",["bread"]="Bread",
            ["eggs"]="Egg",["coffee"]="Coffee",["corn"]="Corn",["milk"]="Milk",["cheese"]="Cheese",["juice"]="Juice",
        };
        RuntimeGltfLoader loader;Transform boxSocket;HandPoseDriver hands;GameObject shown;int generation;

        public void Bind(RuntimeGltfLoader runtimeLoader,CharacterActor actor)
        {
            loader=runtimeLoader;var sockets=actor.GetComponent<CharacterSockets>();boxSocket=sockets?.Get("Box");hands=actor.GetComponent<HandPoseDriver>();Hide();
        }

        /// Every physical transfer uses the same wooden crate as the owner.
        /// Stocking, machine inputs, harvests and collected batches therefore
        /// match the two-handed box animation and show their real contents.
        public void Show(string productId,bool boxed)=>Show(productId,boxed,false,1);
        public async void Show(string productId,bool boxed,bool basket,int amount)
        {
            Hide();_ = boxed;_ = basket;var expected=generation;var socket=boxSocket;if(loader==null||!socket)return;
            var item=await loader.InstantiateAsync("HarvestBasket",socket,Vector3.zero,Quaternion.identity,Vector3.one);
            if(expected!=generation||!socket){if(item)Destroy(item);return;}
            shown=item;shown.name=$"CarriedTransportCrate_{productId}";NormalizeWorldSize(shown,3.4f);
            shown.transform.SetLocalPositionAndRotation(Vector3.zero,Quaternion.identity);foreach(var collider in shown.GetComponentsInChildren<Collider>(true))collider.enabled=false;
            if(ProductAssets.TryGetValue(productId,out var produce))
            {
                var bounds=Bounds(shown);var contents=new GameObject("BasketContents").transform;contents.SetParent(shown.transform,false);
                contents.position=new Vector3(bounds.center.x,bounds.min.y+bounds.size.y*.55f,bounds.center.z);
                var tomato=string.Equals(productId,"tomatoes",StringComparison.OrdinalIgnoreCase);
                var count=Mathf.Clamp(amount*(tomato?2:1),1,6);
                for(var index=0;index<count;index++)
                {
                    var unit=await loader.InstantiateAsync(produce,contents,Vector3.zero,Quaternion.identity,Vector3.one);
                    if(expected!=generation){if(unit)Destroy(unit);return;}
                    unit.transform.SetParent(contents,false);NormalizeWorldSize(unit,tomato?1.6f:.8f);
                    var column=index%3;var row=index/3;
                    unit.transform.position=contents.position+contents.right*((column-1)*.74f)+contents.forward*((row-.5f)*.64f);
                    unit.transform.localRotation=Quaternion.Euler(0,index*53f,0);
                    foreach(var collider in unit.GetComponentsInChildren<Collider>(true))collider.enabled=false;
                }
            }
            hands?.SetGrip(true,.56f);hands?.SetGrip(false,.56f);
        }

        public void Hide()
        {
            generation++;if(shown)Destroy(shown);shown=null;hands?.SetGrip(true,.14f);hands?.SetGrip(false,.14f);
        }
        static Bounds Bounds(GameObject item)
        {
            var renderers=item.GetComponentsInChildren<Renderer>(true);if(renderers.Length==0)return new Bounds(item.transform.position,Vector3.zero);
            var bounds=renderers[0].bounds;for(var i=1;i<renderers.Length;i++)bounds.Encapsulate(renderers[i].bounds);return bounds;
        }
        static void NormalizeWorldSize(GameObject item,float targetLongest)
        {
            var renderers=item.GetComponentsInChildren<Renderer>(true);if(renderers.Length==0)return;var bounds=renderers[0].bounds;
            for(var i=1;i<renderers.Length;i++)bounds.Encapsulate(renderers[i].bounds);var longest=Mathf.Max(bounds.size.x,Mathf.Max(bounds.size.y,bounds.size.z));
            if(longest>.0001f)item.transform.localScale*=targetLongest/longest;
        }
    }
}
