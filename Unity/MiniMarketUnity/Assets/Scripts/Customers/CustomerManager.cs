using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using MiniMarket.Animations;
using MiniMarket.Assets;
using MiniMarket.Characters;
using MiniMarket.Core;
using MiniMarket.Data;
using MiniMarket.Economy;
using MiniMarket.Inventory;
using MiniMarket.Performance;
using MiniMarket.Store;
using MiniMarket.Progression;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace MiniMarket.Customers
{
    public sealed class CustomerManager : MonoBehaviour
    {
        enum Phase { Entering, Shopping, Picking, Queueing, Waiting, Unloading, Scanning, Bagging, Paying, Leaving }
        sealed class Mind
        {
            public CustomerAgent Agent;
            public string CharacterId;
            public Phase Phase;
            public string Product;
            public readonly List<string> ShoppingList = new();
            public int ShoppingIndex;
            public readonly Dictionary<string, int> Basket = new();
            public float Since;
            public int QueueSlot = -1;
            public long QueueJoinedAt = -1;
            public int RequestedUnits;
            public CustomerBasketVisual BasketVisual;
            public readonly List<string> CheckoutUnits=new();
            public int CheckoutIndex;
            public int CheckoutLane;
            public CheckoutFlowVisual CheckoutFlow;
        }

        static readonly string[] CharacterIds = { "CustomerFemale01", "CustomerFemale02", "CustomerFemale03", "CustomerMale01", "CustomerMale02" };
        readonly List<Mind> customers = new();
        readonly Dictionary<string,Stack<CharacterActor>> pools = new(StringComparer.OrdinalIgnoreCase);
        CharacterFactory factory;
        RuntimeGltfLoader loader;
        StoreWorld world;
        GameStateDocument state;
        GameSpecRepository spec;
        InventorySystem inventory;
        EconomySystem economy;
        GameSignals signals;
        PerformanceGovernor performance;
        ProgressionSystem progression;
        ProductAvailabilityPolicy availability;
        readonly List<QueueSystem> queues=new();
        float spawnAt;
        float decisionAt;
        int sequence;
        bool spawning;
        int generation;
        readonly List<CheckoutFlowVisual> checkoutFlows=new();
        public int ActiveCount => customers.Count;

        public void Bind(CharacterFactory characterFactory, RuntimeGltfLoader runtimeLoader, StoreWorld storeWorld, GameStateDocument document,
            GameSpecRepository repository, InventorySystem inventorySystem, EconomySystem economySystem,
            ProductAvailabilityPolicy productAvailability, GameSignals gameSignals, PerformanceGovernor governor, ProgressionSystem progressionSystem)
        {
            factory = characterFactory;loader=runtimeLoader; world = storeWorld; state = document; spec = repository;
            inventory = inventorySystem; economy = economySystem; signals = gameSignals; performance = governor;
            progression = progressionSystem;
            availability = productAvailability;
            queues.Clear();checkoutFlows.Clear();
            for(var lane=0;lane<world.CheckoutQueuePoints.Count;lane++)
            {
                queues.Add(new QueueSystem(world.CheckoutQueuePoints[lane].Count));var flow=gameObject.AddComponent<CheckoutFlowVisual>();flow.Bind(loader,world,lane);checkoutFlows.Add(flow);
            }
            spawnAt = Time.time + 2f;
        }

        void Update()
        {
            if (state == null) return;
            var open = state.CurrentFranchise.Value<bool?>("open") ?? false;
            if (open && !spawning && customers.Count < MaximumCustomers() && Time.time >= spawnAt)
            {
                spawnAt = Time.time + Mathf.Lerp(10f, 4.5f, Mathf.InverseLerp(1, 30, state.Level));
                _ = SpawnAsync();
            }
            if (Time.time < decisionAt) return;
            decisionAt = Time.time + (performance ? performance.DecisionTickSeconds : .75f);
            for (var i = customers.Count - 1; i >= 0; i--) Step(customers[i]);
        }

        int MaximumCustomers() => Mathf.Clamp(4 + state.Level / 3, 4, Application.isMobilePlatform ? 14 : 22);

        async Task SpawnAsync()
        {
            spawning = true;var expectedGeneration=generation;
            try
            {
                var characterId = CharacterIds[sequence % CharacterIds.Length];
                var customerId = $"customer-unity-{++sequence}";
                CharacterActor actor;
                if(pools.TryGetValue(characterId,out var pool)&&pool.Count>0)
                {
                    actor=pool.Pop();actor.transform.position=world.EntranceOutside.position;actor.transform.rotation=Quaternion.identity;actor.gameObject.SetActive(true);actor.ResetExpressions();actor.Play("Idle",0);
                }
                else actor = await factory.CreateAsync(characterId, transform, world.EntranceOutside.position, true);
                if(expectedGeneration!=generation){Pool(characterId,actor);return;}
                var agent = actor.GetComponent<CustomerAgent>();if(!agent)agent=actor.gameObject.AddComponent<CustomerAgent>();
                agent.Bind(customerId, actor);
                var basket=actor.GetComponent<CustomerBasketVisual>();if(!basket)basket=actor.gameObject.AddComponent<CustomerBasketVisual>();await basket.BindAsync(loader,actor);
                if(expectedGeneration!=generation){agent.PrepareForPool();basket.ResetForPool();Pool(characterId,actor);return;}
                agent.transform.rotation = Quaternion.Euler(0, 180, 0);
                var mind = new Mind { Agent = agent, CharacterId=characterId, BasketVisual=basket, Phase = Phase.Entering, Since = Time.time };
                customers.Add(mind);
                agent.GoTo(world.EntranceInside.position);
                Debug.Log($"MINIMARKET_CUSTOMER spawned={customerId} body={characterId} active={customers.Count}");
            }
            catch (Exception exception) { Debug.LogException(exception); }
            finally { if(expectedGeneration==generation)spawning = false; }
        }

        void Step(Mind mind)
        {
            if (!mind.Agent) { customers.Remove(mind); return; }
            if (mind.QueueJoinedAt >= 0 && mind.Phase is Phase.Queueing or Phase.Waiting && state.SimulationTimeMs - mind.QueueJoinedAt >= 300_000)
            {
                AbandonQueue(mind); return;
            }
            switch (mind.Phase)
            {
                case Phase.Entering:
                    if (mind.Agent.Arrived) BuildShoppingList(mind);
                    break;
                case Phase.Shopping:
                    if (mind.Agent.Arrived) { mind.Phase = Phase.Picking; mind.Since = Time.time; mind.Agent.Play("PickupLow"); }
                    break;
                case Phase.Picking:
                    if (Time.time - mind.Since >= 1.05f) Pick(mind);
                    break;
                case Phase.Queueing:
                    UpdateQueueTarget(mind);
                    if (mind.QueueSlot == 0 && mind.Agent.Arrived) { mind.Phase = Phase.Waiting; mind.Since = Time.time; mind.Agent.Play("Queue"); }
                    break;
                case Phase.Waiting:
                    if (QueueFor(mind).PositionOf(mind.Agent.CustomerId) != 0) { mind.Phase = Phase.Queueing; break; }
                    if (Time.time - mind.Since >= 1.2f && HasCashier(mind.CheckoutLane)) BeginCheckout(mind);
                    break;
                case Phase.Unloading:
                    if(Time.time-mind.Since>=.9f&&mind.CheckoutFlow.UnitReady){mind.CheckoutFlow.MoveToScanner();mind.Agent.Play("CheckoutScan");mind.Phase=Phase.Scanning;mind.Since=Time.time;}
                    break;
                case Phase.Scanning:
                    if(Time.time-mind.Since>=ScanSeconds(mind.CheckoutLane)){mind.CheckoutFlow.BagUnit();mind.Agent.Play("CheckoutItem");mind.Phase=Phase.Bagging;mind.Since=Time.time;}
                    break;
                case Phase.Bagging:
                    if(Time.time-mind.Since>=.65f)AdvanceCheckout(mind);
                    break;
                case Phase.Paying:
                    if (Time.time - mind.Since >= 1.8f) PayAndLeave(mind);
                    break;
                case Phase.Leaving:
                    if (mind.Agent.Arrived) Release(mind);
                    break;
            }
        }

        void BuildShoppingList(Mind mind)
        {
            var choices = new List<string>();
            foreach (var id in availability.UnlockedCustomerProducts(state.Level))
                if (inventory.Quantity("shelves", id) > 0 && world.ProductServicePoints.ContainsKey(id)) choices.Add(id);
            if (choices.Count == 0)
            {
                mind.Agent.Play("Tripo_Angry"); mind.Agent.Expression("Frown", 55);
                mind.Phase = Phase.Leaving; mind.Agent.GoTo(world.ExitPoint.position); return;
            }
            for(var i=choices.Count-1;i>0;i--){var j=UnityEngine.Random.Range(0,i+1);(choices[i],choices[j])=(choices[j],choices[i]);}
            var desired=Mathf.Clamp(1+state.Level/8,1,5);
            for(var i=0;i<Mathf.Min(desired,choices.Count);i++)mind.ShoppingList.Add(choices[i]);
            mind.RequestedUnits=mind.ShoppingList.Count;
            mind.ShoppingIndex=0;mind.Product=mind.ShoppingList[0];
            mind.Phase = Phase.Shopping;
            mind.Agent.Play("Browse");
            mind.Agent.GoTo(world.ServicePoint(mind.Product).position);
        }

        void Pick(Mind mind)
        {
            if (inventory.Consume("shelves", mind.Product, 1))
            {
                mind.Basket[mind.Product] = mind.Basket.TryGetValue(mind.Product, out var quantity) ? quantity + 1 : 1;
                mind.BasketVisual?.AddProduct(mind.Product);
            }
            mind.ShoppingIndex++;
            while(mind.ShoppingIndex<mind.ShoppingList.Count&&inventory.Quantity("shelves",mind.ShoppingList[mind.ShoppingIndex])<1)mind.ShoppingIndex++;
            if(mind.ShoppingIndex<mind.ShoppingList.Count)
            {
                mind.Product=mind.ShoppingList[mind.ShoppingIndex];mind.Phase=Phase.Shopping;mind.Agent.Play("Browse");mind.Agent.GoTo(world.ServicePoint(mind.Product).position);return;
            }
            if(mind.Basket.Count==0){mind.Phase=Phase.Leaving;mind.Agent.Play("Tripo_LookAround");mind.Agent.GoTo(world.ExitPoint.position);return;}
            mind.CheckoutLane=ChooseLane();mind.QueueSlot = queues[mind.CheckoutLane].Reserve(mind.Agent.CustomerId);
            if (mind.QueueSlot < 0) { PenalizeRating(); ReturnBasket(mind); mind.Agent.Play("Impatient"); mind.Phase = Phase.Leaving; mind.Agent.GoTo(world.ExitPoint.position); return; }
            mind.QueueJoinedAt=state.SimulationTimeMs;
            mind.Phase = Phase.Queueing;
            UpdateQueueTarget(mind);
        }

        void UpdateQueueTarget(Mind mind)
        {
            var queue=QueueFor(mind);mind.QueueSlot = queue.PositionOf(mind.Agent.CustomerId);
            if (mind.QueueSlot < 0) return;
            var lanePoints=world.CheckoutQueuePoints[mind.CheckoutLane];var point = mind.QueueSlot == 0 ? world.CheckoutPoints[mind.CheckoutLane] : lanePoints[Mathf.Min(mind.QueueSlot - 1, lanePoints.Count - 1)];
            if (Vector3.SqrMagnitude(mind.Agent.transform.position - point.position) > .12f) mind.Agent.GoTo(point.position);
        }

        void PayAndLeave(Mind mind)
        {
            var picked=0;foreach(var item in mind.Basket)picked+=item.Value;
            var fulfillment=mind.RequestedUnits>0?picked/(double)mind.RequestedUnits:1;
            var queueSeconds=mind.QueueJoinedAt<0?0:Math.Max(0,(state.SimulationTimeMs-mind.QueueJoinedAt)/1000d);
            var total = economy.Checkout(mind.Basket,fulfillment,queueSeconds);
            if(mind.Basket.Count>=5)progression.Record("lists:five");
            QueueFor(mind).Release(mind.Agent.CustomerId);
            mind.QueueJoinedAt=-1;
            var franchise = state.CurrentFranchise;
            franchise["customersToday"] = (franchise.Value<int?>("customersToday") ?? 0) + 1;
            state.Changed();
            signals.PublishNotification($"Cliente atendido · +{total}");
            Debug.Log($"MINIMARKET_CHECKOUT customer={mind.Agent.CustomerId} totalMinor={total} balanceMinor={state.BalanceMinor}");
            mind.CheckoutFlow?.EndSession();
            mind.Agent.Expression("Smile", 62); mind.Agent.Play("Tripo_Goodbye");
            mind.Phase = Phase.Leaving; mind.Agent.GoTo(world.ExitPoint.position);
        }

        public bool ServeNext()
        {
            for(var lane=0;lane<queues.Count;lane++)if(ServeLane(lane))return true;
            signals.PublishNotification("Todavía no hay un cliente listo en caja");return false;
        }
        public bool ServeLane(int lane)
        {
            if(lane<0||lane>=queues.Count)return false;
            foreach(var mind in customers)if(mind.CheckoutLane==lane&&queues[lane].PositionOf(mind.Agent.CustomerId)==0&&mind.Phase==Phase.Waiting){BeginCheckout(mind);return true;}
            return false;
        }

        public void LogCustomerState()
        {
            var counts=new Dictionary<string,int>();
            foreach(var mind in customers){var key=mind.Phase.ToString();counts[key]=counts.TryGetValue(key,out var value)?value+1:1;}
            Debug.Log("MINIMARKET_CUSTOMERS active="+customers.Count+" phases="+string.Join(",",counts));
        }

        void BeginCheckout(Mind mind)
        {
            mind.CheckoutUnits.Clear();foreach(var item in mind.Basket)for(var unit=0;unit<item.Value;unit++)mind.CheckoutUnits.Add(item.Key);
            mind.CheckoutIndex=0;mind.CheckoutFlow=checkoutFlows[mind.CheckoutLane];mind.CheckoutFlow.BeginSession();BeginCheckoutUnit(mind);
        }
        void BeginCheckoutUnit(Mind mind)
        {
            if(mind.CheckoutIndex>=mind.CheckoutUnits.Count){mind.Phase=Phase.Paying;mind.Since=Time.time;mind.Agent.Play("Pay");return;}
            var product=mind.CheckoutUnits[mind.CheckoutIndex];mind.BasketVisual?.RemoveProduct(product);mind.CheckoutFlow.BeginUnit(product);mind.Agent.Play("CheckoutItem");mind.Phase=Phase.Unloading;mind.Since=Time.time;
        }
        void AdvanceCheckout(Mind mind){mind.CheckoutIndex++;BeginCheckoutUnit(mind);}
        float ScanSeconds(int lane)
        {
            var tier=StationTierRules.Tier(state,$"checkout-{lane+1}",state.CurrentFranchise.Value<int?>("checkoutLevel")??1);
            return .7f/(float)StationTierRules.Speed(tier);
        }
        void ReturnBasket(Mind mind){foreach(var item in mind.Basket)inventory.Add("warehouse",item.Key,item.Value);mind.Basket.Clear();}
        void AbandonQueue(Mind mind)
        {
            QueueFor(mind).Release(mind.Agent.CustomerId);mind.QueueSlot=-1;mind.QueueJoinedAt=-1;ReturnBasket(mind);PenalizeRating();
            mind.Agent.Expression("Frown",65);mind.Agent.Play("Tripo_Angry");mind.Phase=Phase.Leaving;mind.Agent.GoTo(world.ExitPoint.position);
            signals.PublishNotification("Un cliente abandonó la cola tras esperar demasiado");
        }
        void PenalizeRating(){var franchise=state.CurrentFranchise;franchise["rating"]=Math.Round(Math.Max(1,(franchise.Value<double?>("rating")??3.5)-.15),2);state.Changed();}
        bool HasCashier(int lane){var count=0;foreach(var employee in state.Array("employees"))if(employee.Value<string>("role")=="cashier")count++;return count>lane;}
        QueueSystem QueueFor(Mind mind)=>queues[Mathf.Clamp(mind.CheckoutLane,0,queues.Count-1)];
        int ChooseLane()
        {
            var available=SecondCheckoutUnlocked()?Math.Min(2,queues.Count):1;var selected=0;for(var lane=1;lane<available;lane++)if(queues[lane].Count<queues[selected].Count)selected=lane;return selected;
        }
        bool SecondCheckoutUnlocked(){if(state.CurrentFranchise["unlockedAreas"] is not JArray areas)return false;return areas.Contains("checkout-2");}

        void Release(Mind mind)
        {
            QueueFor(mind).Release(mind.Agent.CustomerId);customers.Remove(mind);mind.Agent.PrepareForPool();mind.BasketVisual?.ResetForPool();mind.CheckoutFlow?.EndSession();
            var actor=mind.Agent.GetComponent<CharacterActor>();
            Pool(mind.CharacterId,actor);
        }

        void Pool(string characterId,CharacterActor actor)
        {
            if(!actor)return;if(!pools.TryGetValue(characterId,out var pool))pools[characterId]=pool=new Stack<CharacterActor>();
            if(pool.Count<5){actor.gameObject.SetActive(false);pool.Push(actor);}else Destroy(actor.gameObject);
        }

        public void ResetForFranchise()
        {
            generation++;foreach(var flow in checkoutFlows)flow.EndSession();var snapshot=customers.ToArray();foreach(var mind in snapshot)Release(mind);customers.Clear();for(var lane=0;lane<queues.Count;lane++)queues[lane]=new QueueSystem(world.CheckoutQueuePoints[lane].Count);spawning=false;spawnAt=Time.time+1f;decisionAt=0;
        }
    }
}
