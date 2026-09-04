using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using MiniMarket.Assets;
using MiniMarket.Data;
using MiniMarket.Interactions;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.AI;
using Unity.AI.Navigation;
using UnityEngine.Rendering;

namespace MiniMarket.Store
{
    public sealed class StoreWorldBuilder
    {
        readonly RuntimeGltfLoader loader;
        readonly GameSpecRepository spec;
        readonly InteractionDirector interactions;
        readonly Transform parent;
        static readonly Dictionary<string,Material> RuntimeMaterials=new();
        const float LayoutScale = 2f;
        const float ElementScale = 1.6f;

        static readonly Dictionary<string, string> DisplayAssets = new()
        {
            ["bakery"] = "DisplayBakery", ["pantry"] = "ShelfWallTall", ["eggs"] = "EggDisplay",
            ["produce"] = "DisplayProduceMixed", ["dairy"] = "DisplayRefrigeratedDoors", ["drinks"] = "ShelfWallWide",
        };
        static readonly Dictionary<string, string> ProductAssets = new()
        {
            ["tomatoes"] = "Tomato", ["apples"] = "Apple", ["corn"] = "Corn", ["eggs"] = "Egg",
            ["milk"] = "Milk", ["cheese"] = "Cheese", ["juice"] = "Juice", ["bread"] = "Bread",
            ["flour"] = "Flour", ["wheat"] = "Wheat", ["coffee"] = "Coffee",
        };
        static readonly Dictionary<string, float> TargetLongestDimension = new()
        {
            ["StoreEntrance"]=7.1f,["StoreEntranceAlt"]=7.1f,["AutomaticDoor"]=5.8f,["StorefrontWindow"]=8.5f,["WallStraight"]=4.6f,
            ["RoadSegment"]=8f,["SidewalkSegment"]=8f,["Crosswalk"]=7f,["CityBuilding"]=11f,
            ["Car"]=4.2f,["BusStop"]=3.4f,["Bench"]=2.2f,["Tree"]=4.5f,["StreetLight"]=5.2f,
            ["ShelfWallTall"]=3.2f,["ShelfWallWide"]=3.5f,["EggDisplay"]=2.5f,
            ["DisplayProduceMixed"]=3.1f,["DisplayBakery"]=3.1f,["DisplayRefrigeratedDoors"]=3.5f,
            ["CheckoutArea"]=7.12f,["OperationsWall"]=14.5f,["BackroomStorage"]=4f,["StockroomRack"]=3.7f,
            ["SeasonalDisplay"]=3.3f,["ShelfEndcap"]=3.1f,["ReturnsStation"]=2.4f,["CartBay"]=3.4f,
            ["WallClock"]=.7f,["SecurityCamera"]=.7f,["HangingSign"]=2.5f,["CeilingLight"]=2.2f,
            ["FlourMillAlt"]=2.1f,["BreadOven"]=2.2f,["CheeseMachine"]=2.1f,["JuiceMachineAlt"]=2.1f,
            ["FarmPlotFurrows"]=3.0f,["FarmToolSet"]=1.7f,["CompostBin"]=1.5f,["MiniGreenhouse"]=3.4f,
            ["Scarecrow"]=2.0f,["FarmWaterTank"]=2.5f,["Chicken"]=1.0f,["Cow"]=2.2f,
            ["SupplierTerminal"]=1.7f,["DeliveryDock"]=3.0f,["HiringPoint"]=1.7f,["UpgradePlatform"]=2.4f,["BasketStack"]=1.5f,
        };
        static readonly Dictionary<string,Vector3> TargetLocalSize=new()
        {
            ["DisplayBakery"]=new(3.68f,3.65f,1.35f),["ShelfWallTall"]=new(3.68f,3.45f,1.8f),["EggDisplay"]=new(3.55f,3.35f,1.35f),
            ["DisplayProduceMixed"]=new(3.87f,3.5f,2.4f),["DisplayRefrigeratedDoors"]=new(3.97f,4f,1.5f),["ShelfWallWide"]=new(3.81f,3.9f,1.5f),
            ["CheckoutArea"]=new(7.12f,4.95f,1.9f),["OperationsWall"]=new(15.05f,4.1f,1.4f),["BackroomStorage"]=new(3.76f,4.32f,1.5f),
            ["StockroomRack"]=new(2.66f,3.52f,1.32f),["SeasonalDisplay"]=new(3.12f,3.2f,1.38f),["ShelfEndcap"]=new(1.89f,3.2f,1.25f),
            ["ReturnsStation"]=new(2.3f,2.4f,1.7f),["CartBay"]=new(3.36f,2.75f,2.32f),
            ["FlourMillAlt"]=new(2.3f,3.25f,2.05f),["BreadOven"]=new(2.55f,3.25f,2.05f),["CheeseMachine"]=new(2.25f,3.2f,2.05f),["JuiceMachineAlt"]=new(2.25f,3.2f,2.05f),
            ["SupplierTerminal"]=new(1.9f,2.45f,1.05f),["DeliveryDock"]=new(3.1f,1.6f,2.2f),
        };

        public StoreWorldBuilder(RuntimeGltfLoader assetLoader, GameSpecRepository repository, InteractionDirector director, Transform worldParent)
        { loader = assetLoader; spec = repository; interactions = director; parent = worldParent; }

        public async Task<StoreWorld> BuildAsync()
        {
            var world = new StoreWorld { Root = New("StoreWorld", Vector3.zero) };
            await BuildWalkableFloor(world.Root);
            await BuildEnvelope(world);
            await BuildExterior(world.Root);
            await BuildFixedInterior(world.Root);
            await BuildRetail(world);
            await BuildCheckout(world);
            await BuildProduction(world);
            await BuildFarm(world);
            await BuildServices(world);
            BuildNavigationAnchors(world);
            BuildNavMesh(world.Root);
            BuildOuterGroundCollider(parent);
            StaticBatchingUtility.Combine(world.Root.gameObject);
            return world;
        }

        async Task BuildWalkableFloor(Transform root)
        {
            // Neutral world backing is not an authored object. Every occupied
            // floor surface below is composed from the supplied floor GLBs.
            VisualBox(root,"CityGround",new Vector3(108,.1f,128),new Vector3(0,-.2f,-4),Hex("F0E2E5"),.12f,false);
            // Each floor GLB already carries a 3 x 2 sub-grid, so two columns by
            // three rows reproduce the 6 x 6 panel seams MarketBuilding draws
            // across this same 46 x 34 floor. Placing one GLB per panel gave
            // 18 x 10 tiles and read as bathroom tiling next to the Next frame.
            const float storeModuleWidth=46f/2f;const float storeModuleDepth=34f/3f;
            for(var column=0;column<2;column++)for(var row=0;row<3;row++)
                await PlaceFitted("FloorTileBeige",new Vector3(-23+storeModuleWidth*(column+.5f),-.16f,-17.7f+storeModuleDepth*(row+.5f)),Quaternion.identity,new Vector3(storeModuleWidth,.16f,storeModuleDepth),root,false);
            // The apron is a single seamless slab in Next; two modules keep the
            // store's six-across rhythm without inventing extra grout lines.
            const float apronModuleWidth=46f/2f;const float apronModuleDepth=15f;
            for(var column=0;column<2;column++)
                await PlaceFitted("FloorTileWhite",new Vector3(-23+apronModuleWidth*(column+.5f),-.14f,16.3f+apronModuleDepth*.5f),Quaternion.identity,new Vector3(apronModuleWidth,.14f,apronModuleDepth),root,false);
            // MarketBuilding's entrance mat: the dark slab the player crosses in
            // the doorway, authored at [0, 0.035, 7.02] with a 3.75 x 1.05
            // footprint beneath the layout-scale group, and receiveShadow only.
            // KNOWN GAP: geometry and placement match Next, but this renders at
            // roughly a tenth of the expected diffuse light. Ruled out so far:
            // colour space, shader support, shadow casting, shadow receiving
            // and static batching. The neighbouring glTF floor lights correctly.
            var entranceMat=VisualBox(root,"EntranceMat",new Vector3(7.5f,.055f,2.1f),new Vector3(0,.035f,14.04f),Hex("2B4B43"),.08f,false);
            entranceMat.GetComponent<Renderer>().shadowCastingMode=ShadowCastingMode.Off;
            foreach(var x in new[]{-12f,0,12f})await PlaceFitted("ParkingSpace",new Vector3(x,-.08f,32.3f),Quaternion.identity,new Vector3(8f,.12f,2.4f),root,false);
            await PlaceFitted("SidewalkSegment",new Vector3(-15,-.105f,-19.22f),Quaternion.identity,new Vector3(5.16f,.08f,4.4f),root,false);

            // Physics-only navigation surface, matching STORE_NAVIGATION_BOUNDS.
            // Keeps its surface at y = 0 like MarketBuilding's collider, but two
            // units thick: at 0.12 a single frame of the downward stick force
            // (1.177 * dt, so 0.196 at 6 fps) stepped clean through the slab and
            // the player sank under the floor while walking.
            var floor=VisualBox(root,"NavigationFloor",new Vector3(53.4f,2f,68.6f),new Vector3(0,-1f,-2.5f),Color.clear,0,true);
            floor.GetComponent<Renderer>().enabled=false;
            await Task.CompletedTask;
        }

