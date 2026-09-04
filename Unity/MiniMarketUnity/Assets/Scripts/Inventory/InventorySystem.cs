using System;
using MiniMarket.Data;

namespace MiniMarket.Inventory
{
    public sealed class InventorySystem
    {
        readonly GameStateDocument state;
        public InventorySystem(GameStateDocument document) => state = document;

        public int Quantity(string container, string productId) => state.Quantity(container, productId);

        public bool Transfer(string source, string destination, string productId, int requested, int destinationCapacity = int.MaxValue)
        {
            var amount = Math.Max(0, Math.Min(requested, state.Quantity(source, productId)));
            amount = Math.Min(amount, Math.Max(0, destinationCapacity - state.Quantity(destination, productId)));
            if (amount == 0) return false;
            state.AddQuantity(source, productId, -amount);
            state.AddQuantity(destination, productId, amount);
            return true;
        }

        public bool Consume(string container, string productId, int quantity)
        {
            if (quantity <= 0 || state.Quantity(container, productId) < quantity) return false;
            state.AddQuantity(container, productId, -quantity);
            return true;
        }

        public void Add(string container, string productId, int quantity)
        {
            if (quantity > 0) state.AddQuantity(container, productId, quantity);
        }
    }
}

