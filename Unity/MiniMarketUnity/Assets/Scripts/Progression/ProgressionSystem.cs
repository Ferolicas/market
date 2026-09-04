using System;
using MiniMarket.Core;
using MiniMarket.Data;
using Newtonsoft.Json.Linq;

namespace MiniMarket.Progression
{
    public sealed class ProgressionSystem
    {
        readonly GameStateDocument state;
        readonly GameSpecRepository spec;
        readonly GameSignals signals;
        readonly MiniMarket.Economy.GameLedger ledger;
        public ProgressionSystem(GameStateDocument document, GameSpecRepository repository, GameSignals gameSignals, MiniMarket.Economy.GameLedger gameLedger = null)
        { state = document; spec = repository; signals = gameSignals; ledger = gameLedger; }

        public void ReconcileAllUnlocks()
        {
            if (state.Root["franchises"] is not JArray franchises) return;
            foreach (var token in franchises)
            {
                if (token is not JObject franchise || !franchise.Value<bool>("owned")) continue;
                for (var level = 2; level <= Math.Min(30, state.Level); level++) ApplyUnlock(franchise, level);
            }
        }

        JObject Counters
        {
            get
            {
                if (state.Root["progression"] is not JObject progression) state.Root["progression"] = progression = new JObject();
                if (progression["counters"] is not JObject counters) progression["counters"] = counters = new JObject();
                return counters;
            }
        }

        public void GainXp(int amount) { if (amount > 0) state.Xp += amount; }

        public void Record(string id, int amount = 1)
        {
            if (amount <= 0) return;
            Counters[id] = (Counters.Value<int?>(id) ?? 0) + amount;
            switch (id)
            {
                case "harvest:all": GainAndAdvanceMission("harvest", amount, 18 * amount); break;
                case "stock:all": GainAndAdvanceMission("stock", amount, 12 * amount); break;
                case "production:all": GainAndAdvanceMission("production", amount, 24 * amount); break;
                case "customers": GainAndAdvanceMission("customers", amount, 20 * amount); break;
            }
            state.Changed();
            TryAdvanceLevel();
        }

        public bool ClaimMission(string missionId)
        {
            if (state.Root["missions"] is not JArray missions) return false;
            foreach (var token in missions)
            {
                if (token is not JObject mission || mission.Value<string>("id") != missionId || !mission.Value<bool>("completed") || mission.Value<bool>("claimed")) continue;
                var reward = Math.Max(0L, mission.Value<long?>("rewardMinor") ?? 0);
                mission["claimed"] = true; state.BalanceMinor += reward;
                ledger?.Record("mission", mission.Value<string>("label") ?? "Misión diaria", reward, scope: "global");
                state.Changed(); signals.PublishNotification($"Recompensa cobrada: {reward}"); return true;
            }
            return false;
        }

        public bool ContributeToNextLevel(long requested = long.MaxValue)
        {
            var project = CurrentProject();
            if (project == null) return false;
            var remaining = Math.Max(0L, project.Value<long>("costMinor") - project.Value<long>("contributedMinor"));
            var amount = Math.Min(Math.Min(requested, remaining), state.BalanceMinor);
            if (amount <= 0) return false;
            state.BalanceMinor -= amount;
            state.CurrentFranchise["expensesTodayMinor"] = (state.CurrentFranchise.Value<long?>("expensesTodayMinor") ?? 0) + amount;
            project["contributedMinor"] = project.Value<long>("contributedMinor") + amount;
            project["completed"] = project.Value<long>("contributedMinor") >= project.Value<long>("costMinor");
            ledger?.Record("capital", $"Aporte ampliación nivel {project.Value<int>("level")}", -amount);
            state.Changed();
            signals.PublishNotification(project.Value<bool>("completed") ? "Financiación completada" : $"Aporte realizado: {amount}");
            TryAdvanceLevel();
            return true;
        }

