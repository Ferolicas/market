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
        RuntimeGltfLoader loader;Transform productSocket;Transform boxSocket;HandPoseDriver hands;GameObject shown;int generation;

        public void Bind(RuntimeGltfLoader runtimeLoader,CharacterActor actor)
        {
            loader=runtimeLoader;var sockets=actor.GetComponent<CharacterSockets>();productSocket=sockets?.Get("Product");boxSocket=sockets?.Get("Box");hands=actor.GetComponent<HandPoseDriver>();Hide();
        }

        /// What the worker carries: a shelf run goes in a parcel box, a machine
        /// start is the ingredient in hand, and a harvest or a collected batch
        /// travels in the kit's harvest basket, two-handed, with the goods
        /// visible inside -- up to six of them, one per unit carried.
        public void Show(string productId,bool boxed)=>Show(productId,boxed,false,1);
        public async void Show(string productId,bool boxed,bool basket,int amount)
        {
            Hide();var expected=generation;var twoHanded=boxed||basket;var socket=twoHanded?boxSocket:productSocket;if(loader==null||!socket)return;
            var asset=basket?"HarvestBasket":boxed?"Parcel":ProductAssets.TryGetValue(productId,out var mapped)?mapped:"Parcel";
            var item=await loader.InstantiateAsync(asset,socket,Vector3.zero,Quaternion.identity,Vector3.one);
            if(expected!=generation||!socket){if(item)Destroy(item);return;}
            shown=item;shown.name=basket?$"CarriedBasket_{productId}":boxed?$"CarriedBox_{productId}":$"Carried_{productId}";NormalizeWorldSize(shown,twoHanded ? .42f : .15f);
            shown.transform.SetLocalPositionAndRotation(Vector3.zero,Quaternion.identity);foreach(var collider in shown.GetComponentsInChildren<Collider>(true))collider.enabled=false;
            if(basket&&ProductAssets.TryGetValue(productId,out var produce))
            {
                var bounds=Bounds(shown);var contents=new GameObject("BasketContents").transform;contents.SetParent(shown.transform,false);
                contents.position=new Vector3(bounds.center.x,bounds.min.y+bounds.size.y*.55f,bounds.center.z);
                var count=Mathf.Clamp(amount,1,6);
                for(var index=0;index<count;index++)
                {
                    var unit=await loader.InstantiateAsync(produce,contents,Vector3.zero,Quaternion.identity,Vector3.one);
                    if(expected!=generation){if(unit)Destroy(unit);return;}
                    unit.transform.SetParent(contents,false);NormalizeWorldSize(unit,.11f);
                    var column=index%3;var row=index/3;
                    unit.transform.localPosition=new Vector3((column-1)*.07f,row*.05f,(index%2==0?-.05f:.05f));
                    unit.transform.localRotation=Quaternion.Euler(0,index*53f,0);
                    foreach(var collider in unit.GetComponentsInChildren<Collider>(true))collider.enabled=false;
                }
            }
            hands?.SetGrip(true,twoHanded ? .56f : .2f);hands?.SetGrip(false,twoHanded ? .56f : .64f);
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
