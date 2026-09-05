using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using MiniMarket.Animations;
using MiniMarket.Assets;
using MiniMarket.Inventory;
using UnityEngine;

namespace MiniMarket.Player
{
    /// <summary>The owner's harvest basket -- Next's HarvestBasket, here the kit's
    /// own -- with the carried goods visible inside, up to six units as in Next;
    /// inventory remains pure state.</summary>
    public sealed class PlayerCarryVisual : MonoBehaviour
    {
        static readonly Dictionary<string,string> ProductAssets=new(StringComparer.OrdinalIgnoreCase)
        {
            ["tomatoes"]="Tomato",["apples"]="Apple",["wheat"]="Wheat",["flour"]="Flour",["bread"]="Bread",
            ["eggs"]="Egg",["coffee"]="Coffee",["corn"]="Corn",["milk"]="Milk",["cheese"]="Cheese",["juice"]="Juice",
        };
        const int VisibleUnits=6;
        RuntimeGltfLoader loader;
        PlayerCarrySystem carry;
        GameObject basket;
        Transform contents;
        HandPoseDriver hands;
        readonly List<GameObject> units=new();
        readonly Dictionary<string,Stack<GameObject>> pools=new(StringComparer.OrdinalIgnoreCase);
        string lastSignature;
        int generation;

        public async Task BindAsync(RuntimeGltfLoader runtimeLoader,CharacterActor actor,PlayerCarrySystem playerCarry)
        {
            loader=runtimeLoader;carry=playerCarry;generation++;
            if(basket)Destroy(basket);units.Clear();pools.Clear();
            var sockets=actor.GetComponent<CharacterSockets>();hands=actor.GetComponent<HandPoseDriver>();
            var socket=sockets?.Get("Basket");
            if(socket)
            {
                basket=await loader.InstantiateAsync("HarvestBasket",socket,Vector3.zero,Quaternion.identity,Vector3.one);
                basket.name="PlayerCarryBasket";NormalizeWorldSize(basket,1.2f);   // a 50 cm basket
                basket.transform.localPosition=Vector3.zero;basket.transform.localRotation=Quaternion.identity;
                foreach(var collider in basket.GetComponentsInChildren<Collider>(true))collider.enabled=false;
                var bounds=Bounds(basket);
                contents=new GameObject("BasketContents").transform;contents.SetParent(basket.transform,false);
                contents.position=new Vector3(bounds.center.x,bounds.min.y+bounds.size.y*.6f,bounds.center.z);
            }
            lastSignature=null;Refresh();
        }

        void Update()
        {
            if(carry==null)return;
            if(Signature()!=lastSignature)Refresh();
        }

        string Signature()
        {
            var parts=new List<string>();foreach(var entry in carry.Contents())if(entry.Value>0)parts.Add(entry.Key+":"+entry.Value);
            return string.Join(",",parts);
        }

        async void Refresh()
        {
            if(carry==null)return;var signature=Signature();lastSignature=signature;var active=carry.Total>0;var expected=generation;
            if(basket)basket.SetActive(active);
            if(hands){hands.SetGrip(true,active ? .58f : .14f);hands.SetGrip(false,active ? .28f : .14f);}
            foreach(var unit in units)Pool(unit);units.Clear();
            if(!active||!contents||loader==null)return;
            var wanted=new List<string>();
            foreach(var entry in carry.Contents())for(var i=0;i<entry.Value&&wanted.Count<VisibleUnits;i++)wanted.Add(entry.Key);
            for(var index=0;index<wanted.Count;index++)
            {
                if(!ProductAssets.TryGetValue(wanted[index],out var asset))continue;
                GameObject unit;
                if(pools.TryGetValue(asset,out var pool)&&pool.Count>0){unit=pool.Pop();unit.SetActive(true);}
                else unit=await loader.InstantiateAsync(asset,contents,Vector3.zero,Quaternion.identity,Vector3.one);
                if(expected!=generation||!contents){if(unit)Destroy(unit);return;}
                unit.name="Carried_"+asset;unit.transform.SetParent(contents,false);NormalizeWorldSize(unit,.28f);
                var column=index%3;var row=index/3;
                unit.transform.position=contents.position+contents.right*((column-1)*.28f)+contents.up*(row*.16f)+contents.forward*(index%2==0?-.14f:.14f);
                unit.transform.localRotation=Quaternion.Euler(0,index*53f,0);
                foreach(var collider in unit.GetComponentsInChildren<Collider>(true))collider.enabled=false;
                units.Add(unit);
            }
        }

        void Pool(GameObject unit)
        {
            if(!unit)return;var key=unit.name.Replace("Carried_","");
            if(!pools.TryGetValue(key,out var pool))pools[key]=pool=new Stack<GameObject>();unit.SetActive(false);pool.Push(unit);
        }

        static Bounds Bounds(GameObject item)
        {
            var renderers=item.GetComponentsInChildren<Renderer>(true);if(renderers.Length==0)return new Bounds(item.transform.position,Vector3.zero);
            var bounds=renderers[0].bounds;for(var i=1;i<renderers.Length;i++)bounds.Encapsulate(renderers[i].bounds);return bounds;
        }

        static void NormalizeWorldSize(GameObject item,float targetLongest)
        {
            var renderers=item.GetComponentsInChildren<Renderer>(true);if(renderers.Length==0)return;
            var bounds=renderers[0].bounds;for(var i=1;i<renderers.Length;i++)bounds.Encapsulate(renderers[i].bounds);
            var longest=Mathf.Max(bounds.size.x,Mathf.Max(bounds.size.y,bounds.size.z));if(longest>.0001f)item.transform.localScale*=targetLongest/longest;
        }
    }
}