        public bool TryAdvanceLevel()
        {
            if (state.Level >= 30 || !ObjectiveSatisfied(state.Level)) return false;
            var project = CurrentProject();
            if (project == null || !project.Value<bool>("completed")) return false;
            var completedLevel = state.Level;
            state.Level += 1;
            if (state.Root["progression"] is JObject progression)
            {
                if (progression["completedLevels"] is not JArray completed) progression["completedLevels"] = completed = new JArray();
                if (!completed.Contains(completedLevel)) completed.Add(completedLevel);
                progression["objectiveComplete"] = false;
                progression["lastUnlockAt"] = state.SimulationTimeMs;
            }
            if (state.Root["franchises"] is JArray franchises)
                foreach (var token in franchises) if (token is JObject franchise && franchise.Value<bool>("owned")) ApplyUnlock(franchise, state.Level);
            EnsureNextProject();
            state.Changed();
            signals.PublishNotification($"Nivel {state.Level} desbloqueado · {spec.Levels[state.Level - 1]?["unlock"]}");
            return true;
        }

        public bool ObjectiveSatisfied(int level)
        {
            int C(string id) => Counters.Value<int?>(id) ?? 0;
            return level switch
            {
                1 => C("harvest:tomatoes") >= 3 && C("stock:tomatoes") >= 3 && C("customers") >= 1,
                2 => C("customers") >= 2, 3 => C("customers") >= 4, 4 => C("stock:all") >= 12,
                5 => C("harvest:wheat") >= 6, 6 => C("sales:bread") >= 4, 7 => C("customers") >= 12,
                8 => C("sales:eggs") >= 8, 9 => ShelfAvailability() >= .8, 10 => C("sales:units") >= 20,
                11 => C("harvest:corn") >= 20, 12 => C("distance:player") >= 500, 13 => C("sales:milk") >= 12,
                14 => C("customers") >= 30, 15 => C("transport:all") >= 40, 16 => C("production:cheese") >= 10,
                17 => C("queue:under30") >= 1, 18 => C("deliveries") >= 5, 19 => C("orders") >= 8,
                20 => C("customers") >= 50, 21 => C("sales:juice") >= 15, 22 => C("harvest:all") >= 60,
                23 => state.CurrentFranchise.Value<double?>("rating") >= 4.25, 24 => C("stock:all") >= 100,
                25 => C("lists:five") >= 1, 26 => C("production:all") >= 50, 27 => C("sales:units") >= 150,
                28 => AllStationsTierThree(), 29 => C("availability:sales") >= 50, 30 => true, _ => false,
            };
        }

        JObject CurrentProject()
        {
            foreach (var token in state.Array("buildProjects")) if (token.Value<int>("level") == state.Level + 1) return token as JObject;
            return null;
        }

        void EnsureNextProject()
        {
            if (state.Level >= 30) return;
            foreach (var token in state.Array("buildProjects")) if (token.Value<int>("level") == state.Level + 1) return;
            var cost = spec.ScaleMoney(spec.Levels[state.Level]?["costMinor"]?.Value<long>() ?? 0, state.CountryCode);
            state.Array("buildProjects").Add(new JObject { ["id"]=$"level-{state.Level+1}", ["level"]=state.Level+1, ["costMinor"]=cost, ["contributedMinor"]=0, ["completed"]=false });
        }