        static Material CreateFloorMaterial()
        {
            return RuntimeMaterial("StoreFloor_SoftMatte",new Color(.72f,.67f,.54f,1f),.08f);
        }

        async Task BuildExterior(Transform root)
        {
            for(var segment=0;segment<9;segment++)await PlaceFitted("RoadSegment",new Vector3(-32+segment*8,-.08f,36.5f),Quaternion.identity,new Vector3(8f,.09f,7.6f),root,false);
            const float sidewalkWidth=53.6f/7f;
            for(var segment=0;segment<7;segment++)await PlaceFitted("SidewalkSegment",new Vector3(-26.8f+sidewalkWidth*(segment+.5f),-.03f,32.1f),Quaternion.identity,new Vector3(sidewalkWidth,.1f,2.2f),root,false);

            var buildings=new[]{(-10.5f,-26.1f),(-4.4f,-26.5f),(1.3f,-26.3f),(7.3f,-26f),(19.2f,-7.1f),(19.4f,-.8f),(19.1f,5.2f),(-19.1f,-6.2f),(-19.3f,.1f),(-19.1f,6.7f)};
            foreach(var (x,z) in buildings)await Place("CityBuilding",XZ(x,z),Quaternion.Euler(0,z<-20?0:x>0?-90:90,0),Vector3.one,root,true);
            var trees=new[]{(-12.7f,-19f),(-12.7f,-4f),(-12.7f,2f),(-12.7f,8f),(-12.7f,13.2f),(12.7f,-19f),(12.7f,-4f),(12.7f,2f),(12.7f,8f),(12.7f,13.2f),(-10f,20.7f),(-4f,20.7f),(4f,20.7f),(10f,20.7f)};
            foreach(var (x,z) in trees)await Place("Tree",XZ(x,z),Quaternion.identity,Vector3.one,root);
            var lights=new[]{(-13.1f,-7f),(-13.1f,5f),(-13.1f,13f),(13.1f,-7f),(13.1f,5f),(13.1f,13f),(-8f,-19.35f),(8f,-19.35f),(-8f,16.55f),(8f,16.55f)};
            foreach(var (x,z) in lights)await Place("StreetLight",XZ(x,z),Quaternion.identity,Vector3.one,root);

            await Place("Car",XZ(-8.2f,18.25f),Quaternion.identity,Vector3.one,root,true);
            await Place("Car",XZ(7.1f,18.25f),Quaternion.Euler(0,180,0),Vector3.one,root,true);
            await Place("Car",XZ(-15.85f,-2.5f),Quaternion.Euler(0,90,0),Vector3.one,root,true);
            await Place("Car",XZ(15.85f,8f),Quaternion.Euler(0,-90,0),Vector3.one,root,true);
            await Place("BusStop",XZ(-11.2f,20.35f),Quaternion.Euler(0,180,0),Vector3.one,root,true);
            await Place("Bench",XZ(9.4f,20.55f),Quaternion.identity,Vector3.one,root,true);
            await Place("Crosswalk",XZ(0,17.95f),Quaternion.identity,Vector3.one,root);
            await Place("Crosswalk",XZ(-15.55f,9.2f),Quaternion.Euler(0,90,0),Vector3.one,root);
        }

        async Task BuildEnvelope(StoreWorld world)
        {
            // Exact 23 x 17 logical store envelope (layout scale 2).
            const float sideModule=32.66f/7f;
            foreach(var x in new[]{-23f,23f})for(var module=0;module<7;module++)
                await PlaceFitted("WallStraight",new Vector3(x,0,-17.1f+sideModule*(module+.5f)),Quaternion.Euler(0,90,0),new Vector3(sideModule,5.6f,.34f),world.Root,false);
            const float rearModule=35.28f/6f;
            for(var module=0;module<6;module++)await PlaceFitted("WallStraight",new Vector3(-12.28f+rearModule*(module+.5f),0,-17.1f),Quaternion.identity,new Vector3(rearModule,5.6f,.64f),world.Root,false);
            await PlaceFitted("WallStraight",new Vector3(-20.36f,0,-17.1f),Quaternion.identity,new Vector3(5.28f,5.6f,.64f),world.Root,false);
            PhysicsBox(world.Root,"LeftWallCollider",new Vector3(.34f,5.6f,34.4f),new Vector3(-23,2.8f,-.7f));
            PhysicsBox(world.Root,"RightWallCollider",new Vector3(.34f,5.6f,34.4f),new Vector3(23,2.8f,-.7f));
            PhysicsBox(world.Root,"RearWallLeftCollider",new Vector3(35.28f,5.6f,.64f),new Vector3(5.36f,2.8f,-17.1f));
            PhysicsBox(world.Root,"RearWallRightCollider",new Vector3(5.28f,5.6f,.64f),new Vector3(-20.36f,2.8f,-17.1f));

            await BuildStorefront(world.Root);
            await BuildRearFarmDoor(world.Root);
        }

