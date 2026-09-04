using System;
using MiniMarket.Core;
using MiniMarket.Data;
using Newtonsoft.Json.Linq;

namespace MiniMarket.Store
{
    public sealed class HiringSystem
    {
        static readonly string[] Names={"Luna","Mateo","Sofía","Leo","Carmen","Nico"};
        readonly GameStateDocument state; readonly GameSpecRepository spec; readonly GameSignals signals; readonly MiniMarket.Economy.GameLedger ledger; readonly MiniMarket.Progression.ProgressionSystem progression;
        public HiringSystem(GameStateDocument document,GameSpecRepository repository,GameSignals gameSignals,MiniMarket.Economy.GameLedger gameLedger=null,MiniMarket.Progression.ProgressionSystem progressionSystem=null){state=document;spec=repository;signals=gameSignals;ledger=gameLedger;progression=progressionSystem;}
        public bool Hire(string role)
        {
            var info=spec.Root["catalog"]["ROLE_INFO"]?[role] as JObject; if(info==null || state.Level<info.Value<int>("unlockLevel")) return false;
            var salary=spec.ScaleMoney(info.Value<long>("salaryMinor"),state.CountryCode); var signing=salary*2; if(state.BalanceMinor<signing)return false;
            var employees=state.Array("employees"); state.BalanceMinor-=signing;
            state.CurrentFranchise["expensesTodayMinor"]=(state.CurrentFranchise.Value<long?>("expensesTodayMinor")??0)+signing;
            employees.Add(new JObject{{"id",Guid.NewGuid().ToString("N")},{"name",Names[employees.Count%Names.Length]},{"role",role},{"level",1},{"salaryMinor",salary},{"energy",100},{"hat","frog"}});
            progression?.GainXp(55);ledger?.Record("payroll",$"Alta de {info.Value<string>("name")}",-signing);state.Changed();signals.PublishNotification($"{info.Value<string>("name")} contratado");return true;
        }
    }
}
