using System;
using System.Collections.Generic;
using MiniMarket.Core;
using MiniMarket.Data;
using MiniMarket.Economy;
using Newtonsoft.Json.Linq;

namespace MiniMarket.Store
{
    public sealed class DaySystem
    {
        readonly GameStateDocument state;
        readonly GameSpecRepository spec;
        readonly GameSignals signals;
        readonly GameLedger ledger;
        public bool IsOpen
        {
            get => state.CurrentFranchise.Value<bool?>("open") ?? false;
            private set { state.CurrentFranchise["open"] = value; state.Changed(); }
        }

        public DaySystem(GameStateDocument document, GameSpecRepository repository, GameSignals gameSignals, GameLedger gameLedger = null)
        { state = document; spec = repository; signals = gameSignals; ledger = gameLedger; }
        public void ToggleOpen()
        {
            if((state.Root.Value<int?>("tutorialStep")??0)<1){signals.PublishNotification("Primero registra la empresa y el país fiscal");return;}
            if (!IsOpen && !(state.CurrentFranchise.Value<bool?>("licenseActive") ?? false))
            {
                signals.PublishNotification("Necesitas una licencia comercial activa"); return;
            }
            IsOpen = !IsOpen;
            signals.PublishNotification(IsOpen ? "Tienda abierta" : "Tienda cerrada");
        }

        public void AdvanceMinutes(int minutes)
        {
            if (minutes <= 0) return;
            state.MinuteOfDay += minutes;
            state.Root["lastServerTime"] = (state.Root.Value<long?>("lastServerTime") ?? 0) + minutes * 60000L;
            if(state.Root["franchises"] is JArray franchises)
                foreach(var token in franchises)
                    if(token is JObject franchise&&franchise.Value<bool>("owned")&&franchise.Value<bool>("open")&&franchise["employees"] is JArray employees)
                        foreach(var employee in employees)employee["energy"]=Math.Max(15,(employee.Value<double?>("energy")??100)-.15*minutes);
            state.Changed(false);
        }

        public void CloseDay()
        {
            var country = spec.Root["catalog"]?["COUNTRIES"]?[state.CountryCode] as JObject ?? new JObject();
            var payrollBurden = country.Value<double?>("payrollBurdenRate") ?? 0;
            var corporateTax = country.Value<double?>("corporateTaxRate") ?? 0;
            long payroll = 0, operating = 0, taxableProfit = 0;
            var charges = new List<(JObject franchise,long payroll,long operating)>();
            if (state.Root["franchises"] is JArray franchises)
            {
                foreach (var token in franchises)
                {
                    if (token is not JObject franchise || !franchise.Value<bool>("owned")) continue;
                    franchise["open"] = false;
                    long basePayroll = 0;
                    if (franchise["employees"] is JArray employees)
                        foreach (var employee in employees)
                        {
                            basePayroll += employee.Value<long?>("salaryMinor") ?? 0;
                            employee["energy"] = 100;
                        }
                    var payrollCost = (long)Math.Round(basePayroll * (1 + payrollBurden), MidpointRounding.AwayFromZero);
                    var dailyOperating = spec.ScaleMoney(1900L * Math.Max(1, franchise.Value<int?>("expansionLevel") ?? 1) + 700L * Math.Max(1, franchise.Value<int?>("checkoutLevel") ?? 1), state.CountryCode);
                    payroll += payrollCost; operating += dailyOperating;
                    taxableProfit += (franchise.Value<long?>("revenueTodayMinor") ?? 0) - (franchise.Value<long?>("expensesTodayMinor") ?? 0) - payrollCost - dailyOperating;
                    franchise["expensesTodayMinor"] = 0; franchise["revenueTodayMinor"] = 0; franchise["customersToday"] = 0;
                    franchise["licenseDaysLeft"] = Math.Max(0, (franchise.Value<int?>("licenseDaysLeft") ?? 0) - 1);
                    franchise["licenseActive"] = franchise.Value<int>("licenseDaysLeft") > 0;
                    charges.Add((franchise,payrollCost,dailyOperating));
                }
            }
            var tax = Math.Max(0L, (long)Math.Round(taxableProfit * corporateTax, MidpointRounding.AwayFromZero));
            state.BalanceMinor -= payroll + operating + tax;
            if (state.Root["finances"] is not JObject finances) state.Root["finances"] = finances = new JObject();
            finances["payrollMinor"] = (finances.Value<long?>("payrollMinor") ?? 0) + payroll;
            finances["operatingCostsMinor"] = (finances.Value<long?>("operatingCostsMinor") ?? 0) + operating;
            finances["taxesMinor"] = (finances.Value<long?>("taxesMinor") ?? 0) + tax;
            finances["netProfitMinor"] = (finances.Value<long?>("grossRevenueMinor") ?? 0) - (finances.Value<long?>("costOfGoodsMinor") ?? 0) - finances.Value<long>("payrollMinor") - finances.Value<long>("operatingCostsMinor") - finances.Value<long>("taxesMinor");
            finances["daysClosed"] = (finances.Value<int?>("daysClosed") ?? 0) + 1;
            state.Day += 1;
            state.MinuteOfDay = 450;
            state.Root["missions"] = MissionsForDay(state.Day);
            state.Changed();
            foreach(var charge in charges)
            {
                ledger?.Record("payroll", $"Nóminas y cargas laborales · {charge.franchise.Value<string>("name")}", -charge.payroll, charge.franchise);
                ledger?.Record("operations", $"Alquiler, energía y mantenimiento · {charge.franchise.Value<string>("name")}", -charge.operating, charge.franchise);
            }
            if (tax > 0) ledger?.Record("tax", $"Provisión fiscal {Math.Round(corporateTax * 100)}%", -tax, scope: "global");
            signals.PublishNotification($"Día {state.Day - 1} cerrado · nómina {payroll}, operación {operating}, impuestos {tax}");
        }

        JArray MissionsForDay(int day)
        {
            var scale = 1 + day / 3;
            var activityKind = state.Level >= 5 ? "production" : "harvest";
            var activityVerb = state.Level >= 5 ? "Completa" : "Cosecha";
            var activityNoun = state.Level >= 5 ? "ciclos de producción" : "productos";
            JObject Mission(string suffix,string label,string kind,int target,long reward)=>new()
            {
                ["id"]=$"d{day}-{suffix}",["label"]=label,["kind"]=kind,["target"]=target,["progress"]=0,
                ["rewardMinor"]=spec.ScaleMoney(reward*scale,state.CountryCode),["completed"]=false,["claimed"]=false,
            };
            return new JArray
            {
                Mission("stock",$"Repón {5+scale*2} productos","stock",5+scale*2,12000),
                Mission("customers",$"Atiende {3+scale} clientes","customers",3+scale,16000),
                Mission(activityKind,$"{activityVerb} {2+scale} {activityNoun}",activityKind,2+scale,19000),
            };
        }
    }
}
