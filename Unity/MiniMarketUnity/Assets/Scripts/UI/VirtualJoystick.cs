using MiniMarket.Player;
using UnityEngine;
using UnityEngine.EventSystems;

namespace MiniMarket.UI
{
    public sealed class VirtualJoystick : MonoBehaviour, IPointerDownHandler, IDragHandler, IPointerUpHandler
    {
        RectTransform area;RectTransform visual;RectTransform knob;PlayerController player;Vector2 origin;int pointerId=int.MinValue;
        public void Bind(RectTransform touchArea,RectTransform visualRoot,RectTransform handle,PlayerController controller){area=touchArea;visual=visualRoot;knob=handle;player=controller;if(visual)visual.gameObject.SetActive(false);}
        public void OnPointerDown(PointerEventData eventData)
        {
            if(!area||!player||pointerId!=int.MinValue)return;
            pointerId=eventData.pointerId;
            RectTransformUtility.ScreenPointToLocalPointInRectangle(area,eventData.position,eventData.pressEventCamera,out origin);
            visual.anchoredPosition=origin;knob.anchoredPosition=Vector2.zero;visual.gameObject.SetActive(true);player.VirtualInput=Vector2.zero;
        }
        public void OnDrag(PointerEventData eventData)
        {
            if(!area||!player||eventData.pointerId!=pointerId)return;
            RectTransformUtility.ScreenPointToLocalPointInRectangle(area,eventData.position,eventData.pressEventCamera,out var local);
            var radius=Mathf.Clamp(Mathf.Min(area.rect.width,area.rect.height)*.1f,56f,96f);var delta=local-origin;var thumb=Vector2.ClampMagnitude(delta,radius);knob.anchoredPosition=thumb;
            // Player input uses browser screen coordinates: positive Y means down.
            player.VirtualInput=new Vector2(thumb.x/radius,-thumb.y/radius);
        }
        public void OnPointerUp(PointerEventData eventData){if(eventData.pointerId!=pointerId)return;pointerId=int.MinValue;if(knob)knob.anchoredPosition=Vector2.zero;if(visual)visual.gameObject.SetActive(false);if(player)player.VirtualInput=Vector2.zero;}
        void OnDisable(){pointerId=int.MinValue;if(player)player.VirtualInput=Vector2.zero;}
    }
}
