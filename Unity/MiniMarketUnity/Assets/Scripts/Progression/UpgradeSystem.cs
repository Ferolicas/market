using System;
using MiniMarket.Core;
using MiniMarket.Data;
using Newtonsoft.Json.Linq;

namespace MiniMarket.Progression
{
    public sealed class UpgradeSystem
    {
        static readonly int[] CapacityTiers={3,5,8,12,16,20};
        readonly GameStateDocument state;
        readonly GameSpecRepository spec;
        readonly GameSignals signals;
        readonly MiniMarket.Economy.GameLedger ledger;
        readonly ProgressionSystem progression;

        public sealed class QuoteData
        {
            public string Kind;
            public string TargetId;
            public string Label;
            public int CurrentTier;
            public int NextTier;
            public long CostMinor;
            public long ContributedMinor;
            public long RemainingMinor;
        }

        sealed class Target
        {
            public string Kind;
            public string Id;
            public string Label;
            public int Tier;
        }

        public UpgradeSystem(GameStateDocument document,GameSpecRepository repository,GameSignals gameSignals,
            MiniMarket.Economy.GameLedger gameLedger=null,ProgressionSystem progressionSystem=null)
        {state=document;spec=repository;signals=gameSignals;ledger=gameLedger;progression=progressionSystem;}

        /// <summary>Legacy construction actions retained for save/gameplay parity.</summary>
        public bool Upgrade(string id)
        {
            if(id=="station")return Contribute("station");
            var franchise=state.CurrentFranchise;int current;
            switch(id)
            {
                case "shelves":current=franchise.Value<int>("shelvesLevel");break;
                case "checkout":current=franchise.Value<int>("checkoutLevel");break;
                case "expansion":current=franchise.Value<int>("expansionLevel");break;
                default:return UpgradeStationDirect(id);
            }
            var hasBuilder=false;
            foreach(var employee in (JArray)franchise["employees"])if(employee.Value<string>("role")=="builder")hasBuilder=true;
            var cost=(long)Math.Round(spec.ScaleMoney(55000,state.CountryCode)*Math.Pow(current,1.65)*(hasBuilder ? .82 : 1),MidpointRounding.AwayFromZero);
            if(state.BalanceMinor<cost)return false;
            state.BalanceMinor-=cost;franchise["expensesTodayMinor"]=(franchise.Value<long?>("expensesTodayMinor")??0)+cost;franchise[id+"Level"]=current+1;
            if(franchise["stationTiers"] is JObject tiers)
            {
                if(id=="shelves")tiers["shelves-1"]=Math.Max(current+1,tiers.Value<int?>("shelves-1")??1);
                if(id=="checkout")tiers["checkout-1"]=Math.Max(current+1,tiers.Value<int?>("checkout-1")??1);
            }
            progression?.GainXp(80);ledger?.Record("capital",$"Obra y mejora: {id}",-cost);state.Changed();signals.PublishNotification($"{id}: nivel {current+1}");return true;
        }

        public QuoteData Quote(string kind)
        {
            var target=Resolve(kind);if(target==null)return null;
            var cost=UpgradeCost(target.Kind,target.Tier);
            var key=ContributionKey(target);
            var contributed=Contributions.Value<long?>(key)??0;
            return new QuoteData
            {
                Kind=kind,TargetId=target.Id,Label=target.Label,CurrentTier=target.Tier,
                NextTier=Math.Min(10,target.Tier+1),CostMinor=cost,ContributedMinor=contributed,
                RemainingMinor=Math.Max(0,cost-contributed),
            };
        }

        public bool Contribute(string kind,long requested=long.MaxValue)
        {
            var target=Resolve(kind);if(target==null)return false;
            var cost=UpgradeCost(target.Kind,target.Tier);var key=ContributionKey(target);
            var contributed=Contributions.Value<long?>(key)??0;
            var amount=Math.Min(Math.Min(Math.Max(0,requested),Math.Max(0,cost-contributed)),state.BalanceMinor);
            if(amount<=0)return false;
            state.BalanceMinor-=amount;state.CurrentFranchise["expensesTodayMinor"]=(state.CurrentFranchise.Value<long?>("expensesTodayMinor")??0)+amount;
            var total=contributed+amount;Contributions[key]=total;ledger?.Record("upgrade",$"Aporte {target.Label}",-amount);
            if(total>=cost)
            {
                Apply(target);Contributions.Property(key)?.Remove();signals.PublishNotification($"{target.Label}: nivel {target.Tier+1} completado");
            }
            else signals.PublishNotification($"{target.Label}: {(int)Math.Floor(total/(double)cost*100)} % financiado");
            state.Changed();return true;
        }

