using System;
using MiniMarket.Core;
using MiniMarket.Data;
using MiniMarket.Inventory;
using MiniMarket.Progression;
using Newtonsoft.Json.Linq;

namespace MiniMarket.Store
{
    public sealed class OrderSystem
    {
        readonly GameStateDocument state; readonly GameSpecRepository spec; readonly InventorySystem inventory; readonly ProgressionSystem progression; readonly GameSignals signals; readonly ProductAvailabilityPolicy availability; readonly MiniMarket.Economy.GameLedger ledger;
        public OrderSystem(GameStateDocument document, GameSpecRepository repository, InventorySystem inventorySystem, ProductAvailabilityPolicy productAvailability, ProgressionSystem progressionSystem, GameSignals gameSignals, MiniMarket.Economy.GameLedger gameLedger=null)
        { state=document; spec=repository; inventory=inventorySystem; availability=productAvailability; progression=progressionSystem; signals=gameSignals; ledger=gameLedger; }
        public bool Order(string productId, int quantity=10)
        {
            var product=spec.Products[productId] as JObject; if (product==null || !availability.IsProductUnlocked(productId,state.Level)) return false;
            var supplierId=product.Value<string>("supplier"); JObject supplier=null;
            foreach (var token in (JArray)spec.Root["catalog"]["SUPPLIERS"]) if (token.Value<string>("id")==supplierId) supplier=token as JObject;
            if (supplier==null || state.Level<supplier.Value<int>("unlockLevel")) return false;
            quantity=Math.Clamp(quantity,1,100);
            var baseCost=spec.ProductPrice(productId,"wholesaleMinor")*quantity;
            var cost=spec.ScaleMoney(baseCost*(1-supplier.Value<double>("discount")),state.CountryCode);
            if (state.BalanceMinor<cost) return false;
            state.BalanceMinor-=cost;
            state.CurrentFranchise["expensesTodayMinor"]=(state.CurrentFranchise.Value<long?>("expensesTodayMinor")??0)+cost;
            if(state.Root["finances"] is JObject finances)finances["costOfGoodsMinor"]=(finances.Value<long?>("costOfGoodsMinor")??0)+cost;
            var orders=(JArray)state.Root["pendingOrders"];
            orders.Add(new JObject{{"id",Guid.NewGuid().ToString("N")},{"franchiseId",state.CurrentFranchise.Value<string>("id")},{"supplierId",supplierId},{"productId",productId},{"quantity",quantity},{"totalMinor",cost},{"arrivesAtMinute",state.MinuteOfDay+supplier.Value<int>("leadMinutes")}});
            state.Changed(); progression.Record("orders"); ledger?.Record("inventory",$"Pedido de {product.Value<string>("name")}",-cost); signals.PublishNotification($"Pedido: {quantity} × {product.Value<string>("name")}"); return true;
        }
        public void Tick()
        {
            var orders=(JArray)state.Root["pendingOrders"];
            for(var i=orders.Count-1;i>=0;i--)
            {
                var order=(JObject)orders[i];if(order.Value<int>("arrivesAtMinute")>state.MinuteOfDay)continue;
                JObject destination=null;if(state.Root["franchises"] is JArray franchises)foreach(var token in franchises)if(token.Value<string>("id")==order.Value<string>("franchiseId")){destination=token as JObject;break;}
                if(destination==null){orders.RemoveAt(i);continue;}
                if(destination["warehouse"] is not JObject warehouse)destination["warehouse"]=warehouse=new JObject();var product=order.Value<string>("productId");warehouse[product]=(warehouse.Value<int?>(product)??0)+order.Value<int>("quantity");
                orders.RemoveAt(i);progression.Record("deliveries");
                signals.PublishNotification($"Entrega recibida: {order.Value<int>("quantity")} × {order.Value<string>("productId")}");
            }
        }
    }
}
