using MiniMarket.Core;
using MiniMarket.Data;
using MiniMarket.Economy;
using MiniMarket.Progression;
using Newtonsoft.Json.Linq;

namespace MiniMarket.Store
{
    public sealed class FranchiseSystem
    {
        readonly GameStateDocument state;readonly ProgressionSystem progression;readonly GameLedger ledger;readonly GameSignals signals;
        public FranchiseSystem(GameStateDocument document,ProgressionSystem progressionSystem,GameLedger gameLedger,GameSignals gameSignals)
        {state=document;progression=progressionSystem;ledger=gameLedger;signals=gameSignals;}

        public bool Buy(string franchiseId)
        {
            var target=Find(franchiseId);if(target==null||target.Value<bool>("owned")||state.Level<target.Value<int>("unlockLevel"))return false;
            var cost=target.Value<long?>("purchaseCostMinor")??0;if(state.BalanceMinor<cost)return false;
            state.BalanceMinor-=cost;target["owned"]=true;target["licenseActive"]=true;target["licenseDaysLeft"]=7;
            progression.ReconcileAllUnlocks();ledger?.Record("capital",$"Apertura de {target.Value<string>("name")}",-cost,target);state.Changed();
            signals.PublishNotification($"{target.Value<string>("name")} ya forma parte de tu empresa");return true;
        }

        public bool Travel(string franchiseId)
        {
            var target=Find(franchiseId);if(target==null||!target.Value<bool>("owned"))return false;
            state.Root["currentFranchiseId"]=franchiseId;state.Changed();signals.PublishNotification($"Viaje a {target.Value<string>("name")}");return true;
        }

        JObject Find(string id)
        {
            if(state.Root["franchises"] is not JArray franchises)return null;
            foreach(var token in franchises)if(token is JObject item&&item.Value<string>("id")==id)return item;
            return null;
        }
    }
}
