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

        public async void Show(string productId,bool boxed)
        {
            Hide();var expected=generation;var socket=boxed?boxSocket:productSocket;if(loader==null||!socket)return;
            var asset=boxed?"Parcel":ProductAssets.TryGetValue(productId,out var mapped)?mapped:"Parcel";
            var item=await loader.InstantiateAsync(asset,socket,Vector3.zero,Quaternion.identity,Vector3.one);
            if(expected!=generation||!socket){if(item)Destroy(item);return;}
            shown=item;shown.name=boxed?$"CarriedBox_{productId}":$"Carried_{productId}";NormalizeWorldSize(shown,boxed ? .42f : .15f);
            shown.transform.SetLocalPositionAndRotation(Vector3.zero,Quaternion.identity);foreach(var collider in shown.GetComponentsInChildren<Collider>(true))collider.enabled=false;
            hands?.SetGrip(true,boxed ? .56f : .2f);hands?.SetGrip(false,boxed ? .56f : .64f);
        }

        public void Hide()
        {
            generation++;if(shown)Destroy(shown);shown=null;hands?.SetGrip(true,.14f);hands?.SetGrip(false,.14f);
        }
        static void NormalizeWorldSize(GameObject item,float targetLongest)
        {
            var renderers=item.GetComponentsInChildren<Renderer>(true);if(renderers.Length==0)return;var bounds=renderers[0].bounds;
            for(var i=1;i<renderers.Length;i++)bounds.Encapsulate(renderers[i].bounds);var longest=Mathf.Max(bounds.size.x,Mathf.Max(bounds.size.y,bounds.size.z));
            if(longest>.0001f)item.transform.localScale*=targetLongest/longest;
        }
    }
}