        async Task BuildStorefront(Transform root)
        {
            // Visuals come exclusively from the supplied mosaic GLBs. Four
            // modules fill the exact two 19.06 m storefront spans while the
            // central 7.48 m automatic-door opening remains unchanged.
            foreach(var x in new[]{-17.935f,-8.405f,8.405f,17.935f})
            {
                var window=await PlaceFitted("StorefrontWindow",new Vector3(x,0,15.6f),Quaternion.identity,new Vector3(9.53f,5.6f,.72f),root,false);
                window.AddComponent<StorefrontCameraCutaway>();
            }
            // The entrance module is the shop's door: it carries the sign, the
            // bollards and the two sliding leaves the sensor drives. It joins the
            // cutaway like the rest of the facade -- seen from the street, out of
            // the way once you are inside, which is what the original does. Left
            // always visible it stands between the isometric camera and the
            // player and hides him behind its own sign.
            var door=await PlaceFitted("StoreEntrance",new Vector3(0,0,15.9f),Quaternion.identity,
                                       new Vector3(8.6f,6.2f,4.4f),root,false);
            RestOnFloor(door,0f);
            door.AddComponent<StorefrontCameraCutaway>();
            doorLeaves=(FindLeaf(door.transform,"tripo_part_27"),FindLeaf(door.transform,"tripo_part_47"));

            // Physics remains independent from art: side facade collision is
            // exact, while the automatic doorway keeps its Next.js opening.
            PhysicsBox(root,"StorefrontCollider_Left",new Vector3(19.06f,5.6f,.64f),new Vector3(-13.17f,2.8f,15.6f));
            PhysicsBox(root,"StorefrontCollider_Right",new Vector3(19.06f,5.6f,.64f),new Vector3(13.17f,2.8f,15.6f));
            var sensor=new GameObject("StorefrontDoorSensor");sensor.transform.SetParent(root,false);sensor.transform.localPosition=new Vector3(0,1.5f,17f);var trigger=sensor.AddComponent<BoxCollider>();trigger.isTrigger=true;trigger.size=new Vector3(9.4f,3f,9.2f);var body=sensor.AddComponent<Rigidbody>();body.isKinematic=true;body.useGravity=false;
            // Drive the entrance's own leaves from the sensor. The presenter
            // existed but was never wired to anything, so the door has never
            // opened. The slide is measured from a leaf's own width, because the
            // leaves live inside an instance scaled to fit the doorway.
            if(doorLeaves.left&&doorLeaves.right)
            {
                var presenter=sensor.AddComponent<StorefrontDoorPresenter>();
                var leafRenderer=doorLeaves.left.GetComponent<Renderer>();
                var width=leafRenderer?leafRenderer.localBounds.size.x:1f;
                presenter.Bind(doorLeaves.left,doorLeaves.right,width*.92f);
            }
        }

        (Transform left,Transform right) doorLeaves;

        /// FitLocalSize only scales; the mosaic exports are centred on their own
        /// origin, so an instance placed at floor level ends up half sunk.
        static void RestOnFloor(GameObject instance,float floorY)
        {
            var renderers=instance.GetComponentsInChildren<Renderer>(true);
            if(renderers.Length==0)return;
            var bounds=renderers[0].bounds;
            for(var i=1;i<renderers.Length;i++)bounds.Encapsulate(renderers[i].bounds);
            instance.transform.position+=Vector3.up*(floorY-bounds.min.y);
        }

        static Transform FindLeaf(Transform root,string name)
        {
            foreach(var child in root.GetComponentsInChildren<Transform>(true))
                if(child.name==name)return child;
            return null;
        }

        static void PhysicsBox(Transform root,string name,Vector3 size,Vector3 position)
        {
            var box=new GameObject(name);box.transform.SetParent(root,false);box.transform.position=position;var collider=box.AddComponent<BoxCollider>();collider.size=size;box.isStatic=true;
        }


        async Task BuildRearFarmDoor(Transform root)
        {
            await PlaceFitted("AutomaticDoor",new Vector3(-15,0,-17.1f),Quaternion.Euler(0,180,0),new Vector3(5.68f,3.8f,.5f),root,false);
        }

        static void BuildWallSegment(Vector3 position,Quaternion rotation,Transform root)
        {
            var holder=new GameObject("WallStraight_Runtime").transform;holder.SetParent(root,false);holder.localPosition=position;holder.localRotation=rotation;
            WallBox(holder,"Wall",new Vector3(4.62f,2.85f,.24f),new Vector3(0,1.425f,0),new Color(.86f,.80f,.67f));
            WallBox(holder,"Base",new Vector3(4.68f,.5f,.31f),new Vector3(0,.25f,0),new Color(.13f,.15f,.15f));
            WallBox(holder,"Accent",new Vector3(4.68f,.17f,.32f),new Vector3(0,.62f,0),new Color(.25f,.38f,.23f));
            WallBox(holder,"Cap",new Vector3(4.72f,.2f,.33f),new Vector3(0,2.95f,0),new Color(.12f,.14f,.14f));
        }

        static void WallBox(Transform parent,string name,Vector3 size,Vector3 localPosition,Color color)
        {
            var part=GameObject.CreatePrimitive(PrimitiveType.Cube);part.name=name;part.transform.SetParent(parent,false);part.transform.localPosition=localPosition;part.transform.localScale=size;part.isStatic=true;
            part.GetComponent<Renderer>().sharedMaterial=RuntimeMaterial($"{name}_RoyalMatch",color,.1f);
        }

        static Material RuntimeMaterial(string name,Color color,float smoothness)
        {
            if(RuntimeMaterials.TryGetValue(name,out var existing)&&existing)return existing;
            var material=new Material(PrimitiveTemplate()){name=name};material.color=color;material.SetFloat("_Metallic",0);material.SetFloat("_Smoothness",smoothness);RuntimeMaterials[name]=material;
            return material;
        }

        static Shader primitiveTemplate;
        /// Resources.Load keeps the shader's compiled variants in the player;
        /// Shader.Find alone resolves a name the build may have stripped.
        static Shader PrimitiveTemplate()
        {
            if(primitiveTemplate)return primitiveTemplate;
            var template=Resources.Load<Material>("RuntimePrimitive");
            primitiveTemplate=template?template.shader:Shader.Find("Universal Render Pipeline/Lit");
            return primitiveTemplate;
        }

        static Material TransparentRuntimeMaterial(string name,Color color)
        {
            if(RuntimeMaterials.TryGetValue(name,out var existing)&&existing)return existing;
            var material=new Material(PrimitiveTemplate()){name=name,color=color,renderQueue=(int)RenderQueue.Transparent};
            material.SetFloat("_Surface",1);material.SetFloat("_Blend",0);material.SetFloat("_Metallic",.02f);material.SetFloat("_Smoothness",.92f);material.SetFloat("_ZWrite",0);
            material.SetInt("_SrcBlend",(int)BlendMode.SrcAlpha);material.SetInt("_DstBlend",(int)BlendMode.OneMinusSrcAlpha);material.SetOverrideTag("RenderType","Transparent");
            material.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");material.DisableKeyword("_ALPHAPREMULTIPLY_ON");material.enableInstancing=true;RuntimeMaterials[name]=material;return material;
        }

        static GameObject VisualBox(Transform root,string name,Vector3 size,Vector3 position,Color color,float smoothness,bool collider)
        {
            var box=GameObject.CreatePrimitive(PrimitiveType.Cube);box.name=name;box.transform.SetParent(root,false);box.transform.position=position;box.transform.localScale=size;box.isStatic=true;
            box.GetComponent<Renderer>().sharedMaterial=RuntimeMaterial($"{name}_Material",color,smoothness);
            if(!collider)UnityEngine.Object.Destroy(box.GetComponent<Collider>());
            return box;
        }

        static Color Hex(string value)
        {
            // CSS/Three reference colours are sRGB; Unity material properties
            // are linear in this project.  Converting here prevents all dark
            // greens and mid-tones from being gamma-lifted and washed out.
            return ColorUtility.TryParseHtmlString($"#{value}",out var color)?color.linear:Color.magenta;
        }

        static Color WithAlpha(Color color,float alpha){color.a=alpha;return color;}

        static GameObject FurniturePart(Transform root,string name,PrimitiveType primitive,Vector3 localPosition,Vector3 localScale,Color color,float smoothness=.12f,Quaternion? localRotation=null)
        {
            var part=GameObject.CreatePrimitive(primitive);part.name=name;part.transform.SetParent(root,false);part.transform.localPosition=localPosition;part.transform.localRotation=localRotation??Quaternion.identity;part.transform.localScale=localScale;part.isStatic=true;
            part.GetComponent<Renderer>().sharedMaterial=RuntimeMaterial($"{name}_{ColorUtility.ToHtmlStringRGB(color)}",color,smoothness);
            UnityEngine.Object.Destroy(part.GetComponent<Collider>());return part;
        }

