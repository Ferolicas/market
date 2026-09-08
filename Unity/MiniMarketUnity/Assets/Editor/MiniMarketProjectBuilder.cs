#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.Build;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.SceneManagement;

namespace MiniMarket.Editor
{
    public static class MiniMarketProjectBuilder
    {
        const string ScenePath="Assets/Scenes/Store.unity";
        const string PipelinePath="Assets/Settings/MiniMarketURP.asset";
        const string RendererPath="Assets/Settings/MiniMarketRenderer.asset";
        static readonly HashSet<string> WebEnvironmentAssets=new(StringComparer.OrdinalIgnoreCase)
        {
            "SidewalkSegment","ParkingSpace","CityBuilding","Car","BusStop","Bench","Tree","StreetLight","StoreEntrance","StoreEntranceAlt","StorefrontWindow","AutomaticDoor","WallStraight","ShoppingCart",
            "ShelfWallTall","ShelfWallWide","EggDisplay","DisplayProduceMixed","DisplayRefrigeratedDoors","CheckoutArea",
            "OperationsWall","BackroomStorage","StockroomRack","SeasonalDisplay","ShelfEndcap","ReturnsStation","CartBay","CashierStool","WallClock","SecurityCamera","HangingSign","CeilingLight",
            "FlourMillAlt","BreadOven","CheeseMachine","JuiceMachineAlt","FarmPlotEmpty","FarmPlotFurrows","FarmFenceLong","FarmFenceShort","FarmToolSet","CompostBin","MiniGreenhouse",
            "Scarecrow","FarmWaterTank","Chicken","Cow","SupplierTerminal","DeliveryDock","HiringPoint","UpgradePlatform",
            "CropSeed","CropSprout","CropSmall","CropGrowing","TomatoRipe","WheatRipe","CornRipe",
            "CheckoutBag","ReusableShoppingBag","HarvestBasket","FlourMill","JuiceMachine",
            "ShelfGondolaDouble","ShelfGondolaSingle","ShelfDivider","ShelfPriceRail","DisplayTable",
            "ChestFreezer","WorkCounter","UtilitySink","BakeryWorkArea","Pallet","WoodCrate","Furniture2:WoodCrate","DeliveryDockAlt",
            "UpgradePlatformAlt","FarmGate","FarmFenceCorner","RaisedBed","IrrigationBed","IrrigationChannel","Sprinkler","WateringCan","SeedSack",
            "FarmPlotSeeded","FarmPlotWatered","CarrotRipe","LettuceRipe","PumpkinRipe","WheatGrowing","ChickenPaddock","CowPaddock",
        };

        [MenuItem("Mini Market/Configure Project")]
        public static void Configure()
        {
            Directory.CreateDirectory("Assets/Scenes");Directory.CreateDirectory("Assets/Settings");Directory.CreateDirectory("Builds");
            ConfigureSurfaceTextures();ConfigureRendering();ConfigureGltfShaders();ConfigureRuntimeMaterialTemplate();ConfigurePlayer();CreateScene();AssetDatabase.SaveAssets();AssetDatabase.Refresh();
            Debug.Log("Mini Market Unity configurado para Web/PWA; Android/iOS quedan preparados.");
        }

        static void ConfigureSurfaceTextures()
        {
            foreach(var path in new[]{"Assets/Resources/Surfaces/Grass.png","Assets/Resources/Surfaces/Road.png","Assets/Resources/Surfaces/Crosswalk.png",
                                      "Assets/Resources/Surfaces/FloorTileBeige.jpg","Assets/Resources/Surfaces/FloorTileWhite.jpg"})
            {
                if(AssetImporter.GetAtPath(path) is not TextureImporter importer)continue;
                importer.textureType=TextureImporterType.Default;importer.sRGBTexture=true;importer.mipmapEnabled=true;
                importer.streamingMipmaps=false;importer.wrapMode=TextureWrapMode.Repeat;importer.filterMode=FilterMode.Bilinear;
                importer.anisoLevel=1;importer.npotScale=TextureImporterNPOTScale.None;importer.maxTextureSize=1024;
                importer.textureCompression=TextureImporterCompression.CompressedHQ;
                importer.SaveAndReimport();
            }
        }

