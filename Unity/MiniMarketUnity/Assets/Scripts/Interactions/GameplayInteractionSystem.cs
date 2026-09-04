using System;
using System.Collections.Generic;
using MiniMarket.Animations;
using MiniMarket.Core;
using MiniMarket.Data;
using MiniMarket.Farm;
using MiniMarket.Inventory;
using MiniMarket.Production;
using MiniMarket.Progression;
using MiniMarket.Store;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace MiniMarket.Interactions
{
    public sealed class GameplayInteractionSystem : IDisposable
    {
        readonly InteractionDirector director; readonly StoreWorld world; readonly GameStateDocument state; readonly GameSpecRepository spec;
        readonly InventorySystem inventory; readonly PlayerCarrySystem carry; readonly ProductAvailabilityPolicy availability;
        readonly FarmSystem farm; readonly ProductionSystem production; readonly ProgressionSystem progression; readonly GameSignals signals; CharacterActor player;
        public event Action<string> OpenPanelRequested;
        public event Action<int> CheckoutRequested;
        public GameplayInteractionSystem(InteractionDirector interactionDirector,StoreWorld storeWorld,GameStateDocument document,GameSpecRepository repository,
            InventorySystem inventorySystem,PlayerCarrySystem playerCarry,ProductAvailabilityPolicy productAvailability,
            FarmSystem farmSystem,ProductionSystem productionSystem,ProgressionSystem progressionSystem,GameSignals gameSignals,CharacterActor playerActor)
        { director=interactionDirector;world=storeWorld;state=document;spec=repository;inventory=inventorySystem;carry=playerCarry;availability=productAvailability;farm=farmSystem;production=productionSystem;progression=progressionSystem;signals=gameSignals;player=playerActor;director.Activated+=Activate; }

        void Activate(InteractionPoint point)
        {
            var id=point.interactionId;
            if(id is "supplier" or "hiring" or "upgrade"){OpenPanelRequested?.Invoke(id);return;}
            if(id=="warehouse"){Warehouse();return;}
            if(id=="returns"){ReturnCarry();return;}
            if(id.StartsWith("checkout:",StringComparison.Ordinal)){player.Play("CheckoutScan");CheckoutRequested?.Invoke(int.TryParse(id[9..],out var lane)?lane:0);return;}
            if(id.StartsWith("stock:",StringComparison.Ordinal)){Stock(id[6..]);return;}
            if(id.StartsWith("farm:",StringComparison.Ordinal)){player.Play("HarvestLow");if(!farm.TendOrHarvest(id[5..]))signals.PublishNotification("El cultivo todavía no está listo");return;}
            if(id.StartsWith("machine:",StringComparison.Ordinal)){player.Play("LiftBox");if(!production.Operate(id[8..]))signals.PublishNotification("Faltan ingredientes o la máquina está bloqueada");return;}
            if(id.StartsWith("animal:",StringComparison.Ordinal))
            {
                var machine=id.EndsWith("chicken",StringComparison.Ordinal)?"chicken-coop-1":"cow-station-1";
                player.Play("PickupLow"); if(!production.Operate(machine))signals.PublishNotification("La estación animal todavía no está disponible");
            }
        }

        void Stock(string department)
        {
            if(!world.Shelves.TryGetValue(department,out var shelf))return;
            foreach(var product in shelf.allowedProducts)
            {
                if(!availability.CanCustomerRequest(product,state.Level))continue;
                var baseCapacity=availability.ShelfCapacity(state,product);
                var missing=Math.Max(0,baseCapacity-inventory.Quantity("shelves",product));var quantity=Math.Min(3,Math.Min(carry.Quantity(product),missing));
                if(quantity<=0)continue;
                carry.TransferToShelf(product,baseCapacity,quantity);
                progression.Record($"stock:{product}",quantity);progression.Record("stock:all",quantity);progression.Record("transport:all",quantity);
                player.Play(baseCapacity>=10?"StockMid":"StockLow");signals.PublishNotification($"Colocaste {quantity} × {product} · carga {carry.Total}/{carry.Capacity}");return;
            }
            signals.PublishNotification(carry.Total>0?"Esta carga no corresponde a este expositor o está lleno":"La cesta está vacía: recoge mercancía en el almacén");
        }

        void Warehouse()
        {
            if(carry.Total>0){ReturnCarry();return;}
            var products=new List<string>(availability.UnlockedProducts(state.Level));
            products.Sort((a,b)=>
            {
                var deficitA=availability.ShelfCapacity(state,a)-inventory.Quantity("shelves",a);
                var deficitB=availability.ShelfCapacity(state,b)-inventory.Quantity("shelves",b);
                return deficitB.CompareTo(deficitA);
            });
            var moved=carry.PickupFromWarehouse(products);
            if(moved<1){signals.PublishNotification("El almacén no tiene mercancía disponible");return;}
            player.Play("PickupLow");signals.PublishNotification($"Cargaste {moved} unidades · {carry.Summary()}");
        }

        public bool ReturnCarry()
        {
            var moved=carry.ReturnAllToWarehouse();
            if(moved<1){signals.PublishNotification("No llevas productos");return false;}
            player.Play("PickupLow");signals.PublishNotification($"Devolviste {moved} unidades al almacén");return true;
        }

        public void Dispose()=>director.Activated-=Activate;
        public void SetPlayerActor(CharacterActor actor)=>player=actor;
    }
}
