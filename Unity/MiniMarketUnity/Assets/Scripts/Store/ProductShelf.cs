using System.Collections.Generic;
using UnityEngine;

namespace MiniMarket.Store
{
    public sealed class ProductShelf : MonoBehaviour
    {
        public string departmentId;
        public string[] allowedProducts;
        public readonly List<Transform> ProductSlots = new();
        readonly HashSet<int> occupied = new();
        /// How big the product goes on this shelf, in world units, and whether
        /// that measure is its whole size or only its footprint. A carton
        /// hollow sets the width of the egg; its height then follows.
        public float slotSize = .6f;
        public bool fitFootprint;

        public void BuildSlots(int count, Vector3 localCenter, Vector3 spacing, int columns)
        {
            ProductSlots.Clear(); occupied.Clear();
            columns = Mathf.Max(1, columns);
            for (var i = 0; i < count; i++)
            {
                var slot = new GameObject($"ProductSlot_{i + 1:00}").transform;
                slot.SetParent(transform, false);
                slot.localPosition = localCenter + new Vector3((i % columns - (columns - 1) * .5f) * spacing.x, (i / columns) * spacing.y, (i / columns) * spacing.z);
                ProductSlots.Add(slot);
            }
        }

        /// Slots at places measured on the piece itself, one hollow each.
        public void BuildSlotsAt(IReadOnlyList<Vector3> localPoints, float size, bool footprint)
        {
            ProductSlots.Clear(); occupied.Clear(); slotSize = size; fitFootprint = footprint;
            for (var i = 0; i < localPoints.Count; i++)
            {
                var slot = new GameObject($"ProductSlot_{i + 1:00}").transform;
                slot.SetParent(transform, false); slot.localPosition = localPoints[i];
                ProductSlots.Add(slot);
            }
        }

        public Transform ReserveFreeSlot()
        {
            for (var i = 0; i < ProductSlots.Count; i++) if (occupied.Add(i)) return ProductSlots[i];
            return null;
        }

        public void Release(Transform slot)
        {
            var index = ProductSlots.IndexOf(slot);
            if (index >= 0) occupied.Remove(index);
        }
    }
}

