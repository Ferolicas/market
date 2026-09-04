using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;

namespace MiniMarket.Data
{
    /// <summary>
    /// One authoritative gate for every system that can expose, request,
    /// produce or move a product.  Keeping the unlock table here prevents a
    /// customer, shelf, supplier and machine from disagreeing about levels.
    /// </summary>
    public sealed class ProductAvailabilityPolicy
    {
        static readonly Dictionary<string, int> ProductUnlockLevels = new(StringComparer.OrdinalIgnoreCase)
        {
            ["tomatoes"] = 1, ["apples"] = 2, ["wheat"] = 4, ["flour"] = 5,
            ["bread"] = 6, ["eggs"] = 8, ["coffee"] = 9, ["corn"] = 11,
            ["milk"] = 13, ["cheese"] = 16, ["juice"] = 21,
        };

        static readonly Dictionary<string, int> CustomerUnlockLevels = new(StringComparer.OrdinalIgnoreCase)
        {
            ["tomatoes"] = 1, ["apples"] = 2, ["bread"] = 6,
            ["eggs"] = 8, ["coffee"] = 9, ["corn"] = 11,
            ["milk"] = 13, ["cheese"] = 16, ["juice"] = 21,
        };

        static readonly Dictionary<string, int> CropUnlockLevels = new(StringComparer.OrdinalIgnoreCase)
        {
            ["crop-tomato-1"] = 1, ["crop-tomato-2"] = 2,
            ["crop-wheat-1"] = 4, ["crop-corn-1"] = 11,
        };

        static readonly Dictionary<string, int> MachineUnlockLevels = new(StringComparer.OrdinalIgnoreCase)
        {
            ["flour-mill-1"] = 5, ["bread-oven-1"] = 6,
            ["chicken-coop-1"] = 8, ["cow-station-1"] = 13,
            ["cheese-maker-1"] = 16, ["juice-machine-1"] = 21,
        };

        readonly GameSpecRepository spec;

        public ProductAvailabilityPolicy(GameSpecRepository repository) => spec = repository;

        public int ProductUnlockLevel(string productId)
            => ProductUnlockLevels.TryGetValue(productId ?? string.Empty, out var level) ? level : int.MaxValue;

        public int CustomerUnlockLevel(string productId)
            => CustomerUnlockLevels.TryGetValue(productId ?? string.Empty, out var level) ? level : int.MaxValue;

        public int CropUnlockLevel(string cropId)
            => CropUnlockLevels.TryGetValue(cropId ?? string.Empty, out var level) ? level : int.MaxValue;

        public int MachineUnlockLevel(string machineId)
            => MachineUnlockLevels.TryGetValue(machineId ?? string.Empty, out var level) ? level : int.MaxValue;

        public bool IsProductUnlocked(string productId, int level) => level >= ProductUnlockLevel(productId);
        public bool CanCustomerRequest(string productId, int level) => level >= CustomerUnlockLevel(productId);
        public bool IsCropUnlocked(string cropId, int level) => level >= CropUnlockLevel(cropId);
        public bool IsMachineUnlocked(string machineId, int level) => level >= MachineUnlockLevel(machineId);

        public IEnumerable<string> UnlockedCustomerProducts(int level)
        {
            foreach (var product in CustomerUnlockLevels)
                if (level >= product.Value) yield return product.Key;
        }

        public IEnumerable<string> UnlockedProducts(int level)
        {
            foreach (var product in ProductUnlockLevels)
                if (level >= product.Value) yield return product.Key;
        }

        public int ShelfCapacity(string productId)
            => Math.Max(1, spec.ProductConfig[productId]?["shelfCapacity"]?.Value<int>() ?? 12);

        public int ShelfCapacity(GameStateDocument state,string productId)
        {
            var fallback=state.CurrentFranchise.Value<int?>("shelvesLevel")??1;
            var tier=StationTierRules.Tier(state,"shelves-1",fallback);
            return Math.Max(1,(int)Math.Round(ShelfCapacity(productId)*StationTierRules.Capacity(tier),MidpointRounding.AwayFromZero));
        }

        public bool HasShelf(string productId)
        {
            if (spec.Layouts?["retail"]?["RETAIL_DEPARTMENTS"] is not JObject departments) return false;
            foreach (var department in departments.Properties())
                if (department.Value["products"] is JArray products)
                    foreach (var product in products)
                        if (string.Equals(product.Value<string>(), productId, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        public void ReconcileProgressionState(GameStateDocument state)
        {
            foreach (var token in state.Array("crops"))
            {
                if (token is not JObject crop) continue;
                var unlocked = IsCropUnlocked(crop.Value<string>("id"), state.Level);
                if (!unlocked) crop["status"] = "LOCKED";
                else if (crop.Value<string>("status") == "LOCKED")
                {
                    crop["status"] = "GROWING";
                    crop["plantedAt"] = state.SimulationTimeMs;
                    var baseGrow=spec.ProductConfig[crop.Value<string>("productId")]?["growMs"]?.Value<long>()??4000;
                    var tier=StationTierRules.Tier(state,crop.Value<string>("id"),crop.Value<int?>("tier")??1);
                    var levelSpeed=1d+Math.Min(.5,Math.Max(0,state.Level-1)*.025);
                    crop["readyAt"] = state.SimulationTimeMs + Math.Max(1500,(long)Math.Round(baseGrow/StationTierRules.Speed(tier)/levelSpeed,MidpointRounding.AwayFromZero));
                }
            }
            foreach (var token in state.Array("productionMachines"))
            {
                if (token is not JObject machine) continue;
                var unlocked = IsMachineUnlocked(machine.Value<string>("id"), state.Level);
                if (!unlocked) machine["status"] = "LOCKED";
                else if (machine.Value<string>("status") == "LOCKED") machine["status"] = "WAITING_INPUT";
            }
        }
    }
}
