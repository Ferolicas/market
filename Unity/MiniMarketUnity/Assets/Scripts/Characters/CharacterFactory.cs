using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using MiniMarket.Animations;
using MiniMarket.Assets;
using UnityEngine;

namespace MiniMarket.Characters
{
    public sealed class CharacterFactory
    {
        // The store is measured at 6.2 world units to the metre, taken from the
        // egg display the owner approved (9.23 units for a 1.49 m stand). An
        // adult is 1.75 m, which is 10.85 units: 5.616 gave 6.49 and left the
        // cast shorter than the furniture. The children keep 85% of that so a
        // glance tells them apart.
        const float BodyScale=9.39f;
        const float ChildScale=7.99f;
        static readonly HashSet<string> Children=new(StringComparer.OrdinalIgnoreCase){"Boy","Girl"};
        readonly RuntimeGltfLoader loader;
        public CharacterFactory(RuntimeGltfLoader runtimeLoader) => loader = runtimeLoader;

        public async Task<CharacterActor> CreateAsync(string characterId, Transform parent, Vector3 position, bool includeAllLods)
        {
            var root = new GameObject(characterId);
            root.SetActive(false);
            root.transform.SetParent(parent, false);
            root.transform.localPosition = position;
            // The delivered cast is metric, about a metre tall in its own file,
            // and read far too small beside the storefront. Geometry is never
            // touched; only this presentation scale carries the size. Measured,
            // the nine bodies are all 0.98 tall -- the boy and the girl too, who
            // differ only in their proportions -- so the shorter children are
            // this scale and nothing else.
            root.transform.localScale=Vector3.one*(Children.Contains(characterId)?ChildScale:BodyScale);

            // Web/PWA uses a tiny motion-only GLB (50-bone rig + 47 clips)
            // and one approved LOD2 renderer. Loading all three full skinned
            // files per actor multiplied download, morph buffers and battery
            // cost without improving an orthographic management view.
            var motion = await loader.InstantiateAsync($"{characterId}:Motion", root.transform, Vector3.zero, Quaternion.identity, Vector3.one);
            var boneMap = BuildBoneMap(motion.transform);
            // On a phone nobody ever draws the near mesh, so it is not even
            // loaded: at 8.7 MB a body across nine bodies that is most of what
            // was killing the tab.
            var soloLejos = MiniMarket.Performance.PerformanceGovernor.Handheld && loader.Has($"{characterId}:LOD3");
            var nearRenderers = System.Array.Empty<Renderer>();
            if (!soloLejos)
            {
                var visual = await loader.InstantiateAsync($"{characterId}:LOD2", root.transform, Vector3.zero, Quaternion.identity, Vector3.one);
                nearRenderers = RebindRenderers(visual, root.transform, boneMap, "LOD2_Renderers");
            }
            // The far mesh (same rig, a tenth of the triangles, no morphs) for
            // when this character is not one of the few nearest the player.
            Renderer[] farRenderers = System.Array.Empty<Renderer>();
            if (loader.Has($"{characterId}:LOD3"))
            {
                var farVisual = await loader.InstantiateAsync($"{characterId}:LOD3", root.transform, Vector3.zero, Quaternion.identity, Vector3.one);
                farRenderers = RebindRenderers(farVisual, root.transform, boneMap, "LOD3_Renderers");
            }
            root.AddComponent<CharacterLod>().Configure(nearRenderers, farRenderers);

            var actor = root.AddComponent<CharacterActor>();
            var sockets = root.AddComponent<CharacterSockets>();
            var hands = root.AddComponent<HandPoseDriver>();
            sockets.Build(motion.transform); hands.Bind(motion.transform); actor.Bind(motion.transform); actor.Play("Idle", 0);
            AddController(root);
            root.SetActive(true);
            return actor;
        }

        static Dictionary<string, Transform> BuildBoneMap(Transform source)
        {
            var result = new Dictionary<string, Transform>(StringComparer.OrdinalIgnoreCase);
            foreach (var bone in source.GetComponentsInChildren<Transform>(true))
                if (!result.ContainsKey(bone.name)) result[bone.name] = bone;
            return result;
        }

        static Renderer[] RebindRenderers(GameObject imported, Transform characterRoot,
            IReadOnlyDictionary<string, Transform> bones, string holderName)
        {
            var holder = new GameObject(holderName).transform;
            holder.SetParent(characterRoot, false);
            var result = new List<Renderer>();
            foreach (var renderer in imported.GetComponentsInChildren<SkinnedMeshRenderer>(true))
            {
                var mapped = new Transform[renderer.bones.Length];
                for (var i = 0; i < mapped.Length; i++)
                {
                    var source = renderer.bones[i];
                    if (!source || !bones.TryGetValue(source.name, out mapped[i]))
                        throw new InvalidOperationException($"LOD incompatible: falta hueso {source?.name ?? "null"}");
                }
                renderer.bones = mapped;
                if (renderer.rootBone && bones.TryGetValue(renderer.rootBone.name, out var rootBone)) renderer.rootBone = rootBone;
                renderer.transform.SetParent(holder, true);
                // The bind-pose localBounds stop describing this mesh once its
                // bones point at the Motion rig, so let Unity recompute them.
                renderer.updateWhenOffscreen = true;
                renderer.allowOcclusionWhenDynamic = true;
                result.Add(renderer);
            }
            UnityEngine.Object.Destroy(imported);
            return result.ToArray();
        }

        static void AddController(GameObject root)
        {
            var controller = root.AddComponent<CharacterController>();
            controller.height = 1.72f;
            controller.radius = .31f;
            controller.center = new Vector3(0, .86f, 0);
            controller.stepOffset = .25f;
            controller.slopeLimit = 48f;
        }
    }
}
