using System;
using System.Collections.Generic;
using MiniMarket.Data;
using Newtonsoft.Json.Linq;

namespace MiniMarket.Employees
{
    /// <summary>
    /// Converts shelf shortages into upstream crop and machine priorities.
    /// Workers therefore replenish the product the shop actually needs instead
    /// of repeatedly selecting the first crop or machine in a JSON array.
    /// </summary>
    public sealed class SupplyDemandPlanner
    {
        readonly GameStateDocument state;
        readonly GameSpecRepository spec;
        readonly ProductAvailabilityPolicy availability;

        public SupplyDemandPlanner(GameStateDocument document, GameSpecRepository repository, ProductAvailabilityPolicy policy)
        { state = document; spec = repository; availability = policy; }

        public double Demand(string productId)
            => Demand(productId, new HashSet<string>(StringComparer.OrdinalIgnoreCase));

        double Demand(string productId, HashSet<string> path)
        {
            if (!path.Add(productId)) return 0;
            double demand = 0;
            if (availability.CanCustomerRequest(productId, state.Level))
            {
                var target = availability.ShelfCapacity(state,productId) * 1.35;
                demand += Math.Max(0, target - state.Quantity("shelves", productId) - state.Quantity("warehouse", productId));
            }

            foreach (var token in state.Array("productionMachines"))
            {
                if (token is not JObject machine || !availability.IsMachineUnlocked(machine.Value<string>("id"), state.Level)) continue;
                var output = machine.Value<string>("productId");
                if (spec.ProductConfig[output]?["recipe"] is not JObject recipe) continue;
                var required = recipe.Value<int?>(productId) ?? 0;
                if (required < 1) continue;
                // Translate the actual downstream shortage into input units
                // and credit material already waiting in the warehouse. This
                // prevents either extreme: endless tomato harvesting while
                // bread is absent, or accumulating a mountain of wheat after
                // the next flour/bread cycles are already supplied.
                demand += Math.Max(0, Demand(output, path) * required - state.Quantity("warehouse", productId));
            }
            path.Remove(productId);

            // The active progression targets need supply before the customer
            // product exists.  This mirrors the original level objectives.
            if (productId == "wheat" && state.Level is 4 or 5) demand += 24;
            if (productId == "corn" && state.Level == 11) demand += 24;
            return demand;
        }

        public JObject BestReadyCrop(string avoidProduct = null)
        {
            JObject selected = null; var best = double.NegativeInfinity;
            foreach (var token in state.Array("crops"))
            {
                if (token is not JObject crop || crop.Value<string>("status") != "READY" || (crop.Value<int?>("available") ?? 0) < 1) continue;
                if (!availability.IsCropUnlocked(crop.Value<string>("id"), state.Level)) continue;
                var product = crop.Value<string>("productId");
                var score = Demand(product);
                if (!string.Equals(product, avoidProduct, StringComparison.OrdinalIgnoreCase)) score += .75;
                else score -= .75;
                if (score > best) { best = score; selected = crop; }
            }
            return selected;
        }

        public JObject BestMachineOutput()
        {
            JObject selected = null; var best = double.NegativeInfinity;
            foreach (var token in state.Array("productionMachines"))
            {
                if (token is not JObject machine || (machine.Value<int?>("output") ?? 0) < 1) continue;
                if (!availability.IsMachineUnlocked(machine.Value<string>("id"), state.Level)) continue;
                var score = Demand(machine.Value<string>("productId")) + machine.Value<int>("output") * .1;
                if (score > best) { best = score; selected = machine; }
            }
            return selected;
        }

        public JObject BestMachineToStart()
        {
            JObject selected = null; var best = 0d;
            foreach (var token in state.Array("productionMachines"))
            {
                if (token is not JObject machine || !availability.IsMachineUnlocked(machine.Value<string>("id"), state.Level)) continue;
                var status = machine.Value<string>("status");
                if (status != "WAITING_INPUT" && status != "IDLE") continue;
                var outputProduct = machine.Value<string>("productId");
                // When an intermediate and its final sellable product have the
                // same upstream demand, consume the available intermediate
                // first. Otherwise the operator can keep milling flour forever
                // while a ready bread oven is ignored.
                var score = Demand(outputProduct) +
                    (availability.CanCustomerRequest(outputProduct, state.Level) ? .5 : 0);
                if (score <= best || !HasRecipe(machine)) continue;
                best = score; selected = machine;
            }
            return selected;
        }

        public string BestStockProduct(IEnumerable<string> candidates)
        {
            string selected = null; var lowestFill = double.PositiveInfinity;
            foreach (var product in candidates)
            {
                if (!availability.CanCustomerRequest(product, state.Level) || state.Quantity("warehouse", product) < 1) continue;
                var capacity = availability.ShelfCapacity(state,product);
                var fill = state.Quantity("shelves", product) / (double)capacity;
                if (fill >= 1 || fill >= lowestFill) continue;
                selected = product; lowestFill = fill;
            }
            return selected;
        }

        bool HasRecipe(JObject machine)
        {
            var product = machine.Value<string>("productId");
            if (spec.ProductConfig[product]?["recipe"] is not JObject recipe || !recipe.HasValues) return true;
            foreach (var ingredient in recipe.Properties())
                if (state.Quantity("warehouse", ingredient.Name) < ingredient.Value.Value<int>()) return false;
            return true;
        }
    }
}
