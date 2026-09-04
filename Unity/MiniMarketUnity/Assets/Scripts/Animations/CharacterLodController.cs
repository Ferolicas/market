using UnityEngine;

namespace MiniMarket.Animations
{
    public sealed class CharacterLodController : MonoBehaviour
    {
        Renderer[] lod0 = System.Array.Empty<Renderer>();
        Renderer[] lod1 = System.Array.Empty<Renderer>();
        Renderer[] lod2 = System.Array.Empty<Renderer>();
        float lod1Distance = 8f;
        float lod2Distance = 17f;
        int current = -1;
        float nextEvaluation;

        public void Configure(Renderer[] high, Renderer[] medium, Renderer[] low,
            float mediumDistance = 8f, float lowDistance = 17f)
        {
            lod0 = high ?? System.Array.Empty<Renderer>();
            lod1 = medium ?? System.Array.Empty<Renderer>();
            lod2 = low ?? System.Array.Empty<Renderer>();
            lod1Distance = Mathf.Max(1f, mediumDistance);
            lod2Distance = Mathf.Max(lod1Distance + 1f, lowDistance);
            Evaluate(force: true);
        }

        void Update()
        {
            // LOD does not need a per-frame decision.  A four-Hz check avoids
            // dozens of tiny Update costs when the shop is full of customers.
            if (Time.unscaledTime < nextEvaluation) return;
            nextEvaluation = Time.unscaledTime + .25f;
            Evaluate(false);
        }

        void Evaluate(bool force)
        {
            var camera = Camera.main;
            if (!camera || lod0.Length == 0) return;
            int target;
            if (camera.orthographic)
            {
                // In an orthographic management camera distance does not
                // change apparent size. Choose the LOD from screen coverage:
                // at the normal store overview a 30k-triangle LOD2 is already
                // visually indistinguishable, while close zoom keeps LOD0.
                var relativeHeight = 1.9f / Mathf.Max(.01f, camera.orthographicSize * 2f);
                target = relativeHeight >= .16f ? 0 : relativeHeight >= .095f ? 1 : 2;
            }
            else
            {
                var distance = Vector3.Distance(transform.position, camera.transform.position);
                target = distance >= lod2Distance && lod2.Length > 0 ? 2
                    : distance >= lod1Distance && lod1.Length > 0 ? 1 : 0;
            }
            if (target == 2 && lod2.Length == 0) target = lod1.Length > 0 ? 1 : 0;
            if (target == 1 && lod1.Length == 0) target = 0;
            if (!force && target == current) return;
            Set(lod0, target == 0);
            Set(lod1, target == 1);
            Set(lod2, target == 2);
            current = target;
        }

        static void Set(Renderer[] renderers, bool visible)
        {
            foreach (var renderer in renderers) if (renderer) renderer.enabled = visible;
        }
    }
}
