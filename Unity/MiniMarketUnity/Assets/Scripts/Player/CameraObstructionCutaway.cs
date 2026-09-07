using System;
using System.Collections.Generic;
using UnityEngine;

namespace MiniMarket.Player
{
    /// Fully clears only architectural panels that sit between the camera and
    /// the controlled actor. Colliders and interaction geometry remain active,
    /// and every renderer is restored as soon as the sightline clears or the
    /// management overview opens.
    public sealed class CameraObstructionCutaway : MonoBehaviour
    {
        static readonly string[] ArchitectureTokens =
        {
            "WallStraight", "WallCorner", "Storefront", "Facade", "StoreEntrance",
            "EntranceFrame", "AutomaticDoor", "GlassPartition", "ProductionGlass",
        };

        readonly HashSet<Renderer> hidden = new();
        readonly List<Renderer> candidates = new();
        IsometricCamera rig;
        Transform target;
        bool candidatesCollected;
        float nextVisibilityRefresh;

        void Awake() => rig = GetComponent<IsometricCamera>();

        void LateUpdate()
        {
            if (!rig) rig = GetComponent<IsometricCamera>();
            if (!target)
            {
                var player = GameObject.FindWithTag("Player");
                if (player) target = player.transform;
            }
            // The player is created only after StoreWorldBuilder has completed,
            // so architecture is stable at this point. Scan once instead of
            // walking every renderer every two seconds during normal play.
            if (target && !candidatesCollected)
            {
                var all = FindObjectsByType<Renderer>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
                foreach (var renderer in all) if (renderer && IsArchitecture(renderer.transform)) candidates.Add(renderer);
                candidatesCollected = true;
            }
            if (Time.unscaledTime < nextVisibilityRefresh) return;
            nextVisibilityRefresh = Time.unscaledTime + .1f;
            Restore();
            if (!target || (rig && rig.OverviewActive)) return;

            var origin = transform.position;
            var destination = target.position + Vector3.up * 1.05f;
            var delta = destination - origin;
            var length = delta.magnitude;
            if (length < .1f) return;
            var ray = new Ray(origin, delta / length);
            foreach (var renderer in candidates)
            {
                if (!renderer || !renderer.enabled || renderer.transform.IsChildOf(target)) continue;
                if (!renderer.bounds.IntersectRay(ray, out var distance) || distance >= length - .35f) continue;
                renderer.forceRenderingOff = true;
                hidden.Add(renderer);
            }
        }

        static bool IsArchitecture(Transform item)
        {
            for (var current = item; current; current = current.parent)
                foreach (var token in ArchitectureTokens)
                    if (current.name.IndexOf(token, StringComparison.OrdinalIgnoreCase) >= 0) return true;
            return false;
        }

        void Restore()
        {
            foreach (var renderer in hidden) if (renderer) renderer.forceRenderingOff = false;
            hidden.Clear();
        }

        void OnDisable() => Restore();
        void OnDestroy() => Restore();
    }
}
