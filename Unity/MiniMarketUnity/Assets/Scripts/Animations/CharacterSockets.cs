using System;
using System.Collections.Generic;
using UnityEngine;

namespace MiniMarket.Animations
{
    public sealed class CharacterSockets : MonoBehaviour
    {
        readonly Dictionary<string, Transform> sockets = new(StringComparer.OrdinalIgnoreCase);
        public IReadOnlyDictionary<string, Transform> All => sockets;

        public void Build(Transform rigRoot = null)
        {
            sockets.Clear();
            var source = rigRoot ? rigRoot : transform;
            var head = Find(source, "Head");
            var left = Find(source, "Hand_L");
            var right = Find(source, "Hand_R");
            Add("Head", head, Vector3.zero, Quaternion.identity);
            Add("HandLeft", left, new Vector3(0, 0, .06f), Quaternion.Euler(0, 90, 0));
            Add("HandRight", right, new Vector3(0, 0, .06f), Quaternion.Euler(0, -90, 0));
            Add("Product", right, new Vector3(0, .015f, .095f), Quaternion.Euler(0, -90, 0));
            Add("Money", right, new Vector3(0, .01f, .08f), Quaternion.Euler(0, -90, 0));
            Add("Basket", left, new Vector3(0, -.06f, .1f), Quaternion.Euler(10, 90, 0));
            Add("Box", transform, new Vector3(0, .92f, .27f), Quaternion.identity);
            Add("CartLeft", left, new Vector3(0, 0, .08f), Quaternion.Euler(0, 90, 0));
            Add("CartRight", right, new Vector3(0, 0, .08f), Quaternion.Euler(0, -90, 0));
            Add("LookAt", head, new Vector3(0, .08f, .25f), Quaternion.identity);
            Add("FootIKLeft", Find(source, "Foot_L"), Vector3.zero, Quaternion.identity);
            Add("FootIKRight", Find(source, "Foot_R"), Vector3.zero, Quaternion.identity);
        }

        public Transform Get(string id) => sockets.TryGetValue(id, out var value) ? value : null;

        static Transform Find(Transform source, string expected)
        {
            foreach (var child in source.GetComponentsInChildren<Transform>(true))
                if (child.name.Equals(expected, StringComparison.OrdinalIgnoreCase)) return child;
            return null;
        }

        void Add(string id, Transform parent, Vector3 position, Quaternion rotation)
        {
            if (!parent) return;
            var socket = new GameObject($"Socket_{id}").transform;
            socket.SetParent(parent, false);
            socket.localPosition = position;
            socket.localRotation = rotation;
            sockets[id] = socket;
        }
    }
}