        static GameObject BuildSeasonalDisplayRuntime(Transform parent,Vector3 position)
        {
            const float s=ElementScale;var root=new GameObject("SeasonalDisplay_Runtime");root.transform.SetParent(parent,false);root.transform.localPosition=position;
            var steel=Hex("53666B");var wood=Hex("A8835D");
            FurniturePart(root.transform,"SeasonalBase",PrimitiveType.Cube,new Vector3(0,.08f*s,0),new Vector3(1.95f,.14f,.86f)*s,steel);
            foreach(var x in new[]{-.88f,.88f})FurniturePart(root.transform,"SeasonalUpright",PrimitiveType.Cube,new Vector3(x,.96f,-.3f)*s,new Vector3(.075f,1.85f,.075f)*s,steel);
            var levels=new[]{.32f,.75f,1.18f,1.61f};
            foreach(var y in levels)
            {
                FurniturePart(root.transform,"SeasonalShelf",PrimitiveType.Cube,new Vector3(0,y,0)*s,new Vector3(1.82f,.09f,.68f)*s,wood,.08f,Quaternion.Euler(-11.46f,0,0));
                FurniturePart(root.transform,"SeasonalRail",PrimitiveType.Cube,new Vector3(0,y+.02f,.35f)*s,new Vector3(1.86f,.11f,.04f)*s,steel);
            }
            foreach(var y in levels)foreach(var x in new[]{-.55f,0,.55f})
            {
                FurniturePart(root.transform,"SeasonalPlanter",PrimitiveType.Cylinder,new Vector3(x,y+.14f,0)*s,new Vector3(.15f,.08f,.15f)*s,Hex("B06E46"),.08f);
                FurniturePart(root.transform,"SeasonalFoliage",PrimitiveType.Sphere,new Vector3(x,y+.34f,0)*s,new Vector3(.2f,.27f,.2f)*s,Hex("5D8B5B"),.06f);
            }
            AddRuntimeBoundsCollider(root);return root;
        }

        static void RetailBackPanel(Transform root,float width,float height,float z,Color color,float s)
        {
            FurniturePart(root,"RetailBackPanel",PrimitiveType.Cube,new Vector3(0,height*.5f,z)*s,new Vector3(width,height,.075f)*s,color,.08f);
            for(var index=0;index<7;index++)
            {
                var y=.22f+index*Mathf.Max(.2f,(height-.34f)/6f);
                FurniturePart(root,"RetailBackSlat",PrimitiveType.Cube,new Vector3(0,y,z+.042f)*s,new Vector3(width*.86f,.012f,.012f)*s,Hex("747D79"),.22f);
            }
        }

        static void RetailUprights(Transform root,float width,float height,float z,float s)
        {
            foreach(var side in new[]{-1f,1f})foreach(var postZ in new[]{z-.03f,z+.09f})
                FurniturePart(root,"RetailUpright",PrimitiveType.Cube,new Vector3(side*(width*.5f-.055f),height*.5f,postZ)*s,new Vector3(.07f,height,.07f)*s,Hex("53666B"),.38f);
        }

        static void RetailShelfBank(Transform root,float[] levels,float width,float depth,float z,float front,Color accent,float s)
        {
            foreach(var y in levels)
            {
                FurniturePart(root,"RetailShelf",PrimitiveType.Cube,new Vector3(0,y,z)*s,new Vector3(width,.065f,depth)*s,Hex("D8DED9"),.12f);
                FurniturePart(root,"RetailShelfLip",PrimitiveType.Cube,new Vector3(0,y+.025f,z+front*(depth*.5f-.006f))*s,new Vector3(width+.035f,.105f,.035f)*s,Hex("53666B"),.32f);
                FurniturePart(root,"RetailShelfAccent",PrimitiveType.Cube,new Vector3(0,y+.075f,z+front*(depth*.5f+.017f))*s,new Vector3(width*.92f,.062f,.018f)*s,accent,.18f);
                foreach(var offset in new[]{-.31f,0,.31f})FurniturePart(root,"RetailPriceTag",PrimitiveType.Cube,new Vector3(offset*width,y+.075f,z+front*(depth*.5f+.029f))*s,new Vector3(.25f,.055f,.012f)*s,Hex("FFF8E7"),.06f);
            }
        }

        static GameObject BuildRetailDisplayRuntime(Transform parent,string department,Vector3 position)
        {
            const float s=ElementScale;
            var root=new GameObject($"Retail_{department}_Runtime");root.transform.SetParent(parent,false);root.transform.localPosition=position;
            var steel=Hex("53666B");
            var accent=department switch
            {
                "bakery"=>Hex("B96D39"),"pantry"=>Hex("6F4938"),"eggs"=>Hex("D49A34"),
                "produce"=>Hex("3F7B4C"),"dairy"=>Hex("4382A1"),_=>Hex("CC6841")
            };

            if(department=="produce")
            {
                FurniturePart(root.transform,"ProduceBase",PrimitiveType.Cube,new Vector3(0,.08f,0)*s,new Vector3(2.42f,.12f,1.5f)*s,steel,.22f);
                foreach(var x in new[]{-1.08f,1.08f})foreach(var z in new[]{-.58f,.58f})FurniturePart(root.transform,"ProduceLeg",PrimitiveType.Cube,new Vector3(x,.39f,z)*s,new Vector3(.09f,.7f,.09f)*s,steel,.24f);
                FurniturePart(root.transform,"ProduceBody",PrimitiveType.Cube,new Vector3(0,.43f,0)*s,new Vector3(2.28f,.54f,1.34f)*s,Hex("A8835D"),.08f);
                foreach(var x in new[]{-.92f,-.46f,0,.46f,.92f})FurniturePart(root.transform,"ProduceDivider",PrimitiveType.Cube,new Vector3(x,.44f,0)*s,new Vector3(.035f,.46f,1.37f)*s,Hex("6E482D"),.06f);
                foreach(var x in new[]{-.76f,0,.76f})
                {
                    FurniturePart(root.transform,"ProduceBin",PrimitiveType.Cube,new Vector3(x,.78f,-.29f)*s,new Vector3(.7f,.095f,.68f)*s,steel,.24f,Quaternion.Euler(9.74f,0,0));
                    foreach(var offset in new[]{-.35f,.35f})FurniturePart(root.transform,"ProduceBinSide",PrimitiveType.Cube,new Vector3(x+offset,.87f,-.29f)*s,new Vector3(.035f,.28f,.7f)*s,steel,.24f,Quaternion.Euler(9.74f,0,0));
                    FurniturePart(root.transform,"ProduceLabel",PrimitiveType.Cube,new Vector3(x,.78f,-.65f)*s,new Vector3(.63f,.2f,.035f)*s,accent,.18f);
                }
                FurniturePart(root.transform,"ProduceCanopy",PrimitiveType.Cube,new Vector3(0,1.16f,.3f)*s,new Vector3(1.65f,.11f,.58f)*s,steel,.22f,Quaternion.Euler(-5.73f,0,0));
                foreach(var x in new[]{-.92f,.92f})FurniturePart(root.transform,"ProduceSignPost",PrimitiveType.Cube,new Vector3(x,1.56f,.46f)*s,new Vector3(.055f,1.25f,.055f)*s,steel,.24f);
                FurniturePart(root.transform,"ProduceSign",PrimitiveType.Cube,new Vector3(0,2.16f,.46f)*s,new Vector3(2.02f,.28f,.08f)*s,accent,.16f);
            }
            else
            {
                var width=department=="eggs"?2.18f:department=="pantry"||department=="bakery"?2.24f:department=="drinks"?2.3f:2.42f;
                var depth=department=="pantry"?1.12f:department=="bakery"?.78f:department=="eggs"?.82f:department=="drinks"?.9f:.92f;
                var panelHeight=department=="bakery"?1.9f:department=="pantry"?1.82f:department=="eggs"?1.78f:2.13f;
                var panelZ=department=="pantry"?0:department=="eggs"?-.31f:-.34f;
                var baseZ=department=="bakery"?-.11f:0;
                FurniturePart(root.transform,"RetailBase",PrimitiveType.Cube,new Vector3(0,.08f,baseZ)*s,new Vector3(width,.16f,depth)*s,steel,.24f);
                RetailBackPanel(root.transform,width-.16f,panelHeight,panelZ,department switch{"bakery"=>Hex("D8C3A2"),"pantry"=>Hex("B69A77"),"eggs"=>Hex("D7C9AA"),"dairy"=>Hex("D5E2E0"),_=>Hex("D8D3C6")},s);
                RetailUprights(root.transform,width-.06f,panelHeight+.1f,panelZ,s);
                var levels=department switch
                {
                    "bakery"=>new[]{.28f,.63f,.98f,1.33f,1.68f},"pantry"=>new[]{.24f,.6f,.96f,1.32f,1.68f},
                    "eggs"=>new[]{.28f,.68f,1.08f,1.48f},"dairy"=>new[]{.32f,.72f,1.12f,1.52f,1.92f},_=>new[]{.3f,.7f,1.1f,1.5f,1.9f}
                };
                if(department=="pantry")
                {
                    RetailShelfBank(root.transform,levels,2.08f,.52f,.28f,1,accent,s);
                    RetailShelfBank(root.transform,levels,2.08f,.52f,-.28f,-1,accent,s);
                }
                else RetailShelfBank(root.transform,levels,department=="dairy"?2.18f:department=="drinks"?2.13f:department=="eggs"?2.02f:2.08f,department=="bakery"?.52f:.68f,department=="bakery"?.02f:0,1,accent,s);
                if(department=="dairy")
                {
                    foreach(var side in new[]{-1f,1f})
                    {
                        var x=side*.55f;
                        foreach(var edgeY in new[]{.16f,2.2f})FurniturePart(root.transform,"ColdDoorFrame",PrimitiveType.Cube,new Vector3(x,edgeY,.47f)*s,new Vector3(1.04f,.07f,.055f)*s,Hex("34423F"),.38f);
                        foreach(var edgeX in new[]{-.495f,.495f})FurniturePart(root.transform,"ColdDoorFrame",PrimitiveType.Cube,new Vector3(x+edgeX,1.18f,.47f)*s,new Vector3(.055f,2.08f,.055f)*s,Hex("34423F"),.38f);
                        TransparentBox(root.transform,"ColdDoorGlass",new Vector3(.94f,1.95f,.022f)*s,new Vector3(x,1.18f,.485f)*s,new Color(.78f,.93f,.94f,.18f),false);
                    }
                }
                FurniturePart(root.transform,"RetailTop",PrimitiveType.Cube,new Vector3(0,panelHeight+.08f,baseZ)*s,new Vector3(width+.08f,.18f,depth)*s,steel,.24f);
                FurniturePart(root.transform,"RetailDepartmentSign",PrimitiveType.Cube,new Vector3(0,panelHeight+.34f,.08f)*s,new Vector3(width-.28f,.28f,.08f)*s,accent,.16f);
            }
            AddRuntimeBoundsCollider(root);return root;
        }

