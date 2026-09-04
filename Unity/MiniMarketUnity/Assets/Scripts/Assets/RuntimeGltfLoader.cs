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

        public async Task<GameObject> InstantiateAsync(string id, Transform parent, Vector3 position, Quaternion rotation, Vector3 scale)
        {
            if (!catalog.TryGet(id, out var entry)) throw new KeyNotFoundException($"Asset runtime no encontrado: {id}");
            if (!imports.TryGetValue(id, out var importTask))
            {
                importTask = LoadAsync(entry);
                imports[id] = importTask;
            }
            var gltf = await importTask;
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