        void ApplyUnlock(JObject f, int level)
        {
            if (f["unlockedAreas"] is not JArray unlocked) f["unlockedAreas"] = unlocked = new JArray();
            if (f["stationTiers"] is not JObject tiers) f["stationTiers"] = tiers = new JObject();
            if (f["crops"] is not JArray crops) f["crops"] = crops = new JArray();
            if (f["productionMachines"] is not JArray machines) f["productionMachines"] = machines = new JArray();
            void Unlock(string id) { if (!unlocked.Contains(id)) unlocked.Add(id); }
            void Tier(string id, int value = 1) { tiers[id] = Math.Max(value, tiers.Value<int?>(id) ?? 0); }
            void UnlockMachine(string id) { foreach (var t in machines) if (t.Value<string>("id")==id && t.Value<string>("status")=="LOCKED") t["status"]="WAITING_INPUT"; }
            void UnlockCrop(string id) { foreach (var t in crops) if (t.Value<string>("id")==id && t.Value<string>("status")=="LOCKED") { t["status"]="GROWING"; t["plantedAt"]=state.SimulationTimeMs; t["readyAt"]=state.SimulationTimeMs+GrowMs(t.Value<string>("productId"),tiers.Value<int?>(id)??t.Value<int?>("tier")??1); } }
            if (level==2 && !HasCrop(f,"crop-tomato-2")) crops.Add(new JObject{{"id","crop-tomato-2"},{"productId","tomatoes"},{"status","GROWING"},{"plantedAt",state.SimulationTimeMs},{"readyAt",state.SimulationTimeMs+GrowMs("tomatoes",1)},{"available",0},{"tier",1}});
            if (level==2) Tier("crop-tomato-2");
            if (level==3) { f["playerCapacityTier"]=2; f["carry"]["capacity"]=5; }
            if (level==4) { Unlock("farm-wheat"); UnlockCrop("crop-wheat-1"); Tier("crop-wheat-1"); }
            if (level==5) { Unlock("flour-mill"); UnlockMachine("flour-mill-1"); Tier("flour-mill-1"); }
            if (level==6) { Unlock("bread-oven"); UnlockMachine("bread-oven-1"); Tier("bread-oven-1"); }
            if (level==7) { f["checkoutLevel"]=Math.Max(2,f.Value<int>("checkoutLevel")); Tier("checkout-1",2); }
            if (level==8) { Unlock("chicken-coop"); UnlockMachine("chicken-coop-1"); Tier("chicken-coop-1"); }
            if (level==9) HireUnlockedEmployee(f,"stocker");
            if (level==10) { f["storeRank"]=Math.Max(2,f.Value<int?>("storeRank")??1); BumpStructureForNewArea(f,"expansion-side"); Unlock("expansion-side"); }
            if (level==11) { Unlock("farm-corn"); UnlockCrop("crop-corn-1"); Tier("crop-corn-1"); }
            if (level==12) f["playerSpeedTier"]=Math.Max(2,f.Value<int?>("playerSpeedTier")??1);
            if (level==13) { Unlock("cow-station"); UnlockMachine("cow-station-1"); Tier("cow-station-1"); }
            if (level==14) HireUnlockedEmployee(f,"cashier");
            if (level==15) { f["playerCapacityTier"]=3; f["carry"]["capacity"]=8; }
            if (level==16) { Unlock("cheese-maker"); UnlockMachine("cheese-maker-1"); Tier("cheese-maker-1"); }
            if (level==17) { Unlock("checkout-2"); Tier("checkout-2"); }
            if (level==18) { Unlock("stockroom-rack"); Unlock("delivery-dock"); }
            if (level==20) { f["storeRank"]=Math.Max(3,f.Value<int?>("storeRank")??1); BumpStructureForNewArea(f,"expansion-rear"); Unlock("expansion-rear"); }
            if (level==21) { Unlock("juice-machine"); UnlockMachine("juice-machine-1"); Tier("juice-machine-1"); }
            if (level==22) HireUnlockedEmployee(f,"farmer");
            if (level==23) Unlock("facade-premium");
            if (level==24) { f["playerCapacityTier"]=4; f["carry"]["capacity"]=12; f["shelvesLevel"]=Math.Max(3,f.Value<int>("shelvesLevel")); Tier("shelves-1",3); }
            if (level==26) HireUnlockedEmployee(f,"operator");
            if (level==27) { BumpStructureForNewArea(f,"expansion-third"); Unlock("expansion-third"); Unlock("endcap-display"); }
            if (level==28) Unlock("equipment-premium");
            if (level==30) { f["storeRank"]=Math.Max(4,f.Value<int?>("storeRank")??1); Unlock("franchise-unlocked"); }
        }

        long GrowMs(string productId,int tier)
        {
            var baseGrow=spec.ProductConfig[productId]?["growMs"]?.Value<long>()??4000;
            var levelSpeed=1d+Math.Min(.5,Math.Max(0,state.Level-1)*.025);
            return Math.Max(1500,(long)Math.Round(baseGrow/StationTierRules.Speed(tier)/levelSpeed,MidpointRounding.AwayFromZero));
        }