        static GameObject BuildCartBayRuntime(Transform parent,Vector3 position)
        {
            const float s=ElementScale;var root=new GameObject("CartBay_Runtime");root.transform.SetParent(parent,false);root.transform.localPosition=position;
            var frame=Hex("C2CBC7");var metal=Hex("C6CECB");var gold=Hex("F0C45E");
            FurniturePart(root.transform,"CartBayBase",PrimitiveType.Cube,new Vector3(0,.035f,0)*s,new Vector3(2.1f,.07f,1.45f)*s,Hex("BEC7C3"));
            foreach(var x in new[]{-.96f,.96f})
            {
                FurniturePart(root.transform,"CartBaySide",PrimitiveType.Cube,new Vector3(x,.67f,0)*s,new Vector3(.075f,1.34f,1.45f)*s,frame);
                FurniturePart(root.transform,"CartBayGoldRail",PrimitiveType.Cube,new Vector3(x,.18f,0)*s,new Vector3(.16f,.14f,1.48f)*s,gold,.42f);
                FurniturePart(root.transform,"CartBayFinial",PrimitiveType.Sphere,new Vector3(x,1.35f,0)*s,Vector3.one*.2f*s,Hex("F0C45E"),.58f);
            }
            FurniturePart(root.transform,"CartBaySign",PrimitiveType.Cube,new Vector3(0,1.5f,-.66f)*s,new Vector3(2.08f,.4f,.12f)*s,Hex("F1E8CF"));
            WorldLabel(root.transform,"CartBayLabel","CARROS",new Vector3(0,1.5f*s,-.555f*s),Quaternion.Euler(0,180,0),.036f,Hex("214D40"));
            for(var cartIndex=0;cartIndex<3;cartIndex++)BuildSimpleCart(root.transform,new Vector3(0,0,(.42f-cartIndex*.26f)*s),s*(1-cartIndex*.055f),metal);
            AddRuntimeBoundsCollider(root);return root;
        }

        static void BuildSimpleCart(Transform parent,Vector3 localPosition,float scale,Color metal)
        {
            var cart=new GameObject("ShoppingCart_Runtime").transform;cart.SetParent(parent,false);cart.localPosition=localPosition;
            foreach(var y in new[]{.4f,.56f,.72f,.86f})
            {
                FurniturePart(cart,"CartBasketFrontRail",PrimitiveType.Cube,new Vector3(0,y,.39f)*scale,new Vector3(.9f,.025f,.025f)*scale,metal,.5f);
                FurniturePart(cart,"CartBasketBackRail",PrimitiveType.Cube,new Vector3(0,y,-.31f)*scale,new Vector3(.9f,.025f,.025f)*scale,metal,.5f);
            }
            foreach(var x in new[]{-.43f,-.22f,0,.22f,.43f})
            {
                FurniturePart(cart,"CartBasketFrontBar",PrimitiveType.Cube,new Vector3(x,.63f,.39f)*scale,new Vector3(.022f,.5f,.022f)*scale,metal,.5f);
                FurniturePart(cart,"CartBasketBackBar",PrimitiveType.Cube,new Vector3(x,.63f,-.31f)*scale,new Vector3(.022f,.5f,.022f)*scale,metal,.5f);
            }
            foreach(var z in new[]{-.31f,-.08f,.15f,.39f})foreach(var x in new[]{-.45f,.45f})FurniturePart(cart,"CartBasketSideBar",PrimitiveType.Cube,new Vector3(x,.63f,z)*scale,new Vector3(.022f,.5f,.022f)*scale,metal,.5f);
            FurniturePart(cart,"CartBase",PrimitiveType.Cube,new Vector3(0,.18f,.02f)*scale,new Vector3(.82f,.07f,.7f)*scale,metal,.5f);
            foreach(var x in new[]{-.43f,.43f})
            {
                FurniturePart(cart,"CartLeg",PrimitiveType.Cube,new Vector3(x,.38f,-.22f)*scale,new Vector3(.05f,.55f,.05f)*scale,metal,.5f,Quaternion.Euler(-12,0,0));
                FurniturePart(cart,"CartHandlePost",PrimitiveType.Cube,new Vector3(x,.72f,-.38f)*scale,new Vector3(.05f,.5f,.05f)*scale,metal,.5f);
                foreach(var z in new[]{-.24f,.28f})FurniturePart(cart,"CartWheel",PrimitiveType.Cylinder,new Vector3(x,.08f,z)*scale,new Vector3(.13f,.06f,.13f)*scale,Hex("2E3533"),.42f,Quaternion.Euler(0,0,90));
            }
            FurniturePart(cart,"CartHandle",PrimitiveType.Cylinder,new Vector3(0,.94f,-.38f)*scale,new Vector3(.045f,.48f,.045f)*scale,Hex("D6A745"),.5f,Quaternion.Euler(0,0,90));
        }

