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
        public Transform checkoutAnchor;
        /// Matches Next's WorkstationController checkout focus.
        public bool checkoutFocused;

        // OVERVIEW_CAMERA_OFFSET = { x: 16, y: 23, z: 25.75 }, X mirrored: that
        // is Next's azimuth and distance, 37 degrees up. The furniture sheets
        // use a low three-quarter view, so the follow rig keeps the approved
        // azimuth and drops to a more frontal 20-degree elevation. The requested
        // 40% pullback scales this vector without changing that angle.
        const float ReferenceElevationDegrees = 30f;
        const float ElevationDegrees = 20f;
        const float DistanceMultiplier = 1.4f;
        static readonly Vector3 OverviewOffset = Lowered(new Vector3(-16f, 23f, 25.75f), ElevationDegrees) * DistanceMultiplier;
        static Vector3 Lowered(Vector3 offset, float degrees)
        {
            var flat = new Vector3(offset.x, 0f, offset.z);
            var radius = offset.magnitude; var e = degrees * Mathf.Deg2Rad;
            return flat.normalized * (radius * Mathf.Cos(e)) + Vector3.up * (radius * Mathf.Sin(e));
        }
        // 0.9 * PLAYER_SCALE(1.1): the constant height the rig aims at. Next
        // keeps it independent of the player's own Y, and so does this.
        const float TargetHeight = .99f;
        const float FocusResponse = 4.8f;
        const float ReleaseResponse = 3.2f;
        const float ZoomResponse = 5f;

        Camera view;
        float checkoutBlend;
        float inverseSize;
        bool framed;

        void Awake() => view = GetComponent<Camera>();

        void LateUpdate()
        {
            if (!target) return;
            if (!view) view = GetComponent<Camera>();
            var centre = new Vector3(target.position.x, TargetHeight, target.position.z);
            var overviewPosition = new Vector3(
                centre.x + OverviewOffset.x,
                TargetHeight + OverviewOffset.y,
                centre.z + OverviewOffset.z);

            var blendTarget=checkoutFocused&&checkoutAnchor?1f:0f;
            checkoutBlend=Mathf.Lerp(checkoutBlend,blendTarget,Damp(blendTarget>0?FocusResponse:ReleaseResponse,FrameDelta(Time.deltaTime)));
            // Camera coordinates in checkout-layout.ts are relative to lane 1's
            // counter. X/Z use the original physical plan scale (2*3) so the
            // shop's later spatial expansion does not pull the register out of
            // its own shot. Heights retain Next's WORLD_SCALE=3 conversion.
            var checkoutTarget=checkoutAnchor
                ?checkoutAnchor.position+new Vector3(-4.5f,4.05f,-.9f)
                :centre;
            var checkoutPosition=checkoutAnchor
                ?checkoutAnchor.position+new Vector3(-4.5f,21.6f,29.1f)
                :overviewPosition;
            var desiredTarget=Vector3.Lerp(centre,checkoutTarget,checkoutBlend);
            var desiredPosition=Vector3.Lerp(overviewPosition,checkoutPosition,checkoutBlend);
            var desiredInverse=Mathf.Lerp(1f/OverviewSize(),1f/CheckoutSize(),checkoutBlend);

            // Following in LateUpdate with no positional damping keeps the
            // character on the optical axis while standing, walking or turning.
            transform.position = desiredPosition;
            transform.rotation = Quaternion.LookRotation((desiredTarget - desiredPosition).normalized, Vector3.up);
            if (view && view.orthographic)
            {
                if(!framed){inverseSize=desiredInverse;framed=true;}
                else inverseSize=Mathf.Lerp(inverseSize,desiredInverse,Damp(ZoomResponse,FrameDelta(Time.deltaTime)));
                view.orthographicSize=1f/Mathf.Max(.0001f,inverseSize);
            }
        }

        // Next sizes the frustum in canvas pixels beneath a WORLD_SCALE=3 group:
        // zoom = min(w / 32, h / 28.5) / CAMERA_DISTANCE_FACTOR(1.15). Unity
        // holds the authored coordinates directly, so the visible frame divides
        // by that outer scale and again by two to become a half-height.
        // This is the only knob that departs from Next's framing parity.
        // 1.38 framed the shop before it tripled in space, then 30% was added.
        // The latest 40% request expands the orthographic frame by the same
        // multiplier used by the physical camera offset.
        const float PullBack = 2.5116f;
        // A vertical character projects with cos(elevation). Compensate the
        // lower angle so the owner keeps the same on-screen height as at the
        // previously approved 30-degree view.
        float FrontalProjectionCompensation => Mathf.Cos(ElevationDegrees * Mathf.Deg2Rad) / Mathf.Cos(ReferenceElevationDegrees * Mathf.Deg2Rad);
        float OverviewSize() => PullBack * FrontalProjectionCompensation * Mathf.Max(28.5f * 1.15f / 6f, 32f * 1.15f / (6f * Aspect));
        // CHECKOUT_CAMERA_FRAME = { width: 39, height: 27 }. The close view is
        // intentionally independent of the requested 40% overview pullback.
        float CheckoutSize()=>Mathf.Max(27f*.5f,39f/(2f*Aspect));
        float Aspect => view ? Mathf.Max(.1f, view.aspect) : 1f;
        static float FrameDelta(float delta)=>Mathf.Clamp(delta,0,.05f);
        static float Damp(float response,float delta)=>1f-Mathf.Exp(-response*delta);
    }
}
