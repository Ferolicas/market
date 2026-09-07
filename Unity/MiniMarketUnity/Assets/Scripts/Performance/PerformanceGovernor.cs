using System;
using UnityEngine;
using UnityEngine.Profiling;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace MiniMarket.Performance
{
    public enum DevicePerformanceTier { Low, Mid, High }

    /// Reaches the pipeline asset's private numbers, which URP exposes for
    /// reading but not for writing.
    sealed class SerializedObjectLite
    {
        readonly UnityEngine.Object target;
        public SerializedObjectLite(UnityEngine.Object o) => target = o;
        public void SetInt(string field, int value)
        {
            var f = target.GetType().GetField(field, System.Reflection.BindingFlags.Instance
                                                    | System.Reflection.BindingFlags.NonPublic);
            if (f == null) return;
            f.SetValue(target, f.FieldType.IsEnum ? System.Enum.ToObject(f.FieldType, value) : (object)value);
        }
    }

    public sealed class PerformanceGovernor : MonoBehaviour
    {
        [SerializeField] int targetFps = 60;
        [SerializeField] float minimumResolutionScale = .68f;
        [SerializeField] float adjustmentInterval = 4f;
        /// A phone is not a desktop: half the frames, no multisampling, no
        /// anisotropy and a shorter shadow, because what it runs out of is
        /// battery, not talent.
        public static bool Handheld => Application.isMobilePlatform || SystemInfo.deviceType == DeviceType.Handheld;
        float sampleTime;
        int frames;
        float resolutionScale = 1f;
        float lastFps = 60f;
        readonly float[] frameTimesMs=new float[240];
        int frameTimeCount;int frameTimeCursor;int slowSamples;int fastSamples;

        public float AiTickSeconds { get; private set; } = .25f;
        public float DecisionTickSeconds { get; private set; } = .75f;
        public DevicePerformanceTier ActiveTier { get; private set; }=DevicePerformanceTier.High;

        void Awake()
        {
            QualitySettings.vSyncCount = 0;
            // The rig blends four bones per vertex. WebGL defaults to the High
            // level, which capped this at two: Unity dropped the other two and
            // renormalised, so neck and shoulder vertices snapped rigidly to a
            // single bone and tore into a flat shard on certain poses.
            QualitySettings.skinWeights = SkinWeights.FourBones;
            ActiveTier=DetectTier();
            if (Handheld)
            {
                targetFps = 30; minimumResolutionScale = .5f; adjustmentInterval = 2f;
                resolutionScale = ActiveTier switch { DevicePerformanceTier.Low=>.7f,DevicePerformanceTier.High=>.88f,_=>.8f };
                minimumResolutionScale=ActiveTier switch { DevicePerformanceTier.Low=>.5f,DevicePerformanceTier.High=>.68f,_=>.56f };
                ScalableBufferManager.ResizeBuffers(resolutionScale, resolutionScale);
                QualitySettings.anisotropicFiltering = AnisotropicFiltering.Disable;
                // At 203 pixels tall nobody can tell the 197k mesh from the 23k
                // one, and skinning the big one twice is what the phone cannot
                // afford. On a phone everyone draws the far mesh, the owner too.
                MiniMarket.Animations.CharacterLod.NearBudget = ActiveTier==DevicePerformanceTier.High?1:0;
                if (GraphicsSettings.defaultRenderPipeline is UniversalRenderPipelineAsset urp)
                {
                    urp.msaaSampleCount = 1;
                    urp.shadowDistance = ActiveTier switch { DevicePerformanceTier.Low=>8f,DevicePerformanceTier.High=>16f,_=>12f };
                    // A 2048 shadow map is 16 MB of the phone's budget for a
                    // shadow nobody looks at from up here.
                    var so = new SerializedObjectLite(urp);
                    so.SetInt("m_MainLightShadowmapResolution", 1024);
                    so.SetInt("m_AdditionalLightsShadowmapResolution", 512);
                }
            }
            Application.targetFrameRate = targetFps;
            QualitySettings.realtimeReflectionProbes = false;
            // Streaming loads a texture's detail as it comes into view, which on
            // a phone is a hitch every time the camera reveals a new shelf. The
            // whole set is small enough to keep resident.
            QualitySettings.streamingMipmapsActive = !Handheld;
            QualitySettings.streamingMipmapsMemoryBudget = 384;
            Shader.globalMaximumLOD = Handheld ? 300 : 450;
            ApplyScheduling(lastFps);
        }

        static DevicePerformanceTier DetectTier()
        {
            if(!Handheld)return DevicePerformanceTier.High;
#if UNITY_WEBGL
            // Browsers do not expose dependable device RAM/GPU figures. Mid is
            // the measured WebGL profile and can still scale its resolution.
            return DevicePerformanceTier.Mid;
#else
            var memory=SystemInfo.systemMemorySize;
            var cores=SystemInfo.processorCount;
            if((memory>0&&memory<4000)||cores<6)return DevicePerformanceTier.Low;
            if(memory>=7000&&cores>=8)return DevicePerformanceTier.High;
            return DevicePerformanceTier.Mid;
#endif
        }

        void Update()
        {
            frameTimesMs[frameTimeCursor]=Time.unscaledDeltaTime*1000f;
            frameTimeCursor=(frameTimeCursor+1)%frameTimesMs.Length;
            frameTimeCount=Math.Min(frameTimeCount+1,frameTimesMs.Length);
            frames++;
            sampleTime += Time.unscaledDeltaTime;
            if (sampleTime < adjustmentInterval) return;
            var fps = frames / Math.Max(.01f, sampleTime);
            lastFps = fps;
            if (fps < targetFps * .84f){slowSamples++;fastSamples=0;}
            else if (fps > targetFps * .97f){fastSamples++;slowSamples=0;}
            else {slowSamples=0;fastSamples=0;}
            // Hysteresis avoids changing render scale after one noisy sample.
            if(slowSamples>=2){resolutionScale=Mathf.Max(minimumResolutionScale,resolutionScale-.08f);slowSamples=0;}
            else if(fastSamples>=3){resolutionScale=Mathf.Min(1f,resolutionScale+.04f);fastSamples=0;}
            ScalableBufferManager.ResizeBuffers(resolutionScale, resolutionScale);
            ApplyScheduling(fps);
            frames = 0; sampleTime = 0;
        }

        void ApplyScheduling(float fps)
        {
            if(!Handheld&&fps>=45f){AiTickSeconds=.25f;DecisionTickSeconds=.75f;return;}
            var stressed=fps<targetFps*.84f;
            AiTickSeconds=ActiveTier switch { DevicePerformanceTier.Low=>stressed ? .65f : .5f,DevicePerformanceTier.High=>stressed ? .4f : .3f,_=>stressed ? .5f : .4f };
            DecisionTickSeconds=ActiveTier switch { DevicePerformanceTier.Low=>stressed ? 1.8f : 1.5f,DevicePerformanceTier.High=>stressed ? 1.2f : .9f,_=>stressed ? 1.5f : 1.2f };
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
            var samples=new float[frameTimeCount];
            var spikes=0;
            for(var i=0;i<frameTimeCount;i++){samples[i]=frameTimesMs[i];if(samples[i]>100f)spikes++;}
            Array.Sort(samples);
            var p95=Percentile(samples,.95f);var p99=Percentile(samples,.99f);
            Debug.Log($"MINIMARKET_PERF tier={ActiveTier} fps={lastFps:0.0} p95ms={p95:0.00} p99ms={p99:0.00} spikes100={spikes} resolution={resolutionScale:0.00} visibleRenderers={visibleRenderers} materialSlots={materialSlots} visibleTriangles={triangles} managedMB={managedMb:0.0} allocatedMB={allocatedMb:0.0} aiTick={AiTickSeconds:0.00} decisionTick={DecisionTickSeconds:0.00}");
        }

        static float Percentile(float[] values,float percentile)
        {
            if(values.Length==0)return 0;
            return values[Mathf.Clamp(Mathf.CeilToInt(values.Length*percentile)-1,0,values.Length-1)];
        }
    }
}