        static void AddRuntimeBoundsCollider(GameObject root)
        {
            var renderers=root.GetComponentsInChildren<Renderer>();if(renderers.Length==0)return;var bounds=renderers[0].bounds;for(var i=1;i<renderers.Length;i++)bounds.Encapsulate(renderers[i].bounds);
            var collider=root.AddComponent<BoxCollider>();collider.center=root.transform.InverseTransformPoint(bounds.center);collider.size=root.transform.InverseTransformVector(bounds.size);
        }

        static TextMesh WorldLabel(Transform parent,string name,string value,Vector3 position,Quaternion rotation,float characterSize,Color color)
        {
            var root=new GameObject(name);root.transform.SetParent(parent,false);root.transform.localPosition=position;root.transform.localRotation=rotation;var label=root.AddComponent<TextMesh>();label.text=value;label.anchor=TextAnchor.MiddleCenter;label.alignment=TextAlignment.Center;label.font=Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");label.fontSize=90;label.characterSize=characterSize;label.fontStyle=FontStyle.Bold;label.color=color;return label;
        }

        static GameObject TransparentBox(Transform root,string name,Vector3 size,Vector3 position,Color color,bool collider)
        {
            var box=GameObject.CreatePrimitive(PrimitiveType.Cube);box.name=name;box.transform.SetParent(root,false);box.transform.position=position;box.transform.localScale=size;box.isStatic=true;
            box.GetComponent<Renderer>().sharedMaterial=TransparentRuntimeMaterial($"{name}_Material",color);
            if(!collider)UnityEngine.Object.Destroy(box.GetComponent<Collider>());
            return box;
        }

        // Three.js uses the opposite horizontal handedness from Unity's camera
        // basis.  Every authored Next X coordinate crosses this one boundary.
        static Vector3 XZ(float x,float z,float y=0)=>new(-x*LayoutScale,y,z*LayoutScale);

        async Task BuildFixedInterior(Transform root)
        {
            await Place("OperationsWall",XZ(-1.6f,-8.05f),Quaternion.identity,Vector3.one,root,true);
            await Place("BackroomStorage",XZ(5.25f,-8f),Quaternion.identity,Vector3.one,root,true);
            await Place("StockroomRack",XZ(9.65f,-7.85f),Quaternion.identity,Vector3.one,root,true);
            await Place("SeasonalDisplay",XZ(-7f,3.15f),Quaternion.identity,Vector3.one,root,true);
            await Place("ShelfEndcap",XZ(6.4f,-2.2f),Quaternion.Euler(0,90,0),Vector3.one,root,true);

            await Place("WallClock",XZ(9.65f,-8.34f,2.2f),Quaternion.identity,Vector3.one,root);
            await Place("SecurityCamera",XZ(-10.75f,-8.05f,2.55f),Quaternion.identity,Vector3.one,root);
            await Place("SecurityCamera",XZ(10.65f,7.2f,2.55f),Quaternion.Euler(0,180,0),Vector3.one,root);
            await Place("HangingSign",XZ(7.25f,1.65f,2.45f),Quaternion.identity,Vector3.one,root);
            await Place("HangingSign",XZ(-3.8f,-3.35f,2.45f),Quaternion.identity,Vector3.one,root);
            foreach(var x in new[]{-7.2f,-2.4f,2.4f,7.2f})await Place("CeilingLight",XZ(x,-.6f,2.85f),Quaternion.identity,Vector3.one,root);

            await BuildProductionCubicle(root);
            await BuildFarmField(root);
        }

        async Task BuildProductionCubicle(Transform root)
        {
            var walls=(JArray)spec.Layouts["production"]["PRODUCTION_CUBICLE"]["walls"];
            foreach(var token in walls)
            {
                var wall=(JObject)token;var p=(JArray)wall["position"];
                var halfX=wall.Value<float>("halfX")*ElementScale;var halfZ=wall.Value<float>("halfZ")*ElementScale;
                var alongZ=halfZ>halfX;var length=Mathf.Max(halfX,halfZ)*2;
                await PlaceFitted("GlassPartition",XZ(p[0].Value<float>(),p[2].Value<float>()),alongZ?Quaternion.Euler(0,90,0):Quaternion.identity,new Vector3(length,2.65f,.14f),root,false);
                PhysicsBox(root,wall.Value<string>("id")+"_Collider",new Vector3(halfX*2,2.65f,halfZ*2),XZ(p[0].Value<float>(),p[2].Value<float>(),1.325f));
            }
        }

        async Task BuildFarmField(Transform root)
        {
            var field=(JObject)spec.Layouts["farm"]["FARM_FIELD"];var center=(JArray)field["center"];var size=(JArray)field["size"];
            var cellWidth=size[0].Value<float>()*LayoutScale/6f;var cellDepth=size[2].Value<float>()*LayoutScale/2f;
            var centerX=-center[0].Value<float>()*LayoutScale;var centerZ=center[2].Value<float>()*LayoutScale;
            for(var column=0;column<6;column++)for(var row=0;row<2;row++)
                await PlaceFitted("FarmPlotEmpty",new Vector3(centerX-size[0].Value<float>()*LayoutScale*.5f+cellWidth*(column+.5f),-.03f,centerZ-size[2].Value<float>()*LayoutScale*.5f+cellDepth*(row+.5f)),Quaternion.identity,new Vector3(cellWidth,.14f,cellDepth),root,false);
            var gate=(JObject)spec.Layouts["farm"]["FARM_GATE"];
            foreach(var token in (JArray)gate["accessCorridorFences"])await BuildFence((JObject)token,root);
            foreach(var token in (JArray)gate["perimeterWallFences"])await BuildFence((JObject)token,root);
            await BuildFence((JObject)gate["openLeaf"],root);await BuildFence((JObject)gate["rightFence"],root);await BuildFence((JObject)gate["leftFrontFence"],root);await BuildFence((JObject)gate["rightFrontFence"],root);
        }

        async Task BuildFence(JObject data,Transform root)
        {
            var p=(JArray)data["center"];var halfX=data.Value<float>("halfX")*ElementScale;var halfZ=data.Value<float>("halfZ")*ElementScale;
            var alongZ=halfZ>halfX;var length=Mathf.Max(halfX,halfZ)*2;var asset=length>5f?"FarmFenceLong":"FarmFenceShort";
            await PlaceFitted(asset,XZ(p[0].Value<float>(),p[2].Value<float>()),alongZ?Quaternion.Euler(0,90,0):Quaternion.identity,new Vector3(length,.85f,.22f),root,false);
            PhysicsBox(root,"FarmFenceCollider",new Vector3(halfX*2,.85f,halfZ*2),XZ(p[0].Value<float>(),p[2].Value<float>(),.425f));
        }

        async Task BuildRetail(StoreWorld world)
        {
            var departments = (JObject)spec.Layouts["retail"]["RETAIL_DEPARTMENTS"];
            foreach (var property in departments.Properties())
            {
                var data = (JObject)property.Value;
                var pos = (JArray)data["display"];
                var position = new Vector3(-pos[0].Value<float>() * LayoutScale, 0, pos[2].Value<float>() * LayoutScale);
                var display = await Place(DisplayAssets[property.Name],position,Quaternion.identity,Vector3.one*ElementScale,world.Root,true);
                var shelf = display.AddComponent<ProductShelf>();
                shelf.departmentId = property.Name;
                shelf.allowedProducts = data["products"].ToObject<string[]>();
                shelf.BuildSlots(30, new Vector3(0, .7f*ElementScale, .16f*ElementScale), new Vector3(.23f*ElementScale, .34f*ElementScale, .04f*ElementScale), 10);
                world.Shelves[property.Name] = shelf;
                var service = (JArray)data["service"];
                var servicePoint = New($"Service_{property.Name}", new Vector3(-service[0].Value<float>() * LayoutScale, 0, service[1].Value<float>() * LayoutScale));
                servicePoint.SetParent(world.Root, true);
                foreach (var product in shelf.allowedProducts)
                {
                    world.ProductServicePoints[product] = servicePoint;
                }
                AddInteraction(world,servicePoint,$"stock:{property.Name}",$"Reponer {data.Value<string>("label")}",1.5f,true,.035f,.22f);
            }
        }

