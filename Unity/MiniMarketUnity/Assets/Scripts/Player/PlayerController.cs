#if !ENABLE_INPUT_SYSTEM
// Movement, interaction and the whole HUD run on the new Input System. With
// Active Input Handling left on "Input Manager (Old)" no devices are ever
// created: Keyboard.current stays null and InputSystemUIInputModule delivers no
// pointer events, so keyboard, joystick and buttons are all dead and the build
// ships unplayable while still compiling and passing the scripted QA.
#error Mini Market requires the new Input System. Set Project Settings > Player > Active Input Handling to "Input System Package" or "Both".
#endif

using UnityEngine;
using UnityEngine.InputSystem;
using MiniMarket.Data;

namespace MiniMarket.Player
{
    [RequireComponent(typeof(CharacterController))]
    public sealed class PlayerController : MonoBehaviour
    {
        // Exact presentation-space values used by the current Next runtime.
        // Unity works in the scene before Next's outer WORLD_SCALE (3x), so the
        // tier-one 17.82 world-unit cap becomes 5.94 Unity units/second.
        [SerializeField] float walkSpeed = 5.94f;
        [SerializeField] float acceleration = 32.4f;
        [SerializeField] float braking = 43.2f;
        [SerializeField] float turnTime = .13f;
        [SerializeField] float maxTurnRate = 540f;
        CharacterController controller;
        Vector3 velocity;
        float angularVelocity;
        GameStateDocument state;
        public Vector2 VirtualInput { get; set; }
        public bool InputEnabled { get; set; } = true;
        public float Speed01 { get; private set; }
        /// Feeds the WorkstationController port, which mirrors Next's rule that a
        /// deliberate new move cancels stationary work.
        public float InputMagnitude { get; private set; }

        void Awake() => controller = GetComponent<CharacterController>();
        public void Bind(GameStateDocument document)=>state=document;
        void Update()
        {
            if (!InputEnabled) { InputMagnitude = 0f; return; }
            var input = VirtualInput;
            if (Keyboard.current != null)
            {
                if (Keyboard.current.aKey.isPressed || Keyboard.current.leftArrowKey.isPressed) input.x -= 1;
                if (Keyboard.current.dKey.isPressed || Keyboard.current.rightArrowKey.isPressed) input.x += 1;
                if (Keyboard.current.sKey.isPressed || Keyboard.current.downArrowKey.isPressed) input.y += 1;
                if (Keyboard.current.wKey.isPressed || Keyboard.current.upArrowKey.isPressed) input.y -= 1;
            }
            input = Vector2.ClampMagnitude(input, 1);
            InputMagnitude = input.magnitude;
            // Next deliberately uses the fixed overview-camera basis instead
            // of the damped camera transform, keeping arrows straight on screen.
            // OVERVIEW_CAMERA_GROUND_FORWARD is (-16, -25.75) in the authored
            // right-handed layout; StoreWorldBuilder mirrors X, so the basis is
            // mirrored with it. Unity's left-handed cross product then gives
            // screen-right, where the Three formula (-z, x) yielded screen-LEFT
            // and inverted every horizontal input.
            var forward = new Vector3(16f, 0, -25.75f).normalized;
            var right = Vector3.Cross(Vector3.up, forward);
            var direction = Vector3.ClampMagnitude(right * input.x + forward * -input.y, 1f);
            var tier=Mathf.Max(1,state?.CurrentFranchise.Value<int?>("playerSpeedTier")??1);
            var tierMultiplier=1f+Mathf.Min(.32f,(tier-1)*.08f);
            var targetSpeed = direction.sqrMagnitude > .01f ? walkSpeed*tierMultiplier : 0f;
            var desired = direction * targetSpeed;
            velocity = Vector3.MoveTowards(velocity, desired, (targetSpeed > .001f ? acceleration : braking) * Time.deltaTime);
            if (direction.sqrMagnitude > .01f)
            {
                var targetYaw = Mathf.Atan2(direction.x, direction.z) * Mathf.Rad2Deg;
                var yaw = Mathf.SmoothDampAngle(transform.eulerAngles.y, targetYaw, ref angularVelocity, turnTime, maxTurnRate, Time.deltaTime);
                transform.rotation = Quaternion.Euler(0, yaw, 0);
            }
            controller.Move((velocity + Physics.gravity * .12f) * Time.deltaTime);
            Speed01 = Mathf.InverseLerp(0, walkSpeed*tierMultiplier, velocity.magnitude);
        }
    }
}
