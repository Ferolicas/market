using System;
using UnityEngine;
using UnityEngine.Profiling;
using UnityEngine.Rendering;

namespace MiniMarket.Performance
{
    public sealed class PerformanceGovernor : MonoBehaviour
    {
        [SerializeField] int targetFps = 60;
        [SerializeField] float minimumResolutionScale = .68f;
        [SerializeField] float adjustmentInterval = 4f;
        float sampleTime;
        int frames;
        float resolutionScale = 1f;
        float lastFps = 60f;

        public float AiTickSeconds { get; private set; } = .25f;
        public float DecisionTickSeconds { get; private set; } = .75f;

        void Awake()
        {
            QualitySettings.vSyncCount = 0;
            // The rig blends four bones per vertex. WebGL defaults to the High
            // level, which capped this at two: Unity dropped the other two and
            // renormalised, so neck and shoulder vertices snapped rigidly to a
            // single bone and tore into a flat shard on certain poses.
            QualitySettings.skinWeights = SkinWeights.FourBones;
            Application.targetFrameRate = targetFps;
            QualitySettings.realtimeReflectionProbes = false;
            QualitySettings.streamingMipmapsActive = true;
            QualitySettings.streamingMipmapsMemoryBudget = Application.isMobilePlatform ? 192 : 384;
            Shader.globalMaximumLOD = Application.isMobilePlatform ? 350 : 450;
        }

        void Update()
        {
            frames++;
            sampleTime += Time.unscaledDeltaTime;
            if (sampleTime < adjustmentInterval) return;
            var fps = frames / Math.Max(.01f, sampleTime);
            lastFps = fps;
            if (fps < targetFps * .84f) resolutionScale = Mathf.Max(minimumResolutionScale, resolutionScale - .08f);
            else if (fps > targetFps * .97f) resolutionScale = Mathf.Min(1f, resolutionScale + .04f);
            ScalableBufferManager.ResizeBuffers(resolutionScale, resolutionScale);
            AiTickSeconds = fps < 45 ? .4f : .25f;
            DecisionTickSeconds = fps < 45 ? 1.2f : .75f;
            frames = 0; sampleTime = 0;
        }

        public void LogRuntimeBudget()
        {
            long triangles=0;var visibleRenderers=0;var materialSlots=0;
            foreach(var renderer in FindObjectsByType<Renderer>(FindObjectsInactive.Exclude,FindObjectsSortMode.None))
            {
                if(!renderer.enabled||!renderer.isVisible)continue;
                visibleRenderers++;materialSlots+=renderer.sharedMaterials?.Length??0;
                if(renderer is SkinnedMeshRenderer skinned&&skinned.sharedMesh)
                    for(var i=0;i<skinned.sharedMesh.subMeshCount;i++)triangles+=skinned.sharedMesh.GetIndexCount(i)/3;
                else if(renderer is MeshRenderer meshRenderer&&renderer.GetComponent<MeshFilter>()?.sharedMesh is Mesh mesh)
                {
                    // Static batching makes several renderers reference one combined
                    // mesh.  Each renderer draws only its own sub-mesh range; summing
                    // the whole combined mesh for every renderer inflated telemetry
                    // by several million triangles without reflecting GPU work.
                    var first=meshRenderer.isPartOfStaticBatch?meshRenderer.subMeshStartIndex:0;
                    var count=meshRenderer.isPartOfStaticBatch
                        ?Math.Min(mesh.subMeshCount-first,meshRenderer.sharedMaterials?.Length??0)
                        :mesh.subMeshCount;
                    for(var i=first;i<first+count;i++)triangles+=mesh.GetIndexCount(i)/3;
                }
            }
            var managedMb=GC.GetTotalMemory(false)/(1024d*1024d);
            var allocatedMb=Profiler.GetTotalAllocatedMemoryLong()/(1024d*1024d);
            Debug.Log($"MINIMARKET_PERF fps={lastFps:0.0} resolution={resolutionScale:0.00} visibleRenderers={visibleRenderers} materialSlots={materialSlots} visibleTriangles={triangles} managedMB={managedMb:0.0} allocatedMB={allocatedMb:0.0} aiTick={AiTickSeconds:0.00} decisionTick={DecisionTickSeconds:0.00}");
        }
    }
}
