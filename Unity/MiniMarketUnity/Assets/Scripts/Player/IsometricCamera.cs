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

        // OVERVIEW_CAMERA_OFFSET = { x: 16, y: 23, z: 25.75 }, X mirrored: that
        // is Next's azimuth and distance, 37 degrees up. The kit's geometry was
        // built for a camera about 16 degrees up (the sheets' own view), so the
        // rig keeps the azimuth and the distance and drops to that elevation.
        const float ElevationDegrees = 50f;
        static readonly Vector3 OverviewOffset = Lowered(new Vector3(-16f, 23f, 25.75f), ElevationDegrees);
        static Vector3 Lowered(Vector3 offset, float degrees)
        {
            var flat = new Vector3(offset.x, 0f, offset.z);
            var radius = offset.magnitude; var e = degrees * Mathf.Deg2Rad;
            return flat.normalized * (radius * Mathf.Cos(e)) + Vector3.up * (radius * Mathf.Sin(e));
        }
        // The player is not framed at the centre but 30% of the frame height
        // behind the way it faces, so the screen shows what lies ahead: the
        // look-at point runs ahead of the player along its facing, by the
        // ground distance that projects to that screen offset -- a step away
        // from the camera climbs the screen by sin(elevation), a step across
        // it moves a full step -- so the offset reads the same whichever way
        // the player walks. The facing is damped so a turn re-frames smoothly.
        const float AheadFraction = .30f;
        const float HeadingResponse = 8f;
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
            var halfHeight = 1f / Mathf.Max(1e-4f, inverseSize);
            return perUnit < 1e-4f ? 0f : AheadFraction * 2f * halfHeight / perUnit;
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
