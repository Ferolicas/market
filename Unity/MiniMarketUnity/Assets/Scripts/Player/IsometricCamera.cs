using UnityEngine;
using MiniMarket.Store;

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
        public Transform farmAnchor;
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
        // In portrait the orthographic frustum is much taller. At the approved
        // 20-degree angle its lower edge used to start below y=0 while its upper
        // rays reached beyond the 120-unit far plane. The canvas was full-screen,
        // but those rays could only draw the cyan clear colour, making the world
        // look like a rounded iframe between two bands. Pulling an orthographic
        // camera backwards along its own axis does not change object size or the
        // viewing angle; it only puts the complete frustum above the ground.
        const float GroundCoverageMargin = 1f;
        const float MinimumFarClip = 512f;
        const float AxisResponse = 8f;

        Camera view;
        float checkoutBlend;
        float inverseSize;
        float axisDegrees;
        bool framed;

        void Awake()
        {
            view = GetComponent<Camera>();
            if(view)view.farClipPlane=Mathf.Max(view.farClipPlane,MinimumFarClip);
        }

        void LateUpdate()
        {
            if (!target) return;
            if (!view) view = GetComponent<Camera>();
            var north=new Vector3(16f,0,-25.75f).normalized;
            var facesSouth=Vector3.Dot(target.forward,north)<-.35f;
            axisDegrees=Mathf.LerpAngle(axisDegrees,facesSouth?180f:0f,Damp(AxisResponse,FrameDelta(Time.deltaTime)));
            var cameraOffset=Quaternion.AngleAxis(axisDegrees,Vector3.up)*OverviewOffset;
            var farmFocused=farmAnchor&&target.position.z<farmAnchor.position.z+26f;
            var focus=farmFocused?farmAnchor.position:target.position;
            var centre = new Vector3(focus.x, TargetHeight, focus.z);
            var overviewPosition = new Vector3(
                centre.x + cameraOffset.x,
                TargetHeight + cameraOffset.y,
                centre.z + cameraOffset.z);

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
            var overviewSize=farmFocused?FarmSize():OverviewSize();
            var desiredInverse=Mathf.Lerp(1f/overviewSize,1f/CheckoutSize(),checkoutBlend);

            var frameHalfHeight=1f/Mathf.Max(.0001f,desiredInverse);
            if (view && view.orthographic)
            {
                if(!framed){inverseSize=desiredInverse;framed=true;}
                else inverseSize=Mathf.Lerp(inverseSize,desiredInverse,Damp(ZoomResponse,FrameDelta(Time.deltaTime)));
                frameHalfHeight=1f/Mathf.Max(.0001f,inverseSize);
                view.orthographicSize=frameHalfHeight;
                view.farClipPlane=Mathf.Max(view.farClipPlane,MinimumFarClip);
            }
            desiredPosition=CoverGround(desiredTarget,desiredPosition,frameHalfHeight);

            // Following in LateUpdate with no positional damping keeps the
            // character on the optical axis while standing, walking or turning.
            transform.position = desiredPosition;
            transform.rotation = Quaternion.LookRotation((desiredTarget - desiredPosition).normalized, Vector3.up);
        }

        /// Keeps every portrait-screen ray in front of the y=0 world plane.
        /// The returned point stays on the exact same camera axis, so the
        /// projection, target position, character size and 20-degree view remain
        /// unchanged. Wide screens already have enough height and return the
        /// original position byte-for-byte.
        internal static Vector3 CoverGround(Vector3 target,Vector3 position,float halfHeight)
        {
            var back=position-target;
            if(back.sqrMagnitude<.0001f)return position;
            back.Normalize();
            if(back.y<=.0001f)return position;
            var rotation=Quaternion.LookRotation(-back,Vector3.up);
            var screenUp=rotation*Vector3.up;
            var bottomY=position.y-Mathf.Abs(screenUp.y)*Mathf.Max(0,halfHeight);
            if(bottomY>=GroundCoverageMargin)return position;
            return position+back*((GroundCoverageMargin-bottomY)/back.y);
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
        float FarmSize()=>Mathf.Max(OverviewSize(),(StoreWorldBuilder.FarmWorldRadius+10f)/Aspect);
        // CHECKOUT_CAMERA_FRAME = { width: 39, height: 27 }. The close view is
        // intentionally independent of the requested 40% overview pullback.
        float CheckoutSize()=>Mathf.Max(27f*.5f,39f/(2f*Aspect));
        float Aspect => view ? Mathf.Max(.1f, view.aspect) : 1f;
        static float FrameDelta(float delta)=>Mathf.Clamp(delta,0,.05f);
        static float Damp(float response,float delta)=>1f-Mathf.Exp(-response*delta);
    }
}
