using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using MiniMarket.Assets;
using MiniMarket.Core;
using MiniMarket.Data;
using UnityEngine;

namespace MiniMarket.Store
{
    public sealed class ProductVisualSystem : IDisposable
    {
        static readonly Dictionary<string, string> AssetIds = new()
        {
            ["tomatoes"]="Tomato", ["apples"]="Apple", ["corn"]="Corn", ["eggs"]="Egg", ["milk"]="Milk",
            ["cheese"]="Cheese", ["juice"]="Juice", ["bread"]="Bread", ["flour"]="Flour", ["wheat"]="Wheat", ["coffee"]="Coffee"
        };
        readonly RuntimeGltfLoader loader;
        readonly StoreWorld world;
        readonly GameStateDocument state;
        readonly ProductAvailabilityPolicy availability;
        readonly GameSignals signals;
        readonly Dictionary<string, List<GameObject>> active = new();
        readonly Dictionary<string, Stack<GameObject>> pools = new();
        readonly HashSet<string> refreshing = new();
        int lastLevel;
        string lastFranchise;

        public ProductVisualSystem(RuntimeGltfLoader assetLoader, StoreWorld storeWorld, GameStateDocument document, ProductAvailabilityPolicy productAvailability, GameSignals gameSignals)
        {
            loader=assetLoader; world=storeWorld; state=document; availability=productAvailability; signals=gameSignals;
            signals.InventoryChanged += InventoryChanged;
            signals.StateChanged += StateChanged;
            lastLevel=state.Level;
            lastFranchise=state.CurrentFranchise.Value<string>("id");
        }

        /// Finish the initial shelf population before gameplay is exposed. The
        /// constructor used to launch these imports in the background, so the
        /// first product texture arrived while the owner was already walking.
        public Task WarmAsync()
        {
            var tasks=new List<Task>();
            foreach(var pair in AssetIds){tasks.Add(loader.PreloadAsync(pair.Value));tasks.Add(RefreshAsync(pair.Key));}
            return Task.WhenAll(tasks);
        }

        void InventoryChanged(string product, int quantity)
        {
            if (AssetIds.ContainsKey(product)) _ = RefreshAsync(product);
        }

        void StateChanged()
        {
            var franchise=state.CurrentFranchise.Value<string>("id");if(lastLevel==state.Level&&lastFranchise==franchise)return;
            lastLevel=state.Level;lastFranchise=franchise;
            foreach(var product in AssetIds.Keys)_ = RefreshAsync(product);
        }

        async Task RefreshAsync(string product)
        {
            if (!refreshing.Add(product)) return;
            try
            {
                ProductShelf shelf = null;
                foreach (var candidate in world.Shelves.Values)
                    if (Array.IndexOf(candidate.allowedProducts, product) >= 0) { shelf=candidate; break; }
                if (!shelf) return;
                if (!active.TryGetValue(product, out var shown)) active[product] = shown = new List<GameObject>();
                if (!pools.TryGetValue(product, out var pool)) pools[product] = pool = new Stack<GameObject>();
                var desired = availability.CanCustomerRequest(product,state.Level)
                    ? Mathf.Min(state.Quantity("shelves", product), shelf.ProductSlots.Count / Mathf.Max(1, shelf.allowedProducts.Length)) : 0;
                while (shown.Count > desired) { var item=shown[^1]; shown.RemoveAt(shown.Count-1); item.SetActive(false); pool.Push(item); }
                while (shown.Count < desired)
                {
                    var slotIndex = ProductOffset(shelf, product) + shown.Count * Mathf.Max(1, shelf.allowedProducts.Length);
                    if (slotIndex >= shelf.ProductSlots.Count) break;
                    GameObject item;
                    if (pool.Count > 0) { item=pool.Pop(); item.SetActive(true); }
                    else item=await loader.InstantiateAsync(AssetIds[product], shelf.transform, Vector3.zero, Quaternion.identity, Vector3.one);
                    var slot=shelf.ProductSlots[slotIndex]; item.transform.SetParent(slot, false); item.transform.localPosition=Vector3.zero; item.transform.localRotation=Quaternion.identity; item.transform.localScale=Vector3.one;
                    NormalizeWorldSize(item,shelf.slotSize,shelf.fitFootprint);
                    shown.Add(item);
                }
            }
            catch (Exception exception) { Debug.LogWarning($"Visual {product}: {exception.Message}"); }
            finally { refreshing.Remove(product); }
        }

        static int ProductOffset(ProductShelf shelf, string product) { var index=Array.IndexOf(shelf.allowedProducts,product); return Mathf.Max(0,index); }
        static void NormalizeWorldSize(GameObject item,float target,bool footprint)
        {
            var renderers=item.GetComponentsInChildren<Renderer>(true);if(renderers.Length==0)return;
            var bounds=renderers[0].bounds;for(var i=1;i<renderers.Length;i++)bounds.Encapsulate(renderers[i].bounds);
            // Fitting the footprint is what seats an egg in its hollow: the
            // hollow decides how wide it may be, and its height follows.
            var medida=footprint?Mathf.Max(bounds.size.x,bounds.size.z)
                                :Mathf.Max(bounds.size.x,Mathf.Max(bounds.size.y,bounds.size.z));
            if(medida<=.0001f)return;
            item.transform.localScale*=target/medida;
        }
        public void Dispose() { signals.InventoryChanged -= InventoryChanged; signals.StateChanged -= StateChanged; }
    }
}
