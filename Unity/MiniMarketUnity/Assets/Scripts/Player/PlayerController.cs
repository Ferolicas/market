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
        [SerializeField] float runSpeed = Core.Pace.Run;
        [SerializeField] float acceleration = 77.76f;
        [SerializeField] float braking = 103.68f;
        CharacterController controller;
        Vector3 velocity;
        /// Ground speed in world units, which is what a stride has to match.
        public float WorldSpeed => new Vector2(velocity.x, velocity.z).magnitude;
        /// Intended speed before acceleration. The animation bridge uses this
        /// to choose the gait immediately instead of forcing two seconds of
        /// walking before a full-stick run.
        public float TargetWorldSpeed { get; private set; }
        GameStateDocument state;
        public Vector2 VirtualInput { get; set; }
        public bool InputEnabled { get; set; } = true;
        /// Stationary checkout work consumes movement until the stick/key is
        /// released; a new deliberate direction cancels work on the next frame.
        public bool MovementLocked { get; set; }
        public float Speed01 { get; private set; }
        /// Feeds the WorkstationController port, which mirrors Next's rule that a
        /// deliberate new move cancels stationary work.
        public float InputMagnitude { get; private set; }
        void Awake() => controller = GetComponent<CharacterController>();
        public void Bind(GameStateDocument document)=>state=document;
        /// Speed upgrades are ten real tiers. Tier one starts at 60% of the
        /// previously approved running speed and tier ten reaches exactly that
        /// speed; no upgrade can make the owner faster than today's 100%.
        public static float SpeedMultiplierForTier(int tier)
        {
            var safeTier=Mathf.Clamp(tier,1,10);
            return Mathf.Lerp(.6f,1f,(safeTier-1)/9f);
        }
        void Update()
        {
            if (!InputEnabled) { InputMagnitude = 0f;TargetWorldSpeed=0f; return; }
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
            if(MovementLocked)
            {
                velocity=Vector3.zero;TargetWorldSpeed=0;Speed01=0;
                controller.Move(Physics.gravity*.12f*Time.deltaTime);
                return;
            }
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
            var tier=state?.CurrentFranchise.Value<int?>("playerSpeedTier")??1;
            var tierMultiplier=SpeedMultiplierForTier(tier);
            var pushing=direction.sqrMagnitude>.01f;
            var inputStrength=direction.magnitude;
            var pace=runSpeed*tierMultiplier;
            var targetSpeed=pushing?pace*inputStrength:0f;
            TargetWorldSpeed=targetSpeed;
            if (pushing)
            {
                // Direction is input, not inertia. Redirect the current speed and
                // the body in the same frame; smoothing the velocity vector and
                // yaw separately made the owner skate sideways before turning.
                var speed=Mathf.MoveTowards(WorldSpeed,targetSpeed,acceleration*Time.deltaTime);
                velocity=direction.normalized*speed;
                var targetYaw = Mathf.Atan2(direction.x, direction.z) * Mathf.Rad2Deg;
                transform.rotation = Quaternion.Euler(0,targetYaw,0);
            }
            else velocity=Vector3.MoveTowards(velocity,Vector3.zero,braking*Time.deltaTime);
            controller.Move((velocity + Physics.gravity * .12f) * Time.deltaTime);
            Speed01 = Mathf.InverseLerp(0, pace, velocity.magnitude);
        }
    }
}