        async Task BuildCheckout(StoreWorld world)
        {
            var lanes = (JObject)spec.Layouts["checkout"]["CHECKOUT_LANES"];
            foreach (var lane in lanes.Properties())
            {
                var data = (JObject)lane.Value;
                var counter = (JArray)data["counter"];
                var position = new Vector3(-counter[0].Value<float>() * LayoutScale, 0, counter[2].Value<float>() * LayoutScale);
                var checkout = await Place("CheckoutArea", position, Quaternion.identity, Vector3.one * ElementScale, world.Root, true);
                if(lane.Name!="0")world.AvailabilityVisuals[$"checkout:{lane.Name}"]=checkout;
                var customer = (JArray)data["customerFront"];
                var laneIndex=int.Parse(lane.Name);var checkoutPoint=New($"CheckoutInteractionPoint_{laneIndex}", new Vector3(-customer[0].Value<float>() * LayoutScale, 0, customer[1].Value<float>() * LayoutScale));checkoutPoint.SetParent(world.Root,true);world.CheckoutPoints.Add(checkoutPoint);
                AddInteraction(world,checkoutPoint,$"checkout:{lane.Name}","Atender caja",1.55f,true,.08f,.75f);
                var unload=New($"CheckoutUnloadSocket_{laneIndex}",position+new Vector3(-.72f,1.08f,-.12f));unload.SetParent(world.Root,true);world.CheckoutUnloadPoints.Add(unload);
                var scan=New($"CheckoutScanSocket_{laneIndex}",position+new Vector3(0,1.08f,-.12f));scan.SetParent(world.Root,true);world.CheckoutScanPoints.Add(scan);
                var bag=New($"CheckoutBagSocket_{laneIndex}",position+new Vector3(.78f,1.08f,-.12f));bag.SetParent(world.Root,true);world.CheckoutBagPoints.Add(bag);
                var queue = (JArray)data["queueStart"];
                var laneQueue=new List<Transform>();world.CheckoutQueuePoints.Add(laneQueue);
                for (var i = 0; i < 8; i++)
                {
                    var point = New($"Queue{laneIndex+1}_Point{i + 1:00}", new Vector3(-queue[0].Value<float>() * LayoutScale, 0, (queue[1].Value<float>() - i * .78f) * LayoutScale));
                    point.SetParent(world.Root, true);laneQueue.Add(point);if(laneIndex==0)world.QueuePoints.Add(point);
                }
                if(laneIndex==0){world.CheckoutPoint=checkoutPoint;world.CheckoutUnloadPoint=unload;world.CheckoutScanPoint=scan;world.CheckoutBagPoint=bag;}
            }
        }

        async Task BuildProduction(StoreWorld world)
        {
            var fixtures = (JObject)spec.Layouts["production"]["STORE_PRODUCTION_FIXTURES"];
            var ids = new Dictionary<string, string> { ["flourMill"] = "FlourMillAlt", ["breadOven"] = "BreadOven", ["cheeseMaker"] = "CheeseMachine", ["juiceMachine"] = "JuiceMachineAlt" };
            foreach (var property in fixtures.Properties())
            {
                var data = (JObject)property.Value; var pos = (JArray)data["position"];
                var root = await Place(ids[property.Name], new Vector3(-pos[0].Value<float>() * LayoutScale, 0, pos[2].Value<float>() * LayoutScale), Quaternion.identity, Vector3.one * ElementScale, world.Root, true);
                world.AvailabilityVisuals[$"machine:{data.Value<string>("machineId")}"]=root;
                var work=(JArray)data["operatorWorkPoint"];
                var workPoint=New($"MachineWork_{property.Name}",new Vector3(-work[0].Value<float>()*LayoutScale,0,work[1].Value<float>()*LayoutScale));workPoint.SetParent(world.Root,true);
                var interaction=AddInteraction(world,workPoint,$"machine:{data.Value<string>("machineId")}",data.Value<string>("label"),1.55f,true,.08f,.75f);
                world.MachinePoints[data.Value<string>("machineId")] = interaction.transform;
            }
        }

        async Task BuildFarm(StoreWorld world)
        {
            var farm = (JObject)spec.Layouts["farm"];
            var plots = (JArray)farm["FARM_PLOTS"];
            foreach (var token in plots)
            {
                var plot = (JObject)token; var pos = (JArray)plot["position"];
                var asset = await Place("FarmPlotFurrows", new Vector3(-pos[0].Value<float>() * LayoutScale, 0, pos[2].Value<float>() * LayoutScale), Quaternion.identity, Vector3.one * ElementScale, world.Root, true);
                world.CropVisualRoots[plot.Value<string>("id")]=asset.transform;
                world.AvailabilityVisuals[$"crop:{plot.Value<string>("id")}"]=asset;
                var interaction=AddInteraction(world, asset.transform, $"farm:{plot.Value<string>("id")}", "Cultivar / cosechar");
                world.CropPoints[plot.Value<string>("id")] = interaction.transform;
            }
            var facilities = (JObject)farm["FARM_FACILITIES"];
            var facilityAssets = new Dictionary<string, string> { ["tools"] = "FarmToolSet", ["compost"] = "CompostBin", ["greenhouse"] = "MiniGreenhouse", ["scarecrow"] = "Scarecrow", ["waterTank"] = "FarmWaterTank" };
            foreach (var property in facilities.Properties())
            {
                var pos = (JArray)property.Value["position"];
                await Place(facilityAssets[property.Name], new Vector3(-pos[0].Value<float>() * LayoutScale, 0, pos[2].Value<float>() * LayoutScale), Quaternion.identity, Vector3.one * ElementScale, world.Root, true);
            }
            var animals = (JObject)farm["FARM_ANIMAL_STATIONS"];
            foreach (var property in animals.Properties())
            {
                var pos = (JArray)property.Value["position"];
                var id = property.Name == "chicken" ? "Chicken" : "Cow";
                var animal = await Place(id, new Vector3(-pos[0].Value<float>() * LayoutScale, 0, pos[2].Value<float>() * LayoutScale), Quaternion.Euler(0, 180, 0), Vector3.one * ElementScale, world.Root, true);
                world.AvailabilityVisuals[$"machine:{(property.Name=="chicken"?"chicken-coop-1":"cow-station-1")}"]=animal;
                var work=(JArray)property.Value["workPosition"];
                var workPoint=New($"AnimalWork_{property.Name}",new Vector3(-work[0].Value<float>()*LayoutScale,0,work[2].Value<float>()*LayoutScale));workPoint.SetParent(world.Root,true);
                AddInteraction(world,workPoint,$"animal:{property.Name}",property.Name == "chicken" ? "Recoger huevos" : "Recoger leche",1.55f,true,.08f,.75f);
            }
        }

