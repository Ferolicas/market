using MiniMarket.Animations;
using UnityEngine;

namespace MiniMarket.Store
{
    /// <summary>
    /// Automatic sliding door. Occupancy is sampled every frame with an overlap
    /// test rather than accumulated from trigger callbacks: the player spawns
    /// already standing inside the sensor, and OnTriggerEnter does not fire
    /// reliably for an overlap that exists the moment the collider is created,
    /// so the door stayed shut with somebody in the doorway.
    /// </summary>
    public sealed class StorefrontDoorPresenter : MonoBehaviour
    {
        static readonly Collider[] Hits = new Collider[16];
        Transform left; Transform right;
        float closedLeft; float closedRight; float travel = 5.4f;
        float leftDir = -1f; float rightDir = 1f;
        BoxCollider sensor; Vector3 doorway;

        /// <param name="slide">How far each leaf runs, in the leaves' own local
        /// units. The entrance is scaled to fit the doorway, so its children live
        /// in a scaled space and a world-space distance would tear them apart.</param>
        public void Bind(Transform leftLeaf, Transform rightLeaf, float slide = 5.4f)
        {
            left = leftLeaf; right = rightLeaf;
            closedLeft = left.localPosition.x; closedRight = right.localPosition.x;
            travel = Mathf.Abs(slide);
            // Each leaf runs away from the middle of the doorway, decided by
            // where its own geometry sits. Trusting the caller's left/right had
            // them swapped, so opening slid the two leaves across each other and
            // the opening never cleared -- and since the panes are near
            // identical, the picture did not change at all.
            leftDir = Direction(leftLeaf);
            rightDir = Direction(rightLeaf);
            sensor = GetComponent<BoxCollider>();
            // The sensor's own position, not the leaf's parent: glTFast nests the
            // nodes under an intermediate transform that sits at the origin, so
            // measuring from there put the doorway 15 metres from where it is.
            doorway = transform.position;
            Debug.Log($"MINIMARKET_DOOR ligada izquierda={left.name} derecha={right.name} recorrido={travel:F3}");
        }

        Transform player;

        static float Direction(Transform leaf)
        {
            var renderer = leaf.GetComponent<Renderer>();
            var x = renderer ? renderer.localBounds.center.x : 0f;
            return x < 0f ? -1f : 1f;
        }

        bool Occupied()
        {
            // Distance to the doorway, not a physics query. An overlap test
            // depends on the character's collider, its layer and the box
            // reaching far enough, and any of the three failing leaves the door
            // shut with no way to tell which.
            if (!player)
            {
                // Ask the runtime for the character it owns. Looking the player
                // up by tag returned nothing here, and scanning for actors found
                // none in range, so the door never saw anybody arrive.
                var runtime = FindFirstObjectByType<MiniMarket.Core.MiniMarketRuntime>();
                if (runtime && runtime.PlayerActor) player = runtime.PlayerActor.transform;
                if (!player)
                {
                    var tagged = GameObject.FindWithTag("Player");
                    if (tagged) player = tagged.transform;
                }
            }
            if (player)
            {
                var d = player.position - doorway;
                if (Mathf.Abs(d.x) < 5.5f && Mathf.Abs(d.z) < 7.5f) return true;
            }
            foreach (var actor in FindObjectsByType<CharacterActor>(FindObjectsSortMode.None))
            {
                if (!actor || !actor.gameObject.activeInHierarchy) continue;
                var d = actor.transform.position - doorway;
                if (Mathf.Abs(d.x) < 5.5f && Mathf.Abs(d.z) < 7.5f) return true;
            }
            return false;
        }

        bool? reported; float nextSample;

        void Update()
        {
            if (!left || !right) return;
            var open = Occupied();
            if (reported != open)
            {
                reported = open;
                // Report the state, not just the binding: the facade is hidden
                // from the camera while the player is inside, so the only honest
                // way to know the door moves is to have it say so.
                Debug.Log($"MINIMARKET_DOOR estado={(open ? "abierta" : "cerrada")} " +
                          $"x_izq={left.localPosition.x:F3} x_der={right.localPosition.x:F3}");
            }
            var leftTarget = open ? closedLeft + leftDir * travel : closedLeft;
            var rightTarget = open ? closedRight + rightDir * travel : closedRight;
            var speed = (open ? 11.9f : 10.2f) * Mathf.Max(travel / 5.4f, .2f);
            var l = left.localPosition; l.x = Mathf.MoveTowards(l.x, leftTarget, speed * Time.deltaTime); left.localPosition = l;
            var r = right.localPosition; r.x = Mathf.MoveTowards(r.x, rightTarget, speed * Time.deltaTime); right.localPosition = r;

            // Sample where the leaves actually end up. The state line fires the
            // instant the sensor flips, which is before anything has moved, so on
            // its own it cannot tell a working door from a stuck one.
            if (Time.time >= nextSample)
            {
                nextSample = Time.time + 2f;
                var p = player ? player.position : Vector3.one * -999f;
                var actors = FindObjectsByType<CharacterActor>(FindObjectsSortMode.None);
                var nearest = "ninguno"; var best = float.MaxValue;
                foreach (var a in actors)
                {
                    if (!a) continue;
                    var d = Vector3.Distance(a.transform.position, doorway);
                    if (d < best) { best = d; nearest = $"{a.name}@({a.transform.position.x:F1},{a.transform.position.z:F1}) d={d:F1}"; }
                }
                Debug.Log($"MINIMARKET_DOOR muestra abierta={open} x_izq={left.localPosition.x:F3} " +
                          $"vano=({doorway.x:F1},{doorway.z:F1}) jugador=({p.x:F1},{p.z:F1}) " +
                          $"actores={actors.Length} cercano={nearest}");
            }
        }
    }
}
