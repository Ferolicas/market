using System;
using MiniMarket.Core;
using MiniMarket.Data;

namespace MiniMarket.Store
{
    /// <summary>Keeps visible/interactive world content aligned with one level policy.</summary>
    public sealed class WorldAvailabilityPresenter : IDisposable
    {
        readonly StoreWorld world;readonly GameStateDocument state;readonly ProductAvailabilityPolicy policy;readonly GameSignals signals;
        int lastRevision=-1;string lastFranchise;
        public WorldAvailabilityPresenter(StoreWorld storeWorld,GameStateDocument document,ProductAvailabilityPolicy availability,GameSignals gameSignals)
        {world=storeWorld;state=document;policy=availability;signals=gameSignals;signals.StateChanged+=Refresh;Refresh();}

        public void Refresh()
        {
            var franchise=state.CurrentFranchise.Value<string>("id");if(lastRevision==state.Revision&&lastFranchise==franchise)return;lastRevision=state.Revision;lastFranchise=franchise;
            foreach(var pair in world.AvailabilityVisuals)
            {
                if(!pair.Value)continue;var visible=true;
                if(pair.Key.StartsWith("machine:",StringComparison.Ordinal))visible=policy.IsMachineUnlocked(pair.Key[8..],state.Level);
                else if(pair.Key.StartsWith("crop:",StringComparison.Ordinal))visible=policy.IsCropUnlocked(pair.Key[5..],state.Level);
                else if(pair.Key.StartsWith("checkout:",StringComparison.Ordinal))visible=int.Parse(pair.Key[9..])==0||HasArea("checkout-2");
                pair.Value.SetActive(visible);
            }
            foreach(var pair in world.Interactions)
            {
                var id=pair.Key;var enabled=true;
                if(id.StartsWith("farm:",StringComparison.Ordinal))enabled=policy.IsCropUnlocked(id[5..],state.Level);
                else if(id.StartsWith("machine:",StringComparison.Ordinal))enabled=policy.IsMachineUnlocked(id[8..],state.Level);
                else if(id=="animal:chicken")enabled=policy.IsMachineUnlocked("chicken-coop-1",state.Level);
                else if(id=="animal:cow")enabled=policy.IsMachineUnlocked("cow-station-1",state.Level);
                else if(id=="checkout:1")enabled=HasArea("checkout-2");
                if(pair.Value)pair.Value.gameObject.SetActive(enabled);
            }
        }
        bool HasArea(string id)=>state.CurrentFranchise["unlockedAreas"] is Newtonsoft.Json.Linq.JArray areas&&areas.Contains(id);
        public void Dispose()=>signals.StateChanged-=Refresh;
    }
}
