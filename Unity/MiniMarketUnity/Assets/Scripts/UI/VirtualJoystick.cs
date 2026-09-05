using MiniMarket.Player;
using UnityEngine;
using UnityEngine.EventSystems;

namespace MiniMarket.UI
{
    /// A stick fixed in the corner: invisible until a finger takes it, and
    /// rubbery once it has one. The lever springs after the finger instead of
    /// snapping to it, and springs back to the middle when it is let go, which
    /// is what makes a touch control feel like a physical thing. The direction
    /// the player moves comes from the finger, not from the springing lever, so
    /// the feel costs nothing in precision.
    public sealed class VirtualJoystick : MonoBehaviour, IPointerDownHandler, IDragHandler, IPointerUpHandler
    {
        const float Radius = 74f;        // canvas units the lever may travel
        const float Reach = 2.6f;        // how far around the dial a press still grabs it
        const float Stiffness = 220f;    // spring pulling the lever to the finger
        const float Damping = 14f;       // how quickly that spring settles
        const float FadeIn = .10f;
        const float FadeOut = .28f;

        RectTransform area; RectTransform visual; RectTransform knob; PlayerController player;
        CanvasGroup group; Canvas root;
        Vector2 want, at, velocity; int pointerId = int.MinValue; float shown;

        public void Bind(RectTransform touchArea, RectTransform visualRoot, RectTransform handle, PlayerController controller, CanvasGroup fade = null, Canvas canvas = null)
        {
            area = touchArea; visual = visualRoot; knob = handle; player = controller;
            group = fade ? fade : visual ? visual.GetComponent<CanvasGroup>() : null;
            root = canvas ? canvas : GetComponentInParent<Canvas>();
            pointerId = int.MinValue; want = at = velocity = Vector2.zero; shown = 0f;
            if (group) group.alpha = 0f;
            if (knob) knob.anchoredPosition = Vector2.zero;
            if (visual) visual.gameObject.SetActive(true);
        }

        float Scale => root ? Mathf.Max(.01f, root.scaleFactor) : 1f;
        Vector2 Centre => RectTransformUtility.WorldToScreenPoint(root && root.renderMode == RenderMode.ScreenSpaceOverlay ? null : root?.worldCamera, visual.position);

        public void OnPointerDown(PointerEventData eventData)
        {
            if (!visual || !player || pointerId != int.MinValue) return;
            if ((eventData.position - Centre).magnitude > Radius * Reach * Scale) return;   // a press far from the stick is not for it
            pointerId = eventData.pointerId;
            Track(eventData.position);
        }

        public void OnDrag(PointerEventData eventData)
        {
            if (!visual || !player || eventData.pointerId != pointerId) return;
            Track(eventData.position);
        }

        public void OnPointerUp(PointerEventData eventData)
        {
            if (eventData.pointerId != pointerId) return;
            pointerId = int.MinValue; want = Vector2.zero;
            if (player) player.VirtualInput = Vector2.zero;
        }

        void Track(Vector2 screen)
        {
            var delta = Vector2.ClampMagnitude((screen - Centre) / Scale, Radius);
            want = delta;
            // Screen coordinates run down the way the browser reads them.
            player.VirtualInput = new Vector2(delta.x / Radius, -delta.y / Radius);
        }

        void Update()
        {
            var step = Mathf.Min(Time.unscaledDeltaTime, .05f);
            velocity += (want - at) * Stiffness * step;
            velocity *= Mathf.Exp(-Damping * step);
            at += velocity * step;
            if (knob)
            {
                knob.anchoredPosition = at;
                // rubber: the lever leans and stretches into the push
                var lean = at / Radius;
                knob.localScale = new Vector3(1f + Mathf.Abs(lean.x) * .12f, 1f + Mathf.Abs(lean.y) * .12f, 1f);
            }
            var target = pointerId != int.MinValue ? 1f : 0f;
            shown = Mathf.MoveTowards(shown, target, step / (target > shown ? FadeIn : FadeOut));
            if (group) group.alpha = shown;
        }

        void OnDisable()
        {
            pointerId = int.MinValue; want = at = velocity = Vector2.zero;
            if (group) group.alpha = 0f;
            if (player) player.VirtualInput = Vector2.zero;
        }
    }
}
