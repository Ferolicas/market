#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using MiniMarket.Persistence;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEngine;

namespace MiniMarket.Editor
{
    public static class ProductionReadinessValidator
    {
        const string CatalogPath="Assets/StreamingAssets/Data/runtime-asset-catalog.json";

        [MenuItem("Mini Market/Validate Production Readiness")]
        public static void ValidateMenu()=>ValidateForCi();

        public static void ValidateForCi()
        {
            var errors=new List<string>();var warnings=new List<string>();
            Require(File.Exists("Assets/Scenes/Store.unity"),"Falta la escena Store",errors);
            Require(LocalSaveEnvelope.CurrentSchemaVersion>0,"El esquema de save debe estar versionado",errors);
            Require(PlayerSettings.GetApplicationIdentifier(NamedBuildTarget.Android)=="app.olcas.market","Bundle ID Android incorrecto",errors);
            Require(PlayerSettings.GetApplicationIdentifier(NamedBuildTarget.iOS)=="app.olcas.market","Bundle ID iOS incorrecto",errors);
            Require(PlayerSettings.Android.targetArchitectures.HasFlag(AndroidArchitecture.ARM64),"Android ARM64 no está habilitado",errors);
            Require((int)PlayerSettings.Android.minSdkVersion>=26,"Android mínimo debe ser API 26 o superior",errors);
            Require(Version.TryParse(PlayerSettings.iOS.targetOSVersionString,out var ios)&&ios.Major>=15,"iOS mínimo debe ser 15 o superior",errors);

            var projectSettings=File.ReadAllText("ProjectSettings/ProjectSettings.asset");
            Require(projectSettings.Contains("activeInputHandler: 2"),"Active Input Handling debe ser Both",errors);
            ValidateCatalog(errors,warnings);
            ValidateSurfaceTextures(errors,warnings);

            foreach(var warning in warnings)Debug.LogWarning("VALIDATOR "+warning);
            if(errors.Count>0)throw new BuildFailedException("Validación de producción falló:\n- "+string.Join("\n- ",errors));
            Debug.Log($"MINIMARKET_VALIDATION ok catalog=runtime saveSchema={LocalSaveEnvelope.CurrentSchemaVersion} warnings={warnings.Count}");
        }

        static void ValidateCatalog(List<string> errors,List<string> warnings)
        {
            if(!File.Exists(CatalogPath)){errors.Add("Falta runtime-asset-catalog.json");return;}
            JObject catalog;
            try{catalog=JObject.Parse(File.ReadAllText(CatalogPath));}
            catch(Exception exception){errors.Add("Catálogo JSON inválido: "+exception.Message);return;}
            if(catalog["entries"] is not JArray entries){errors.Add("El catálogo no contiene entries");return;}
            var ids=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach(var token in entries)
            {
                var id=token.Value<string>("id");var relative=token.Value<string>("path");
                if(string.IsNullOrWhiteSpace(id)||!ids.Add(id)){errors.Add("ID de asset vacío o duplicado: "+(id??"<vacío>"));continue;}
                var path=Path.Combine("Assets/StreamingAssets",relative??"");
                if(!File.Exists(path)){errors.Add($"Asset {id} ausente: {relative}");continue;}
                var actual=new FileInfo(path).Length;var declared=token.Value<long?>("bytes")??-1;
                if(declared>=0&&declared!=actual)errors.Add($"Bytes desactualizados en {id}: catálogo={declared}, archivo={actual}");
                if(actual>15*1024*1024)warnings.Add($"Asset grande {id}: {actual/1048576d:0.0} MB");
            }
        }

        static void ValidateSurfaceTextures(List<string> errors,List<string> warnings)
        {
            foreach(var guid in AssetDatabase.FindAssets("t:Texture2D",new[]{"Assets/Resources/Surfaces"}))
            {
                var path=AssetDatabase.GUIDToAssetPath(guid);
                if(AssetImporter.GetAtPath(path) is not TextureImporter importer)continue;
                if(importer.maxTextureSize>2048)errors.Add($"Textura de superficie supera 2048: {path}");
                if(!importer.mipmapEnabled)warnings.Add($"Textura sin mipmaps: {path}");
            }
        }

        static void Require(bool condition,string message,List<string> errors){if(!condition)errors.Add(message);}
    }
}
#endif
