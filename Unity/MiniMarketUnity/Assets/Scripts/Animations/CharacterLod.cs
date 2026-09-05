using System.Collections.Generic;
using UnityEngine;

namespace MiniMarket.Animations
{
    /// The approved mesh costs 197k triangles; a shop with ten characters is
    /// two million skinned triangles and drops to 37 fps on an RTX 4080. Every
    /// character carries the approved mesh and a far mesh decimated to 23k
    /// (no morphs), and a budget decides who shows which: the player and the
    /// nearest few within reach keep the full mesh, everyone else draws the far
    /// one -- at isometric scale, a character is 150 pixels tall, and 23k
    /// triangles look the same. Evaluated four times a second for all at once.
    public sealed class CharacterLod : MonoBehaviour
    {
        static readonly List<CharacterLod> All = new();
        static float nextEvaluation;
        public static Transform Focus;
        public static int NearBudget = 4;
        public static float NearRadius = 16f;

        Renderer[] near = System.Array.Empty<Renderer>();
        Renderer[] far = System.Array.Empty<Renderer>();
        public bool PinNear;
        public bool IsNear { get; private set; } = true;

        public void Configure(Renderer[] nearSet, Renderer[] farSet)
        {
            near = nearSet ?? System.Array.Empty<Renderer>();
            far = farSet ?? System.Array.Empty<Renderer>();
            Apply(true, true);
        }

        void OnEnable() { All.Add(this); nextEvaluation = 0f; }
        void OnDisable() => All.Remove(this);

        void Update()
        {
            if (Time.unscaledTime < nextEvaluation) return;
            nextEvaluation = Time.unscaledTime + .25f;
            Evaluate();
        }

        static float Distance(CharacterLod lod, Transform focus)
        {
            var a = lod.transform.position; var b = focus.position;
            return Mathf.Sqrt((a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z));
        }

        static void Evaluate()
        {
            var focus = Focus;
            if (!focus) { foreach (var lod in All) lod.Apply(true, false); return; }
            All.Sort((x, y) => Distance(x, focus).CompareTo(Distance(y, focus)));
            var budget = NearBudget;
            foreach (var lod in All)
            {
                var wantNear = lod.PinNear || lod.far.Length == 0;
                if (!wantNear && budget > 0 && Distance(lod, focus) <= NearRadius) { wantNear = true; budget--; }
                lod.Apply(wantNear, false);
            }
        }

        void Apply(bool showNear, bool force)
        {
            if (!force && showNear == IsNear) return;
            IsNear = showNear;
            foreach (var renderer in near) if (renderer) renderer.enabled = showNear;
            foreach (var renderer in far) if (renderer) renderer.enabled = !showNear;
        }
    }
}
