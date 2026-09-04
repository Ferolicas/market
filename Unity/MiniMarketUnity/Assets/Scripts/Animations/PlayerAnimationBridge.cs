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
        public void Bind(PlayerController value, CharacterActor character,PlayerCarrySystem playerCarry=null) { controller = value; actor = character;carry=playerCarry; }
        void Update()
        {
            if (!controller || !actor) return;
            var loaded=carry?.Total>0;
            // A single 0.72 threshold flipped Run and Walk on every frame whose
            // speed hovered around it, and each flip restarts a 0.18 s crossfade,
            // which reads as the character stuttering exactly while running.
            var running = current == "Run";
            var runThreshold = running ? .62f : .78f;
            var next = loaded?(controller.Speed01>.03f?"CarryWalk":"CarryIdle")
                : controller.Speed01 > runThreshold ? "Run" : controller.Speed01 > .03f ? "Walk" : "Idle";
            if (next == current) return;
            current = next; actor.Play(next);
        }
    }
}