        static void ConfigureRendering()
        {
            var pipeline=AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>(PipelinePath);
            if(!pipeline)
            {
                var renderer=ScriptableObject.CreateInstance<UniversalRendererData>();AssetDatabase.CreateAsset(renderer,RendererPath);
                pipeline=UniversalRenderPipelineAsset.Create(renderer);pipeline.name="MiniMarketURP";AssetDatabase.CreateAsset(pipeline,PipelinePath);
            }
            pipeline.supportsCameraDepthTexture=false;pipeline.supportsCameraOpaqueTexture=false;pipeline.supportsHDR=false;
            pipeline.msaaSampleCount=2;pipeline.renderScale=1f;
            var pipelineSerialized=new SerializedObject(pipeline);var softShadows=pipelineSerialized.FindProperty("m_SoftShadowsSupported");if(softShadows!=null)softShadows.boolValue=true;pipelineSerialized.ApplyModifiedPropertiesWithoutUndo();
            GraphicsSettings.defaultRenderPipeline=pipeline;QualitySettings.renderPipeline=pipeline;
            QualitySettings.shadowDistance=20;QualitySettings.shadowCascades=1;QualitySettings.lodBias=1.1f;QualitySettings.maximumLODLevel=0;QualitySettings.anisotropicFiltering=AnisotropicFiltering.Enable;
        }

        static void ConfigureRuntimeMaterialTemplate()
        {
            // StoreWorldBuilder builds its floor backing, entrance mat and other
            // primitives at runtime. A material newed from Shader.Find carries no
            // variant the build was told to keep, so URP falls back and the
            // surface renders unlit black in WebGL. Shipping a template asset
            // makes the variant set travel with the player.
            Directory.CreateDirectory("Assets/Resources");
            const string path="Assets/Resources/RuntimePrimitive.mat";
            if(AssetDatabase.LoadAssetAtPath<Material>(path))return;
            var shader=Shader.Find("Universal Render Pipeline/Lit");
            if(!shader)return;
            AssetDatabase.CreateAsset(new Material(shader){name="RuntimePrimitive"},path);
        }

        static void ConfigureGltfShaders()
        {
            // glTFast creates these materials at runtime. Keep their complete
            // variants in player builds or streamed GLBs render magenta.
            var shaderPaths=new[]{
                "Packages/com.unity.render-pipelines.universal/Shaders/Lit.shader",
                "Packages/com.unity.cloud.gltfast/Runtime/Shader/glTF-pbrMetallicRoughness.shadergraph",
                "Packages/com.unity.cloud.gltfast/Runtime/Shader/glTF-pbrSpecularGlossiness.shadergraph",
                "Packages/com.unity.cloud.gltfast/Runtime/Shader/glTF-unlit.shadergraph",
                "Packages/com.unity.cloud.gltfast/Runtime/Shader/URP/glTF-pbrMetallicRoughness-Clearcoat.shadergraph"
            };
            var settings=GraphicsSettings.GetGraphicsSettings();
            var serialized=new SerializedObject(settings);
            var included=serialized.FindProperty("m_AlwaysIncludedShaders");
            foreach(var path in shaderPaths)
            {
                var shader=AssetDatabase.LoadAssetAtPath<Shader>(path);if(!shader)continue;
                var exists=false;for(var i=0;i<included.arraySize;i++)if(included.GetArrayElementAtIndex(i).objectReferenceValue==shader){exists=true;break;}
                if(exists)continue;included.InsertArrayElementAtIndex(included.arraySize);included.GetArrayElementAtIndex(included.arraySize-1).objectReferenceValue=shader;
            }
            serialized.ApplyModifiedPropertiesWithoutUndo();
        }