        public string PriorityStationId()=>Resolve("station")?.Id;
        public long PriorityStationCost=>Quote("station")?.RemainingMinor??0;

        JObject Contributions
        {
            get
            {
                if(state.CurrentFranchise["upgradeContributions"] is not JObject value)state.CurrentFranchise["upgradeContributions"]=value=new JObject();
                return value;
            }
        }

        Target Resolve(string kind)
        {
            var franchise=state.CurrentFranchise;
            if(kind=="station")
            {
                if(franchise["stationTiers"] is not JObject tiers)return null;
                string selected=null;var selectedTier=int.MaxValue;
                foreach(var property in tiers.Properties())
                {
                    var tier=property.Value.Value<int>();if(tier>=10)continue;
                    if(tier<selectedTier||(tier==selectedTier&&(selected==null||string.CompareOrdinal(property.Name,selected)<0))){selected=property.Name;selectedTier=tier;}
                }
                return selected==null?null:new Target{Kind="station",Id=selected,Label=StationLabel(selected),Tier=selectedTier};
            }
            if(kind=="player-speed")
            {
                var tier=Math.Max(1,franchise.Value<int?>("playerSpeedTier")??1);
                return state.Level>=12&&tier<10?new Target{Kind=kind,Id=kind,Label="Velocidad del vendedor",Tier=tier}:null;
            }
            if(kind=="player-capacity")
            {
                var tier=CapacityTier(franchise["carry"]?.Value<int?>("capacity")??3);
                return state.Level>=3&&tier<CapacityTiers.Length?new Target{Kind=kind,Id=kind,Label="Capacidad de carga",Tier=tier}:null;
            }
            if(kind!="employee")return null;
            var roles=spec.Root["catalog"]?["ROLE_INFO"] as JObject;
            var employees=state.Array("employees");
            if(roles!=null)
            {
                foreach(var role in roles.Properties())
                {
                    if(state.Level<(role.Value.Value<int?>("unlockLevel")??int.MaxValue))continue;
                    var found=false;foreach(var employee in employees)if(employee.Value<string>("role")==role.Name){found=true;break;}
                    if(!found)return new Target{Kind="hire",Id=role.Name,Label=$"Contratación: {role.Value.Value<string>("name")}",Tier=0};
                }
            }
            JObject selectedEmployee=null;
            foreach(var token in employees)
            {
                if(token is not JObject employee||(employee.Value<int?>("level")??1)>=10)continue;
                if(selectedEmployee==null||(employee.Value<int?>("level")??1)<(selectedEmployee.Value<int?>("level")??1)||
                   ((employee.Value<int?>("level")??1)==(selectedEmployee.Value<int?>("level")??1)&&string.CompareOrdinal(employee.Value<string>("id"),selectedEmployee.Value<string>("id"))<0))selectedEmployee=employee;
            }
            return selectedEmployee==null?null:new Target{Kind="employee",Id=selectedEmployee.Value<string>("id"),Label=$"Formación de {selectedEmployee.Value<string>("name")}",Tier=selectedEmployee.Value<int?>("level")??1};
        }

        long UpgradeCost(string kind,int tier)
        {
            var baseCost=kind switch{"station"=>5000d,"player-speed"=>7500d,"player-capacity"=>6500d,_=>8000d};
            return spec.ScaleMoney(baseCost*Math.Pow(Math.Max(1,tier),1.55),state.CountryCode);
        }

        static string ContributionKey(Target target)=>$"{(target.Kind=="hire"?"employee":target.Kind)}:{target.Id}:{target.Tier+1}";

