using System;
using System.Collections.Generic;
using UnityEngine;

namespace MiniMarket.Animations
{
    public sealed class HandPoseDriver : MonoBehaviour
    {
        sealed class Finger
        {
            public Transform Bone;
            public Quaternion Rest;
            public float Weight;
            public int Side;
        }

        readonly List<Finger> fingers = new();
        float leftGrip = .14f;
        float rightGrip = .14f;

        public void Bind(Transform rigRoot = null)
        {
            fingers.Clear();
            foreach (var bone in (rigRoot ? rigRoot : transform).GetComponentsInChildren<Transform>(true))
            {
                var name = bone.name;
                if (!IsFinger(name)) continue;
                var weight = name.Contains("_03_") ? .82f : name.Contains("_02_") ? 1f : .72f;
                if (name.StartsWith("Thumb", StringComparison.OrdinalIgnoreCase)) weight *= .55f;
                fingers.Add(new Finger { Bone = bone, Rest = bone.localRotation, Weight = weight, Side = name.EndsWith("_L", StringComparison.OrdinalIgnoreCase) ? -1 : 1 });
            }
        }

        public void SetGrip(bool left, float amount)
        {
            if (left) leftGrip = Mathf.Clamp01(amount); else rightGrip = Mathf.Clamp01(amount);
        }

        void LateUpdate()
        {
            foreach (var finger in fingers)
            {
                if (!finger.Bone) continue;
                var grip = finger.Side < 0 ? leftGrip : rightGrip;
                var curl = Quaternion.AngleAxis(grip * 52f * finger.Weight, Vector3.right);
                finger.Bone.localRotation = Quaternion.Slerp(finger.Bone.localRotation, finger.Rest * curl, 1f - Mathf.Exp(-14f * Time.deltaTime));
            }
        }

        static bool IsFinger(string name)
            => name.StartsWith("Thumb_", StringComparison.OrdinalIgnoreCase)
               || name.StartsWith("Index_", StringComparison.OrdinalIgnoreCase)
               || name.StartsWith("Middle_", StringComparison.OrdinalIgnoreCase)
               || name.StartsWith("Ring_", StringComparison.OrdinalIgnoreCase)
               || name.StartsWith("Pinky_", StringComparison.OrdinalIgnoreCase);
    }
}
