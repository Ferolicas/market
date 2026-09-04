using UnityEngine;

namespace MiniMarket.Player
{
    /// Port of Next's OverviewCamera. StoreWorldBuilder converts the authored
    /// Three.js layout into Unity by negating X, so every constant lifted from
    /// the specification has to be mirrored along with the world. Leaving the
    /// offset unmirrored swung the framing roughly 64 degrees of azimuth around
    /// the store and threw the fixtures onto the wrong side of the screen.
    public sealed class IsometricCamera : MonoBehaviour
    {
        public Transform target;
        /// Next blends to the checkout rig while WorkstationController reports
        /// `performingZoneId() === "checkout"`.
        public bool checkoutFocused;

        // OVERVIEW_CAMERA_OFFSET = { x: 16, y: 23, z: 25.75 }, X mirrored.
        static readonly Vector3 OverviewOffset = new(-16f, 23f, 25.75f);
        // scaleStorePosition(CHECKOUT_CAMERA_POSITION / _TARGET), X mirrored.
        static readonly Vector3 CheckoutPosition = new(-16.6f, 7.2f, 17.6f);
        static readonly Vector3 CheckoutTarget = new(-16.6f, 1.35f, 7.6f);
        // 0.9 * PLAYER_SCALE(1.1): the constant height the rig aims at. Next
        // keeps it independent of the player's own Y, and so does this.
        const float TargetHeight = .99f;
        const float FollowResponse = 2.8f;
        const float ZoomResponse = 5f;
        const float FocusResponse = 4.8f;
        const float ReleaseResponse = 3.2f;

        Camera view;
        Vector3 lookAt;
        float blend;
        float inverseSize = 1f;
        bool framed;

        void Awake() => view = GetComponent<Camera>();

        void LateUpdate()
        {
            if (!target) return;
            if (!view) view = GetComponent<Camera>();
            var delta = FrameDelta(Time.deltaTime);

            var overviewLookAt = new Vector3(target.position.x, TargetHeight, target.position.z);
            var overviewPosition = new Vector3(
                target.position.x + OverviewOffset.x,
                TargetHeight + OverviewOffset.y,
                target.position.z + OverviewOffset.z);
            blend = Mathf.Lerp(blend, checkoutFocused ? 1f : 0f, Damp(checkoutFocused ? FocusResponse : ReleaseResponse, delta));
            var desiredLookAt = Vector3.Lerp(overviewLookAt, CheckoutTarget, blend);
            var desiredPosition = Vector3.Lerp(overviewPosition, CheckoutPosition, blend);
            // Next damps `zoom`, which is the reciprocal of the orthographic
            // half-height. Interpolating the size directly would ease along a
            // different curve, so the blend stays in reciprocal space.
            var desiredInverseSize = Mathf.Lerp(1f / OverviewSize(), 1f / CheckoutSize(), blend);

            if (!framed)
            {
                framed = true;
                transform.position = desiredPosition;
                lookAt = desiredLookAt;
                inverseSize = desiredInverseSize;
            }
            else
            {
                var response = Damp(FollowResponse, delta);
                transform.position = Vector3.Lerp(transform.position, desiredPosition, response);
                lookAt = Vector3.Lerp(lookAt, desiredLookAt, response);
                inverseSize = Mathf.Lerp(inverseSize, desiredInverseSize, Damp(ZoomResponse, delta));
            }

            transform.rotation = Quaternion.LookRotation((lookAt - transform.position).normalized, Vector3.up);
            if (view && view.orthographic) view.orthographicSize = 1f / inverseSize;
        }

        // Next sizes the frustum in canvas pixels beneath a WORLD_SCALE=3 group:
        // zoom = min(w / 32, h / 28.5) / CAMERA_DISTANCE_FACTOR(1.15). Unity
        // holds the authored coordinates directly, so the visible frame divides
        // by that outer scale and again by two to become a half-height.
        float OverviewSize() => Mathf.Max(28.5f * 1.15f / 6f, 32f * 1.15f / (6f * Aspect));
        // CHECKOUT_CAMERA_FRAME = { width: 39, height: 27 }, no distance factor.
        float CheckoutSize() => Mathf.Max(27f / 6f, 39f / (6f * Aspect));
        float Aspect => view ? Mathf.Max(.1f, view.aspect) : 1f;

        static float FrameDelta(float delta) => Mathf.Clamp(delta, 0f, .05f);
        static float Damp(float response, float delta) => 1f - Mathf.Exp(-response * delta);
    }
}
