using MiniMarket.Core;
using UnityEngine;

namespace MiniMarket.Store
{
    /// <summary>Opens only the refrigerated bay the owner is approaching.</summary>
    public sealed class DairyDoorPresenter : MonoBehaviour
    {
        Transform[] hinges;
        Quaternion[] closed;
        Transform player;
        float bayWidth;
        float nextLookup;

        public void Bind(Transform[] doorHinges, float doorWorldWidth)
        {
            hinges = doorHinges;
            bayWidth = doorWorldWidth;
            closed = new Quaternion[hinges.Length];
            for (var i = 0; i < hinges.Length; i++) closed[i] = hinges[i].localRotation;
        }

        void FindPlayer()
        {
            if (player || Time.unscaledTime < nextLookup) return;
            nextLookup = Time.unscaledTime + .5f;
            var runtime = FindFirstObjectByType<MiniMarketRuntime>();
            if (runtime && runtime.PlayerActor) player = runtime.PlayerActor.transform;
            if (!player)
            {
                var tagged = GameObject.FindWithTag("Player");
                if (tagged) player = tagged.transform;
            }
        }

        void Update()
        {
            if (hinges == null || hinges.Length == 0) return;
            FindPlayer();
            for (var i = 0; i < hinges.Length; i++)
            {
                var hinge = hinges[i];
                if (!hinge) continue;
                var open = false;
                if (player)
                {
                    var delta = player.position - (hinge.position + transform.right * bayWidth * .5f);
                    var across = Mathf.Abs(Vector3.Dot(delta, transform.right));
                    var front = Mathf.Abs(Vector3.Dot(delta, transform.forward));
                    open = across < bayWidth * .72f && front < 3.4f;
                }
                var target = open ? closed[i] * Quaternion.Euler(0, -96f, 0) : closed[i];
                hinge.localRotation = Quaternion.RotateTowards(hinge.localRotation, target,
                                                               (open ? 250f : 210f) * Time.deltaTime);
            }
        }
    }
}
