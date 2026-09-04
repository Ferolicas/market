using System;
using System.Threading.Tasks;
using MiniMarket.Core;
using MiniMarket.Customers;
using MiniMarket.Data;
using MiniMarket.Economy;
using MiniMarket.Employees;
using MiniMarket.Farm;
using MiniMarket.Inventory;
using MiniMarket.Networking;
using MiniMarket.Persistence;
using MiniMarket.Production;
using MiniMarket.Progression;
using MiniMarket.Store;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace MiniMarket.Tests
{
    public sealed class CoreSystemsTests
    {
        [Test]
        public void QueueCompactsWithoutDuplicatingCustomers()
        {
            var queue=new QueueSystem(3);Assert.That(queue.Reserve("a"),Is.EqualTo(0));Assert.That(queue.Reserve("b"),Is.EqualTo(1));Assert.That(queue.Reserve("a"),Is.EqualTo(0));
            Assert.That(queue.Release("a"),Is.True);Assert.That(queue.PositionOf("b"),Is.EqualTo(0));
        }

        [Test]
        public void RemotePersistenceCadenceIsExactlyThirtyMinutes()=>Assert.That(SaveCoordinator.RemoteSyncSeconds,Is.EqualTo(1800f));

        [Test]
        public async Task InventoryAndCheckoutUseExtractedNextEconomy()
        {
            var spec=new GameSpecRepository();await spec.LoadAsync();var signals=new GameSignals();var state=new GameStateDocument(spec.CreateInitialState(),signals);var inventory=new InventorySystem(state);var progression=new ProgressionSystem(state,spec,signals);var economy=new EconomySystem(state,spec,inventory,signals,progression);
            var before=state.BalanceMinor;inventory.Add("shelves","tomatoes",1);Assert.That(inventory.Consume("shelves","tomatoes",1),Is.True);
            var total=economy.Checkout(new System.Collections.Generic.Dictionary<string,int>{{"tomatoes",1}});Assert.That(total,Is.EqualTo(212));Assert.That(state.BalanceMinor,Is.EqualTo(before+212));
        }

        [Test]
        public async Task BuildProgressionRequiresFundingAndObjective()
        {
            var spec=new GameSpecRepository();await spec.LoadAsync();var signals=new GameSignals();var state=new GameStateDocument(spec.CreateInitialState(),signals);var progression=new ProgressionSystem(state,spec,signals);
            progression.Record("harvest:tomatoes",3);progression.Record("stock:tomatoes",3);progression.Record("customers",1);Assert.That(state.Level,Is.EqualTo(1));
            Assert.That(progression.ContributeToNextLevel(),Is.True);Assert.That(state.Level,Is.EqualTo(2));
        }

        [Test]
        public async Task PlayerCanAlwaysReturnCarryWithoutLosingItems()
        {
            var spec=new GameSpecRepository();await spec.LoadAsync();var signals=new GameSignals();var state=new GameStateDocument(spec.CreateInitialState(),signals);var inventory=new InventorySystem(state);var carry=new PlayerCarrySystem(state,inventory,signals);
            Assert.That(carry.Add("tomatoes",3),Is.EqualTo(3));Assert.That(carry.Free,Is.EqualTo(0));
            Assert.That(carry.ReturnAllToWarehouse(),Is.EqualTo(3));Assert.That(carry.Total,Is.EqualTo(0));Assert.That(inventory.Quantity("warehouse","tomatoes"),Is.EqualTo(3));
        }

        [Test]
        public async Task ProductAvailabilityIsConsistentAcrossCustomersAndMachines()
        {
            var spec=new GameSpecRepository();await spec.LoadAsync();var policy=new ProductAvailabilityPolicy(spec);
            Assert.That(policy.CanCustomerRequest("tomatoes",1),Is.True);Assert.That(policy.CanCustomerRequest("apples",1),Is.False);
            Assert.That(policy.CanCustomerRequest("apples",2),Is.True);Assert.That(policy.CanCustomerRequest("juice",4),Is.False);
            Assert.That(policy.IsMachineUnlocked("juice-machine-1",4),Is.False);Assert.That(policy.IsMachineUnlocked("juice-machine-1",21),Is.True);
            foreach(var product in policy.UnlockedCustomerProducts(30))Assert.That(policy.HasShelf(product),Is.True,$"Falta expositor para {product}");
        }

        [Test]
        public async Task LockedJuiceMachineCannotProduceAtLevelFour()
        {
            var spec=new GameSpecRepository();await spec.LoadAsync();var signals=new GameSignals();var state=new GameStateDocument(spec.CreateInitialState(),signals);state.Level=4;
            var inventory=new InventorySystem(state);var carry=new PlayerCarrySystem(state,inventory,signals);var policy=new ProductAvailabilityPolicy(spec);policy.ReconcileProgressionState(state);
            carry.Add("tomatoes",2);var production=new ProductionSystem(state,spec,inventory,carry,policy,signals);
            Assert.That(production.Operate("juice-machine-1"),Is.False);
        }

        [Test]
        public async Task FarmerPrioritizesWheatWhenBreadChainIsEmpty()
        {
            var spec=new GameSpecRepository();await spec.LoadAsync();var signals=new GameSignals();var state=new GameStateDocument(spec.CreateInitialState(),signals);state.Level=6;
            var policy=new ProductAvailabilityPolicy(spec);policy.ReconcileProgressionState(state);
            foreach(var token in state.Array("crops"))if(token is JObject crop&&policy.IsCropUnlocked(crop.Value<string>("id"),state.Level)){crop["status"]="READY";crop["available"]=3;}
            state.SetQuantity("shelves","bread",0);state.SetQuantity("warehouse","bread",0);state.SetQuantity("warehouse","flour",0);state.SetQuantity("warehouse","wheat",0);
            var planner=new SupplyDemandPlanner(state,spec,policy);Assert.That(planner.BestReadyCrop()?.Value<string>("productId"),Is.EqualTo("wheat"));
        }

        [Test]
        public async Task OperatorConvertsAvailableFlourToBreadBeforeMillingAgain()
        {
            var spec=new GameSpecRepository();await spec.LoadAsync();var signals=new GameSignals();var state=new GameStateDocument(spec.CreateInitialState(),signals);state.Level=6;
            var policy=new ProductAvailabilityPolicy(spec);policy.ReconcileProgressionState(state);
            state.SetQuantity("shelves","bread",0);state.SetQuantity("warehouse","bread",0);state.SetQuantity("warehouse","flour",1);state.SetQuantity("warehouse","wheat",4);
            var planner=new SupplyDemandPlanner(state,spec,policy);Assert.That(planner.BestMachineToStart()?.Value<string>("productId"),Is.EqualTo("bread"));
        }

        [Test]
        public async Task MissingBreadOutranksRepeatedTomatoHarvestAndThenYieldsFairly()
        {
            var spec=new GameSpecRepository();await spec.LoadAsync();var signals=new GameSignals();var state=new GameStateDocument(spec.CreateInitialState(),signals);state.Level=6;
            var policy=new ProductAvailabilityPolicy(spec);policy.ReconcileProgressionState(state);
            foreach(var token in state.Array("crops"))if(token is JObject crop&&policy.IsCropUnlocked(crop.Value<string>("id"),state.Level)){crop["status"]="READY";crop["available"]=3;}
            state.SetQuantity("shelves","tomatoes",0);state.SetQuantity("warehouse","tomatoes",0);state.SetQuantity("shelves","apples",policy.ShelfCapacity(state,"apples"));
            state.SetQuantity("shelves","bread",0);state.SetQuantity("warehouse","bread",0);state.SetQuantity("warehouse","flour",0);state.SetQuantity("warehouse","wheat",0);
            var planner=new SupplyDemandPlanner(state,spec,policy);
            Assert.That(planner.BestReadyCrop("tomatoes")?.Value<string>("productId"),Is.EqualTo("wheat"));
            state.SetQuantity("warehouse","wheat",6);
            Assert.That(planner.BestReadyCrop("wheat")?.Value<string>("productId"),Is.EqualTo("tomatoes"));
        }

        [Test]
        public async Task EveryCustomerProductHasShelfAndNeverUnlocksBeforeItsSource()
        {
            var spec=new GameSpecRepository();await spec.LoadAsync();var policy=new ProductAvailabilityPolicy(spec);
            foreach(var product in policy.UnlockedCustomerProducts(30))Assert.That(policy.HasShelf(product),Is.True,$"Sin expositor: {product}");
            Assert.That(policy.CustomerUnlockLevel("bread"),Is.GreaterThanOrEqualTo(policy.MachineUnlockLevel("bread-oven-1")));
            Assert.That(policy.CustomerUnlockLevel("eggs"),Is.GreaterThanOrEqualTo(policy.MachineUnlockLevel("chicken-coop-1")));
            Assert.That(policy.CustomerUnlockLevel("milk"),Is.GreaterThanOrEqualTo(policy.MachineUnlockLevel("cow-station-1")));
            Assert.That(policy.CustomerUnlockLevel("cheese"),Is.GreaterThanOrEqualTo(policy.MachineUnlockLevel("cheese-maker-1")));
            Assert.That(policy.CustomerUnlockLevel("juice"),Is.GreaterThanOrEqualTo(policy.MachineUnlockLevel("juice-machine-1")));
        }

        [Test]
        public async Task CloseDayMatchesOriginalPayrollOperationsTaxAndResetRules()
        {
            var spec=new GameSpecRepository();await spec.LoadAsync();var signals=new GameSignals();var state=new GameStateDocument(spec.CreateInitialState(),signals);var franchise=state.CurrentFranchise;
            state.BalanceMinor=500000;franchise["expansionLevel"]=2;franchise["checkoutLevel"]=3;franchise["revenueTodayMinor"]=100000;franchise["expensesTodayMinor"]=15000;
            state.Array("employees").Add(new JObject{{"salaryMinor",10000},{"energy",25}});state.Array("employees").Add(new JObject{{"salaryMinor",20000},{"energy",40}});
            new DaySystem(state,spec,signals).CloseDay();
            Assert.That(state.BalanceMinor,Is.EqualTo(444850));Assert.That(state.Day,Is.EqualTo(2));Assert.That(state.MinuteOfDay,Is.EqualTo(450));
            Assert.That(franchise.Value<long>("revenueTodayMinor"),Is.Zero);Assert.That(franchise.Value<long>("expensesTodayMinor"),Is.Zero);Assert.That(franchise.Value<int>("customersToday"),Is.Zero);
            Assert.That(franchise.Value<int>("licenseDaysLeft"),Is.EqualTo(6));Assert.That(franchise.Value<bool>("licenseActive"),Is.True);
            foreach(var employee in state.Array("employees"))Assert.That(employee.Value<double>("energy"),Is.EqualTo(100));
            var finances=(JObject)state.Root["finances"];Assert.That(finances.Value<long>("payrollMinor"),Is.EqualTo(39300));Assert.That(finances.Value<long>("operatingCostsMinor"),Is.EqualTo(5900));Assert.That(finances.Value<long>("taxesMinor"),Is.EqualTo(9950));
        }

        [Test]
        public async Task AcceleratedShopClockDoesNotFastForwardRealStationTimers()
        {
            var spec=new GameSpecRepository();await spec.LoadAsync();var signals=new GameSignals();var state=new GameStateDocument(spec.CreateInitialState(),signals);var before=state.SimulationTimeMs;
            new DaySystem(state,spec,signals).AdvanceMinutes(10);
            Assert.That(state.MinuteOfDay,Is.EqualTo(460));Assert.That(state.SimulationTimeMs,Is.EqualTo(before));Assert.That(state.Root.Value<long>("lastServerTime"),Is.EqualTo(600000));
        }

        [Test]
        public async Task DailyMissionProgressRewardsXpAndCanBeClaimedOnce()
        {
            var spec=new GameSpecRepository();await spec.LoadAsync();var signals=new GameSignals();var state=new GameStateDocument(spec.CreateInitialState(),signals);var progression=new ProgressionSystem(state,spec,signals);var before=state.BalanceMinor;
            progression.Record("harvest:all",3);var mission=(JObject)((JArray)state.Root["missions"])[2];
            Assert.That(mission.Value<bool>("completed"),Is.True);Assert.That(state.Xp,Is.EqualTo(54));Assert.That(progression.ClaimMission(mission.Value<string>("id")),Is.True);Assert.That(state.BalanceMinor,Is.EqualTo(before+19000));Assert.That(progression.ClaimMission(mission.Value<string>("id")),Is.False);
        }

        [Test]
        public async Task LevelNineAvailabilityIgnoresProductsThatAreStillLocked()
        {
            var spec=new GameSpecRepository();await spec.LoadAsync();var signals=new GameSignals();var state=new GameStateDocument(spec.CreateInitialState(),signals);state.Level=9;var policy=new ProductAvailabilityPolicy(spec);
            foreach(var id in policy.UnlockedCustomerProducts(10))state.SetQuantity("shelves",id,Math.Max(1,spec.ProductConfig[id]?["shelfCapacity"]?.Value<int>()??12));
            Assert.That(new ProgressionSystem(state,spec,signals).ObjectiveSatisfied(9),Is.True);
        }

        [Test]
        public async Task LedgerEventsMatchTheAuthoritativeBackendContract()
        {
            PlayerPrefs.DeleteKey("mini-market-unity-recovery-v1");PlayerPrefs.DeleteKey("mini-market-unity-session-v1");
            var spec=new GameSpecRepository();await spec.LoadAsync();var signals=new GameSignals();var saves=new SaveCoordinator(new MarketApiClient("http://127.0.0.1:9"),signals);var state=await saves.LoadAsync(spec);
            saves.QueueEvent("sales","Venta contractual",212);
            var domainEvent=(JObject)saves.PendingEventsSnapshot()[0];
            Assert.That(Guid.TryParse(domainEvent.Value<string>("eventId"),out _),Is.True);Assert.That(domainEvent.Value<int>("sequence"),Is.EqualTo(1));Assert.That(domainEvent.Value<string>("type"),Is.EqualTo("sales"));
            Assert.That(DateTimeOffset.TryParse(domainEvent.Value<string>("occurredAt"),out _),Is.True);Assert.That(domainEvent["payload"]?.Value<string>("scope"),Is.EqualTo("franchise"));
            Assert.That(state.Root.Value<int>("eventSequence"),Is.EqualTo(1));Assert.That(((JArray)state.Root["processedEventIds"])[0].Value<string>(),Is.EqualTo(domainEvent.Value<string>("eventId")));
            saves.Dispose();PlayerPrefs.DeleteKey("mini-market-unity-recovery-v1");PlayerPrefs.DeleteKey("mini-market-unity-session-v1");
        }

        [Test]
        public async Task SavedProgressReconcilesEveryOriginalUnlockAndAutomaticWorker()
        {
            var spec=new GameSpecRepository();await spec.LoadAsync();var signals=new GameSignals();var state=new GameStateDocument(spec.CreateInitialState(),signals);state.Level=30;
            var progression=new ProgressionSystem(state,spec,signals);progression.ReconcileAllUnlocks();var franchise=state.CurrentFranchise;
            Assert.That(franchise["unlockedAreas"].Values<string>(),Does.Contain("juice-machine"));
            Assert.That(franchise["unlockedAreas"].Values<string>(),Does.Contain("checkout-2"));
            Assert.That(franchise["unlockedAreas"].Values<string>(),Does.Contain("franchise-unlocked"));
            Assert.That(franchise["stationTiers"]["shelves-1"].Value<int>(),Is.GreaterThanOrEqualTo(3));
            Assert.That(franchise.Value<int>("storeRank"),Is.EqualTo(4));
            foreach(var role in new[]{"stocker","cashier","farmer","operator"})
            {
                var found=false;foreach(var employee in (JArray)franchise["employees"])if(employee.Value<string>("role")==role)found=true;
                Assert.That(found,Is.True,$"Falta contratación automática {role}");
            }
            var count=((JArray)franchise["employees"]).Count;progression.ReconcileAllUnlocks();Assert.That(((JArray)franchise["employees"]).Count,Is.EqualTo(count));
        }

        [Test]
        public async Task ExpiredLicenseCanBeRenewedWithTheOriginalPriceRule()
        {
            var spec=new GameSpecRepository();await spec.LoadAsync();var signals=new GameSignals();var state=new GameStateDocument(spec.CreateInitialState(),signals);var franchise=state.CurrentFranchise;
            franchise["licenseActive"]=false;franchise["licenseDaysLeft"]=0;franchise["expansionLevel"]=1;var before=state.BalanceMinor;
            var licenses=new LicenseSystem(state,spec,null,signals);Assert.That(licenses.RenewalCost,Is.EqualTo(48000));Assert.That(licenses.Renew(),Is.True);
            Assert.That(state.BalanceMinor,Is.EqualTo(before-48000));Assert.That(franchise.Value<int>("licenseDaysLeft"),Is.EqualTo(14));Assert.That(franchise.Value<bool>("licenseActive"),Is.True);
        }

        [Test]
        public async Task FranchisePurchaseAndTravelKeepBranchesIndependent()
        {
            var spec=new GameSpecRepository();await spec.LoadAsync();var signals=new GameSignals();var state=new GameStateDocument(spec.CreateInitialState(),signals);state.Level=5;state.BalanceMinor=2000000;
            var progression=new ProgressionSystem(state,spec,signals);var franchises=new FranchiseSystem(state,progression,null,signals);
            Assert.That(franchises.Buy("estacion"),Is.True);Assert.That(franchises.Travel("estacion"),Is.True);Assert.That(state.CurrentFranchise.Value<string>("id"),Is.EqualTo("estacion"));
            state.SetQuantity("warehouse","tomatoes",7);Assert.That(franchises.Travel("barrio"),Is.True);Assert.That(state.Quantity("warehouse","tomatoes"),Is.Not.EqualTo(7));
        }

        [Test]
        public async Task StationTiersApplyExactShelfCapacityAndPresentationValue()
        {
            var spec=new GameSpecRepository();await spec.LoadAsync();var signals=new GameSignals();var state=new GameStateDocument(spec.CreateInitialState(),signals);var policy=new ProductAvailabilityPolicy(spec);
            state.CurrentFranchise["stationTiers"]["shelves-1"]=2;
            Assert.That(policy.ShelfCapacity(state,"tomatoes"),Is.EqualTo(15));
            state.CurrentFranchise["stationTiers"]["shelves-1"]=6;
            var economy=new EconomySystem(state,spec,new InventorySystem(state),signals);
            Assert.That(economy.Checkout(new System.Collections.Generic.Dictionary<string,int>{{"tomatoes",1}}),Is.EqualTo(229));
        }

        [Test]
        public async Task StationSpeedAffectsProductionAndLevelAffectsCropGrowth()
        {
            var spec=new GameSpecRepository();await spec.LoadAsync();var signals=new GameSignals();var state=new GameStateDocument(spec.CreateInitialState(),signals);state.Level=6;
            var inventory=new InventorySystem(state);var carry=new PlayerCarrySystem(state,inventory,signals);var policy=new ProductAvailabilityPolicy(spec);policy.ReconcileProgressionState(state);
            state.CurrentFranchise["stationTiers"]["flour-mill-1"]=3;state.SetQuantity("warehouse","wheat",2);
            var production=new ProductionSystem(state,spec,inventory,carry,policy,signals);Assert.That(production.StartForWorker("flour-mill-1"),Is.True);
            JObject mill=null;foreach(var token in state.Array("productionMachines"))if(token.Value<string>("id")=="flour-mill-1")mill=(JObject)token;
            Assert.That(mill.Value<long>("completesAt")-mill.Value<long>("startedAt"),Is.EqualTo(3478));
            state.CurrentFranchise["stationTiers"]["crop-tomato-1"]=3;JObject crop=null;foreach(var token in state.Array("crops"))if(token.Value<string>("id")=="crop-tomato-1")crop=(JObject)token;
            crop["status"]="EMPTY";var farm=new FarmSystem(state,spec,inventory,carry,policy,signals);Assert.That(farm.TendOrHarvest("crop-tomato-1"),Is.True);
            Assert.That(crop.Value<long>("readyAt")-crop.Value<long>("plantedAt"),Is.EqualTo(3092));
        }

        [Test]
        public async Task PriorityStationUpgradeUsesAuthoritativeTierCostAndTarget()
        {
            var spec=new GameSpecRepository();await spec.LoadAsync();var signals=new GameSignals();var state=new GameStateDocument(spec.CreateInitialState(),signals);state.BalanceMinor=220000;
            var upgrades=new UpgradeSystem(state,spec,signals);Assert.That(upgrades.PriorityStationId(),Is.EqualTo("checkout-1"));Assert.That(upgrades.PriorityStationCost,Is.EqualTo(5000));
            Assert.That(upgrades.Upgrade("station"),Is.True);Assert.That(state.CurrentFranchise["stationTiers"]["checkout-1"].Value<int>(),Is.EqualTo(2));Assert.That(state.BalanceMinor,Is.EqualTo(215000));
        }

        [Test]
        public async Task ProgressiveUpgradeCategoriesModifyTheActualRuntimeValues()
        {
            var spec=new GameSpecRepository();await spec.LoadAsync();var signals=new GameSignals();var state=new GameStateDocument(spec.CreateInitialState(),signals);state.Level=12;state.BalanceMinor=1000000;
            var upgrades=new UpgradeSystem(state,spec,signals);
            var capacity=upgrades.Quote("player-capacity");Assert.That(capacity.CostMinor,Is.EqualTo(6500));Assert.That(upgrades.Contribute("player-capacity",capacity.RemainingMinor),Is.True);
            Assert.That(state.CurrentFranchise["carry"].Value<int>("capacity"),Is.EqualTo(5));
            var speed=upgrades.Quote("player-speed");Assert.That(speed.CostMinor,Is.EqualTo(7500));Assert.That(upgrades.Contribute("player-speed",speed.RemainingMinor),Is.True);
            Assert.That(state.CurrentFranchise.Value<int>("playerSpeedTier"),Is.EqualTo(2));
            var employee=upgrades.Quote("employee");Assert.That(employee.TargetId,Is.EqualTo("farmer"));Assert.That(upgrades.Contribute("employee",employee.RemainingMinor),Is.True);
            var found=false;foreach(var token in state.Array("employees"))if(token.Value<string>("role")=="farmer")found=true;Assert.That(found,Is.True);
        }

        [Test]
        public async Task AllThirtyLevelsKeepDemandCropsMachinesAndShelvesCoherent()
        {
            var spec=new GameSpecRepository();await spec.LoadAsync();var policy=new ProductAvailabilityPolicy(spec);
            for(var level=1;level<=30;level++)
            {
                var signals=new GameSignals();var state=new GameStateDocument(spec.CreateInitialState(),signals);state.Level=level;
                new ProgressionSystem(state,spec,signals).ReconcileAllUnlocks();policy.ReconcileProgressionState(state);
                foreach(var product in policy.UnlockedCustomerProducts(level))
                {
                    Assert.That(policy.IsProductUnlocked(product,level),Is.True,$"Nivel {level}: demanda sin producto {product}");
                    Assert.That(policy.HasShelf(product),Is.True,$"Nivel {level}: demanda sin expositor {product}");
                }
                foreach(var token in state.Array("crops"))
                {
                    var crop=(JObject)token;var unlocked=policy.IsCropUnlocked(crop.Value<string>("id"),level);
                    Assert.That(crop.Value<string>("status")=="LOCKED",Is.EqualTo(!unlocked),$"Nivel {level}: cultivo {crop.Value<string>("id")}");
                }
                foreach(var token in state.Array("productionMachines"))
                {
                    var machine=(JObject)token;var unlocked=policy.IsMachineUnlocked(machine.Value<string>("id"),level);
                    Assert.That(machine.Value<string>("status")=="LOCKED",Is.EqualTo(!unlocked),$"Nivel {level}: máquina {machine.Value<string>("id")}");
                }
            }
        }

        [Test]
        public async Task CompleteWheatBreadSaleDayAndReloadDataFlowPreservesEveryUnit()
        {
            var spec=new GameSpecRepository();await spec.LoadAsync();var signals=new GameSignals();var state=new GameStateDocument(spec.CreateInitialState(),signals);state.Level=6;
            var inventory=new InventorySystem(state);var carry=new PlayerCarrySystem(state,inventory,signals);var policy=new ProductAvailabilityPolicy(spec);var progression=new ProgressionSystem(state,spec,signals);progression.ReconcileAllUnlocks();policy.ReconcileProgressionState(state);
            var farm=new FarmSystem(state,spec,inventory,carry,policy,signals,progression);JObject wheat=null;foreach(var token in state.Array("crops"))if(token.Value<string>("id")=="crop-wheat-1")wheat=(JObject)token;
            wheat["status"]="READY";wheat["available"]=6;Assert.That(farm.HarvestForWorker("crop-wheat-1",2,out var harvestedId),Is.EqualTo(2));Assert.That(harvestedId,Is.EqualTo("wheat"));inventory.Add("warehouse",harvestedId,2);
            var production=new ProductionSystem(state,spec,inventory,carry,policy,signals,progression);Assert.That(production.StartForWorker("flour-mill-1"),Is.True);JObject mill=null;foreach(var token in state.Array("productionMachines"))if(token.Value<string>("id")=="flour-mill-1")mill=(JObject)token;production.Tick(mill.Value<long>("completesAt"));
            Assert.That(production.CollectForWorker("flour-mill-1",1,out var flourId),Is.EqualTo(1));inventory.Add("warehouse",flourId,1);Assert.That(flourId,Is.EqualTo("flour"));
            Assert.That(production.StartForWorker("bread-oven-1"),Is.True);JObject oven=null;foreach(var token in state.Array("productionMachines"))if(token.Value<string>("id")=="bread-oven-1")oven=(JObject)token;production.Tick(oven.Value<long>("completesAt"));
            Assert.That(production.CollectForWorker("bread-oven-1",1,out var breadId),Is.EqualTo(1));inventory.Add("warehouse",breadId,1);Assert.That(carry.PickupFromWarehouse(new[]{"bread"}),Is.EqualTo(1));
            Assert.That(carry.TransferToShelf("bread",policy.ShelfCapacity(state,"bread"),1),Is.EqualTo(1));Assert.That(inventory.Consume("shelves","bread",1),Is.True);
            var before=state.BalanceMinor;var sale=new EconomySystem(state,spec,inventory,signals,progression).Checkout(new System.Collections.Generic.Dictionary<string,int>{{"bread",1}});Assert.That(sale,Is.GreaterThan(0));Assert.That(state.BalanceMinor,Is.EqualTo(before+sale));
            var serialized=state.ToJson();var restored=new GameStateDocument(JObject.Parse(serialized),new GameSignals());Assert.That(restored.BalanceMinor,Is.EqualTo(state.BalanceMinor));Assert.That(restored.Quantity("warehouse","wheat"),Is.Zero);Assert.That(restored.Quantity("shelves","bread"),Is.Zero);
        }

        [Test]
        public async Task ShopClockDrainsOnlyOpenOwnedEmployeesAndDeliversToInactiveBranches()
        {
            var spec=new GameSpecRepository();await spec.LoadAsync();var signals=new GameSignals();var state=new GameStateDocument(spec.CreateInitialState(),signals);var primary=state.CurrentFranchise;
            primary["open"]=true;state.Array("employees").Add(new JObject{{"id","worker"},{"role","stocker"},{"energy",100}});
            JObject second=null;foreach(var token in (JArray)state.Root["franchises"])if(token.Value<string>("id")=="estacion")second=(JObject)token;second["owned"]=true;second["open"]=false;
            new DaySystem(state,spec,signals).AdvanceMinutes(10);Assert.That(state.Array("employees")[0].Value<double>("energy"),Is.EqualTo(98.5));
            ((JArray)state.Root["pendingOrders"]).Add(new JObject{{"id","other-order"},{"franchiseId","estacion"},{"productId","tomatoes"},{"quantity",7},{"arrivesAtMinute",state.MinuteOfDay}});
            var inventory=new InventorySystem(state);var policy=new ProductAvailabilityPolicy(spec);var progression=new ProgressionSystem(state,spec,signals);new OrderSystem(state,spec,inventory,policy,progression,signals).Tick();
            Assert.That(second["warehouse"].Value<int>("tomatoes"),Is.EqualTo(7));Assert.That(((JArray)state.Root["pendingOrders"]).Count,Is.Zero);
        }

        [Test]
        public async Task NewCompanySetupConvertsAllEconomicValuesAndLocksCountry()
        {
            var spec=new GameSpecRepository();await spec.LoadAsync();var signals=new GameSignals();var state=new GameStateDocument(spec.CreateInitialState(),signals);var beforeProject=state.Array("buildProjects")[0].Value<long>("costMinor");
            var setup=new CompanySetupSystem(state,spec,null,signals);Assert.That(setup.Required,Is.True);Assert.That(setup.Configure("CO"),Is.True);
            Assert.That(state.CountryCode,Is.EqualTo("CO"));Assert.That(state.Root.Value<string>("currency"),Is.EqualTo("COP"));Assert.That(state.BalanceMinor,Is.EqualTo(900000000));Assert.That(state.Root.Value<int>("tutorialStep"),Is.EqualTo(1));
            Assert.That(state.Array("buildProjects")[0].Value<long>("costMinor"),Is.EqualTo((long)Math.Round(beforeProject*900000000d/220000d,MidpointRounding.AwayFromZero)));
            Assert.That(setup.Configure("MX"),Is.False);Assert.That(state.CountryCode,Is.EqualTo("CO"));
        }
    }
}
