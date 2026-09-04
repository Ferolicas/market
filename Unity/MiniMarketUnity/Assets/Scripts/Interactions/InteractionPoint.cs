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
        public float dwellSeconds = .08f;
        public float repeatSeconds = .22f;
        public event Action<InteractionPoint> Activated;

        public void Configure(string id, string displayLabel, float radius = 1.8f, bool activateAutomatically = true, float dwell = .08f, float repeat = .22f)
        {
            interactionId = id; label = displayLabel; range = radius;automatic=activateAutomatically;dwellSeconds=Mathf.Max(0,dwell);repeatSeconds=Mathf.Max(.05f,repeat);
            var trigger = GetComponent<SphereCollider>();
            trigger.isTrigger = true; trigger.radius = radius;
        }

        public void Activate() => Activated?.Invoke(this);
    }
}