        void Apply(Target target)
        {
            var franchise=state.CurrentFranchise;var next=Math.Min(10,target.Tier+1);
            if(target.Kind=="station"){ApplyStation(target.Id,next);return;}
            if(target.Kind=="player-speed"){franchise["playerSpeedTier"]=next;return;}
            if(target.Kind=="player-capacity")
            {
                if(target.Tier<CapacityTiers.Length){franchise["playerCapacityTier"]=target.Tier+1;franchise["carry"]["capacity"]=CapacityTiers[target.Tier];}
                return;
            }
            if(target.Kind=="employee")
            {
                foreach(var employee in state.Array("employees"))if(employee.Value<string>("id")==target.Id){employee["level"]=next;break;}
                return;
            }
            Hire(target.Id);
        }

        void ApplyStation(string id,int next)
        {
            var franchise=state.CurrentFranchise;if(franchise["stationTiers"] is not JObject tiers)return;tiers[id]=next;
            foreach(var token in state.Array("crops"))if(token.Value<string>("id")==id)token["tier"]=next;
            foreach(var token in state.Array("productionMachines"))if(token.Value<string>("id")==id)
            {
                token["tier"]=next;var product=token.Value<string>("productId");var baseCapacity=spec.ProductConfig[product]?["shelfCapacity"]?.Value<int>()??8;
                token["outputCapacity"]=Math.Max(token.Value<int?>("output")??0,(int)Math.Round(baseCapacity*StationTierRules.Capacity(next),MidpointRounding.AwayFromZero));
            }
            if(id=="checkout-1")franchise["checkoutLevel"]=next;
            if(id=="shelves-1")franchise["shelvesLevel"]=next;
        }

        bool UpgradeStationDirect(string id)
        {
            if(state.CurrentFranchise["stationTiers"] is not JObject tiers||tiers[id]==null)return false;
            var current=tiers.Value<int?>(id)??1;if(current>=10)return false;
            var cost=UpgradeCost("station",current);if(state.BalanceMinor<cost)return false;
            state.BalanceMinor-=cost;state.CurrentFranchise["expensesTodayMinor"]=(state.CurrentFranchise.Value<long?>("expensesTodayMinor")??0)+cost;
            ApplyStation(id,current+1);ledger?.Record("upgrade",$"Mejora de estación: {id}",-cost);state.Changed();signals.PublishNotification($"Estación mejorada a nivel {current+1}");return true;
        }

        void Hire(string role)
        {
            var employees=state.Array("employees");var index=employees.Count;var names=spec.Root["catalog"]?["EMPLOYEE_NAMES"] as JArray;var hats=spec.Root["catalog"]?["HATS"] as JArray;
            var roleInfo=spec.Root["catalog"]?["ROLE_INFO"]?[role];var salary=spec.ScaleMoney(roleInfo?["salaryMinor"]?.Value<long>()??0,state.CountryCode);
            employees.Add(new JObject
            {
                ["id"]=Guid.NewGuid().ToString("N"),["name"]=names!=null&&names.Count>0?names[index%names.Count].Value<string>():$"Empleado {index+1}",
                ["role"]=role,["level"]=1,["salaryMinor"]=salary,["energy"]=100,["hat"]=hats!=null&&hats.Count>0?hats[index%hats.Count]?["id"]?.Value<string>():"none",
            });
        }

        static int CapacityTier(int capacity)
        {
            var tier=1;for(var i=1;i<CapacityTiers.Length;i++){if(capacity<CapacityTiers[i])break;tier=i+1;}return tier;
        }

        string StationLabel(string id)
        {
            return id switch
            {
                "shelves-1"=>"Expositores de venta","checkout-1"=>"Caja principal","checkout-2"=>"Caja secundaria",
                "flour-mill-1"=>"Molino de harina","bread-oven-1"=>"Horno de pan","chicken-coop-1"=>"Gallinero",
                "cow-station-1"=>"Estación de leche","cheese-maker-1"=>"Quesera","juice-machine-1"=>"Máquina de zumo",
                _=>CropLabel(id),
            };
        }

        string CropLabel(string id)
        {
            foreach(var crop in state.Array("crops"))if(crop.Value<string>("id")==id)
            {
                var product=crop.Value<string>("productId");var name=spec.Products[product]?["name"]?.Value<string>()??product;return $"Bancal de {name.ToLowerInvariant()}";
            }
            return "Estación prioritaria";
        }
    }
}
