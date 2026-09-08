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
        /// The shop returns to its original compact footprint. Metric fixtures,
        /// tiles and actors keep their approved physical size; only the excess
        /// spacing and envelope spans introduced by the former x2 expansion go.
        public const float PreviousStoreScale = 3f;
        public const float StoreScale = PreviousStoreScale;
        /// The approved dairy case measures 1.955 m in its source and 12.12
        /// units beside the 1.75 m owner. This is the single conversion used by
        /// every clean metric prop, so cars, furniture and farm equipment all
        /// share the same human scale.
        public const float WorldUnitsPerMeter = 6.2f;
        const float ServiceReach = WorldUnitsPerMeter * .75f;
        const float RetailReach = WorldUnitsPerMeter * 1.1f;
        public const float RoadWidthMeters = 7.6f;
        public const float CrosswalkWidthMeters = 7f;
        static float FixedPlanFactor => PreviousStoreScale / StoreScale;
        /// The pieces do not grow with the floor: furniture and the building's
        /// modules are twice their authored size, the small props two and a half
        /// times, so everything reads at one scale beside the cast.
        public const float PieceScale = 2f;
        public const float SmallPieceScale = 2.5f;
        const float SmallThreshold = 2.5f;
        /// Clean replacements are authored in metres with their pivot at the
        /// centre of the footprint on the floor. They never pass through the
        /// legacy longest-axis normalizer, which was shrinking road vehicles to
        /// less than one metre and gave unrelated furniture unrelated scales.
        static readonly HashSet<string> MetricEnvironment = new(StringComparer.OrdinalIgnoreCase)
        {
            "AutomaticDoor","BackroomStorage","BaggingArea","BaggingAreaAlt","BakeryWorkArea",
            "BasketStack","BasketStackAlt","Bench","BreadOven","BusStop","Car","CardTerminal",
            "CarrotRipe","CartBay","CashDrawer","CashDrawerAlt","CashRegister","CashierStool",
            "CeilingLight","CheckoutBag","CheckoutCounter","CheckoutLaneSign","CheckoutScanner","CheckoutScannerAlt",
            "CheckoutShelf","CheeseMachine","ChestFreezer","Chicken","ChickenPaddock","CityBuilding",
            "CompostBin","Conveyor","CornRipe","Cow","CowPaddock","CropGrowing","CropSeed",
            "CropSmall","CropSprout","Crosswalk","DeliveryDock","DeliveryDockAlt","DisplayBakery",
            "DisplayProduceSloped","EggTray","FarmFenceCorner","FarmFenceLong","FarmFenceShort",
            "FarmGate","FarmPlotEmpty","FarmPlotFurrows","FarmPlotSeeded","FarmPlotWatered",
            "FarmToolSet","FarmWaterTank","FlourMill","FlourMillAlt","Furniture2:WoodCrate",
            "GlassPartition","HangingSign","HiringPoint","IrrigationBed","IrrigationChannel",
            "JuiceMachine","JuiceMachineAlt","LettuceRipe","MilkCan","MiniGreenhouse","OperationsWall",
            "Pallet","Parcel","ParkingSpace","PromotionalBasket","PumpkinRipe","RaisedBed",
            "ReceiptPrinter","RefrigeratedDisplay","ReturnsStation","ReusableShoppingBag","RoadSegment",
            "Scarecrow","SecurityCamera","SeedSack","ShelfCorner","ShelfDivider","ShelfGondolaDouble",
            "ShelfGondolaSingle","ShelfPriceRail","ShoppingBasket","ShoppingBasketAlt","ShoppingCart",
            "SidewalkSegment","Sprinkler","StockroomRack","StreetLight","SupplierTerminal",
            "TomatoRipe","Tree","UpgradePlatform","UpgradePlatformAlt","UtilitySink","WallClock",
            "WallCorner","WateringCan","WheatGrowing","WheatRipe","WoodCrate","WorkCounter",
        };
        static readonly HashSet<string> MetricGlassEnvironment = new(StringComparer.OrdinalIgnoreCase)
        {
            "AutomaticDoor","BreadOven","BusStop","Car","ChestFreezer","CityBuilding","DisplayBakery",
            "GlassPartition","JuiceMachine","JuiceMachineAlt","MiniGreenhouse","OperationsWall",
            "RefrigeratedDisplay","SupplierTerminal",
        };
        /// The building's face -- entrance, storefront, walls, rear door -- moves
        /// as one piece; a fifth bigger than authored, on request. Split from the
        /// street so the shop can grow without the cars and the trees growing.
        public const float EnvelopeScale = 1.2f;
        static readonly HashSet<string> Envelope = new(StringComparer.OrdinalIgnoreCase)
        {
            "StoreEntrance","StoreEntranceAlt","StorefrontWindow","WallStraight","WallCorner","AutomaticDoor",
        };
        static float SizeFactor(string id,float authored)=>
            Envelope.Contains(id)?EnvelopeScale:MetricEnvironment.Contains(id)?WorldUnitsPerMeter:authored<SmallThreshold?SmallPieceScale:PieceScale;
        public const float LayoutScale = 2f;
        public const float FarmWorldRadius = 68f;
        const float ElementScale = 1.6f;

        static readonly Dictionary<string, string> DisplayAssets = new()
        {
            ["bakery"] = "DisplayTable", ["pantry"] = "ShelfWallTall", ["eggs"] = "EggDisplay",
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
            ["StoreEntrance"]=7.1f,["StoreEntranceAlt"]=7.1f,["StorefrontWindow"]=8.5f,["WallStraight"]=4.6f,
            ["EggDisplay"]=4.62f,  // su alto; la pieza va entera, sin estirar por ejes
            ["DisplayRefrigeratedDoors"]=9.24f,
        };

        /// The delivered September furniture was reconstructed from a single
        /// view. Its proportions are already correct and must never be fitted
        /// independently on X/Y/Z. These are final world heights, calibrated
        /// between the approved 9.24-high egg display and 12.12-high dairy case.
        static readonly Dictionary<string,float> TargetWorldHeight=new()
        {
            ["CheckoutArea"]=7.2f,
            ["ShelfWallTall"]=11.16f,
            ["ShelfWallWide"]=11.16f,
            ["DisplayProduceMixed"]=7.44f,
            ["SeasonalDisplay"]=8.4f,
            ["DisplayTable"]=4.4f,
            ["ShelfEndcap"]=6.4f,
        };
        static readonly HashSet<string> SeptemberFurniture=new(StringComparer.OrdinalIgnoreCase)
        {
            "CheckoutArea","ShelfWallTall","ShelfWallWide","DisplayProduceMixed","SeasonalDisplay","DisplayTable","ShelfEndcap",
        };

        /// Where each of them stands: shop coordinates as the specification
        /// uses them, the height above the floor in world units for the ones
        /// that sit on a surface, and the turn. None of them carries a collider:
        /// they are furnishing, and the navigation mesh is baked from what was
        /// already there, so no customer or worker route changes.
        static readonly (string id,float x,float z,float y,float yaw)[] KitProps =
        {
            ("ShelfGondolaDouble",-7.8f,0.9f,0f,90f),   // pasillo nuevo a la izquierda
            ("ShelfGondolaSingle",-7.8f,-0.9f,0f,90f),
            ("ShelfDivider",-7.8f,1.9f,0f,90f),
            ("ShelfPriceRail",-7.8f,-1.9f,0f,90f),
            ("ChestFreezer",10.4f,-2.2f,0f,90f),
            ("WorkCounter",-8.25f,-4.6f,0f,0f),   // obrador dentro de la cabina
            ("UtilitySink",-10.2f,-7.0f,0f,0f),
            ("BakeryWorkArea",-6.3f,-7.0f,0f,0f),
            ("Pallet",2.8f,-7.4f,0f,0f),   // trastienda
            ("WoodCrate",2.8f,-7.4f,1.04f,0f),
            ("Furniture2:WoodCrate",2.4f,-6.9f,0f,25f),
            ("FlourMill",1.4f,-5.4f,0f,0f),
            ("JuiceMachine",2.6f,-5.4f,0f,0f),
            ("DeliveryDockAlt",10.6f,-5.4f,0f,90f),   // segundo muelle
            ("UpgradePlatformAlt",10.6f,-3.8f,0f,90f),
            ("FarmGate",7.5f,-10.575f,0f,0f),   // porton de la granja
            ("FarmFenceCorner",10.3f,-10.7f,0f,0f),
            ("RaisedBed",-1.8f,-11.6f,0f,0f),   // franja de trabajo de la granja
            ("IrrigationBed",0.4f,-11.6f,0f,0f),
            ("IrrigationChannel",2.6f,-11.6f,0f,90f),
            ("Sprinkler",4.4f,-11.6f,0f,0f),
            ("WateringCan",-3.6f,-11.4f,0f,0f),
            ("SeedSack",-4.8f,-11.4f,0f,0f),
            ("FarmPlotSeeded",-8.2f,-12.72f,0f,0f),   // bancales extra
            ("FarmPlotWatered",-8.2f,-15.45f,0f,0f),
            ("ChickenPaddock",1.6f,-12.9f,0f,0f),   // corrales
            ("CowPaddock",5.4f,-12.9f,0f,0f),
            ("WheatGrowing",2.4f,-16.4f,0f,0f),   // cultivos maduros al fondo
            ("CarrotRipe",3.8f,-16.4f,0f,0f),
            ("LettuceRipe",5.0f,-16.4f,0f,0f),
            ("PumpkinRipe",6.2f,-16.4f,0f,0f),
        };

        // Inspection switch. With it on, the shop's contents are stripped to bare
        // floor and walls so the floor can be judged on its own: everything
        // placed inside keeps its logic, sockets and interactions, and loses
        // only what it shows and what it blocks.
        public static bool BareInterior = false;
        static GameObject HideIfBare(GameObject go)
        {
            if(!BareInterior||!go)return go;
            foreach(var r in go.GetComponentsInChildren<Renderer>(true))r.enabled=false;
            foreach(var c in go.GetComponentsInChildren<Collider>(true))c.enabled=false;
            return go;
        }

        public StoreWorldBuilder(RuntimeGltfLoader assetLoader, GameSpecRepository repository, InteractionDirector director, Transform worldParent)
        { loader = assetLoader; spec = repository; interactions = director; parent = worldParent; }

        public async Task<StoreWorld> BuildAsync()
        {
            var world = new StoreWorld { Root = New("StoreWorld", Vector3.zero) };
            world.Root.localScale = Vector3.one * StoreScale;
            await BuildWalkableFloor(world.Root);
            await BuildEnvelope(world);
            await BuildExterior(world.Root);
            await BuildFixedInterior(world.Root);
            await BuildRetail(world);
            await BuildCheckout(world);
            await BuildProduction(world);
            await BuildFarm(world);
            await BuildServices(world);
            await BuildKitProps(world.Root);
            BuildNavigationAnchors(world);
            BuildNavMesh(world.Root);
            BuildOuterGroundCollider(parent);
            // Take the door leaves out of the hierarchy while the batch is built.
            // StaticBatchingUtility.Combine bakes every child into one mesh and
            // ignores the isStatic flag entirely, so the leaves were welded into
            // the storefront: their transforms moved their full travel and the
            // picture did not change by a single pixel.
            var detached = new List<(Transform leaf, Transform parent)>();
            foreach (var leaf in new[] { doorLeaves.left, doorLeaves.right, doorFrames.left, doorFrames.right })
            {
                if (!leaf) continue;
                detached.Add((leaf, leaf.parent));
                leaf.SetParent(null, true);
            }
            // Combining bakes a second copy of every piece's geometry and keeps
            // the originals loaded. On a desktop that trade -- memory for draw
            // calls -- is worth it; on a phone, with sixty-odd renderers in
            // frame, it is what pushes the tab over its limit and kills it.
            if (!MiniMarket.Performance.PerformanceGovernor.Handheld)
                StaticBatchingUtility.Combine(world.Root.gameObject);
            foreach (var (leaf, previous) in detached) leaf.SetParent(previous, true);
            await Resources.UnloadUnusedAssets();
            return world;
        }

        async Task BuildWalkableFloor(Transform root)
        {
            // The world backing is authored: CityPerimeter draws it as a 54 x 64
            // block at [0, -0.2, -2] in the soft green below, and this is the
            // same slab at layout scale. It had been standing in a pale pink,
            // which is what showed through wherever a floor was missing.
            TexturedSurface(root,"CityGrass",new Vector2(108,128),new Vector3(0,-.15f,-4),"Grass",new Vector2(18,21.333f)*(StoreScale/PreviousStoreScale),.02f);
            // The floor is the designer's own, taken whole out of MOBILIARIO.glb
            // by tools/kit/extract_part.py: the beige is a 3 x 3 panel slab, the
            // white a 3 x 2, coloured from MOBILIARIO.png seen square on. The
            // kit is modelled at an isometric yaw, so each was turned back about
            // 23 degrees and its outline, which the scan left bowed in by three
            // to seven thousandths, pushed back out to the straight line. Both
            // now fill their rectangle exactly, so they are laid edge to edge:
            // no overlap, nothing underneath, nothing cut away.
            // Repeat the approved tile sheets over two two-triangle surfaces.
            // They contain exactly the same visible 3 x 3 tiles as the old GLB;
            // UV repetition adds floor area without enlarging a tile or creating
            // 576 startup objects that would bring the first-movement hitch back.
            var tileScale=StoreScale/PreviousStoreScale;
            TexturedSurface(root,"FloorBeige",new Vector2(46f,34f),new Vector3(0,-.006f,-.7f),"FloorTileBeige",new Vector2(12,9)*tileScale,.18f);
            TexturedSurface(root,"FloorWhite",new Vector2(46f,15f),new Vector3(0,-.008f,23.8f),"FloorTileWhite",new Vector2(12,3)*tileScale,.16f);
            Debug.Log($"MINIMARKET_FOOTPRINT escala={StoreScale:0.##} interior={46f*StoreScale:0.00}x{49f*StoreScale:0.00} baldosas=144 superficies=2 tamano_baldosa=sin_cambios");
            VisualBox(root,"StoreKerb",new Vector3(50,.12f,2.4f*FixedPlanFactor),new Vector3(0,-.09f,32.3f),Hex("566A62"),.02f,false);
            // MarketBuilding's entrance mat: the dark slab the player crosses in
            // the doorway, authored at [0, 0.035, 7.02] with a 3.75 x 1.05
            // footprint beneath the layout-scale group, and receiveShadow only.
            // KNOWN GAP: geometry and placement match Next, but this renders at
            // roughly a tenth of the expected diffuse light. Ruled out so far:
            // colour space, shader support, shadow casting, shadow receiving
            // and static batching. The neighbouring glTF floor lights correctly.
            const float entranceZ=15.9f;const float approvedMatOffset=5.58f;
            var entranceMat=VisualBox(root,"EntranceMat",new Vector3(7.5f*FixedPlanFactor,.055f,2.1f*FixedPlanFactor),
                                      new Vector3(0,.035f,entranceZ-approvedMatOffset/StoreScale),Hex("2B4B43"),.08f,false);
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

        /// Lay a floor GLB across a rectangle so the faces you see meet edge to
        /// edge. faceX and faceZ are how much of the model's box its visible top
        /// actually covers, and offX and offZ how far that face sits off the
        /// box centre, both as fractions of the box, measured off the mesh. The
        /// fit is enlarged by the first pair so one cell of face lands per cell
        /// of floor, and the piece slid by the second so the face lands square.
        /// Modules of `moduleWorld` length (world units) laid end to end from
        /// `startLocal` to `endLocal` (authored, local units) along x or z at the
        /// fixed other coordinate; height and cross size are world units and the
        /// level `yWorld` is kept in world units too.
        async Task FillSpan(string id,bool alongZ,float fixedLocal,float startLocal,float endLocal,float moduleAuthored,float heightAuthored,float crossAuthored,float yWorld,Transform root,bool flip=false)
        {
            var factor=SizeFactor(id,moduleAuthored);
            var moduleWorld=moduleAuthored*factor;var heightWorld=heightAuthored*factor;var crossWorld=crossAuthored*factor;
            var spanWorld=(endLocal-startLocal)*StoreScale;var count=Mathf.Max(1,Mathf.RoundToInt(spanWorld/moduleWorld));var fit=spanWorld/count;
            for(var module=0;module<count;module++)
            {
                var along=startLocal+(fit/StoreScale)*(module+.5f);
                var position=alongZ?new Vector3(fixedLocal,yWorld/StoreScale,along):new Vector3(along,yWorld/StoreScale,fixedLocal);
                var rotation=alongZ?Quaternion.Euler(0,90,0):(flip?Quaternion.Euler(0,180,0):Quaternion.identity);
                await PlaceFitted(id,position,rotation,new Vector3(fit,heightWorld,crossWorld),root,false,1f);
            }
        }

        async Task TileFloor(Transform root,string id,float x0,float x1,float z0,float z1,
                             int columns,int rows,float faceX,float faceZ,float offX,float offZ,
                             float thickness,float y)
        {
            // A bigger floor is more tiles, not bigger tiles: the count grows with
            // the space and every tile keeps the world size it was approved at.
            columns=Mathf.Max(1,Mathf.RoundToInt(columns*StoreScale));rows=Mathf.Max(1,Mathf.RoundToInt(rows*StoreScale));
            var cellX=(x1-x0)/columns;var cellZ=(z1-z0)/rows;
            var fitX=cellX/faceX;var fitZ=cellZ/faceZ;
            for(var column=0;column<columns;column++)for(var row=0;row<rows;row++)
            {
                // Alternate heights by parity: each tile's backing reaches a
                // little past its outline, and two backings sharing a plane
                // would fight for it.
                var parity=((column+row)&1)==0?.0004f:-.0004f;
                var centre=new Vector3(x0+cellX*(column+.5f)-offX*fitX,(y+parity)/StoreScale,z0+cellZ*(row+.5f)-offZ*fitZ);
                var tile=await PlaceFitted(id,centre,Quaternion.identity,new Vector3(fitX*StoreScale,thickness,fitZ*StoreScale),root,false,1f);
                foreach(var renderer in tile.GetComponentsInChildren<Renderer>())
                    renderer.shadowCastingMode=ShadowCastingMode.Off;
            }
        }

        static Material CreateFloorMaterial()
        {
            return RuntimeMaterial("StoreFloor_SoftMatte",new Color(.72f,.67f,.54f,1f),.08f);
        }

        async Task BuildExterior(Transform root)
        {
            // CityPerimeter lays four roads and four kerbs around the block, not
            // one of each: [36, 0.09, 3.8] across z -21.8 and z 18.25, and
            // [3.8, 0.09, 43.9] up x -15.85 and x 15.85, with kerbs at z -19.4,
            // z 16.05 and x +/-13.45. Only the front pair had been built, so the
            // other three sides of the block were bare ground.
            // The road sheet already contains asphalt, solid shoulders and lane
            // markings. Four two-triangle surfaces replace the old chain of
            // scanned 3k-triangle GLBs while preserving the same footprint.
            const float horizontalLength=76f;const float verticalLength=87.8f;
            var roadWidthWorld=RoadWidthMeters*WorldUnitsPerMeter;
            // Positions and lengths live in the expanded layout, while exterior
            // widths retain their world size. Divide only the width by the root
            // scale, exactly as PlaceFitted used to compensate the road GLB.
            var horizontalTiles=horizontalLength*StoreScale/(roadWidthWorld*3f);var verticalTiles=verticalLength*StoreScale/(roadWidthWorld*3f);
            foreach(var z in new[]{36.5f,-43.6f})TexturedSurface(root,$"Road_{z:0.0}",new Vector2(horizontalLength,roadWidthWorld/StoreScale),new Vector3(2,-.034f,z),"Road",new Vector2(horizontalTiles,1),.08f);
            foreach(var x in new[]{-31.7f,31.7f})TexturedSurface(root,$"Road_{x:0.0}",new Vector2(verticalLength,roadWidthWorld/StoreScale),new Vector3(x,-.034f,-3.5f),"Road",new Vector2(verticalTiles,1),.08f,90);
            const float sidewalkModule=53.6f/7f;const float sidewalkWidth=2.2f;
            foreach(var z in new[]{32.1f,-38.8f})await FillSpan("SidewalkSegment",false,z,-26.8f,26.8f,sidewalkModule,.1f,sidewalkWidth,-.03f,root);
            foreach(var x in new[]{-26.9f,26.9f})await FillSpan("SidewalkSegment",true,x,-38.7f,32.1f,sidewalkModule,.1f,sidewalkWidth,-.03f,root);

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
            var crosswalkSize=new Vector2(CrosswalkWidthMeters*WorldUnitsPerMeter/StoreScale,4.667f*WorldUnitsPerMeter/StoreScale);
            TexturedSurface(root,"CrosswalkFront",crosswalkSize,new Vector3(0,-.026f,35.9f),"Crosswalk",Vector2.one,.04f);
            TexturedSurface(root,"CrosswalkSide",crosswalkSize,new Vector3(31.1f,-.026f,18.4f),"Crosswalk",Vector2.one,.04f,90);
            Debug.Log($"MINIMARKET_EXTERIOR escala_metrica={WorldUnitsPerMeter:0.##} calzada={RoadWidthMeters:0.##}m paso_cebra={CrosswalkWidthMeters:0.##}m coche=3.9m");
        }

        async Task BuildEnvelope(StoreWorld world)
        {
            // The supplied wall belongs to the same architectural set as the
            // facade and door. Give every module exactly the facade module's
            // width, height and depth; FillSpan chooses how many are required
            // and trims their width evenly to close each side without gaps.
            const float wallModule=16.24f;const float wallHeight=11.2f;const float wallDepth=1.44f;
            foreach(var x in new[]{-23f,23f})await FillSpan("WallStraight",true,x,-17.1f,15.56f,wallModule,wallHeight,wallDepth,0,world.Root);
            const float doorHalf=5.68f*EnvelopeScale/2f/StoreScale;   // the rear door's half width, local
            await FillSpan("WallStraight",false,-17.1f,-23f,-15f-doorHalf,wallModule,wallHeight,wallDepth,0,world.Root);
            await FillSpan("WallStraight",false,-17.1f,-15f+doorHalf,23f,wallModule,wallHeight,wallDepth,0,world.Root);
            var colliderHeight=wallHeight/StoreScale;var colliderY=wallHeight*.5f/StoreScale;var colliderDepth=wallDepth/StoreScale;
            foreach(var x in new[]{-23f,23f})
                PhysicsBox(world.Root,x<0?"LeftWallCollider":"RightWallCollider",
                           new Vector3(colliderDepth,colliderHeight,32.66f),new Vector3(x,colliderY,-.77f));
            var rearLeftEnd=-15f-doorHalf;
            var rearLeftWidth=rearLeftEnd-(-23f);var rearRightStart=-15f+doorHalf;var rearRightWidth=23f-rearRightStart;
            PhysicsBox(world.Root,"RearWallLeftCollider",new Vector3(rearLeftWidth,colliderHeight,colliderDepth),
                       new Vector3(-23f+rearLeftWidth*.5f,colliderY,-17.1f));
            PhysicsBox(world.Root,"RearWallRightCollider",new Vector3(rearRightWidth,colliderHeight,colliderDepth),
                       new Vector3(rearRightStart+rearRightWidth*.5f,colliderY,-17.1f));

            await BuildStorefront(world.Root);
            await BuildRearFarmDoor(world.Root);
        }

        async Task BuildStorefront(Transform root)
        {
            // Visuals come exclusively from the supplied mosaic GLBs. Four
            // modules fill the exact two 19.06 m storefront spans while the
            // central 7.48 m automatic-door opening remains unchanged.
            // The supplied facade arrived exactly half the entrance height. Its
            // complete module is therefore doubled here (width, height and
            // depth), then FillSpan chooses fewer repetitions to preserve the
            // same side spans without stretching the texture.
            // No cutaway: the module carries its own window picture and the
            // entrance's glass is transparent, so the facade stays on screen.
            // Windows twice their size fill each side from the entrance's edge
            // (its width is PieceScale of the authored) out to the corner.
            const float storefrontModule=16.24f;var edge=20.57f*EnvelopeScale/2f/StoreScale;   // entranceWidth, declared further down
            await FillSpan("StorefrontWindow",false,15.6f,-22.7f,-edge,storefrontModule,11.2f,1.44f,0,root);
            await FillSpan("StorefrontWindow",false,15.6f,edge,22.7f,storefrontModule,11.2f,1.44f,0,root);
            foreach(Transform child in root)
                if(child.name.StartsWith("StorefrontWindow",StringComparison.OrdinalIgnoreCase))
                    GlazePanes(child,"facadeglass");
            // The entrance stays on screen. Next never hides its storefront --
            // the only visibility toggles there are particles and the checkout
            // focus -- because its glass is transparent (opacity .12 to .28 with
            // transmission), so the shop reads straight through the facade. Ours
            // now does the same, which is what makes a cutaway unnecessary.
            // The pier beside the opening was 0.216 thick on the delivered mesh
            // against a leaf-and-frame of 0.648, so a door open enough to clear
            // its own opening always left a fifth of itself past the building.
            // Half a unit of plain wall is inserted either side, measured from
            // the true edge of the opening at 0.645 -- read off a render of the
            // shell, because the mesh carries material right across the doorway
            // and an x histogram cannot tell the pier from the hole.
            // Grown by 1.5935 with the cast on 6-9-2026: at 6.2 units to the
            // metre the doorway has to clear a 1.75 m owner, and it did not.
            const float entranceWidth=20.57f;
            const float entranceHeight=11.37f;
            var door=await PlaceFitted("StoreEntrance",new Vector3(0,0,15.9f),Quaternion.identity,
                                       new Vector3(entranceWidth,entranceHeight,7.01f),root,false);
            // The entrance carries its own plinth: 0.107 of the model's 1.764
            // height, which at this fit is 0.432 in the world. Resting its
            // lowest point on y = 0 would put that step above the plane
            // everyone walks on and feet would sink into it.
            const float entrancePlinth=.432f;
            RestOnFloor(door,-entrancePlinth);
            // The facade either side of the opening is solid. The doorway itself
            // is left clear so the automatic door is what governs entry.
            var frameHalf=entranceWidth*.5f;const float openingHalf=2.95f;
            var pierWidth=frameHalf-openingHalf;
            foreach(var side in new[]{-1f,1f})
                PhysicsBox(root,$"EntrancePier_{(side<0?"Left":"Right")}",
                           new Vector3(pierWidth*FixedPlanFactor,5.2f*FixedPlanFactor,1.6f*FixedPlanFactor),
                           new Vector3(side*(openingHalf+pierWidth*.5f)*FixedPlanFactor,2.6f*FixedPlanFactor,15.9f));
            doorLeaves=FindDoorLeaves(door.transform);
            // The frame arrived as one fixed grid while only the panes moved, so
            // opening the door left jambs, head, sill and centre post standing in
            // the opening. It is split down the seam between the panes and each
            // half is driven with its own leaf.
            doorFrames=FindFrameHalves(door.transform,doorLeaves);
            // glTFast hands the panes the opaque shader graph even though the
            // glTF material asks for BLEND: the runtime reported queue 3000 and
            // _Surface 1 on "Shader Graphs/glTF-pbrMetallicRoughness", and
            // dropping the file's alpha from 0.26 to 0.035 did not change a
            // single pixel on screen. They are moved onto the same transparent
            // material the cold-room door already uses, which does blend.
            GlazePanes(door.transform);
            // PlaceFitted marks every child static, and static batching bakes the
            // geometry in place: moving a transform then changes no pixels. Each
            // pane and the frame half that travels with it must stay dynamic.
            foreach(var piece in new[]{doorLeaves.left,doorLeaves.right,doorFrames.left,doorFrames.right})
            {
                if(!piece)continue;
                foreach(var child in piece.GetComponentsInChildren<Transform>(true))
                    child.gameObject.isStatic=false;
            }

            // Physics remains independent from art: side facade collision is
            // exact, while the automatic doorway keeps its Next.js opening.
            var leftWidth=-edge-(-22.7f);var rightWidth=22.7f-edge;
            PhysicsBox(root,"StorefrontCollider_Left",new Vector3(leftWidth,11.2f/StoreScale,1.44f/StoreScale),new Vector3(-22.7f+leftWidth*.5f,5.6f/StoreScale,15.6f));
            PhysicsBox(root,"StorefrontCollider_Right",new Vector3(rightWidth,11.2f/StoreScale,1.44f/StoreScale),new Vector3(edge+rightWidth*.5f,5.6f/StoreScale,15.6f));
            var sensor=new GameObject("StorefrontDoorSensor");sensor.transform.SetParent(root,false);sensor.transform.localPosition=new Vector3(0,2f*FixedPlanFactor,15.9f);var trigger=sensor.AddComponent<BoxCollider>();trigger.isTrigger=true;trigger.size=new Vector3(11f,5f,15f)*FixedPlanFactor;var body=sensor.AddComponent<Rigidbody>();body.isKinematic=true;body.useGravity=false;
            // Drive the entrance's own leaves from the sensor. The presenter
            // existed but was never wired to anything, so the door has never
            // opened. The slide is measured from a leaf's own width, because the
            // leaves live inside an instance scaled to fit the doorway.
            if(doorLeaves.left&&doorLeaves.right)
            {
                var presenter=sensor.AddComponent<StorefrontDoorPresenter>();
                var leafRenderer=doorLeaves.left.GetComponent<Renderer>();
                var width=leafRenderer?leafRenderer.localBounds.size.x:1f;
                var frameRenderer=doorFrames.left?doorFrames.left.GetComponent<Renderer>():null;
                var frameWidth=frameRenderer?frameRenderer.localBounds.size.x:width;
                // See LeafTravel: the run is bounded by the wall beside the
                // opening, not by the facade's outer bounds.
                presenter.Bind(doorLeaves.left,doorLeaves.right,LeafTravel(width,frameWidth),doorFrames.left,doorFrames.right);
                foreach(var piece in new[]{doorLeaves.left,doorLeaves.right,doorFrames.left,doorFrames.right})
                {
                    if(!piece)continue;
                    var r=piece.GetComponent<Renderer>();
                    Debug.Log($"MINIMARKET_DOOR pieza={piece.name} x=[{r.bounds.min.x:0.00},{r.bounds.max.x:0.00}] z=[{r.bounds.min.z:0.00},{r.bounds.max.z:0.00}]");
                }
                foreach(var w in root.GetComponentsInChildren<Renderer>(true))
                {
                    if(w.transform.parent==null||!w.transform.parent.name.Contains("StorefrontWindow"))continue;
                    Debug.Log($"MINIMARKET_DOOR escaparate={w.transform.parent.name} x=[{w.bounds.min.x:0.00},{w.bounds.max.x:0.00}] z=[{w.bounds.min.z:0.00},{w.bounds.max.z:0.00}]");
                }
            }
            else
            {
                Debug.LogWarning("MINIMARKET_DOOR no se localizaron las hojas de la entrada");
            }
        }

        (Transform left,Transform right) doorLeaves;
        (Transform left,Transform right) doorFrames;

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

        /// Find the two sliding leaves by shape rather than by node name: the
        /// pair of thin, similar panels sitting either side of the doorway's
        /// centre. Matching on the mosaic's part names works only until an export
        /// renames them, and then the door silently stops opening.
        static void GlazePanes(Transform target,string materialToken="cristal")
        {
            var facade=materialToken.Equals("facadeglass",StringComparison.OrdinalIgnoreCase);
            var glass=TransparentRuntimeMaterial(facade?"FacadeGlass":"EntranceGlass",
                facade?new Color(.45f,.72f,.78f,.16f):new Color(.60f,.71f,.74f,.14f));
            var glazed=0;
            foreach(var renderer in target.GetComponentsInChildren<Renderer>(true))
            {
                var shared=renderer.sharedMaterials;
                var touched=false;
                for(var i=0;i<shared.Length;i++)
                {
                    if(shared[i]==null||!shared[i].name.ToLowerInvariant().Contains(materialToken))continue;
                    shared[i]=glass;touched=true;
                }
                if(!touched)continue;
                renderer.sharedMaterials=shared;
                renderer.shadowCastingMode=ShadowCastingMode.Off;renderer.receiveShadows=false;glazed++;
            }
            Debug.Log($"MINIMARKET_GLASS tipo={(facade?"fachada":"entrada")} paneles={glazed}");
        }

        static (Transform left,Transform right) FindFrameHalves(Transform door,(Transform left,Transform right) leaves)
        {
            Transform forLeft=null,forRight=null;
            if(!leaves.left||!leaves.right)return (null,null);
            var leftAt=leaves.left.GetComponent<Renderer>();
            var rightAt=leaves.right.GetComponent<Renderer>();
            if(!leftAt||!rightAt)return (null,null);
            foreach(var piece in door.GetComponentsInChildren<Transform>(true))
            {
                if(!piece.name.StartsWith("EntranceFrame"))continue;
                var renderer=piece.GetComponent<Renderer>();
                if(!renderer)continue;
                // Matched by measured position, never by name: glTFast mirrors X
                // on import, so the half called Left arrives on the right.
                var mine=renderer.bounds.center.x;
                if(Mathf.Abs(mine-leftAt.bounds.center.x)<=Mathf.Abs(mine-rightAt.bounds.center.x))
                    forLeft=piece; else forRight=piece;
            }
            return (forLeft,forRight);
        }

        /// How far a leaf runs to clear the opening.
        ///
        /// The whole frame half must pass its own closed outer edge before it can
        /// disappear inside the wall. The extra authored 0.05 crosses the small
        /// reveal between the frame and the clean masonry pier.
        static float LeafTravel(float leafWidth,float frameWidth)=>Mathf.Max(leafWidth,frameWidth)+.05f;

        static (Transform left,Transform right) FindDoorLeaves(Transform root)
        {
            var centre=0f;var bounds=new Bounds();var first=true;
            foreach(var r in root.GetComponentsInChildren<Renderer>(true))
            {
                if(first){bounds=r.bounds;first=false;}else bounds.Encapsulate(r.bounds);
            }
            if(first)return (null,null);
            centre=bounds.center.x;
            Transform left=null,right=null;float leftScore=0,rightScore=0;
            foreach(var r in root.GetComponentsInChildren<Renderer>(true))
            {
                // The frame halves are thin, tall and narrow too, and each has
                // more area than the pane it carries, so without this they won
                // the search and the door slid its frame while the glass stayed.
                if(r.name.StartsWith("EntranceFrame"))continue;
                var size=r.bounds.size;
                var thin=size.z<bounds.size.z*.28f;                 // a panel, not the shell
                var tall=size.y>bounds.size.y*.35f;
                var narrow=size.x<bounds.size.x*.42f;
                if(!thin||!tall||!narrow)continue;
                var offset=r.bounds.center.x-centre;
                var score=size.y*size.x;
                if(offset<0&&score>leftScore){leftScore=score;left=r.transform;}
                if(offset>0&&score>rightScore){rightScore=score;right=r.transform;}
            }
            return (left,right);
        }

        static void PhysicsBox(Transform root,string name,Vector3 size,Vector3 position)
        {
            var box=new GameObject(name);box.transform.SetParent(root,false);box.transform.localPosition=position;var collider=box.AddComponent<BoxCollider>();collider.size=size;box.isStatic=true;
        }


        async Task BuildRearFarmDoor(Transform root)
        {
            // The door is a full-height wall module on the sheet, cap level with the
            // walls beside it; fitted to 3.8 it was squashed by a third.
            await PlaceFitted("AutomaticDoor",new Vector3(-15,0,-17.1f),Quaternion.Euler(0,180,0),new Vector3(9.05f,8.92f,.8f),root,false);
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

        static Material TexturedMaterial(string textureName,float smoothness)
        {
            var name=$"Surface_{textureName}";
            if(RuntimeMaterials.TryGetValue(name,out var existing)&&existing)return existing;
            var texture=Resources.Load<Texture2D>($"Surfaces/{textureName}");
            if(!texture){Debug.LogError($"Falta la textura de superficie {textureName}");return RuntimeMaterial(name,Color.magenta,0);}
            texture.wrapMode=TextureWrapMode.Repeat;texture.filterMode=FilterMode.Bilinear;
            var material=new Material(PrimitiveTemplate()){name=name,color=Color.white};
            material.mainTexture=texture;material.SetTexture("_BaseMap",texture);material.SetFloat("_Metallic",0);material.SetFloat("_Smoothness",smoothness);material.enableInstancing=true;
            RuntimeMaterials[name]=material;return material;
        }

        /// A flat authored surface needs only two triangles. UV repetition lives
        /// on the mesh, so horizontal and vertical roads share one material and
        /// still preserve the supplied sheet's proportions.
        static GameObject TexturedSurface(Transform root,string name,Vector2 size,Vector3 position,string textureName,Vector2 tiles,float smoothness,float yaw=0)
        {
            var surface=new GameObject(name,typeof(MeshFilter),typeof(MeshRenderer));surface.transform.SetParent(root,false);
            surface.transform.localPosition=new Vector3(position.x,position.y/StoreScale,position.z);surface.transform.localRotation=Quaternion.Euler(0,yaw,0);surface.isStatic=true;
            var halfX=size.x*.5f;var halfZ=size.y*.5f;
            var mesh=new Mesh{name=name+"_Mesh"};
            mesh.vertices=new[]{new Vector3(-halfX,0,-halfZ),new Vector3(-halfX,0,halfZ),new Vector3(halfX,0,halfZ),new Vector3(halfX,0,-halfZ)};
            mesh.normals=new[]{Vector3.up,Vector3.up,Vector3.up,Vector3.up};
            mesh.uv=new[]{Vector2.zero,new Vector2(0,tiles.y),tiles,new Vector2(tiles.x,0)};
            mesh.triangles=new[]{0,1,2,0,2,3};mesh.RecalculateBounds();
            surface.GetComponent<MeshFilter>().sharedMesh=mesh;
            var renderer=surface.GetComponent<MeshRenderer>();renderer.sharedMaterial=TexturedMaterial(textureName,smoothness);renderer.shadowCastingMode=ShadowCastingMode.Off;renderer.receiveShadows=true;
            return surface;
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
            var box=GameObject.CreatePrimitive(PrimitiveType.Cube);box.name=name;box.transform.SetParent(root,false);
            box.transform.localPosition=new Vector3(position.x,position.y/StoreScale,position.z);box.transform.localScale=new Vector3(size.x,size.y/StoreScale,size.z);box.isStatic=true;
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
            var box=GameObject.CreatePrimitive(PrimitiveType.Cube);box.name=name;box.transform.SetParent(root,false);box.transform.localPosition=position;box.transform.localScale=size;box.isStatic=true;
            box.GetComponent<Renderer>().sharedMaterial=TransparentRuntimeMaterial($"{name}_Material",color);
            if(!collider)UnityEngine.Object.Destroy(box.GetComponent<Collider>());
            return box;
        }

        // Three.js uses the opposite horizontal handedness from Unity's camera
        // basis.  Every authored Next X coordinate crosses this one boundary.
        /// The plan grows with the space, the mounting height does not: a clock,
        /// a camera, a sign or a lamp hangs on the wall, and the wall keeps the
        /// size it was authored at, so its height is divided back out of the
        /// root's scale. Left as a plan coordinate they floated above the roof.
        static Vector3 XZ(float x,float z,float y=0)=>new(-x*LayoutScale,y/StoreScale,z*LayoutScale);

        async Task BuildFixedInterior(Transform root)
        {
            HideIfBare(await Place("OperationsWall",XZ(-1.6f,-8.05f),Quaternion.identity,Vector3.one,root,true));
            HideIfBare(await Place("BackroomStorage",XZ(5.25f,-8f),Quaternion.identity,Vector3.one,root,true));
            HideIfBare(await Place("StockroomRack",XZ(9.65f,-7.85f),Quaternion.identity,Vector3.one,root,true));
            HideIfBare(await Place("SeasonalDisplay",XZ(-7f,3.15f),Quaternion.identity,Vector3.one,root,true));
            // Three's +90 degree turn becomes -90 after mirroring the plan on X.
            HideIfBare(await Place("ShelfEndcap",XZ(6.4f,-2.2f),Quaternion.Euler(0,-90,0),Vector3.one,root,true));

            HideIfBare(await Place("WallClock",XZ(9.65f,-8.34f,2.2f),Quaternion.identity,Vector3.one,root));
            HideIfBare(await Place("SecurityCamera",XZ(-10.75f,-8.05f,2.55f),Quaternion.identity,Vector3.one,root));
            HideIfBare(await Place("SecurityCamera",XZ(10.65f,7.2f,2.55f),Quaternion.Euler(0,180,0),Vector3.one,root));
            HideIfBare(await Place("HangingSign",XZ(7.25f,1.65f,2.45f),Quaternion.identity,Vector3.one,root));
            HideIfBare(await Place("HangingSign",XZ(-3.8f,-3.35f,2.45f),Quaternion.identity,Vector3.one,root));
            foreach(var x in new[]{-7.2f,-2.4f,2.4f,7.2f})HideIfBare(await Place("CeilingLight",XZ(x,-.6f,2.85f),Quaternion.identity,Vector3.one,root));

            await BuildProductionCubicle(root);
            await BuildFarmField(root);
        }

        Task BuildProductionCubicle(Transform root)
        {
            // The production room uses the shop's rear and side walls. Only the
            // two exposed sides receive glass: one full inner side and a front
            // split around the doorway, which produces the requested inverted L.
            // These are three lightweight boxes, with the exact facade glass
            // material, no roof, opaque module or decorative frame.
            var cubicle=(JObject)spec.Layouts["production"]["PRODUCTION_CUBICLE"];
            var bounds=(JObject)cubicle["bounds"];var doorway=(JObject)cubicle["doorway"];
            const float buildingSide=23f,buildingRear=-17.1f,glassHeight=11.2f,glassThickness=.18f;
            var innerX=-bounds.Value<float>("right")*LayoutScale;
            var frontZ=bounds.Value<float>("front")*LayoutScale;
            var doorCenter=-doorway.Value<float>("centerX")*LayoutScale;
            var doorHalf=doorway.Value<float>("halfWidth")*LayoutScale;
            var doorLeft=doorCenter-doorHalf;var doorRight=doorCenter+doorHalf;

            ProductionGlassPanel(root,"ProductionGlass_Side",
                new Vector3(glassThickness/StoreScale,glassHeight/StoreScale,frontZ-buildingRear),
                new Vector3(innerX,glassHeight*.5f/StoreScale,(buildingRear+frontZ)*.5f));
            ProductionGlassFront(root,"ProductionGlass_FrontLeft",innerX,doorLeft,frontZ,glassHeight,glassThickness);
            ProductionGlassFront(root,"ProductionGlass_FrontRight",doorRight,buildingSide,frontZ,glassHeight,glassThickness);
            Debug.Log($"MINIMARKET_PRODUCTION_GLASS forma=L_invertida ancho={(buildingSide-innerX)*StoreScale:0.00} fondo={(frontZ-buildingRear)*StoreScale:0.00} alto={glassHeight:0.00} puerta={(doorRight-doorLeft)*StoreScale:0.00}");
            return Task.CompletedTask;
        }

        static void ProductionGlassFront(Transform root,string name,float start,float end,float z,float height,float thickness)
        {
            ProductionGlassPanel(root,name,new Vector3(end-start,height/StoreScale,thickness/StoreScale),
                new Vector3((start+end)*.5f,height*.5f/StoreScale,z));
        }

        static void ProductionGlassPanel(Transform root,string name,Vector3 size,Vector3 position)
        {
            var panel=GameObject.CreatePrimitive(PrimitiveType.Cube);panel.name=name;panel.transform.SetParent(root,false);
            panel.transform.localPosition=position;panel.transform.localScale=size;panel.isStatic=true;
            var renderer=panel.GetComponent<Renderer>();renderer.sharedMaterial=TransparentRuntimeMaterial("FacadeGlass",new Color(.45f,.72f,.78f,.16f));
            renderer.shadowCastingMode=ShadowCastingMode.Off;renderer.receiveShadows=false;
            HideIfBare(panel);
        }

        async Task BuildKitProps(Transform root)
        {
            var report=new List<string>();
            foreach(var prop in KitProps)
            {
                var placed=HideIfBare(await Place(prop.id,XZ(prop.x,prop.z,prop.y),Quaternion.Euler(0,prop.yaw,0),Vector3.one,root));
                if(!placed){report.Add($"{prop.id}=FALTA");continue;}
                var renderers=placed.GetComponentsInChildren<Renderer>(true);
                if(renderers.Length==0){report.Add($"{prop.id}=SIN_MALLA");continue;}
                var bounds=renderers[0].bounds;for(var i=1;i<renderers.Length;i++)bounds.Encapsulate(renderers[i].bounds);
                report.Add($"{prop.id}@{bounds.center.x:0.#},{bounds.center.z:0.#} base={bounds.min.y:0.##} alto={bounds.size.y:0.##}");
            }
            var rotos=report.FindAll(line=>line.Contains("FALTA")||line.Contains("SIN_MALLA"));
            if(rotos.Count>0)Debug.LogWarning("MINIMARKET_PROPS "+string.Join(" ",rotos));
            Debug.Log($"MINIMARKET_PROPS colocadas={report.Count-rotos.Count}/{KitProps.Length}");
        }

        async Task BuildFarmField(Transform root)
        {
            var field=(JObject)spec.Layouts["farm"]["FARM_FIELD"];var center=(JArray)field["center"];var size=(JArray)field["size"];
            var cellWidth=size[0].Value<float>()*LayoutScale/6f;var cellDepth=size[2].Value<float>()*LayoutScale/2f;
            var centerX=-center[0].Value<float>()*LayoutScale;var centerZ=center[2].Value<float>()*LayoutScale;
            for(var column=0;column<6;column++)for(var row=0;row<2;row++)
                await PlaceFitted("FarmPlotEmpty",new Vector3(centerX-size[0].Value<float>()*LayoutScale*.5f+cellWidth*(column+.5f),-.03f,centerZ-size[2].Value<float>()*LayoutScale*.5f+cellDepth*(row+.5f)),Quaternion.identity,new Vector3(cellWidth,.14f,cellDepth),root,false);
            // KitFarm stands the plots on a lawn -- two shape meshes, #315d36
            // under a #59934f top a fifth of a unit above it, both the size of
            // FARM_FIELD. Without it the plots sat straight on the city ground
            // and the gaps between them read as bare grass.
            var fieldWidth=size[0].Value<float>()*LayoutScale;var fieldDepth=size[2].Value<float>()*LayoutScale;
            VisualBox(root,"FarmLawnEdge",new Vector3(fieldWidth*1.035f,.1f,fieldDepth*1.035f),new Vector3(centerX,-.038f,centerZ),Hex("315D36"),.03f,false);
            TexturedSurface(root,"FarmLawn",new Vector2(fieldWidth,fieldDepth),new Vector3(centerX,.021f,centerZ),"Grass",new Vector2(fieldWidth/6f,fieldDepth/6f)*(StoreScale/PreviousStoreScale),.02f);
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
            PhysicsBox(root,"FarmFenceCollider",new Vector3(halfX*2,.85f,halfZ*2)*FixedPlanFactor,XZ(p[0].Value<float>(),p[2].Value<float>(),.425f));
        }

        /// The slots where the stock shows up, laid out over the fixture the
        /// piece really is. They are children of the display, so a local offset
        /// is multiplied by its scale -- and that scale is whatever FitLocalSize
        /// needed to blow a 15 cm export up to a six metre gondola. Written as
        /// fixed local numbers they put the tomatoes fifty metres in the air,
        /// which is why the shelves looked empty however much stock was on them.
        /// The offsets are measured on the fitted piece and divided back.
        static bool TryGetLocalRendererBounds(GameObject root, out Bounds bounds)
        {
            bounds = default;
            var renderers = root.GetComponentsInChildren<Renderer>(true);
            var found = false;
            foreach (var renderer in renderers)
            {
                var source = renderer.localBounds;
                for (var x = -1; x <= 1; x += 2)
                for (var y = -1; y <= 1; y += 2)
                for (var z = -1; z <= 1; z += 2)
                {
                    var corner = source.center + Vector3.Scale(source.extents, new Vector3(x, y, z));
                    var local = root.transform.InverseTransformPoint(renderer.transform.TransformPoint(corner));
                    if (!found) { bounds = new Bounds(local, Vector3.zero); found = true; }
                    else bounds.Encapsulate(local);
                }
            }
            return found;
        }

        static void BuildShelfSlots(ProductShelf shelf, GameObject display, string asset)
        {
            var renderers = display.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length == 0) { shelf.BuildSlots(30, Vector3.zero, Vector3.zero, 10); return; }
            var bounds = renderers[0].bounds;
            for (var i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
            var size = bounds.size;
            var scale = display.transform.lossyScale;
            Vector3 Local(Vector3 world) => new(world.x / Mathf.Max(.0001f, scale.x),
                                                world.y / Mathf.Max(.0001f, scale.y),
                                                world.z / Mathf.Max(.0001f, scale.z));
            if (asset == "EggDisplay")
            {
                // The cartons were measured on the piece: seven hollows across
                // from .116 to .888 of its width, two deep at .274 and .567, on
                // three trays whose floors sit at .064, .344 and .594 of its
                // height. One egg per hollow, as wide as the hollow lets it be.
                var puntos = new List<Vector3>();
                foreach (var suelo in new[] { .0642f, .3435f, .5940f })
                    // The depth axis turns over on import, so the rows measured
                    // on the file at .274 and .567 are these two here.
                    foreach (var fila in new[] { .7263f, .4330f })
                        for (var i = 0; i < 7; i++)
                            puntos.Add(Local(new Vector3((.1161f + i * .12862f - .5f) * size.x,
                                                          suelo * size.y, (fila - .5f) * size.z)));
                shelf.BuildSlotsAt(puntos, size.x * .1286f * .86f, true);
                return;
            }
            if (asset == "DisplayRefrigeratedDoors")
            {
                // The delivered three-bay fridge has five usable shelf levels.
                // Slots alternate milk/cheese because ProductVisualSystem uses
                // that same alternating order. Milk occupies the left half and
                // cheese the right half, three products per level on each side.
                if (!TryGetLocalRendererBounds(display, out var localBounds)) return;
                var localSize = localBounds.size;
                var puntos = new List<Vector3>(30);
                foreach (var nivel in new[] { .34f, .46f, .58f, .70f, .82f })
                    for (var columna = 0; columna < 3; columna++)
                    {
                        var lecheX = -.41f + columna * .165f;
                        var quesoX = .08f + columna * .165f;
                        puntos.Add(new Vector3(localBounds.center.x + lecheX * localSize.x,
                                               localBounds.min.y + nivel * localSize.y,
                                               localBounds.center.z + localSize.z * .18f));
                        puntos.Add(new Vector3(localBounds.center.x + quesoX * localSize.x,
                                               localBounds.min.y + nivel * localSize.y,
                                               localBounds.center.z + localSize.z * .18f));
                    }
                shelf.BuildSlotsAt(puntos, Mathf.Min(localSize.x * Mathf.Abs(scale.x) * .07f,
                                                     localSize.y * Mathf.Abs(scale.y) * .10f), false);
                return;
            }
            if (asset == "DisplayProduceMixed")
            {
                // Two rows of three wooden bins. ProductVisualSystem consumes
                // slots tomato/apple/corn in that order, so every SKU owns one
                // physical compartment per row instead of forming generic rows
                // across the front of the furniture.
                if (!TryGetLocalRendererBounds(display, out var localBounds)) return;
                var localSize = localBounds.size;var puntos = new List<Vector3>(36);
                for(var item=0;item<12;item++)
                {
                    // Alternate rows from the first units, then fill all six
                    // places in each wooden bin. This prevents a partially
                    // stocked crate from leaving an entire row visually empty.
                    var row=item%2;var within=item/2;
                    for(var product=0;product<3;product++)
                        puntos.Add(new Vector3(localBounds.center.x+(product-1)*localSize.x*.31f+(within-2.5f)*localSize.x*.046f,
                                               localBounds.min.y+(row==0 ? .43f : .75f)*localSize.y,
                                               localBounds.center.z+localSize.z*.14f));
                }
                shelf.BuildSlotsAt(puntos,Mathf.Min(localSize.x*Mathf.Abs(scale.x)*.055f,
                                                    localSize.y*Mathf.Abs(scale.y)*.11f),false);
                return;
            }
            if (asset == "DisplayTable")
            {
                // The approved table is the bread display. Eighteen slots cover
                // only its top, so bread follows the real shelf inventory and
                // the old milk can and egg tray can never reappear on it.
                if (!TryGetLocalRendererBounds(display, out var localBounds)) return;
                var localSize=localBounds.size;var puntos=new List<Vector3>(18);
                for(var row=0;row<3;row++)
                    for(var column=0;column<6;column++)
                        puntos.Add(new Vector3(localBounds.center.x+(column-2.5f)*localSize.x*.145f,
                                               localBounds.max.y+localSize.y*.025f,
                                               localBounds.center.z+(row-1)*localSize.z*.22f));
                shelf.BuildSlotsAt(puntos,Mathf.Min(localSize.x*Mathf.Abs(scale.x)*.11f,
                                                    localSize.z*Mathf.Abs(scale.z)*.20f),false);
                return;
            }
            if (asset == "ShelfWallTall" || asset == "ShelfWallWide")
            {
                if (!TryGetLocalRendererBounds(display, out var localBounds)) return;
                var localSize=localBounds.size;var wide=asset=="ShelfWallWide";
                var columns=wide?9:8;var levels=wide?5:4;var puntos=new List<Vector3>(columns*levels);
                for(var level=0;level<levels;level++)
                    for(var column=0;column<columns;column++)
                        puntos.Add(new Vector3(localBounds.center.x+(column-(columns-1)*.5f)*localSize.x*(wide ? .088f : .105f),
                                               localBounds.min.y+(.18f+level*(wide ? .17f : .215f))*localSize.y,
                                               localBounds.center.z+localSize.z*.18f));
                shelf.BuildSlotsAt(puntos,Mathf.Min(localSize.x*Mathf.Abs(scale.x)*(wide ? .075f : .09f),
                                                    localSize.y*Mathf.Abs(scale.y)*.085f),false);
                return;
            }
            // Three rows up the front of the piece, ten across, in front of its face.
            var centre = Local(new Vector3(0f, size.y * .30f, size.z * .24f));
            var step = Local(new Vector3(size.x * .085f, size.y * .24f, 0f));
            shelf.slotSize = .24f * SmallPieceScale; shelf.fitFootprint = false;
            shelf.BuildSlots(30, centre, step, 10);
        }

        /// The refrigerator arrived as one opaque mesh, so its frames cannot be
        /// separated into animated leaves without damaging that mesh. Three
        /// lightweight glass leaves are fitted over the bays and remain dynamic;
        /// DairyDoorPresenter opens the one approached by the owner.
        static void BuildDairyDoors(GameObject display)
        {
            if (!display || BareInterior) return;
            if (!TryGetLocalRendererBounds(display, out var bounds)) return;

            var scale = display.transform.lossyScale;
            var bayWidth = bounds.size.x * .265f;
            var glassHeight = bounds.size.y * .58f;
            var glassY = bounds.min.y + bounds.size.y * .55f;
            var glassZ = bounds.max.z + .025f / Mathf.Max(.0001f, Mathf.Abs(scale.z));
            var thickness = Mathf.Max(.025f / Mathf.Max(.0001f, Mathf.Abs(scale.z)), bounds.size.z * .009f);
            var hinges = new Transform[3];
            var glass = TransparentRuntimeMaterial("DairyDoorGlass", new Color(.55f,.82f,.88f,.15f));
            var handle = RuntimeMaterial("DairyDoorHandle", Hex("202928"), .48f);

            for (var bay = 0; bay < 3; bay++)
            {
                var bayCentreX = bounds.center.x + (bay - 1) * bounds.size.x * .325f;
                var hinge = new GameObject($"DairyDoorHinge_{bay + 1}").transform;
                hinge.SetParent(display.transform, false);
                hinge.localPosition = new Vector3(bayCentreX - bayWidth * .5f, glassY, glassZ);
                hinge.localRotation = Quaternion.identity;
                hinges[bay] = hinge;

                var pane = GameObject.CreatePrimitive(PrimitiveType.Cube);
                pane.name = $"DairyDoorGlass_{bay + 1}";
                pane.transform.SetParent(hinge, false);
                pane.transform.localPosition = new Vector3(bayWidth * .5f, 0, 0);
                pane.transform.localScale = new Vector3(bayWidth, glassHeight, thickness);
                UnityEngine.Object.Destroy(pane.GetComponent<Collider>());
                var paneRenderer = pane.GetComponent<Renderer>();
                paneRenderer.sharedMaterial = glass;
                paneRenderer.shadowCastingMode = ShadowCastingMode.Off;
                paneRenderer.receiveShadows = false;
                pane.isStatic = false;

                var grip = GameObject.CreatePrimitive(PrimitiveType.Cube);
                grip.name = $"DairyDoorHandle_{bay + 1}";
                grip.transform.SetParent(hinge, false);
                grip.transform.localPosition = new Vector3(bayWidth * .90f, 0, thickness * 1.8f);
                grip.transform.localScale = new Vector3(Mathf.Max(.035f / Mathf.Max(.0001f, Mathf.Abs(scale.x)),bayWidth*.018f),
                                                        glassHeight * .22f,
                                                        thickness * 1.6f);
                UnityEngine.Object.Destroy(grip.GetComponent<Collider>());
                grip.GetComponent<Renderer>().sharedMaterial = handle;
                grip.isStatic = false;
            }

            var presenter = display.AddComponent<DairyDoorPresenter>();
            presenter.Bind(hinges, bayWidth * Mathf.Abs(scale.x));
            var worldSize = Vector3.Scale(bounds.size, new Vector3(Mathf.Abs(scale.x), Mathf.Abs(scale.y), Mathf.Abs(scale.z)));
            var worldCenter = display.transform.TransformPoint(bounds.center);
            var front = display.transform.forward;
            Debug.Log($"MINIMARKET_DAIRY nevera={worldSize.x:0.00}x{worldSize.y:0.00}x{worldSize.z:0.00} puertas=3 " +
                      $"centro=({worldCenter.x:0.00},{worldCenter.z:0.00}) frente=({front.x:0.00},{front.z:0.00})");
        }

        async Task BuildRetail(StoreWorld world)
        {
            var departments = (JObject)spec.Layouts["retail"]["RETAIL_DEPARTMENTS"];
            var dairyData=(JObject)departments["dairy"];
            var dairyDisplay=(JArray)dairyData["display"];
            var dairyService=(JArray)dairyData["service"];
            foreach (var property in departments.Properties())
            {
                var data = (JObject)property.Value;
                var pos = (JArray)data["display"];
                var displayZ=pos[2].Value<float>();
                // The drinks shelf was approved beside dairy. Doubling the plan
                // would otherwise double their gap as well; retain that one
                // deliberate adjacency while the rest of the shop spreads out.
                if(property.Name=="drinks")
                    displayZ=dairyDisplay[2].Value<float>()+(displayZ-dairyDisplay[2].Value<float>())*FixedPlanFactor;
                var position = new Vector3(-pos[0].Value<float>() * LayoutScale, 0, displayZ * LayoutScale);
                // X is mirrored at the Three -> Unity boundary, therefore yaw
                // must be mirrored too. Keeping -90 made the open face of both
                // wall displays point through the wall instead of at the aisle.
                var rotation = Quaternion.Euler(0, -(data.Value<float?>("yaw") ?? 0), 0);
                var display = HideIfBare(await Place(DisplayAssets[property.Name],position,rotation,Vector3.one*ElementScale,world.Root,true));
                var shelf = display.AddComponent<ProductShelf>();
                shelf.departmentId = property.Name;
                var listedProducts=data["products"].ToObject<string[]>();
                // The table replaces the old bakery fixture and is reserved for
                // bread. Flour and wheat are production inputs, not retail stock.
                shelf.allowedProducts = property.Name=="bakery"
                    ? new[]{"bread"}
                    : listedProducts;
                BuildShelfSlots(shelf, display, DisplayAssets[property.Name]);
                if (property.Name == "dairy") BuildDairyDoors(display);
                world.Shelves[property.Name] = shelf;
                var service = (JArray)data["service"];
                var serviceZ=service[1].Value<float>();
                if(property.Name=="drinks")
                    serviceZ=dairyService[1].Value<float>()+(serviceZ-dairyService[1].Value<float>())*FixedPlanFactor;
                // The shop floor was expanded x2, while furniture and the short
                // distance from a display to its usable side were deliberately
                // kept at their previous physical size. Scaling this offset with
                // the expanded floor put customer destinations behind the unit.
                var servicePoint = NearLayoutPoint($"Service_{property.Name}",display.transform,
                    pos[0].Value<float>(),displayZ,service[0].Value<float>(),serviceZ,world.Root);
                foreach (var product in shelf.allowedProducts)
                {
                    world.ProductServicePoints[product] = servicePoint;
                }
                var interaction=AddAreaInteraction(world,display,$"stock:{property.Name}",$"Reponer {data.Value<string>("label")}",RetailReach,true,.035f,.22f);
                interaction.repeatAutomatically=false;
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
                var checkout = HideIfBare(await Place("CheckoutArea", position, Quaternion.identity, Vector3.one * ElementScale, world.Root, true));
                world.CheckoutCounters.Add(checkout.transform);
                // The delivered checkout is the complete approved set: belt,
                // monitor, payment terminal and lane post are one coherent
                // piece. Do not layer the older split sign or loose checkout
                // props over it.
                if(lane.Name!="0")world.AvailabilityVisuals[$"checkout:{lane.Name}"]=checkout;
                var counterX=counter[0].Value<float>();var counterZ=counter[2].Value<float>();
                var customer = (JArray)data["customerFront"];
                var laneIndex=int.Parse(lane.Name);var checkoutPoint=NearLayoutPoint($"CheckoutCustomerPoint_{laneIndex}",checkout.transform,
                    counterX,counterZ,customer[0].Value<float>(),customer[1].Value<float>(),world.Root);world.CheckoutPoints.Add(checkoutPoint);
                var cashier=(JArray)data["cashierWork"];
                var cashierPoint=NearLayoutPoint($"CheckoutInteractionPoint_{laneIndex}",checkout.transform,
                    counterX,counterZ,cashier[0].Value<float>(),cashier[2].Value<float>(),world.Root);
                AddInteraction(world,cashierPoint,$"checkout:{lane.Name}","Atender caja",ServiceReach,true,.08f,.75f);
                // CheckoutKit's physical sockets, converted from StoreElement
                // units (1.6) through Next's WORLD_SCALE (3), with X mirrored.
                // The three points now sit on the real belt, scanner and bagger.
                var unload=WorldAnchor($"CheckoutUnloadSocket_{laneIndex}",checkout.transform.position+new Vector3(7.968f,6f,0),world.Root);world.CheckoutUnloadPoints.Add(unload);
                var scan=WorldAnchor($"CheckoutScanSocket_{laneIndex}",checkout.transform.position+new Vector3(-3.072f,5.592f,0),world.Root);world.CheckoutScanPoints.Add(scan);
                var bag=WorldAnchor($"CheckoutBagSocket_{laneIndex}",checkout.transform.position+new Vector3(-8.016f,4.896f,0),world.Root);world.CheckoutBagPoints.Add(bag);
                var bagPickup=(JArray)data["bagPickup"];
                world.CheckoutBagPickupPoints.Add(NearLayoutPoint($"CheckoutBagPickupPoint_{laneIndex}",checkout.transform,
                    counterX,counterZ,bagPickup[0].Value<float>(),bagPickup[1].Value<float>(),world.Root));
                var laneQueue=new List<Transform>();world.CheckoutQueuePoints.Add(laneQueue);
                for (var i = 0; i < 8; i++)
                {
                    // A checkout owns one straight queue across the aisle. The
                    // old points turned down Z and crossed the next lane; carts
                    // then occupied the same places and NavMesh avoidance could
                    // deadlock both lines. Six world units leave a small gap
                    // between the new 5.16-unit trolleys.
                    var point = NearLayoutPoint($"Queue{laneIndex+1}_Point{i + 1:00}",checkout.transform,
                        counterX,counterZ,customer[0].Value<float>()-(i+1),customer[1].Value<float>(),world.Root);
                    laneQueue.Add(point);if(laneIndex==0)world.QueuePoints.Add(point);
                }
                if(laneIndex==0){world.CheckoutPoint=cashierPoint;world.CheckoutCameraAnchor=checkout.transform;world.CheckoutUnloadPoint=unload;world.CheckoutScanPoint=scan;world.CheckoutBagPoint=bag;}
            }
        }

        async Task BuildProduction(StoreWorld world)
        {
            var fixtures = (JObject)spec.Layouts["production"]["STORE_PRODUCTION_FIXTURES"];
            var ids = new Dictionary<string, string> { ["flourMill"] = "FlourMillAlt", ["breadOven"] = "BreadOven", ["cheeseMaker"] = "CheeseMachine", ["juiceMachine"] = "JuiceMachineAlt" };
            foreach (var property in fixtures.Properties())
            {
                var data = (JObject)property.Value; var pos = (JArray)data["position"];
                var root = HideIfBare(await Place(ids[property.Name], new Vector3(-pos[0].Value<float>() * LayoutScale, 0, pos[2].Value<float>() * LayoutScale), Quaternion.identity, Vector3.one * ElementScale, world.Root, true));
                world.AvailabilityVisuals[$"machine:{data.Value<string>("machineId")}"]=root;
                var work=(JArray)data["operatorWorkPoint"];
                var workPoint=NearLayoutPoint($"MachineWork_{property.Name}",root.transform,
                    pos[0].Value<float>(),pos[2].Value<float>(),work[0].Value<float>(),work[1].Value<float>(),world.Root);
                var interaction=AddAreaInteraction(world,root,$"machine:{data.Value<string>("machineId")}",data.Value<string>("label"),WorldUnitsPerMeter*.72f,true,.035f,.75f);
                interaction.repeatAutomatically=false;
                world.MachinePoints[data.Value<string>("machineId")] = workPoint;
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
                var interaction=AddAreaInteraction(world,asset,$"farm:{plot.Value<string>("id")}","Cultivar / cosechar",WorldUnitsPerMeter*.65f,true,.035f,.22f);
                interaction.repeatAutomatically=false;
                // Automated farmers need a reachable point outside the solid
                // plot. The player uses the complete rounded perimeter above.
                var workPosition=interaction.transform.position+Vector3.forward*(interaction.AreaHalfExtents.y+WorldUnitsPerMeter*.3f);
                workPosition.y=.08f;
                world.CropPoints[plot.Value<string>("id")]=WorldAnchor($"CropWork_{plot.Value<string>("id")}",workPosition,world.Root);
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
                var workPoint=NearLayoutPoint($"AnimalWork_{property.Name}",animal.transform,
                    pos[0].Value<float>(),pos[2].Value<float>(),work[0].Value<float>(),work[2].Value<float>(),world.Root);
                var interaction=AddInteraction(world,workPoint,$"animal:{property.Name}",property.Name == "chicken" ? "Recoger huevos" : "Recoger leche",ServiceReach,true,.08f,.75f);
                interaction.repeatAutomatically=false;
            }
        }

        async Task BuildServices(StoreWorld world)
        {
            var supplier = HideIfBare(await Place("SupplierTerminal",XZ(8.8f,-2.15f),Quaternion.identity,Vector3.one,world.Root,true));
            var deliveryDock=HideIfBare(await Place("DeliveryDock",XZ(8.8f,-3.23f),Quaternion.identity,Vector3.one,world.Root,true));
            HideIfBare(await Place("SupplierTerminal",XZ(8.8f,-5.35f),Quaternion.identity,Vector3.one,world.Root,true));
            var returns=HideIfBare(await Place("ReturnsStation",XZ(9.85f,5.45f),Quaternion.Euler(0,180,0),Vector3.one,world.Root,true));
            var cartBay=HideIfBare(await Place("CartBay",XZ(3.05f,6.55f),Quaternion.identity,Vector3.one,world.Root,true));
            world.CartReturnPoint=NearLayoutPoint("CartReturnPoint",cartBay.transform,3.05f,6.55f,3.05f,5.25f,world.Root);
            var supplierPoint=NearLayoutPoint("SupplierServicePoint",supplier.transform,8.8f,-2.15f,8.8f,-.95f,world.Root);
            AddInteraction(world,supplierPoint,"supplier","Abrir proveedores",ServiceReach,false);
            var returnsInteraction=AddAreaInteraction(world,returns,"returns","Devolver mercancía",ServiceReach,true,.08f,.75f);
            returnsInteraction.repeatAutomatically=false;
            var pickup = (JArray)spec.Layouts["warehouse"]?["WAREHOUSE_PICKUP_STATION"]?["position"];
            world.WarehousePoint = pickup == null
                ? WorldAnchor("WarehousePickupPoint",deliveryDock.transform.position+new Vector3(8.4f,.08f,-1.02f),world.Root)
                : NearLayoutPoint("WarehousePickupPoint",deliveryDock.transform,8.8f,-3.23f,
                    pickup[0].Value<float>(),pickup[2].Value<float>(),world.Root);
            var warehouseInteraction=AddInteraction(world,world.WarehousePoint,"warehouse","Recoger mercancía",ServiceReach,true,.08f,1.1f);
            warehouseInteraction.repeatAutomatically=false;
        }

        void BuildNavigationAnchors(StoreWorld world)
        {
            world.EntranceOutside = New("EntranceOutside", new Vector3(0, 0, 30.4f));
            world.EntranceInside = New("EntranceInside", new Vector3(0, 0, 11.2f));
            world.ExitPoint = New("ExitPoint", new Vector3(0, 0, 30.8f));
            world.EntranceOutside.SetParent(world.Root, true); world.EntranceInside.SetParent(world.Root, true); world.ExitPoint.SetParent(world.Root, true);
            var field=(JObject)spec.Layouts["farm"]["FARM_FIELD"];
            var fieldCenter=(JArray)field["center"];
            world.FarmCameraAnchor=WorldAnchor("FarmCameraAnchor",new Vector3(
                -fieldCenter[0].Value<float>()*LayoutScale*StoreScale,
                .99f,
                fieldCenter[2].Value<float>()*LayoutScale*StoreScale),world.Root);
            // StorefrontDoorPresenter owns the entrance proximity directly. An
            // extra no-op InteractionPoint only displayed a misleading prompt.
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
            ground.transform.localPosition = new Vector3(0, -1f, -4f * StoreScale);
            ground.AddComponent<BoxCollider>().size = new Vector3(108f * StoreScale, 2f, 128f * StoreScale);
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
                wall.transform.localPosition = new Vector3(offset.x * StoreScale, offset.y, offset.z * StoreScale);
                wall.AddComponent<BoxCollider>().size = new Vector3(size.x * StoreScale, size.y, size.z * StoreScale);
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
            var floorY=instance.transform.position.y;
            if(MetricEnvironment.Contains(id))
            {
                instance.transform.localScale=Vector3.one*(WorldUnitsPerMeter/StoreScale);
                if(MetricGlassEnvironment.Contains(id))GlazePanes(instance.transform,"glass");
                RestOnFloor(instance,floorY);
            }
            else if(TargetWorldHeight.TryGetValue(id,out var targetHeight))FitWorldHeight(instance,targetHeight);
            else
            {
                var target=TargetLongestDimension.TryGetValue(id,out var listed)?listed
                    :Mathf.Max(scale.x,Mathf.Max(scale.y,scale.z));
                NormalizeScale(instance,target*SizeFactor(id,target));
            }
            if(SeptemberFurniture.Contains(id))LogFurnitureSize(id,instance);
            foreach(var child in instance.GetComponentsInChildren<Transform>(true))child.gameObject.isStatic=true;
            if (collider) AddBoundsCollider(instance);
            return instance;
        }

        async Task<GameObject> PlaceFitted(string id,Vector3 position,Quaternion rotation,Vector3 targetSize,Transform root,bool collider,float sizeFactor=0f)
        {
            var instance=await loader.InstantiateAsync(id,root,position,rotation,Vector3.one);
            var floorY=instance.transform.position.y;
            if(sizeFactor<=0f)sizeFactor=SizeFactor(id,Mathf.Max(targetSize.x,Mathf.Max(targetSize.y,targetSize.z)));
            FitLocalSize(instance,targetSize*sizeFactor);
            if(MetricEnvironment.Contains(id))
            {
                if(MetricGlassEnvironment.Contains(id))GlazePanes(instance.transform,"glass");
                RestOnFloor(instance,floorY);
            }
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

        static void FitWorldHeight(GameObject instance,float targetHeight)
        {
            var renderers=instance.GetComponentsInChildren<Renderer>(true);if(renderers.Length==0||targetHeight<=0)return;
            var bounds=renderers[0].bounds;for(var i=1;i<renderers.Length;i++)bounds.Encapsulate(renderers[i].bounds);
            if(bounds.size.y<=.0001f)return;
            instance.transform.localScale*=targetHeight/bounds.size.y;
        }

        static void LogFurnitureSize(string id,GameObject instance)
        {
            var renderers=instance.GetComponentsInChildren<Renderer>(true);if(renderers.Length==0)return;
            var bounds=renderers[0].bounds;for(var i=1;i<renderers.Length;i++)bounds.Encapsulate(renderers[i].bounds);
            Debug.Log($"MINIMARKET_MUEBLE id={id} medida={bounds.size.x:0.00}x{bounds.size.y:0.00}x{bounds.size.z:0.00}");
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
            // target.position is already in world space. Passing it through
            // New() multiplied it by StoreScale again and moved every sensor
            // away from the fixture it belonged to.
            var pointRoot = WorldAnchor($"Interaction_{id}",target.position,world.Root);
            var point = pointRoot.gameObject.AddComponent<InteractionPoint>();
            point.Configure(id,label,radius,automatic,dwell,repeat);
            interactions.Register(point); world.Interactions[id] = point; return point;
        }

        InteractionPoint AddAreaInteraction(StoreWorld world,GameObject target,string id,string label,float reach,bool automatic=true,float dwell=.08f,float repeat=.22f)
        {
            var renderers=target.GetComponentsInChildren<Renderer>(true);
            if(renderers.Length==0)return AddInteraction(world,target.transform,id,label,reach,automatic,dwell,repeat);
            var bounds=renderers[0].bounds;for(var i=1;i<renderers.Length;i++)bounds.Encapsulate(renderers[i].bounds);
            var position=new Vector3(bounds.center.x,target.transform.position.y,bounds.center.z);
            var pointRoot=WorldAnchor($"Interaction_{id}",position,world.Root);
            var point=pointRoot.gameObject.AddComponent<InteractionPoint>();
            point.ConfigureArea(id,label,new Vector2(bounds.extents.x,bounds.extents.z),reach,automatic,dwell,repeat);
            interactions.Register(point);world.Interactions[id]=point;return point;
        }

        static Transform WorldAnchor(string name,Vector3 worldPosition,Transform root)
        {
            var value=new GameObject(name).transform;
            value.position=worldPosition;
            value.SetParent(root,true);
            return value;
        }

        /// Converts a short authored offset around a fixture using the physical
        /// pre-expansion scale. Main furniture remains on the expanded x2 plan;
        /// service points, queue spacing and operator positions stay beside it.
        static Transform NearLayoutPoint(string name,Transform fixture,float fixtureX,float fixtureZ,
            float pointX,float pointZ,Transform root,float y=.08f)
        {
            var physicalPlanScale=LayoutScale*PreviousStoreScale;
            var worldPosition=fixture.position+new Vector3(
                -(pointX-fixtureX)*physicalPlanScale,
                0,
                (pointZ-fixtureZ)*physicalPlanScale);
            worldPosition.y=y;
            return WorldAnchor(name,worldPosition,root);
        }

        Transform New(string name, Vector3 position)
        {
            var value = new GameObject(name).transform; value.SetParent(parent, false); value.position = position * StoreScale; return value;
        }
    }
}
