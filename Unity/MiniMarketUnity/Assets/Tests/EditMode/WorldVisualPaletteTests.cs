using System.Reflection;
using MiniMarket.Assets;
using MiniMarket.Store;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace MiniMarket.Tests
{
    public sealed class WorldVisualPaletteTests
    {
        GameObject root;

        [TearDown]
        public void TearDown()
        {
            if(root)Object.DestroyImmediate(root);
        }

        [Test]
        public void HangingDepartmentSignsAimOneReadableLabelAtTheGameplayCamera()
        {
            root=new GameObject("StoreWorld");root.transform.localScale=Vector3.one*StoreWorldBuilder.StoreScale;
            var build=typeof(StoreWorldBuilder).GetMethod("BuildPremiumHangingSign",BindingFlags.NonPublic|BindingFlags.Static);
            for(var index=0;index<6;index++)
                LogAssert.Expect(LogType.Error,"Destroy may not be called from edit mode! Use DestroyImmediate instead.\nDestroying an object in edit mode destroys it permanently.");

            build.Invoke(null,new object[]{root.transform,"HorizontalSign","PANADERÍA",0f,0f,0f,17f,10.8f});
            build.Invoke(null,new object[]{root.transform,"VerticalSign","DESPENSA",0f,0f,90f,17f,10.8f});

            var cameraSide=new Vector3(-16f,0,25.75f).normalized;
            foreach(var signName in new[]{"HorizontalSign","VerticalSign"})
            {
                var board=root.transform.Find(signName);
                var text=root.transform.Find($"{signName}_CameraText").GetComponent<TextMesh>();
                Assert.That(root.GetComponentsInChildren<TextMesh>(),Has.Length.EqualTo(2));
                Assert.That(Vector3.Dot((text.transform.position-board.position).normalized,-text.transform.forward),Is.GreaterThan(.99f));
                Assert.That(Vector3.Dot(-text.transform.forward,cameraSide),Is.GreaterThan(.5f));
            }
        }

        [Test]
        public void ShelfSemanticMaterialsResolveToTheSharedFurnitureLanguage()
        {
            root=GameObject.CreatePrimitive(PrimitiveType.Cube);root.name="ShelfGondolaDouble";
            var source=new Material(Shader.Find("Sprites/Default")){name="Polished_dark_1.00_0.00_0.55"};
            root.GetComponent<Renderer>().sharedMaterial=source;

            WorldPalette.Apply("ShelfGondolaDouble",root);

            var actual=root.GetComponent<Renderer>().sharedMaterial.color;
            Assert.That(actual.r,Is.EqualTo(WorldPalette.Linear(WorldPalette.ShelfStructure).r).Within(.001f));
            Assert.That(actual.g,Is.EqualTo(WorldPalette.Linear(WorldPalette.ShelfStructure).g).Within(.001f));
            Assert.That(actual.b,Is.EqualTo(WorldPalette.Linear(WorldPalette.ShelfStructure).b).Within(.001f));
        }

        [Test]
        public void TreeCrownsUseDarkMidAndLightGreensByHeight()
        {
            root=new GameObject("Tree");
            foreach(var y in new[]{1f,2f,3f})
            {
                var crown=GameObject.CreatePrimitive(PrimitiveType.Sphere);crown.name="TreeCrown";crown.transform.SetParent(root.transform);crown.transform.localPosition=Vector3.up*y;
                crown.GetComponent<Renderer>().sharedMaterial=new Material(Shader.Find("Sprites/Default")){name="Polished_leaf2_1.00_0.00_0.62"};
            }

            WorldPalette.Apply("Tree",root);

            var crowns=root.GetComponentsInChildren<Renderer>();
            System.Array.Sort(crowns,(left,right)=>left.bounds.center.y.CompareTo(right.bounds.center.y));
            Assert.That(crowns[0].sharedMaterial.color.r,Is.EqualTo(WorldPalette.Linear(WorldPalette.TreeDark).r).Within(.001f));
            Assert.That(crowns[1].sharedMaterial.color.g,Is.EqualTo(WorldPalette.Linear(WorldPalette.TreeMid).g).Within(.001f));
            Assert.That(crowns[2].sharedMaterial.color.b,Is.EqualTo(WorldPalette.Linear(WorldPalette.TreeLight).b).Within(.001f));
        }
    }
}
