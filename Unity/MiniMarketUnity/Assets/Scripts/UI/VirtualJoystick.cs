using MiniMarket.Player;
using UnityEngine;
using UnityEngine.EventSystems;

namespace MiniMarket.UI
{
    /// Movement by dragging anywhere on the screen, with nothing drawn: the
    /// press is the centre and the drag away from it is the direction, so the
    /// control is wherever the thumb lands and never covers the shop. Holding
    /// a direction still breaks into a run; that lives in PlayerController.
    public sealed class VirtualJoystick : MonoBehaviour, IPointerDownHandler, IDragHandler, IPointerUpHandler
    {
        /// How far the finger travels from where it landed for a full push.
        const float Reach = 74f;

        RectTransform area; PlayerController player; Canvas root;
        Vector2 origin; int pointerId = int.MinValue;

        public void Bind(RectTransform touchArea, PlayerController controller, Canvas canvas = null)
        {
            area = touchArea; player = controller;
            root = canvas ? canvas : GetComponentInParent<Canvas>();
            pointerId = int.MinValue;
            if (player) player.VirtualInput = Vector2.zero;
        }

        float Scale => root ? Mathf.Max(.01f, root.scaleFactor) : 1f;

        public void OnPointerDown(PointerEventData eventData)
        {
            if (!player || pointerId != int.MinValue) return;
            pointerId = eventData.pointerId; origin = eventData.position;
            player.VirtualInput = Vector2.zero;
        }

        public void OnDrag(PointerEventData eventData)
        {
            if (!player || eventData.pointerId != pointerId) return;
            var delta = Vector2.ClampMagnitude((eventData.position - origin) / Scale, Reach);
            // Screen coordinates count upwards; the player reads them the way
            // the browser does, with a push up meaning forward.
            player.VirtualInput = new Vector2(delta.x / Reach, -delta.y / Reach);
        }

        public void OnPointerUp(PointerEventData eventData)
        {
            if (eventData.pointerId != pointerId) return;
            pointerId = int.MinValue;
            if (player) player.VirtualInput = Vector2.zero;
        }

        void OnDisable()
        {
            pointerId = int.MinValue;
            if (player) player.VirtualInput = Vector2.zero;
        }
    }
}
