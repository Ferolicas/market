using System.Threading.Tasks;
using MiniMarket.Animations;
using MiniMarket.Assets;
using MiniMarket.Inventory;
using UnityEngine;

namespace MiniMarket.Player
{
    /// <summary>One reusable hand-held basket; inventory remains pure state.</summary>
    public sealed class PlayerCarryVisual : MonoBehaviour
    {
        RuntimeGltfLoader loader;
        PlayerCarrySystem carry;
        GameObject basket;
        HandPoseDriver hands;
        int lastTotal=-1;

        public async Task BindAsync(RuntimeGltfLoader runtimeLoader,CharacterActor actor,PlayerCarrySystem playerCarry)
        {
            loader=runtimeLoader;carry=playerCarry;
            if(basket)Destroy(basket);
            var sockets=actor.GetComponent<CharacterSockets>();hands=actor.GetComponent<HandPoseDriver>();
            var socket=sockets?.Get("Basket");
            if(socket)
            {
                basket=await loader.InstantiateAsync("ShoppingBasket",socket,Vector3.zero,Quaternion.identity,Vector3.one);
                basket.name="PlayerCarryBasket";NormalizeWorldSize(basket,.52f);
                basket.transform.localPosition=Vector3.zero;basket.transform.localRotation=Quaternion.identity;
                foreach(var collider in basket.GetComponentsInChildren<Collider>(true))collider.enabled=false;
            }
            lastTotal=-1;Refresh();
        }

        void Update()
        {
            if(carry==null||carry.Total==lastTotal)return;
            Refresh();
        }

        void Refresh()
        {
            if(carry==null)return;lastTotal=carry.Total;var active=lastTotal>0;
            if(basket)basket.SetActive(active);
            if(hands){hands.SetGrip(true,active ? .58f : .14f);hands.SetGrip(false,active ? .28f : .14f);}
        }

        static void NormalizeWorldSize(GameObject item,float targetLongest)
        {
            var renderers=item.GetComponentsInChildren<Renderer>(true);if(renderers.Length==0)return;
            var bounds=renderers[0].bounds;for(var i=1;i<renderers.Length;i++)bounds.Encapsulate(renderers[i].bounds);
            var longest=Mathf.Max(bounds.size.x,Mathf.Max(bounds.size.y,bounds.size.z));if(longest>.0001f)item.transform.localScale*=targetLongest/longest;
        }
    }
}
