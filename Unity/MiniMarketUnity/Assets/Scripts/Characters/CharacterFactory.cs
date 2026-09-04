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
        readonly RuntimeGltfLoader loader;
        public CharacterFactory(RuntimeGltfLoader runtimeLoader) => loader = runtimeLoader;

        public async Task<CharacterActor> CreateAsync(string characterId, Transform parent, Vector3 position, bool includeAllLods)
        {
            var root = new GameObject(characterId);
            root.SetActive(false);
            root.transform.SetParent(parent, false);
            root.transform.localPosition = position;
            // The authoritative Next presentation renders the stylized cast
            // at roughly 2.2 m against its 5.4 m storefront.  The approved
            // GameReady files are metric 1.7 m, so preserve their geometry and
            // apply only the shared presentation scale used by every actor.
            root.transform.localScale=Vector3.one*1.30f;

            // Web/PWA uses a tiny motion-only GLB (50-bone rig + 47 clips)
            // and one approved LOD2 renderer. Loading all three full skinned
            // files per actor multiplied download, morph buffers and battery
            // cost without improving an orthographic management view.
            var motion = await loader.InstantiateAsync($"{characterId}:Motion", root.transform, Vector3.zero, Quaternion.identity, Vector3.one);
            var boneMap = BuildBoneMap(motion.transform);
            var visual = await loader.InstantiateAsync($"{characterId}:LOD2", root.transform, Vector3.zero, Quaternion.identity, Vector3.one);
            RebindRenderers(visual, root.transform, boneMap, "LOD2_Renderers");

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
