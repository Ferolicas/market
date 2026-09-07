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
        public bool OverviewActive => overviewRequested;

        // OVERVIEW_CAMERA_OFFSET = { x: 16, y: 23, z: 25.75 }, X mirrored: that
        // is Next's azimuth and distance, 37 degrees up. The kit's geometry was
        // built for a camera about 16 degrees up (the sheets' own view), so the
        // rig keeps the azimuth and the distance and drops to that elevation.
        const float ElevationDegrees = 30f;
        static readonly Vector3 OverviewOffset = Lowered(new Vector3(-16f, 23f, 25.75f), ElevationDegrees);
        static Vector3 Lowered(Vector3 offset, float degrees)
        {
            var flat = new Vector3(offset.x, 0f, offset.z);
            var radius = offset.magnitude; var e = degrees * Mathf.Deg2Rad;
            return flat.normalized * (radius * Mathf.Cos(e)) + Vector3.up * (radius * Mathf.Sin(e));
        }
        // Keep the approved player size and spend more of the same frame on the
        // path ahead. A 20% projected offset leaves the actor at roughly 30% of
        // the screen height from the trailing edge, with 70% available ahead.
        const float AheadFraction = .20f;
        const float HeadingResponse = 14f;
        Vector3 heading;
        // The damped follow lags a moving target by velocity / response; the
        // point is to see ahead *while* walking, so that lag is fed forward
        // and the player holds its place in the frame on the move, not only
        // after stopping.
        const float VelocityResponse = 12f;
        Vector3 velocity, lastTargetPosition;
        // scaleStorePosition(CHECKOUT_CAMERA_POSITION / _TARGET), X mirrored.
        static readonly Vector3 CheckoutPosition = new(-16.6f, 7.2f, 17.6f);
        static readonly Vector3 CheckoutTarget = new(-16.6f, 1.35f, 7.6f);
        // Aim at the visual centre of the approved 1.75 m owner. Looking at the
        // old 0.99-unit ankle height put a full-size head under the top HUD as
        // soon as look-ahead was enabled.
        const float TargetHeight = 5.4f;
        const float FollowResponse = 2.8f;
        const float ZoomResponse = 5f;
        const float FocusResponse = 4.8f;
        const float ReleaseResponse = 3.2f;
        const float OverviewResponse = 5.5f;
        const float OverviewMargin = 1.08f;
        const float NormalFarClip = 120f;

        Camera view;
        Vector3 lookAt;
        float blend;
        float overviewBlend;
        float peekBlend;
        float inverseSize = 1f;
        bool framed;
        bool overviewRequested;
        bool hasOverviewBounds;
        Bounds overviewBounds;
        Vector3 peekPoint;
        float peekUntil;
        float inputMagnitude;

        void Awake() => view = GetComponent<Camera>();

        public void ConfigureOverview(Bounds bounds)
        {
            overviewBounds = bounds;
            hasOverviewBounds = bounds.size.sqrMagnitude > 1f;
        }

        public bool ToggleOverview()
        {
            SetOverview(!overviewRequested);
            return overviewRequested;
        }

        public void SetOverview(bool value)
        {
            overviewRequested = value;
            if (value) peekUntil = 0f;
            Debug.Log($"MINIMARKET_CAMERA mode={(value?"overview":"follow")} normalHalf={OverviewSize():0.00} fullHalf={(hasOverviewBounds?FullOverviewSize():OverviewSize()):0.00} ahead={AheadFraction:0.00}");
        }

        public void PeekAt(Vector3 worldPoint, float seconds = 2.8f)
        {
            overviewRequested = false;
            peekPoint = worldPoint;
            peekUntil = Time.unscaledTime + Mathf.Max(.5f, seconds);
            Debug.Log($"MINIMARKET_CAMERA mode=focus x={worldPoint.x:0.0} z={worldPoint.z:0.0} seconds={seconds:0.0}");
        }

        public void SetInputMagnitude(float value)
        {
            inputMagnitude = value;
            if (value > .08f) peekUntil = 0f;
        }

        void LateUpdate()
        {
            if (!target) return;
            if (!view) view = GetComponent<Camera>();
            var delta = FrameDelta(Time.deltaTime);

            var facing = new Vector3(target.forward.x, 0f, target.forward.z);
            if (facing.sqrMagnitude < 1e-6f) facing = heading.sqrMagnitude < 1e-6f ? Vector3.forward : heading;
            facing.Normalize();
            heading = framed ? Vector3.Slerp(heading, facing, Damp(HeadingResponse, delta)) : facing;
            var raw = Time.deltaTime > 1e-4f && framed ? (target.position - lastTargetPosition) / Time.deltaTime : Vector3.zero;
            raw.y = 0f;
            velocity = framed ? Vector3.Lerp(velocity, raw, Damp(VelocityResponse, delta)) : Vector3.zero;
            lastTargetPosition = target.position;
            var ahead = target.position + heading * AheadDistance(heading) + velocity / FollowResponse;
            var overviewLookAt = new Vector3(ahead.x, TargetHeight, ahead.z);
            var overviewPosition = new Vector3(
                ahead.x + OverviewOffset.x,
                TargetHeight + OverviewOffset.y,
                ahead.z + OverviewOffset.z);
            var peeking = Time.unscaledTime < peekUntil && inputMagnitude <= .08f;
            blend = Mathf.Lerp(blend, checkoutFocused && !overviewRequested && !peeking ? 1f : 0f, Damp(checkoutFocused ? FocusResponse : ReleaseResponse, delta));
            var desiredLookAt = Vector3.Lerp(overviewLookAt, CheckoutTarget, blend);
            var desiredPosition = Vector3.Lerp(overviewPosition, CheckoutPosition, blend);
            // Next damps `zoom`, which is the reciprocal of the orthographic
            // half-height. Interpolating the size directly would ease along a
            // different curve, so the blend stays in reciprocal space.
            var desiredInverseSize = Mathf.Lerp(1f / OverviewSize(), 1f / CheckoutSize(), blend);

            peekBlend = Mathf.Lerp(peekBlend, peeking ? 1f : 0f, Damp(peeking ? FocusResponse : ReleaseResponse, delta));
            var peekLookAt = new Vector3(peekPoint.x, TargetHeight, peekPoint.z);
            desiredLookAt = Vector3.Lerp(desiredLookAt, peekLookAt, peekBlend);
            desiredPosition = Vector3.Lerp(desiredPosition, peekLookAt + OverviewOffset, peekBlend);
            desiredInverseSize = Mathf.Lerp(desiredInverseSize, 1f / OverviewSize(), peekBlend);

            overviewBlend = Mathf.Lerp(overviewBlend, overviewRequested ? 1f : 0f, Damp(OverviewResponse, delta));
            if (hasOverviewBounds)
            {
                desiredLookAt = Vector3.Lerp(desiredLookAt, overviewBounds.center, overviewBlend);
                desiredPosition = Vector3.Lerp(desiredPosition, FullOverviewPosition(), overviewBlend);
                desiredInverseSize = Mathf.Lerp(desiredInverseSize, 1f / FullOverviewSize(), overviewBlend);
            }

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
            if (view)
            {
                if (view.orthographic) view.orthographicSize = 1f / inverseSize;
                var overviewFar = hasOverviewBounds ? Mathf.Max(NormalFarClip, FullOverviewDistance() * 2.5f) : NormalFarClip;
                view.farClipPlane = Mathf.Lerp(NormalFarClip, overviewFar, overviewBlend);
            }
        }

        /// Ground distance along `direction` whose screen displacement is
        /// AheadFraction of the frame height, for the current orthographic size.
        float AheadDistance(Vector3 direction)
        {
            var flat = new Vector3(-OverviewOffset.x, 0f, -OverviewOffset.z).normalized;   // towards the scene, on the ground
            var right = Vector3.Cross(Vector3.up, flat).normalized;
            var sinE = Mathf.Sin(ElevationDegrees * Mathf.Deg2Rad);
            var across = Vector3.Dot(direction, right);
            var away = Vector3.Dot(direction, flat) * sinE;
            var perUnit = Mathf.Sqrt(across * across + away * away);
            // Use the normal frame size even while returning from the full-world
            // view; otherwise its large transient size would throw the player
            // hundreds of units off-centre for the first return frame.
            var halfHeight = OverviewSize();
            return perUnit < 1e-4f ? 0f : AheadFraction * 2f * halfHeight / perUnit;
        }

        float FullOverviewDistance() => Mathf.Max(OverviewOffset.magnitude, overviewBounds.extents.magnitude * 1.35f + 12f);
        Vector3 FullOverviewPosition() => overviewBounds.center + OverviewOffset.normalized * FullOverviewDistance();

        float FullOverviewSize()
        {
            if (!hasOverviewBounds) return OverviewSize();
            var rotation = Quaternion.LookRotation(-OverviewOffset.normalized, Vector3.up);
            var right = rotation * Vector3.right;
            var up = rotation * Vector3.up;
            var extents = overviewBounds.extents;
            var horizontal = Mathf.Abs(right.x) * extents.x + Mathf.Abs(right.y) * extents.y + Mathf.Abs(right.z) * extents.z;
            var vertical = Mathf.Abs(up.x) * extents.x + Mathf.Abs(up.y) * extents.y + Mathf.Abs(up.z) * extents.z;
            return Mathf.Max(vertical, horizontal / Aspect) * OverviewMargin;
        }

        // Next sizes the frustum in canvas pixels beneath a WORLD_SCALE=3 group:
        // zoom = min(w / 32, h / 28.5) / CAMERA_DISTANCE_FACTOR(1.15). Unity
        // holds the authored coordinates directly, so the visible frame divides
        // by that outer scale and again by two to become a half-height.
        // This is the only knob that departs from Next's framing parity.
        // Both frames are pulled back by the same amount, so the cut to the
        // checkout keeps its relationship with the overview. 1.38 framed the
        // shop before it tripled in space; a further 30% on request.
        const float PullBack = 1.794f;
        float OverviewSize() => PullBack * Mathf.Max(28.5f * 1.15f / 6f, 32f * 1.15f / (6f * Aspect));
        // CHECKOUT_CAMERA_FRAME = { width: 39, height: 27 }, no distance factor.
        float CheckoutSize() => PullBack * Mathf.Max(27f / 6f, 39f / (6f * Aspect));
        float Aspect => view ? Mathf.Max(.1f, view.aspect) : 1f;

        static float FrameDelta(float delta) => Mathf.Clamp(delta, 0f, .05f);
        static float Damp(float response, float delta) => 1f - Mathf.Exp(-response * delta);
    }
}