        static bool HasCrop(JObject franchise,string id)
        {
            if(franchise["crops"] is not JArray crops)return false;
            foreach(var token in crops)if(token.Value<string>("id")==id)return true;
            return false;
        }

        static void BumpStructureForNewArea(JObject franchise,string area)
        {
            if(franchise["unlockedAreas"] is JArray unlocked&&unlocked.Contains(area))return;
            franchise["structureRevision"]=(franchise.Value<int?>("structureRevision")??1)+1;
        }

        void HireUnlockedEmployee(JObject franchise,string role)
        {
            if(franchise["employees"] is not JArray employees)franchise["employees"]=employees=new JArray();
            foreach(var token in employees)if(token.Value<string>("role")==role)return;
            var index=employees.Count;
            var names=spec.Root["catalog"]?["EMPLOYEE_NAMES"] as JArray;
            var hats=spec.Root["catalog"]?["HATS"] as JArray;
            var roleInfo=spec.Root["catalog"]?["ROLE_INFO"]?[role];
            var baseSalary=roleInfo?["salaryMinor"]?.Value<long>()??0;
            var name=names!=null&&names.Count>0?names[index%names.Count].Value<string>():$"Empleado {index+1}";
            var hat=hats!=null&&hats.Count>0?hats[index%hats.Count]?["id"]?.Value<string>():"none";
            employees.Add(new JObject
            {
                ["id"]=$"unlock-{role}-{index}", ["name"]=name, ["role"]=role, ["level"]=1,
                ["salaryMinor"]=spec.ScaleMoney(baseSalary,state.CountryCode), ["energy"]=100, ["hat"]=hat,
            });
        }

        double ShelfAvailability()
        {
            double total=0; var count=0;
            var policy = new ProductAvailabilityPolicy(spec);
            var rank = Math.Max(1, state.CurrentFranchise.Value<int?>("storeRank") ?? 1);
            var shelfTier = Math.Max(1, state.CurrentFranchise["stationTiers"]?["shelves-1"]?.Value<int?>() ?? state.CurrentFranchise.Value<int?>("shelvesLevel") ?? 1);
            var multiplier = StationCapacityMultiplier(shelfTier);
            foreach (var id in policy.UnlockedCustomerProducts(rank * 10))
            {
                var capacity=Math.Max(1,(int)Math.Round((spec.ProductConfig[id]?["shelfCapacity"]?.Value<int>()??12)*multiplier));
                total+=Math.Min(1,state.Quantity("shelves",id)/(double)capacity);count++;
            }
            return count==0 ? 0 : total/count;
        }

        void GainAndAdvanceMission(string kind, int amount, int xp)
        {
            GainXp(xp);
            if (state.Root["missions"] is not JArray missions) return;
            foreach (var token in missions)
            {
                if (token is not JObject mission || mission.Value<string>("kind") != kind || mission.Value<bool>("completed")) continue;
                var target = Math.Max(1, mission.Value<int?>("target") ?? 1);
                var progress = Math.Min(target, Math.Max(0, mission.Value<int?>("progress") ?? 0) + amount);
                mission["progress"] = progress; mission["completed"] = progress >= target;
                if (progress >= target) signals.PublishNotification($"Misión completada: {mission.Value<string>("label")}");
            }
        }

        static double StationCapacityMultiplier(int tier)
        {
            tier=Math.Clamp(tier,1,10);var capacity=1d;
            if(tier>=2)capacity+=.25;if(tier>=4)capacity+=.25;if(tier>=7)capacity+=.3;if(tier>=10)capacity+=.4;
            return capacity;
        }

        bool AllStationsTierThree()
        {
            if (state.CurrentFranchise["stationTiers"] is not JObject tiers || !tiers.HasValues) return false;
            foreach (var property in tiers.Properties()) if (property.Value.Value<int>() < 3) return false;
            return true;
        }
    }
}