        async Task BuildServices(StoreWorld world)
        {
            var supplier = await Place("SupplierTerminal",XZ(8.8f,-2.15f),Quaternion.identity,Vector3.one,world.Root,true);
            await Place("DeliveryDock",XZ(8.8f,-3.23f),Quaternion.identity,Vector3.one,world.Root,true);
            await Place("SupplierTerminal",XZ(8.8f,-5.35f),Quaternion.identity,Vector3.one,world.Root,true);
            await Place("ReturnsStation",XZ(9.85f,5.45f),Quaternion.Euler(0,180,0),Vector3.one,world.Root,true);
            await Place("CartBay",XZ(3.05f,6.55f),Quaternion.identity,Vector3.one,world.Root,true);
            AddInteraction(world,supplier.transform,"supplier","Abrir proveedores",2.1f,false);
            var returnsPoint=New("ReturnsServicePoint",new Vector3(-20.1f,0,8.6f));returnsPoint.SetParent(world.Root,true);
            AddInteraction(world,returnsPoint,"returns","Devolver mercancía",1.5f,true,.08f,.75f);
            var pickup = (JArray)spec.Layouts["warehouse"]?["WAREHOUSE_PICKUP_STATION"]?["position"];
            var pickupPosition = pickup == null ? new Vector3(-14.8f, 0, -6.8f) : new Vector3(-pickup[0].Value<float>() * LayoutScale, 0, pickup[2].Value<float>() * LayoutScale);
            world.WarehousePoint = New("WarehousePickupPoint", pickupPosition); world.WarehousePoint.SetParent(world.Root, true);
            AddInteraction(world,world.WarehousePoint,"warehouse","Recoger mercancía",1.5f,true,.08f,1.1f);
        }

        void BuildNavigationAnchors(StoreWorld world)
        {
            world.EntranceOutside = New("EntranceOutside", new Vector3(0, 0, 30.4f));
            world.EntranceInside = New("EntranceInside", new Vector3(0, 0, 11.2f));
            world.ExitPoint = New("ExitPoint", new Vector3(0, 0, 30.8f));
            world.EntranceOutside.SetParent(world.Root, true); world.EntranceInside.SetParent(world.Root, true); world.ExitPoint.SetParent(world.Root, true);
            var sensorPoint=New("EntranceSensorPoint",new Vector3(0,0,17f));sensorPoint.SetParent(world.Root,true);AddInteraction(world,sensorPoint,"door","Sensor de entrada",4.8f,false);
        }

        static void BuildOuterGroundCollider(Transform parent)
        {
            // Physics only, and deliberately a sibling of StoreWorld rather than a
            // child: NavMeshSurface collects its own children, so keeping this out
            // leaves the agents' navigation confined to the shop. Its footprint
            // matches the visible CityGround. Without it the player walked past the
            // 53.4 x 68.6 navigation floor and fell out of the world, and because
            // the rig holds a fixed height while tracking X/Z, the camera kept
            // following while the body dropped out of sight.
            var ground = new GameObject("OuterGroundCollider");
            ground.transform.SetParent(parent, false);
            ground.transform.localPosition = new Vector3(0, -1f, -4f);
            ground.AddComponent<BoxCollider>().size = new Vector3(108f, 2f, 128f);
            ground.isStatic = true;

            // And close the perimeter, so the edge of the ground cannot be walked
            // off at all. Recovering from a fall is a worse experience than never
            // falling, and the city has nothing to show beyond this line anyway.
            foreach (var (offset, size) in new (Vector3, Vector3)[]
            {
                (new Vector3(-54.5f, 3f, -4f), new Vector3(1f, 6f, 128f)),
                (new Vector3(54.5f, 3f, -4f), new Vector3(1f, 6f, 128f)),
                (new Vector3(0, 3f, -68.5f), new Vector3(108f, 6f, 1f)),
                (new Vector3(0, 3f, 60.5f), new Vector3(108f, 6f, 1f)),
            })
            {
                var wall = new GameObject("OuterGroundWall");
                wall.transform.SetParent(parent, false);
                wall.transform.localPosition = offset;
                wall.AddComponent<BoxCollider>().size = size;
                wall.isStatic = true;
            }
        }

        static void BuildNavMesh(Transform root)
        {
            var surface=root.gameObject.AddComponent<NavMeshSurface>();
            surface.collectObjects=CollectObjects.Children;surface.useGeometry=NavMeshCollectGeometry.PhysicsColliders;surface.layerMask=~0;
            surface.BuildNavMesh();
        }

        async Task<GameObject> Place(string id, Vector3 position, Quaternion rotation, Vector3 scale, Transform root, bool collider = false)
        {
            var instance = await loader.InstantiateAsync(id, root, position, rotation, Vector3.one);
            if(TargetLocalSize.TryGetValue(id,out var targetSize))FitLocalSize(instance,targetSize);
            else NormalizeScale(instance,TargetLongestDimension.TryGetValue(id,out var target)?target:Mathf.Max(scale.x,Mathf.Max(scale.y,scale.z)));
            foreach(var child in instance.GetComponentsInChildren<Transform>(true))child.gameObject.isStatic=true;
            if (collider) AddBoundsCollider(instance);
            return instance;
        }

        async Task<GameObject> PlaceFitted(string id,Vector3 position,Quaternion rotation,Vector3 targetSize,Transform root,bool collider)
        {
            var instance=await loader.InstantiateAsync(id,root,position,rotation,Vector3.one);
            FitLocalSize(instance,targetSize);
            foreach(var child in instance.GetComponentsInChildren<Transform>(true))child.gameObject.isStatic=true;
            if(collider)AddBoundsCollider(instance);
            return instance;
        }

        static void FitLocalSize(GameObject instance,Vector3 targetSize)
        {
            var renderers=instance.GetComponentsInChildren<Renderer>(true);if(renderers.Length==0)return;
            var rotation=instance.transform.localRotation;instance.transform.localRotation=Quaternion.identity;instance.transform.localScale=Vector3.one;
            var bounds=renderers[0].bounds;for(var i=1;i<renderers.Length;i++)bounds.Encapsulate(renderers[i].bounds);var current=bounds.size;
            instance.transform.localScale=new Vector3(targetSize.x/Mathf.Max(.0001f,current.x),targetSize.y/Mathf.Max(.0001f,current.y),targetSize.z/Mathf.Max(.0001f,current.z));
            instance.transform.localRotation=rotation;
        }

        static void NormalizeScale(GameObject instance,float targetLongest)
        {
            var renderers=instance.GetComponentsInChildren<Renderer>(true);if(renderers.Length==0||targetLongest<=0)return;
            var bounds=renderers[0].bounds;for(var i=1;i<renderers.Length;i++)bounds.Encapsulate(renderers[i].bounds);
            var longest=Mathf.Max(bounds.size.x,Mathf.Max(bounds.size.y,bounds.size.z));if(longest<=.0001f)return;
            instance.transform.localScale=Vector3.one*(targetLongest/longest);
        }

        void AddBoundsCollider(GameObject root)
        {
            var renderers = root.GetComponentsInChildren<Renderer>();
            if (renderers.Length == 0) return;
            var bounds = renderers[0].bounds;
            for (var i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
            var collider = root.AddComponent<BoxCollider>();
            collider.center = root.transform.InverseTransformPoint(bounds.center);
            var localMin = root.transform.InverseTransformPoint(bounds.min);
            var localMax = root.transform.InverseTransformPoint(bounds.max);
            collider.size = new Vector3(Mathf.Abs(localMax.x - localMin.x), Mathf.Abs(localMax.y - localMin.y), Mathf.Abs(localMax.z - localMin.z));
        }

        InteractionPoint AddInteraction(StoreWorld world, Transform target, string id, string label,float radius=1.8f,bool automatic=true,float dwell=.08f,float repeat=.22f)
        {
            var pointRoot = New($"Interaction_{id}",target.position);
            pointRoot.SetParent(world.Root, true);
            var point = pointRoot.gameObject.AddComponent<InteractionPoint>();
            point.Configure(id,label,radius,automatic,dwell,repeat);
            interactions.Register(point); world.Interactions[id] = point; return point;
        }

        Transform New(string name, Vector3 position)
        {
            var value = new GameObject(name).transform; value.SetParent(parent, false); value.position = position; return value;
        }
    }
}
