using System;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using MiniMarket.Core;

namespace MiniMarket.Data
{
    public sealed class GameStateDocument
    {
        readonly GameSignals signals;
        public JObject Root { get; private set; }
        public bool IsDirty { get; private set; }

        public GameStateDocument(JObject root, GameSignals gameSignals)
        {
            Root = root ?? throw new ArgumentNullException(nameof(root));
            signals = gameSignals;
        }

        public int Revision => Root.Value<int?>("revision") ?? 0;
        public int Day { get => Root.Value<int?>("day") ?? 1; set { Root["day"] = value; Changed(); signals.PublishDay(value); } }
        public int MinuteOfDay { get => Root.Value<int?>("minuteOfDay") ?? 450; set { Root["minuteOfDay"] = value; Changed(); } }
        public int Level { get => Root.Value<int?>("level") ?? 1; set { Root["level"] = value; Changed(); } }
        public int Xp { get => Root.Value<int?>("xp") ?? 0; set { Root["xp"] = value; Changed(); } }
        public long BalanceMinor { get => Root.Value<long?>("balanceMinor") ?? 0L; set { Root["balanceMinor"] = value; Changed(); signals.PublishBalance(value); } }
        public string CountryCode => Root.Value<string>("countryCode") ?? "ES";
        public long SimulationTimeMs { get => Root.Value<long?>("simulationTimeMs") ?? 0L; set { Root["simulationTimeMs"] = value; Changed(false); } }

        public JObject CurrentFranchise
        {
            get
            {
                var id = Root.Value<string>("currentFranchiseId");
                var franchises = (JArray)Root["franchises"];
                foreach (var token in franchises)
                    if (token.Value<string>("id") == id) return (JObject)token;
                return (JObject)franchises[0];
            }
        }

        public JObject Inventory(string name)
        {
            if (CurrentFranchise[name] is JObject inventory) return inventory;
            inventory = new JObject();
            CurrentFranchise[name] = inventory;
            return inventory;
        }

        public int Quantity(string container, string productId)
            => Inventory(container).Value<int?>(productId) ?? 0;

        public void SetQuantity(string container, string productId, int value)
        {
            var safe = Math.Max(0, value);
            Inventory(container)[productId] = safe;
            Changed();
            signals.PublishInventory(productId, safe);
        }

        public void AddQuantity(string container, string productId, int delta)
            => SetQuantity(container, productId, Quantity(container, productId) + delta);

        public JArray Array(string name)
        {
            if (CurrentFranchise[name] is JArray array) return array;
            array = new JArray();
            CurrentFranchise[name] = array;
            return array;
        }

        public void Changed(bool incrementRevision = true)
        {
            if (incrementRevision) Root["revision"] = Revision + 1;
            IsDirty = true;
            signals.PublishStateChanged();
        }

        public void MarkSaved() => IsDirty = false;
        public void MarkDirty() => IsDirty = true;
        public string ToJson() => Root.ToString(Formatting.None);
        public JObject CloneRoot() => (JObject)Root.DeepClone();
    }
}
