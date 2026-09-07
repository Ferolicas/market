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
        // Next's tier-one cap is 17.82 world units, and this used to be that
        // figure divided by Next's outer WORLD_SCALE of 3, because the cast was
        // presented at a third of world size. The cast is now presented at full
        // size, so the divisor went: at 5.94 a character three times taller
        // covered the same ground in the same time and read as a giant walking
        // in slow motion. This sits a fifth under that full figure, which is
        // where the pace was judged right on screen. Acceleration and braking
        // keep their proportion to it, and the stride rate follows on its own
        // because CharacterActor.Locomotion reads the speed itself.
        [SerializeField] float walkSpeed = Core.Pace.Walk;
        [SerializeField] float runSpeed = Core.Pace.Run;
        [SerializeField] float acceleration = 77.76f;
        [SerializeField] float braking = 103.68f;
        CharacterController controller;
        Vector3 velocity;
        /// Ground speed in world units, which is what a stride has to match.
        public float WorldSpeed => new Vector2(velocity.x, velocity.z).magnitude;
        GameStateDocument state;
        public Vector2 VirtualInput { get; set; }
        public bool InputEnabled { get; set; } = true;
        public float Speed01 { get; private set; }
        /// True while the owner holds the run key. The rest of the cast walks.
        public bool Running { get; private set; }
        /// Feeds the WorkstationController port, which mirrors Next's rule that a
        /// deliberate new move cancels stationary work.
        public float InputMagnitude { get; private set; }
        /// Hold a direction this long and the owner breaks into a run; let go
        /// and he drops back to walking. A key would be no use on a touch
        /// screen, where the joystick is the only control there is.
        const float HoldToRun = 2f;
        float held;

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
            // Two seconds of a held direction breaks into a run, and letting
            // go drops back to a walk. Turning does not interrupt it: only
            // releasing does. Shift still works for anyone on a keyboard.
            var pushing=direction.sqrMagnitude>.01f;
            held=pushing?held+Time.deltaTime:0f;
            var running=pushing&&(held>=HoldToRun||(Keyboard.current!=null&&(Keyboard.current.leftShiftKey.isPressed||Keyboard.current.rightShiftKey.isPressed)));
            Running=running;
            var pace=(running?runSpeed:walkSpeed)*tierMultiplier;
            var targetSpeed = direction.sqrMagnitude > .01f ? pace : 0f;
            if (pushing)
            {
                // Direction is input, not inertia. Redirect the current speed and
                // the body in the same frame; smoothing the velocity vector and
                // yaw separately made the owner skate sideways before turning.
                var speed=Mathf.MoveTowards(WorldSpeed,targetSpeed,acceleration*Time.deltaTime);
                velocity=direction*speed;
                var targetYaw = Mathf.Atan2(direction.x, direction.z) * Mathf.Rad2Deg;
                transform.rotation = Quaternion.Euler(0,targetYaw,0);
            }
            else velocity=Vector3.MoveTowards(velocity,Vector3.zero,braking*Time.deltaTime);
            controller.Move((velocity + Physics.gravity * .12f) * Time.deltaTime);
            Speed01 = Mathf.InverseLerp(0, runSpeed*tierMultiplier, velocity.magnitude);
        }
    }
}
