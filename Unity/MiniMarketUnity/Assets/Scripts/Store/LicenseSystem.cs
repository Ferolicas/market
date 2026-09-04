using System;
using MiniMarket.Core;
using MiniMarket.Data;
using MiniMarket.Economy;

namespace MiniMarket.Store
{
    public sealed class LicenseSystem
    {
        readonly GameStateDocument state;readonly GameSpecRepository spec;readonly GameLedger ledger;readonly GameSignals signals;
        public LicenseSystem(GameStateDocument document,GameSpecRepository repository,GameLedger gameLedger,GameSignals gameSignals)
        {state=document;spec=repository;ledger=gameLedger;signals=gameSignals;}
        public long RenewalCost=>spec.ScaleMoney(24000L*(1+Math.Max(1,state.CurrentFranchise.Value<int?>("expansionLevel")??1)),state.CountryCode);
        public bool Renew()
        {
            var cost=RenewalCost;if(state.BalanceMinor<cost)return false;
            state.BalanceMinor-=cost;var franchise=state.CurrentFranchise;franchise["licenseActive"]=true;franchise["licenseDaysLeft"]=(franchise.Value<int?>("licenseDaysLeft")??0)+14;
            ledger?.Record("license","Licencia comercial (14 días)",-cost);state.Changed();signals.PublishNotification("Licencia comercial renovada por 14 días");return true;
        }
    }
}
