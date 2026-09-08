using System.Collections.Generic;
using MiniMarket.Interactions;
using UnityEngine;

namespace MiniMarket.Store
{
    public sealed class StoreWorld
    {
        public Transform Root { get; internal set; }
        public readonly Dictionary<string, ProductShelf> Shelves = new();
        public readonly Dictionary<string, Transform> ProductServicePoints = new();
        public readonly Dictionary<string, Transform> CropPoints = new();
        public readonly Dictionary<string, Transform> CropVisualRoots = new();
        public readonly Dictionary<string, Transform> MachinePoints = new();
        public readonly Dictionary<string, InteractionPoint> Interactions = new();
        public readonly Dictionary<string, GameObject> AvailabilityVisuals = new();
        public readonly List<Transform> QueuePoints = new();
        public readonly List<Transform> CheckoutPoints = new();
        public readonly List<List<Transform>> CheckoutQueuePoints = new();
        public readonly List<Transform> CheckoutUnloadPoints = new();
        public readonly List<Transform> CheckoutScanPoints = new();
        public readonly List<Transform> CheckoutBagPoints = new();
        public Transform EntranceOutside;
        public Transform EntranceInside;
        public Transform CheckoutPoint;
        public Transform CheckoutUnloadPoint;
        public Transform CheckoutScanPoint;
        public Transform CheckoutBagPoint;
        public Transform ExitPoint;
        public Transform WarehousePoint;

        public Transform ServicePoint(string productId)
            => ProductServicePoints.TryGetValue(productId, out var point) ? point : EntranceInside;
    }
}
