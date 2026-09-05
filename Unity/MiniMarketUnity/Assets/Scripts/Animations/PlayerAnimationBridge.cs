using MiniMarket.Player;
using MiniMarket.Inventory;
using UnityEngine;

namespace MiniMarket.Animations
{
    public sealed class PlayerAnimationBridge : MonoBehaviour
    {
        PlayerController controller;
        CharacterActor actor;
        PlayerCarrySystem carry;
        string current;
        float lastRate = 1f;
        public void Bind(PlayerController value, CharacterActor character,PlayerCarrySystem playerCarry=null) { controller = value; actor = character;carry=playerCarry; }
        void Update()
        {
            if (!controller || !actor) return;
            var loaded=carry?.Total>0;
            var speed = controller.WorldSpeed;
            if (speed <= .12f)
            {
                var still = loaded ? "CarryIdle" : "Idle";
                if (still == current) return;
                current = still; actor.Play(still);
                return;
            }
            // The clip and the rate come from the speed itself, so a stride
            // covers the ground the body actually crosses. A fixed threshold
            // also flipped Run and Walk on every frame that hovered around it,
            // restarting a 0.18 s crossfade each time.
            var (clip, rate) = CharacterActor.Locomotion(speed, loaded, actor.StrideScale);
            if (clip == current && Mathf.Abs(rate - lastRate) < .06f) return;
            current = clip; lastRate = rate; actor.Play(clip, .18f, rate);
        }
    }
}
