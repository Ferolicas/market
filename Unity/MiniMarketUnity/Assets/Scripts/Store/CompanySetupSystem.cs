using System;
using MiniMarket.Core;
using MiniMarket.Data;
using MiniMarket.Economy;
using Newtonsoft.Json.Linq;

namespace MiniMarket.Store
{
    public sealed class CompanySetupSystem
    {
        readonly GameStateDocument state;readonly GameSpecRepository spec;readonly GameLedger ledger;readonly GameSignals signals;
        public CompanySetupSystem(GameStateDocument document,GameSpecRepository repository,GameLedger gameLedger,GameSignals gameSignals)
        {state=document;spec=repository;ledger=gameLedger;signals=gameSignals;}
        public bool Required=>state.Root.Value<int?>("tutorialStep") is null or 0;

        public bool Configure(string countryCode)
        {
            if(!Required||state.Day>1||(state.Root["finances"]?["grossRevenueMinor"]?.Value<long?>()??0)>0)return false;
            if(spec.Root["catalog"]?["COUNTRIES"]?[countryCode] is not JObject country)return false;
            var oldCode=state.CountryCode;var oldStart=spec.CountryMoneyScaleNumerator(oldCode);var newStart=spec.CountryMoneyScaleNumerator(countryCode);var ratio=newStart/(double)Math.Max(1,oldStart);var before=state.BalanceMinor;
            state.Root["countryCode"]=countryCode;state.Root["currency"]=country.Value<string>("currency");state.BalanceMinor=(long)Math.Round(before*ratio,MidpointRounding.AwayFromZero);
            if(state.Root["franchises"] is JArray franchises)foreach(var token in franchises)if(token is JObject franchise)
            {
                franchise["purchaseCostMinor"]=(long)Math.Round((franchise.Value<long?>("purchaseCostMinor")??0)*ratio,MidpointRounding.AwayFromZero);
                if(franchise["buildProjects"] is JArray projects)foreach(var project in projects)
                {
                    project["costMinor"]=(long)Math.Round((project.Value<long?>("costMinor")??0)*ratio,MidpointRounding.AwayFromZero);
                    project["contributedMinor"]=(long)Math.Round((project.Value<long?>("contributedMinor")??0)*ratio,MidpointRounding.AwayFromZero);
                }
            }
            if(state.Root["missions"] is JArray missions)foreach(var mission in missions)mission["rewardMinor"]=(long)Math.Round((mission.Value<long?>("rewardMinor")??0)*ratio,MidpointRounding.AwayFromZero);
            state.Root["tutorialStep"]=1;ledger?.Record("configuration",$"Capital inicial convertido a {country.Value<string>("currency")}",state.BalanceMinor-before,scope:"global");state.Changed();signals.PublishNotification($"Empresa registrada en {country.Value<string>("name")}");return true;
        }
    }
}
