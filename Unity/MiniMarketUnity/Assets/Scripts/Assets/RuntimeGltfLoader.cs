using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using GLTFast;
using UnityEngine;

namespace MiniMarket.Assets
{
    public sealed class RuntimeGltfLoader : IDisposable
    {
        static readonly HashSet<string> NoRealtimeShadow = new(StringComparer.OrdinalIgnoreCase)
        {
            "RoadSegment","SidewalkSegment","Crosswalk","CityBuilding","Tree","Car","BusStop","Bench","StreetLight",
            "FarmPlotFurrows","FarmToolSet","CompostBin","MiniGreenhouse","Scarecrow","FarmWaterTank",
        };
        readonly RuntimeAssetCatalog catalog;
        readonly Dictionary<string, Task<GltfImport>> imports = new(StringComparer.OrdinalIgnoreCase);
        readonly List<GltfImport> ownedImports = new();

        public RuntimeGltfLoader(RuntimeAssetCatalog runtimeCatalog) => catalog = runtimeCatalog;

        public bool Has(string id) => catalog.TryGet(id, out _);

        public async Task<GameObject> InstantiateAsync(string id, Transform parent, Vector3 position, Quaternion rotation, Vector3 scale)
        {
            if (!catalog.TryGet(id, out var entry)) throw new KeyNotFoundException($"Asset runtime no encontrado: {id}");
            var gltf = await ImportAsync(entry);
            var root = new GameObject(id);
            root.SetActive(false);
            root.transform.SetParent(parent, false);
            root.transform.localPosition = position;
            root.transform.localRotation = rotation;
            root.transform.localScale = scale;
            if (!await gltf.InstantiateMainSceneAsync(root.transform))
            {
                UnityEngine.Object.Destroy(root);
                throw new InvalidOperationException($"No se pudo instanciar {id}");
            }
            foreach (var renderer in root.GetComponentsInChildren<SkinnedMeshRenderer>(true))
            {
                renderer.updateWhenOffscreen = false;
                renderer.allowOcclusionWhenDynamic = true;
            }
            foreach (var renderer in root.GetComponentsInChildren<Renderer>(true))
            {
                renderer.shadowCastingMode = entry.Kind is "product" or "hair" or "hat" || NoRealtimeShadow.Contains(entry.Id)
                    ? UnityEngine.Rendering.ShadowCastingMode.Off
                    : UnityEngine.Rendering.ShadowCastingMode.On;
                if(NoRealtimeShadow.Contains(entry.Id))renderer.receiveShadows=false;
                if (renderer.sharedMaterials == null) continue;
                foreach (var material in renderer.sharedMaterials) if (material) material.enableInstancing = true;
            }
            root.SetActive(true);
            return root;
        }

        /// Download, decode and upload an asset without creating scene objects.
        /// Later instances reuse the parsed import, so a gameplay transition no
        /// longer becomes the first texture upload for that product or crop.
        public async Task PreloadAsync(string id)
        {
            if(!catalog.TryGet(id,out var entry))throw new KeyNotFoundException($"Asset runtime no encontrado: {id}");
            await ImportAsync(entry);
        }

        Task<GltfImport> ImportAsync(RuntimeAssetCatalog.Entry entry)
        {
            if(imports.TryGetValue(entry.Id,out var existing))return existing;
            var task=LoadAsync(entry);imports[entry.Id]=task;return task;
        }

        async Task<GltfImport> LoadAsync(RuntimeAssetCatalog.Entry entry)
        {
            var gltf = new GltfImport();
            if (!await gltf.Load(catalog.Url(entry)))
            {
                gltf.Dispose();
                throw new InvalidOperationException($"No se pudo cargar {entry.Id} desde {entry.Path}");
            }
            ownedImports.Add(gltf);
            return gltf;
        }

        public void Dispose()
        {
            foreach (var import in ownedImports) import.Dispose();
            ownedImports.Clear(); imports.Clear();
        }
    }
}
