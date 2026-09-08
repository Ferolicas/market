using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using MiniMarket.Animations;
using MiniMarket.Assets;
using MiniMarket.Inventory;
using UnityEngine;

namespace MiniMarket.Player
{
    /// <summary>The owner's universal wooden transport crate, kept behind the
    /// HarvestBasket asset id for save/runtime compatibility, with the carried
    /// goods visible inside, up to six units as in Next;
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
        Transform carrySocket,leftHand,rightHand,actorRoot;
        HandPoseDriver hands;
        readonly List<GameObject> units=new();
        readonly Dictionary<string,Stack<GameObject>> pools=new(StringComparer.OrdinalIgnoreCase);
        int lastVersion=-1;
        bool refreshing;
        int generation;

        public async Task BindAsync(RuntimeGltfLoader runtimeLoader,CharacterActor actor,PlayerCarrySystem playerCarry)
        {
            loader=runtimeLoader;carry=playerCarry;generation++;
            if(basket)Destroy(basket);units.Clear();pools.Clear();
            var sockets=actor.GetComponent<CharacterSockets>();hands=actor.GetComponent<HandPoseDriver>();
            carrySocket=sockets?.Get("Box");leftHand=sockets?.Get("HandLeft");rightHand=sockets?.Get("HandRight");actorRoot=actor.transform;
            if(carrySocket)
            {
                basket=await loader.InstantiateAsync("HarvestBasket",carrySocket,Vector3.zero,Quaternion.identity,Vector3.one);
                basket.name="PlayerTransportCrate";NormalizeWorldSize(basket,3.6f);
                basket.transform.localPosition=Vector3.zero;basket.transform.localRotation=Quaternion.identity;
                foreach(var collider in basket.GetComponentsInChildren<Collider>(true))collider.enabled=false;
                var bounds=Bounds(basket);
                contents=new GameObject("BasketContents").transform;contents.SetParent(basket.transform,false);
                contents.position=new Vector3(bounds.center.x,bounds.min.y+bounds.size.y*.6f,bounds.center.z);
            }
            lastVersion=-1;await RefreshAsync();
        }

        void Update()
        {
            if(carry==null||refreshing||carry.Version==lastVersion)return;
            _=RefreshAsync();
        }

        void LateUpdate()
        {
            if(!basket||!basket.activeInHierarchy||!carrySocket||!leftHand||!rightHand||!actorRoot)return;
            // The box is rigid, while its socket follows the two animated palms.
            // This is the Unity equivalent of Next's CarrySocket: a CarryRun
            // stride can move the torso and legs without ever leaving the box
            // behind in the chest.
            carrySocket.rotation=actorRoot.rotation;
            var bounds=Bounds(basket);
            var palms=(leftHand.position+rightHand.position)*.5f;
            var desiredCentre=palms+actorRoot.forward*.22f-Vector3.up*bounds.size.y*.34f;
            carrySocket.position+=desiredCentre-bounds.center;
        }

        async Task RefreshAsync()
        {
            if(carry==null)return;refreshing=true;lastVersion=carry.Version;var active=carry.Total>0;var expected=generation;
            try
            {
                if(basket)basket.SetActive(active);
                if(hands){hands.SetGrip(true,active ? .56f : .14f);hands.SetGrip(false,active ? .56f : .14f);}
                foreach(var unit in units)Pool(unit);units.Clear();
                if(!active||!contents||loader==null)return;
                var wanted=new List<string>(VisibleUnits);
                foreach(var entry in carry.Contents())
                {
                    // One harvested inventory unit represents a small produce
                    // batch. Two visible tomatoes per unit fill both crate rows
                    // when the initial three-unit harvest is collected.
                    var visualPerUnit=entry.Key=="tomatoes"?2:1;
                    for(var i=0;i<entry.Value*visualPerUnit&&wanted.Count<VisibleUnits;i++)wanted.Add(entry.Key);
                }
                for(var index=0;index<wanted.Count;index++)
                {
                    if(!ProductAssets.TryGetValue(wanted[index],out var asset))continue;
                    GameObject unit;
                    if(pools.TryGetValue(asset,out var pool)&&pool.Count>0){unit=pool.Pop();unit.SetActive(true);}
                    else unit=await loader.InstantiateAsync(asset,contents,Vector3.zero,Quaternion.identity,Vector3.one);
                    if(expected!=generation||!contents){if(unit)Destroy(unit);return;}
                    unit.name="Carried_"+asset;unit.transform.SetParent(contents,false);NormalizeWorldSize(unit,wanted[index]=="tomatoes"?1.7f:.85f);
                    var column=index%3;var row=index/3;
                    unit.transform.position=contents.position+contents.right*((column-1)*.78f)+contents.forward*((row-.5f)*.68f);
                    unit.transform.localRotation=Quaternion.Euler(0,index*53f,0);
                    foreach(var collider in unit.GetComponentsInChildren<Collider>(true))collider.enabled=false;
                    units.Add(unit);
                }
            }
            finally{refreshing=false;}
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
