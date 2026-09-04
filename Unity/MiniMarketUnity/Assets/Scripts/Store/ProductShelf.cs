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

