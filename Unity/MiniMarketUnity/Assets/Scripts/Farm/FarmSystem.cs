using System;
using MiniMarket.Core;
using MiniMarket.Data;
using MiniMarket.Inventory;
using Newtonsoft.Json.Linq;
using MiniMarket.Progression;

namespace MiniMarket.Farm
{
    public sealed class FarmSystem
    {
        readonly GameStateDocument state;
        readonly GameSpecRepository spec;
        readonly InventorySystem inventory;
        readonly PlayerCarrySystem carry;
        readonly ProductAvailabilityPolicy availability;
        readonly GameSignals signals;
        readonly ProgressionSystem progression;
        public FarmSystem(GameStateDocument document, GameSpecRepository repository, InventorySystem inventorySystem,
            PlayerCarrySystem playerCarry, ProductAvailabilityPolicy productAvailability, GameSignals gameSignals,
            ProgressionSystem progressionSystem = null)
        { state = document; spec = repository; inventory = inventorySystem; carry = playerCarry; availability = productAvailability; signals = gameSignals; progression = progressionSystem; }

        public void Tick(long nowMs)
        {
            foreach (var token in state.Array("crops"))
            {
                if (token is not JObject crop || crop.Value<string>("status") != "GROWING") continue;
                if (!availability.IsCropUnlocked(crop.Value<string>("id"), state.Level)) continue;
                if (nowMs < (crop.Value<long?>("readyAt") ?? long.MaxValue)) continue;
                crop["status"] = "READY";
                crop["available"] = Yield(crop);
                state.Changed(false);
            }
        }

        public bool TendOrHarvest(string cropId)
        {
            var crop = Find(cropId);
            if (crop == null || !availability.IsCropUnlocked(cropId, state.Level)) return false;
            var status = crop.Value<string>("status");
            if (status == "EMPTY")
            {
                var productId = crop.Value<string>("productId");
                var baseGrowMs = spec.ProductConfig[productId]?["growMs"]?.Value<long>() ?? 4000;
                var growMs=GrowthDuration(baseGrowMs,StationTierRules.Tier(state,cropId,crop.Value<int?>("tier")??1));
                crop["status"] = "GROWING";
                crop["plantedAt"] = state.SimulationTimeMs;
                crop["readyAt"] = state.SimulationTimeMs + Math.Max(1500, growMs);
                state.Changed();
                signals.PublishNotification("Cultivo plantado");
                return true;
            }
            if (status != "READY" || (crop.Value<int?>("available") ?? 0) < 1) return false;
            if (carry.Free < 1)
            {
                signals.PublishNotification("La cesta está llena: surte o usa DEVOLVER CARGA");
                return false;
            }
            var harvested = Math.Min(crop.Value<int>("available"), carry.Free);
            var id = crop.Value<string>("productId");
            carry.Add(id, harvested);
            FinishHarvest(crop, harvested);
            state.Changed();
            progression?.Record($"harvest:{id}", harvested);
            progression?.Record("harvest:all", harvested);
            signals.PublishNotification($"Cosecha: {harvested} × {id}");
            return true;
        }

        public int HarvestForWorker(string cropId, int capacity, out string productId)
        {
            var crop = Find(cropId); productId = crop?.Value<string>("productId");
            if (crop == null || !availability.IsCropUnlocked(cropId, state.Level) || crop.Value<string>("status") != "READY") return 0;
            var harvested = Math.Min(Math.Max(0, capacity), crop.Value<int?>("available") ?? 0);
            if (harvested < 1) return 0;
            FinishHarvest(crop, harvested);
            state.Changed();
            progression?.Record($"harvest:{productId}", harvested);
            progression?.Record("harvest:all", harvested);
            return harvested;
        }

        void FinishHarvest(JObject crop, int harvested)
        {
            var remaining = Math.Max(0, (crop.Value<int?>("available") ?? 0) - harvested);
            crop["available"] = remaining;
            if (remaining > 0) return;
            var id = crop.Value<string>("productId");
            crop["status"] = "GROWING";
            crop["plantedAt"] = state.SimulationTimeMs;
            var baseGrowMs=spec.ProductConfig[id]?["growMs"]?.Value<long>()??4000;var tier=StationTierRules.Tier(state,crop.Value<string>("id"),crop.Value<int?>("tier")??1);
            crop["readyAt"] = state.SimulationTimeMs + GrowthDuration(baseGrowMs,tier);
        }

        JObject Find(string cropId)
        {
            foreach (var token in state.Array("crops")) if (token.Value<string>("id") == cropId) return token as JObject;
            return null;
        }

        int Yield(JObject crop)
        {
            var id = crop.Value<string>("productId");
            var productYield = spec.ProductConfig[id]?["yield"]?.Value<int>() ?? 1;
            var tier = StationTierRules.Tier(state,crop.Value<string>("id"),crop.Value<int?>("tier")??1);
            var capacity = StationTierRules.Capacity(tier);
            return Math.Max(1, (int)Math.Round(3 * productYield * capacity,MidpointRounding.AwayFromZero));
        }

        long GrowthDuration(long baseGrowMs,int tier)
        {
            var levelSpeed=1d+Math.Min(.5,Math.Max(0,state.Level-1)*.025);
            return Math.Max(1500,(long)Math.Round(baseGrowMs/StationTierRules.Speed(tier)/levelSpeed,MidpointRounding.AwayFromZero));
        }
    }
}
