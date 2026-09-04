using System;
using System.Collections.Generic;
using MiniMarket.Player;
using UnityEngine;
using UnityEngine.InputSystem;

namespace MiniMarket.Interactions
{
    public sealed class InteractionDirector : MonoBehaviour
    {
        readonly List<InteractionPoint> points = new();
        PlayerController player;
        public InteractionPoint Nearest { get; private set; }
        public event Action<InteractionPoint> Activated;
        public event Action<InteractionPoint> NearestChanged;
        InteractionPoint previous;
        float enteredAt;
        float nextAutomaticAt;

        public void Bind(PlayerController controller) => player = controller;
        public void Register(InteractionPoint point)
        {
            if (!point || points.Contains(point)) return;
            points.Add(point);
            point.Activated += HandleActivated;
        }

        void Update()
        {
            if (!player) return;
            var best = float.MaxValue; Nearest = null;
            for (var i = points.Count - 1; i >= 0; i--)
            {
                if (!points[i]) { points.RemoveAt(i); continue; }
                if(!points[i].isActiveAndEnabled)continue;
                var distance = Vector3.SqrMagnitude(points[i].transform.position - player.transform.position);
                if (distance < best && distance <= points[i].range * points[i].range) { best = distance; Nearest = points[i]; }
            }
            if (previous != Nearest) { previous = Nearest;enteredAt=Time.time;nextAutomaticAt=enteredAt+(Nearest?Nearest.dwellSeconds:0);NearestChanged?.Invoke(Nearest); }
            if(Nearest&&Nearest.automatic&&Time.time>=nextAutomaticAt)
            {
                Nearest.Activate();nextAutomaticAt=Time.time+Nearest.repeatSeconds;
            }
            if (Nearest && Keyboard.current != null && Keyboard.current.eKey.wasPressedThisFrame) Nearest.Activate();
        }

        public void ActivateNearest() => Nearest?.Activate();
        void HandleActivated(InteractionPoint point) => Activated?.Invoke(point);
    }
}
