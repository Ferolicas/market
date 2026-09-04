using System;
using MiniMarket.Core;
using MiniMarket.Data;
using MiniMarket.Inventory;
using Newtonsoft.Json.Linq;
using MiniMarket.Progression;

namespace MiniMarket.Production
{
    public sealed class ProductionSystem
    {
        readonly GameStateDocument state;
        readonly GameSpecRepository spec;
        readonly InventorySystem inventory;
        readonly PlayerCarrySystem carry;
        readonly ProductAvailabilityPolicy availability;
        readonly GameSignals signals;
        readonly ProgressionSystem progression;
        public ProductionSystem(GameStateDocument document, GameSpecRepository repository, InventorySystem inventorySystem,
            PlayerCarrySystem playerCarry, ProductAvailabilityPolicy productAvailability, GameSignals gameSignals,
            ProgressionSystem progressionSystem = null)
        { state = document; spec = repository; inventory = inventorySystem; carry = playerCarry; availability = productAvailability; signals = gameSignals; progression = progressionSystem; }

        public void Tick(long nowMs)
        {
            foreach (var token in state.Array("productionMachines"))
            {
                if (token is not JObject machine || machine.Value<string>("status") != "PROCESSING") continue;
                if (!availability.IsMachineUnlocked(machine.Value<string>("id"), state.Level)) continue;
                if (nowMs < (machine.Value<long?>("completesAt") ?? long.MaxValue)) continue;
                var id = machine.Value<string>("productId");
                var output = (machine.Value<int?>("output") ?? 0) + (spec.ProductConfig[id]?["yield"]?.Value<int>() ?? 1);
                var capacity = machine.Value<int?>("outputCapacity") ?? 8;
                machine["output"] = Math.Min(capacity, output);
                machine["status"] = output >= capacity ? "FULL" : "OUTPUT_READY";
                machine["startedAt"] = null;
                machine["completesAt"] = null;
                state.Changed(false);
                progression?.Record($"production:{id}");
                progression?.Record("production:all");
            }
        }

        public bool Operate(string machineId)
        {
            var machine = Find(machineId);
            if (machine == null || machine.Value<string>("status") == "LOCKED" || !availability.IsMachineUnlocked(machineId, state.Level)) return false;
            var productId = machine.Value<string>("productId");
            var output = machine.Value<int?>("output") ?? 0;
            if (output > 0)
            {
                var collected = Math.Min(output, carry.Free);
                if (collected < 1) { signals.PublishNotification("La cesta está llena: surte o devuelve la carga"); return false; }
                carry.Add(productId, collected);
                machine["output"] = output - collected;
                machine["status"] = output - collected > 0 ? "OUTPUT_READY" : "WAITING_INPUT";
                state.Changed();
                signals.PublishNotification($"Recogido: {collected} × {productId}");
                return true;
            }
            var recipe = spec.ProductConfig[productId]?["recipe"] as JObject ?? new JObject();
            foreach (var ingredient in recipe.Properties())
                if (carry.Quantity(ingredient.Name) < ingredient.Value.Value<int>()) return false;
            foreach (var ingredient in recipe.Properties()) carry.Remove(ingredient.Name, ingredient.Value.Value<int>());
            var baseCycle=spec.ProductConfig[productId]?["cycleMs"]?.Value<long>()??1000;var tier=StationTierRules.Tier(state,machineId,machine.Value<int?>("tier")??1);
            var cycle=(long)Math.Round(baseCycle/StationTierRules.Speed(tier),MidpointRounding.AwayFromZero);
            machine["status"] = "PROCESSING";
            machine["startedAt"] = state.SimulationTimeMs;
            machine["completesAt"] = state.SimulationTimeMs + cycle;
            state.Changed();
            signals.PublishNotification($"Produciendo {productId}");
            return true;
        }

        public int CollectForWorker(string machineId, int capacity, out string productId)
        {
            var machine = Find(machineId); productId = machine?.Value<string>("productId");
            if (machine == null || !availability.IsMachineUnlocked(machineId, state.Level)) return 0;
            var collected = Math.Min(Math.Max(0, capacity), machine.Value<int?>("output") ?? 0);
            if (collected < 1) return 0;
            var remaining = machine.Value<int>("output") - collected;
            machine["output"] = remaining;
            machine["status"] = remaining > 0 ? "OUTPUT_READY" : "WAITING_INPUT";
            state.Changed();
            return collected;
        }

        public bool StartForWorker(string machineId)
        {
            var machine = Find(machineId);
            if (machine == null || !availability.IsMachineUnlocked(machineId, state.Level)) return false;
            var status = machine.Value<string>("status");
            if (status != "WAITING_INPUT" && status != "IDLE") return false;
            var productId = machine.Value<string>("productId");
            var recipe = spec.ProductConfig[productId]?["recipe"] as JObject ?? new JObject();
            foreach (var ingredient in recipe.Properties())
                if (inventory.Quantity("warehouse", ingredient.Name) < ingredient.Value.Value<int>()) return false;
            foreach (var ingredient in recipe.Properties()) inventory.Consume("warehouse", ingredient.Name, ingredient.Value.Value<int>());
            var baseCycle=spec.ProductConfig[productId]?["cycleMs"]?.Value<long>()??1000;var tier=StationTierRules.Tier(state,machineId,machine.Value<int?>("tier")??1);
            var cycle=(long)Math.Round(baseCycle/StationTierRules.Speed(tier),MidpointRounding.AwayFromZero);
            machine["status"] = "PROCESSING";
            machine["startedAt"] = state.SimulationTimeMs;
            machine["completesAt"] = state.SimulationTimeMs + cycle;
            state.Changed();
            return true;
        }

        JObject Find(string id)
        {
            foreach (var token in state.Array("productionMachines")) if (token.Value<string>("id") == id) return token as JObject;
            return null;
        }
    }
}
