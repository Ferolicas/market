using System;
using System.Collections.Generic;
using MiniMarket.Core;
using MiniMarket.Data;
using MiniMarket.Inventory;
using Newtonsoft.Json.Linq;
using MiniMarket.Progression;

namespace MiniMarket.Economy
{
    public sealed class EconomySystem
    {
        readonly GameStateDocument state;
        readonly GameSpecRepository spec;
        readonly InventorySystem inventory;
        readonly GameSignals signals;
        readonly ProgressionSystem progression;
        readonly GameLedger ledger;

        public EconomySystem(GameStateDocument document, GameSpecRepository repository, InventorySystem inventorySystem,
            GameSignals gameSignals, ProgressionSystem progressionSystem = null, GameLedger gameLedger = null)
        {
            state = document; spec = repository; inventory = inventorySystem; signals = gameSignals;
            progression = progressionSystem; ledger = gameLedger;
        }

        public bool BuyStock(string productId, int quantity)
        {
            quantity = Math.Max(0, quantity);
            var cost = spec.ScaleMoney(spec.ProductPrice(productId, "wholesaleMinor") * quantity, state.CountryCode);
            if (quantity == 0 || state.BalanceMinor < cost) return false;
            state.BalanceMinor -= cost;
            inventory.Add("warehouse", productId, quantity);
            state.CurrentFranchise["expensesTodayMinor"] = (state.CurrentFranchise.Value<long?>("expensesTodayMinor") ?? 0) + cost;
            Finance("costOfGoodsMinor", cost);
            ledger?.Record("inventory", $"Compra de {ProductName(productId)}", -cost);
            signals.PublishNotification($"Pedido recibido: {quantity} × {ProductName(productId)}");
            return true;
        }

        public long Checkout(IReadOnlyDictionary<string, int> basket, double fulfillment = 1, double queueSeconds = 0)
        {
            long subtotal = 0;
            var shelfTier=StationTierRules.Tier(state,"shelves-1",state.CurrentFranchise.Value<int?>("shelvesLevel")??1);
            var presentationValue=StationTierRules.Value(shelfTier);
            foreach (var item in basket)
                subtotal += spec.ScaleMoney(spec.ProductPrice(item.Key,"saleMinor")*presentationValue,state.CountryCode)*Math.Max(0,item.Value);
            if (subtotal <= 0) return 0;
            var taxRate = spec.Root["catalog"]["COUNTRIES"][state.CountryCode]?["salesTaxRate"]?.Value<double>() ?? .21;
            var tax = (long)Math.Round(subtotal * taxRate, MidpointRounding.AwayFromZero);
            state.BalanceMinor += subtotal + tax;
            Finance("grossRevenueMinor", subtotal);
            var franchise = state.CurrentFranchise;
            franchise["revenueTodayMinor"] = (franchise.Value<long?>("revenueTodayMinor") ?? 0) + subtotal;
            var serviceScore = Math.Max(1, Math.Min(5, 3.5 + Math.Clamp(fulfillment, 0, 1) * 1.5 - Math.Max(0, queueSeconds - 30) / 120));
            franchise["rating"] = Math.Round((franchise.Value<double?>("rating") ?? 3.5) * .9 + serviceScore * .1, 2, MidpointRounding.AwayFromZero);
            state.Root["reputation"] = (state.Root.Value<int?>("reputation") ?? 0) + 1;
            state.Changed();
            var units = 0;
            foreach (var item in basket)
            {
                units += Math.Max(0, item.Value);
                progression?.Record($"sales:{item.Key}", Math.Max(0, item.Value));
            }
            progression?.Record("sales:units", units);
            progression?.Record("customers");
            if (queueSeconds <= 30) progression?.Record("queue:under30");
            if (AverageShelfAvailability() >= .9) progression?.Record("availability:sales");
            ledger?.Record("sales", $"Compra Unity · {units} unidades", subtotal + tax);
            signals.PublishNotification($"Venta completada: {subtotal + tax} minor");
            return subtotal + tax;
        }

        double AverageShelfAvailability()
        {
            double total = 0; var count = 0;
            var rank = Math.Max(1, state.CurrentFranchise.Value<int?>("storeRank") ?? 1);
            foreach (var id in new ProductAvailabilityPolicy(spec).UnlockedCustomerProducts(rank * 10))
            {
                var capacity = new ProductAvailabilityPolicy(spec).ShelfCapacity(state,id);
                total += Math.Min(1, state.Quantity("shelves", id) / (double)capacity); count++;
            }
            return count == 0 ? 0 : total / count;
        }

        void Finance(string field, long delta)
        {
            if (state.Root["finances"] is not JObject finances)
            {
                finances = new JObject(); state.Root["finances"] = finances;
            }
            finances[field] = (finances.Value<long?>(field) ?? 0) + delta;
            state.Changed();
        }

        string ProductName(string productId) => spec.Products[productId]?["name"]?.Value<string>() ?? productId;
    }
}
