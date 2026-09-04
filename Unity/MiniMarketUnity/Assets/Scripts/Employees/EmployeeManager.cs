using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using MiniMarket.Characters;
using MiniMarket.Assets;
using MiniMarket.Core;
using MiniMarket.Data;
using MiniMarket.Farm;
using MiniMarket.Inventory;
using MiniMarket.Performance;
using MiniMarket.Production;
using MiniMarket.Progression;
using MiniMarket.Store;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace MiniMarket.Employees
{
    public sealed class EmployeeManager : MonoBehaviour
    {
        enum WorkPhase { Idle, GoingToPickup, Picking, GoingToDropoff, Dropping }
        enum WorkKind { None, Harvest, Stock, CollectOutput, StartMachine }

        sealed class Mind
        {
            public JObject Data;
            public EmployeeAgent Agent;
            public WorkPhase Phase;
            public WorkKind Kind;
            public string Product;
            public string Station;
            public int Amount;
            public float Since;
            public EmployeeCarryVisual CarryVisual;
        }

        static readonly string[] Bodies={"AdultFemale","Boy","Girl","AdultMale"};
        static readonly Dictionary<string,Vector3> Homes=new()
        {
            ["farmer"]=new Vector3(-3.4f,0,-23.4f),["operator"]=new Vector3(-9.6f,0,-1.8f),["stocker"]=new Vector3(0,0,-4.4f),
            ["cashier"]=new Vector3(9.4f,0,4.4f),["builder"]=new Vector3(5.8f,0,-9f),["manager"]=new Vector3(10.8f,0,-7.2f),
        };

        readonly Dictionary<string,Mind> minds=new();
        CharacterFactory factory; RuntimeGltfLoader loader; StoreWorld world; GameStateDocument state; GameSpecRepository spec; InventorySystem inventory;
        FarmSystem farm; ProductionSystem production; ProductAvailabilityPolicy availability;
        PerformanceGovernor performance; ProgressionSystem progression; SupplyDemandPlanner planner;
        bool reconciling; float reconcileAt; float decisionAt; string lastCropProduct;
        int generation;

        public void Bind(CharacterFactory characterFactory,RuntimeGltfLoader runtimeLoader,StoreWorld storeWorld,GameStateDocument document,GameSpecRepository repository,
            InventorySystem inventorySystem,FarmSystem farmSystem,ProductionSystem productionSystem,ProductAvailabilityPolicy productAvailability,
            GameSignals gameSignals,PerformanceGovernor governor,ProgressionSystem progressionSystem)
        {
            factory=characterFactory;loader=runtimeLoader;world=storeWorld;state=document;spec=repository;inventory=inventorySystem;farm=farmSystem;
            production=productionSystem;availability=productAvailability;performance=governor;progression=progressionSystem;
            planner=new SupplyDemandPlanner(state,spec,availability);_ = ReconcileAsync();
        }

        void Update()
        {
            if(state==null)return;
            if(Time.time>=reconcileAt){reconcileAt=Time.time+1f;if(!reconciling)_ = ReconcileAsync();}
            if(Time.time<decisionAt)return;
            decisionAt=Time.time+(performance?performance.DecisionTickSeconds:.65f);
            foreach(var mind in minds.Values)Step(mind);
        }

        async Task ReconcileAsync()
        {
            reconciling=true;var expectedGeneration=generation;
            try
            {
                var index=0;
                foreach(var token in state.Array("employees"))
                {
                    if(token is not JObject employee)continue;
                    var id=employee.Value<string>("id");if(string.IsNullOrWhiteSpace(id)||minds.ContainsKey(id)){index++;continue;}
                    var role=employee.Value<string>("role")??"stocker";
                    var actor=await factory.CreateAsync(Bodies[index%Bodies.Length],transform,Homes.TryGetValue(role,out var home)?home:Vector3.zero,true);
                    if(expectedGeneration!=generation){Destroy(actor.gameObject);return;}
                    actor.gameObject.name=$"Employee_{employee.Value<string>("name")}_{role}";
                    var agent=actor.gameObject.AddComponent<EmployeeAgent>();agent.Bind(actor);actor.Play("Idle");
                    var carryVisual=actor.gameObject.AddComponent<EmployeeCarryVisual>();carryVisual.Bind(loader,actor);
                    minds[id]=new Mind{Data=employee,Agent=agent,CarryVisual=carryVisual,Phase=WorkPhase.Idle,Since=Time.time};index++;
                }
            }
            catch(Exception exception){Debug.LogWarning($"Empleados: {exception.Message}");}
            finally{if(expectedGeneration==generation)reconciling=false;}
        }

        public void ResetForFranchise()
        {
            generation++;foreach(var mind in minds.Values)if(mind.Agent)Destroy(mind.Agent.gameObject);minds.Clear();reconciling=false;lastCropProduct=null;reconcileAt=0;decisionAt=0;_ = ReconcileAsync();
        }

        void Step(Mind mind)
        {
            if(!mind.Agent)return;
            switch(mind.Phase)
            {
                case WorkPhase.Idle:
                    if(Time.time-mind.Since>=.45f)Assign(mind);
                    break;
                case WorkPhase.GoingToPickup:
                    if(mind.Agent.Arrived){mind.Phase=WorkPhase.Picking;mind.Since=Time.time;mind.Agent.Play(PickAnimation(mind.Kind));}
                    break;
                case WorkPhase.Picking:
                    if(Time.time-mind.Since>=.55f)Pickup(mind);
                    break;
                case WorkPhase.GoingToDropoff:
                    if(mind.Agent.Arrived){mind.Phase=WorkPhase.Dropping;mind.Since=Time.time;mind.Agent.Play(DropAnimation(mind.Kind));}
                    break;
                case WorkPhase.Dropping:
                    if(Time.time-mind.Since>=.55f)Dropoff(mind);
                    break;
            }
        }

        void Assign(Mind mind)
        {
            var role=mind.Data.Value<string>("role");
            if((mind.Data.Value<double?>("energy")??100)<=0){Rest(mind);return;}
            if(role=="cashier")
            {
                if(world.CheckoutPoint&&Vector3.SqrMagnitude(mind.Agent.transform.position-world.CheckoutPoint.position)>.25f)mind.Agent.GoTo(world.CheckoutPoint.position);
                else mind.Agent.Play("ScanItem");
                mind.Since=Time.time;return;
            }
            if(role=="farmer")AssignFarmer(mind);
            else if(role=="operator")AssignOperator(mind);
            else if(role=="stocker")AssignStocker(mind);
            else { mind.Agent.Play(role=="manager"?"Tripo_LookAround":"Idle"); mind.Since=Time.time; }
        }

        void AssignFarmer(Mind mind)
        {
            var crop=planner.BestReadyCrop(lastCropProduct);
            if(crop==null||!world.CropPoints.TryGetValue(crop.Value<string>("id"),out var point)){Rest(mind);return;}
            mind.Kind=WorkKind.Harvest;mind.Product=crop.Value<string>("productId");mind.Station=crop.Value<string>("id");
            lastCropProduct=mind.Product;LogTask(mind,"assign");GoPickup(mind,point.position);
        }

        void AssignOperator(Mind mind)
        {
            var output=planner.BestMachineOutput();
            if(output!=null&&world.MachinePoints.TryGetValue(output.Value<string>("id"),out var outputPoint))
            {
                mind.Kind=WorkKind.CollectOutput;mind.Product=output.Value<string>("productId");mind.Station=output.Value<string>("id");LogTask(mind,"assign");GoPickup(mind,outputPoint.position);return;
            }
            var machine=planner.BestMachineToStart();
            if(machine==null||!world.MachinePoints.ContainsKey(machine.Value<string>("id"))||!world.WarehousePoint){Rest(mind);return;}
            mind.Kind=WorkKind.StartMachine;mind.Product=machine.Value<string>("productId");mind.Station=machine.Value<string>("id");LogTask(mind,"assign");GoPickup(mind,world.WarehousePoint.position);
        }

        void AssignStocker(Mind mind)
        {
            var product=planner.BestStockProduct(spec.ProductIds());
            if(product==null||!world.WarehousePoint||!world.ProductServicePoints.ContainsKey(product)){Rest(mind);return;}
            mind.Kind=WorkKind.Stock;mind.Product=product;mind.Station=null;LogTask(mind,"assign");GoPickup(mind,world.WarehousePoint.position);
        }

        void GoPickup(Mind mind,Vector3 destination){mind.Phase=WorkPhase.GoingToPickup;mind.Since=Time.time;mind.Agent.GoTo(destination,EmployeeSpeed(mind));}

        void Pickup(Mind mind)
        {
            var capacity=Math.Min(8,2+Math.Max(1,mind.Data.Value<int?>("level")??1));
            mind.Amount=0;
            if(mind.Kind==WorkKind.Harvest)mind.Amount=farm.HarvestForWorker(mind.Station,capacity,out mind.Product);
            else if(mind.Kind==WorkKind.CollectOutput)mind.Amount=production.CollectForWorker(mind.Station,capacity,out mind.Product);
            else if(mind.Kind==WorkKind.Stock)
            {
                var missing=Math.Max(0,availability.ShelfCapacity(state,mind.Product)-inventory.Quantity("shelves",mind.Product));
                mind.Amount=Math.Min(capacity,Math.Min(missing,inventory.Quantity("warehouse",mind.Product)));
                if(mind.Amount>0)inventory.Consume("warehouse",mind.Product,mind.Amount);
            }
            else if(mind.Kind==WorkKind.StartMachine)mind.Amount=1;
            if(mind.Amount<1){Rest(mind);return;}
            mind.CarryVisual?.Show(mind.Product,mind.Kind is WorkKind.Stock or WorkKind.StartMachine);

            Vector3 destination;
            if(mind.Kind is WorkKind.Harvest or WorkKind.CollectOutput)destination=world.WarehousePoint.position;
            else if(mind.Kind==WorkKind.Stock)destination=world.ProductServicePoints[mind.Product].position;
            else destination=world.MachinePoints[mind.Station].position;
            mind.Phase=WorkPhase.GoingToDropoff;mind.Since=Time.time;mind.Agent.GoTo(destination,EmployeeSpeed(mind),true);
        }

        void Dropoff(Mind mind)
        {
            if(mind.Kind is WorkKind.Harvest or WorkKind.CollectOutput)inventory.Add("warehouse",mind.Product,mind.Amount);
            else if(mind.Kind==WorkKind.Stock)
            {
                var missing=Math.Max(0,availability.ShelfCapacity(state,mind.Product)-inventory.Quantity("shelves",mind.Product));
                var moved=Math.Min(mind.Amount,missing);if(moved>0)inventory.Add("shelves",mind.Product,moved);
                if(mind.Amount>moved)inventory.Add("warehouse",mind.Product,mind.Amount-moved);
                if(moved>0){progression.Record($"stock:{mind.Product}",moved);progression.Record("stock:all",moved);progression.Record("transport:all",moved);}
            }
            else if(mind.Kind==WorkKind.StartMachine)production.StartForWorker(mind.Station);
            mind.CarryVisual?.Hide();
            LogTask(mind,"complete");
            mind.Data["energy"]=Math.Max(0,(mind.Data.Value<double?>("energy")??100)-.015);
            Rest(mind);
        }

        static float EmployeeSpeed(Mind mind)=>Mathf.Min(2.15f,1.42f+Mathf.Max(1,mind.Data.Value<int?>("level")??1)*.08f);

        void Rest(Mind mind)
        {
            mind.CarryVisual?.Hide();mind.Kind=WorkKind.None;mind.Product=null;mind.Station=null;mind.Amount=0;mind.Phase=WorkPhase.Idle;mind.Since=Time.time;mind.Agent.Play("Idle");
        }

        static string PickAnimation(WorkKind kind)=>kind switch
        {
            WorkKind.Harvest=>"HarvestLow",WorkKind.Stock=>"PickupLow",WorkKind.CollectOutput=>"PickupHigh",WorkKind.StartMachine=>"PickupLow",_=>"Idle",
        };
        static string DropAnimation(WorkKind kind)=>kind switch
        {
            WorkKind.Stock=>"StockMid",WorkKind.StartMachine=>"LiftBox",_=>"PickupLow",
        };

        void LogTask(Mind mind,string status)=>Debug.Log($"MINIMARKET_EMPLOYEE status={status} role={mind.Data.Value<string>("role")} task={mind.Kind} product={mind.Product??"none"} station={mind.Station??"none"} amount={mind.Amount}");

        public void LogWorkerState()
        {
            var roles=new List<string>();foreach(var mind in minds.Values)roles.Add($"{mind.Data.Value<string>("role")}:{mind.Phase}:{mind.Product??"none"}");
            var machines=new List<string>();foreach(var token in state.Array("productionMachines"))machines.Add($"{token.Value<string>("id")}:{token.Value<string>("status")}:{token.Value<int?>("output")??0}");
            Debug.Log($"MINIMARKET_WORKERS roles={string.Join(",",roles)} wheat={state.Quantity("warehouse","wheat")} flour={state.Quantity("warehouse","flour")} breadWarehouse={state.Quantity("warehouse","bread")} breadShelf={state.Quantity("shelves","bread")} machines={string.Join(",",machines)}");
        }
    }
}