        static void ConfigurePlayer()
        {
            PlayerSettings.companyName="Olcas";PlayerSettings.productName="Mini Market";
            var configuredVersion=Environment.GetEnvironmentVariable("UNITY_APP_VERSION");
            if(!string.IsNullOrWhiteSpace(configuredVersion))PlayerSettings.bundleVersion=configuredVersion;
            else if(string.IsNullOrWhiteSpace(PlayerSettings.bundleVersion))PlayerSettings.bundleVersion="1.0.0";
            var buildNumber=Environment.GetEnvironmentVariable("UNITY_BUILD_NUMBER");
            if(int.TryParse(buildNumber,out var numericBuild)&&numericBuild>0)PlayerSettings.Android.bundleVersionCode=numericBuild;
            if(!string.IsNullOrWhiteSpace(buildNumber))PlayerSettings.iOS.buildNumber=buildNumber;
            PlayerSettings.colorSpace=ColorSpace.Linear;
            PlayerSettings.defaultScreenWidth=1280;PlayerSettings.defaultScreenHeight=720;PlayerSettings.runInBackground=false;PlayerSettings.resizableWindow=true;
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.WebGL,"app.olcas.market.web");
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Android,"app.olcas.market");
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.iOS,"app.olcas.market");
            PlayerSettings.SetScriptingBackend(NamedBuildTarget.WebGL,ScriptingImplementation.IL2CPP);
            PlayerSettings.SetScriptingBackend(NamedBuildTarget.Android,ScriptingImplementation.IL2CPP);
            PlayerSettings.SetScriptingBackend(NamedBuildTarget.iOS,ScriptingImplementation.IL2CPP);
            PlayerSettings.WebGL.compressionFormat=WebGLCompressionFormat.Brotli;PlayerSettings.WebGL.decompressionFallback=false;PlayerSettings.WebGL.nameFilesAsHashes=true;// A phone will not hand over 768 MB in one block: the tab is killed the
            // moment the world starts filling it, the page reloads and the owner is
            // back at "construyendo supermercado". Start small and grow on demand.
            PlayerSettings.WebGL.initialMemorySize=64;PlayerSettings.WebGL.maximumMemorySize=1024;
            PlayerSettings.WebGL.memoryGrowthMode=WebGLMemoryGrowthMode.Geometric;
            PlayerSettings.WebGL.template="PROJECT:MiniMarketPWA";PlayerSettings.WebGL.powerPreference=WebGLPowerPreference.LowPower;
            PlayerSettings.Android.targetArchitectures=AndroidArchitecture.ARM64;PlayerSettings.Android.minSdkVersion=AndroidSdkVersions.AndroidApiLevel26;PlayerSettings.Android.targetSdkVersion=AndroidSdkVersions.AndroidApiLevelAuto;
            PlayerSettings.iOS.targetOSVersionString="15.0";PlayerSettings.iOS.sdkVersion=iOSSdkVersion.DeviceSDK;
        }

        static void CreateScene()
        {
            var scene=EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);scene.name="Store";
            var marker=new GameObject("RuntimeBootstrap_AutoCreated");marker.transform.position=Vector3.zero;
            EditorSceneManager.SaveScene(scene,ScenePath);EditorBuildSettings.scenes=new[]{new EditorBuildSettingsScene(ScenePath,true)};
        }

        [MenuItem("Mini Market/Build Web PWA")]
        public static void BuildWeb()
        {
            Configure();
            BuildWebPlayer();
        }

        [MenuItem("Mini Market/Build Web Local Fast")]
        public static void BuildWebLocal()
        {
            Configure();PlayerSettings.WebGL.compressionFormat=WebGLCompressionFormat.Disabled;
            BuildWebPlayer();
        }

        static void BuildWebPlayer()
        {
            ProductionReadinessValidator.ValidateForCi();
            var identity=PrepareBuildIdentity();
            try
            {
                var report=BuildPipeline.BuildPlayer(new BuildPlayerOptions{scenes=new[]{ScenePath},locationPathName="Builds/WebGL",target=BuildTarget.WebGL,options=BuildOptions.None});
                if(report.summary.result!=BuildResult.Succeeded)throw new BuildFailedException($"WebGL falló: {report.summary.result} ({report.summary.totalErrors} errores)");
                PruneWebStreamingAssets();
                var stamp=System.DateTime.UtcNow.ToString("yyyyMMdd-HHmmss");
                StampBuildVersion(stamp);
                var deploymentBytes=Directory.EnumerateFiles("Builds/WebGL","*",SearchOption.AllDirectories).Sum(path=>new FileInfo(path).Length);
                File.WriteAllText("Builds/WebGL/BUILD_INFO.txt",$"Unity {Application.unityVersion}\nUTC {System.DateTime.UtcNow:O}\nStamp {stamp}\nVersion {identity.Value<string>("version")}\nBuild {identity.Value<string>("buildNumber")}\nCommit {identity.Value<string>("gitCommit")}\nCatalog {identity.Value<string>("contentCatalogVersion")}\nSaveSchema {identity.Value<int>("saveSchemaVersion")}\nSize {deploymentBytes}\nWarnings {report.summary.totalWarnings}\n");
                Debug.Log($"Build Web/PWA completada: {deploymentBytes} bytes de despliegue");
            }
            finally{CleanupBuildIdentity();}
        }

        [MenuItem("Mini Market/Build Android AAB")]
        public static void BuildAndroidAab()
        {
            Configure();ProductionReadinessValidator.ValidateForCi();Directory.CreateDirectory("Builds/Android");
            EditorUserBuildSettings.buildAppBundle=true;var identity=PrepareBuildIdentity();
            try
            {
                var report=BuildPipeline.BuildPlayer(new BuildPlayerOptions{scenes=new[]{ScenePath},locationPathName="Builds/Android/MiniMarket.aab",target=BuildTarget.Android,options=BuildOptions.None});
                if(report.summary.result!=BuildResult.Succeeded)throw new BuildFailedException($"Android falló: {report.summary.result} ({report.summary.totalErrors} errores)");
                Debug.Log($"Android AAB completado: version={identity.Value<string>("version")} build={identity.Value<string>("buildNumber")}");
            }
            finally{CleanupBuildIdentity();}
        }

        [MenuItem("Mini Market/Export iOS Xcode")]
        public static void ExportIos()
        {
            Configure();ProductionReadinessValidator.ValidateForCi();Directory.CreateDirectory("Builds/iOS");var identity=PrepareBuildIdentity();
            try
            {
                var report=BuildPipeline.BuildPlayer(new BuildPlayerOptions{scenes=new[]{ScenePath},locationPathName="Builds/iOS",target=BuildTarget.iOS,options=BuildOptions.None});
                if(report.summary.result!=BuildResult.Succeeded)throw new BuildFailedException($"iOS falló: {report.summary.result} ({report.summary.totalErrors} errores)");
                Debug.Log($"Proyecto iOS completado: version={identity.Value<string>("version")} build={identity.Value<string>("buildNumber")}");
            }
            finally{CleanupBuildIdentity();}
        }

        const string BuildIdentityPath="Assets/Resources/MiniMarketBuildInfo.json";
        static JObject PrepareBuildIdentity()
        {
            Directory.CreateDirectory("Assets/Resources");
            var identity=new JObject
            {
                ["version"]=PlayerSettings.bundleVersion,
                ["buildNumber"]=Environment.GetEnvironmentVariable("UNITY_BUILD_NUMBER")??DateTime.UtcNow.ToString("yyyyMMddHHmm"),
                ["gitCommit"]=GitCommit(),
                ["contentCatalogVersion"]=FileSha256("Assets/StreamingAssets/Data/runtime-asset-catalog.json"),
                ["saveSchemaVersion"]=MiniMarket.Persistence.LocalSaveEnvelope.CurrentSchemaVersion,
            };
            File.WriteAllText(BuildIdentityPath,identity.ToString(Newtonsoft.Json.Formatting.Indented)+"\n");AssetDatabase.ImportAsset(BuildIdentityPath,ImportAssetOptions.ForceUpdate);
            return identity;
        }

        static void CleanupBuildIdentity(){AssetDatabase.DeleteAsset(BuildIdentityPath);AssetDatabase.Refresh();}

        static string FileSha256(string path)
        {
            using var sha=SHA256.Create();using var stream=File.OpenRead(path);
            return string.Concat(sha.ComputeHash(stream).Select(value=>value.ToString("x2"))).Substring(0,16);
        }

        static string GitCommit()
        {
            var fromEnvironment=Environment.GetEnvironmentVariable("GITHUB_SHA");if(!string.IsNullOrWhiteSpace(fromEnvironment))return fromEnvironment;
            try
            {
                var info=new System.Diagnostics.ProcessStartInfo("git",$"-C \"{Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(),"../.."))}\" rev-parse HEAD")
                {UseShellExecute=false,RedirectStandardOutput=true,CreateNoWindow=true};
                using var process=System.Diagnostics.Process.Start(info);var value=process.StandardOutput.ReadToEnd().Trim();process.WaitForExit();return process.ExitCode==0?value:"unknown";
            }
            catch{return "unknown";}
        }

        static void StampBuildVersion(string stamp)
        {
            // The PWA template ships a __MINIMARKET_BUILD_STAMP__ token so the cache-busting
            // query and the service-worker cache name can never drift from the
            // build they serve. A fixed version meant a new build kept reading the
            // previous catalog in any browser that already held a worker.
            foreach(var path in new[]{"Builds/WebGL/index.html","Builds/WebGL/service-worker.js","Builds/WebGL/sw.js"})
            {
                if(!File.Exists(path))continue;
                var content=File.ReadAllText(path);
                if(!content.Contains("__MINIMARKET_BUILD_STAMP__"))continue;
                File.WriteAllText(path,content.Replace("__MINIMARKET_BUILD_STAMP__",stamp));
            }
        }

        static void PruneWebStreamingAssets()
        {
            const string root="Builds/WebGL/StreamingAssets";var catalogPath=Path.Combine(root,"Data/runtime-asset-catalog.json");
            var catalog=JObject.Parse(File.ReadAllText(catalogPath));var entries=(JArray)catalog["entries"];
            for(var index=entries.Count-1;index>=0;index--)
            {
                var entry=(JObject)entries[index];var kind=entry.Value<string>("kind");var id=entry.Value<string>("id");
                var keep=kind is "character-motion" or "product" or "hair" or "hat" or "metadata"
                    || kind=="character"&&(id.EndsWith(":LOD2",StringComparison.OrdinalIgnoreCase)||id.EndsWith(":LOD3",StringComparison.OrdinalIgnoreCase))
                    || kind=="environment"&&WebEnvironmentAssets.Contains(id);
                if(keep)continue;var path=Path.Combine(root,entry.Value<string>("path"));if(File.Exists(path))File.Delete(path);entries.RemoveAt(index);
            }
            var counts=new JObject();foreach(var entry in entries){var kind=entry.Value<string>("kind");counts[kind]=(counts.Value<int?>(kind)??0)+1;}
            catalog["counts"]=counts;catalog["totalBytes"]=entries.Sum(entry=>entry.Value<long>("bytes"));File.WriteAllText(catalogPath,catalog.ToString(Newtonsoft.Json.Formatting.Indented)+"\n");
        }
    }
}
#endif
