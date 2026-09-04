using System;
using System.Collections.Generic;
using MiniMarket.Core;
using MiniMarket.Data;
using Newtonsoft.Json.Linq;

namespace MiniMarket.Inventory
{
    /// <summary>Capacity-bounded, persisted basket for the playable worker.</summary>
    public sealed class PlayerCarrySystem
    {
        readonly GameStateDocument state;
        readonly GameSignals signals;
        readonly InventorySystem inventory;

        public PlayerCarrySystem(GameStateDocument document, InventorySystem inventorySystem, GameSignals gameSignals)
        {
            state = document; inventory = inventorySystem; signals = gameSignals;
            EnsureShape();
        }

        JObject Carry => (JObject)state.CurrentFranchise["carry"];
        JObject Items => (JObject)Carry["items"];
        public int Capacity => Math.Max(1, Carry.Value<int?>("capacity") ?? 3);
        public int Total
        {
            get
            {
                var total = 0;
                foreach (var property in Items.Properties()) total += Math.Max(0, property.Value.Value<int>());
                return total;
            }
        }
        public int Free => Math.Max(0, Capacity - Total);
        public int Quantity(string productId) => Math.Max(0, Items.Value<int?>(productId) ?? 0);

        public IEnumerable<KeyValuePair<string, int>> Contents()
        {
            foreach (var property in Items.Properties())
            {
                var quantity = Math.Max(0, property.Value.Value<int>());
                if (quantity > 0) yield return new KeyValuePair<string, int>(property.Name, quantity);
            }
        }

        public int Add(string productId, int requested)
        {
            var moved = Math.Min(Math.Max(0, requested), Free);
            if (moved < 1) return 0;
            Items[productId] = Quantity(productId) + moved;
            Changed(productId);
            return moved;
        }

        public int Remove(string productId, int requested)
        {
            var moved = Math.Min(Math.Max(0, requested), Quantity(productId));
            if (moved < 1) return 0;
            var remaining = Quantity(productId) - moved;
            if (remaining > 0) Items[productId] = remaining; else Items.Property(productId)?.Remove();
            Changed(productId);
            return moved;
        }

        public int PickupFromWarehouse(IEnumerable<string> prioritizedProducts)
        {
            var moved = 0;
            if (Free < 1) return 0;
            var candidates = new List<string>(prioritizedProducts);
            while (Free > 0)
            {
                var round = 0;
                foreach (var productId in candidates)
                {
                    if (Free < 1) break;
                    if (inventory.Quantity("warehouse", productId) < 1) continue;
                    inventory.Consume("warehouse", productId, 1);
                    Add(productId, 1);
                    moved++; round++;
                }
                if (round == 0) break;
            }
            return moved;
        }

        public int TransferToShelf(string productId, int capacity, int requested = int.MaxValue)
        {
            var free = Math.Max(0, capacity - inventory.Quantity("shelves", productId));
            var moved = Math.Min(Math.Min(Quantity(productId), Math.Max(0, requested)), free);
            if (moved < 1) return 0;
            Remove(productId, moved);
            inventory.Add("shelves", productId, moved);
            return moved;
        }

        public int ReturnAllToWarehouse()
        {
            var snapshot = new List<KeyValuePair<string, int>>(Contents());
            var moved = 0;
            foreach (var item in snapshot)
            {
                inventory.Add("warehouse", item.Key, item.Value);
                moved += Remove(item.Key, item.Value);
            }
            return moved;
        }

        public string Summary()
        {
            var labels = new List<string>();
            foreach (var item in Contents()) labels.Add($"{item.Value}× {item.Key}");
            return labels.Count == 0 ? "vacía" : string.Join(", ", labels);
        }

        void EnsureShape()
        {
            if (state.CurrentFranchise["carry"] is not JObject carry)
                state.CurrentFranchise["carry"] = carry = new JObject();
            if (carry["items"] is not JObject) carry["items"] = new JObject();
            carry["capacity"] = Math.Max(1, carry.Value<int?>("capacity") ?? 3);
        }

        void Changed(string productId)
        {
            state.Changed();
            signals.PublishInventory(productId, inventory.Quantity("shelves", productId));
        }
    }
}
