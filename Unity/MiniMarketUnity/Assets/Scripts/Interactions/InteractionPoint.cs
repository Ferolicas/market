using System;
using UnityEngine;

namespace MiniMarket.Interactions
{
    [RequireComponent(typeof(SphereCollider))]
    public sealed class InteractionPoint : MonoBehaviour
    {
        public string interactionId;
        public string label;
        public float range = 1.8f;
        public bool automatic = true;
        public bool repeatAutomatically = true;
        public float dwellSeconds = .08f;
        public float repeatSeconds = .22f;
        public event Action<InteractionPoint> Activated;
        Vector2 areaHalfExtents;
        bool area;

        public bool HasArea => area;
        public Vector2 AreaHalfExtents => areaHalfExtents;

        public void Configure(string id, string displayLabel, float radius = 1.8f, bool activateAutomatically = true, float dwell = .08f, float repeat = .22f)
        {
            interactionId = id; label = displayLabel; range = radius;automatic=activateAutomatically;dwellSeconds=Mathf.Max(0,dwell);repeatSeconds=Mathf.Max(.05f,repeat);
            var trigger = GetComponent<SphereCollider>();
            trigger.isTrigger = true; trigger.radius = radius;
        }

        /// A rounded rectangle in world X/Z. Large fixtures and farm plots need
        /// reach measured outwards from their visible edge; a small sphere at
        /// the pivot can sit inside the solid collider and never be reachable.
        public void ConfigureArea(string id, string displayLabel, Vector2 halfExtents, float reach,
            bool activateAutomatically = true, float dwell = .08f, float repeat = .22f)
        {
            area = true;
            areaHalfExtents = new Vector2(Mathf.Max(0, halfExtents.x), Mathf.Max(0, halfExtents.y));
            Configure(id, displayLabel, Mathf.Max(.05f, reach), activateAutomatically, dwell, repeat);
            var trigger = GetComponent<SphereCollider>();
            trigger.radius = areaHalfExtents.magnitude + range;
        }

        public float DistanceSquared(Vector3 worldPosition)
        {
            var delta = worldPosition - transform.position;
            if (!area) return delta.sqrMagnitude;
            var x = Mathf.Max(0, Mathf.Abs(delta.x) - areaHalfExtents.x);
            var z = Mathf.Max(0, Mathf.Abs(delta.z) - areaHalfExtents.y);
            return x * x + delta.y * delta.y + z * z;
        }

        public void Activate() => Activated?.Invoke(this);
    }
}
