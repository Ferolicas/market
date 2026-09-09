using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace MiniMarket.Assets
{
    /// <summary>
    /// Semantic colour system for the 3D world. Imported environment assets use
    /// stable material tokens (Polished_olive, Polished_soil, etc.); resolving
    /// those tokens here keeps every family coherent without duplicating or
    /// permanently mutating the materials cached by glTFast.
    /// </summary>
    public static class WorldPalette
    {
        public const string StoreWall = "E8E1CC";
        public const string StoreWallLight = "F3EEDF";
        public const string StoreTrim = "EEEBDD";
        public const string StoreGreen = "3F5A2C";
        public const string StoreGreenLight = "58753B";
        public const string StoreGreenDark = "304522";
        public const string StoreFrame = "343A34";
        public const string StoreGlass = "BFC9C0";

        public const string FloorBase = "EDE5D1";
        public const string FloorLight = "F3EDDF";
        public const string FloorJoint = "D8CFBA";
        public const string Sidewalk = "E6DCC5";
        public const string Kerb = "D8D0BC";
        public const string Path = "DDD0B3";

        public const string Asphalt = "454A47";
        public const string AsphaltLight = "505551";
        public const string AsphaltShadow = "383D3B";
        public const string RoadLine = "E8E5D9";
        public const string RoadEdge = "CBC5B5";
        public const string StreetLamp = "292F2C";

        public const string Soil = "79533B";
        public const string SoilLight = "8C6246";
        public const string SoilDark = "654431";
        public const string CultivatedSoil = "704A34";
        public const string Furrow = "5C3D2D";
        public const string Grass = "65933E";
        public const string GrassLight = "79A94B";
        public const string GrassDark = "4E7A31";

        public const string Wood = "9A673D";
        public const string WoodLight = "B47B48";
        public const string WoodDark = "71492F";
        public const string WoodPost = "805334";
        public const string WoodCrate = "A87545";
        public const string ShedRoof = "526B3B";
        public const string ShedWall = "D7CEB4";
        public const string Metal = "AEB5AD";
        public const string MetalShadow = "7D8782";

        public const string TreeLight = "86B557";
        public const string TreeMid = "659640";
        public const string TreeDark = "4E7B35";
        public const string TreeDeep = "416B2E";
        public const string Trunk = "8B5937";
        public const string TrunkLight = "A56D40";
        public const string TrunkDark = "68432E";
        public const string Bush = "557F35";
        public const string Hedge = "4C7633";
        public const string SmallPlant = "69943D";

        public const string CropLeaf = "5F8C38";
        public const string CropLeafLight = "79A947";
        public const string CropLeafDark = "486E30";
        public const string CropOrange = "D58236";
        public const string CropYellow = "D0A344";
        public const string CropStem = "477431";

        public const string ShelfStructure = "414A40";
        public const string ShelfStructureDark = "303831";
        public const string ShelfTray = "596157";
        public const string ShelfGreen = "506D39";
        public const string ShelfPanel = "D7CEB6";
        public const string ShelfMetal = "A7AAA0";

        public const string ColdStructure = "AAB2AA";
        public const string ColdLight = "D9DDD5";
        public const string ColdGlass = "B9CBC8";
        public const string ColdInterior = "E4E6DE";
        public const string ColdFrame = "46504A";
        public const string ColdGreen = "526E3D";

        public const string CheckoutBase = "444C45";
        public const string CheckoutBelt = "363D38";
        public const string CheckoutGreen = "506B3A";
        public const string CheckoutMetal = "A5A99F";
        public const string CheckoutScreen = "788A7D";
        public const string CheckoutCream = "D9D3C1";

        static readonly HashSet<string> ShelfAssets = new(StringComparer.OrdinalIgnoreCase)
        {
            "ShelfGondolaDouble","ShelfGondolaSingle","ShelfCorner","ShelfDivider","ShelfPriceRail",
            "StockroomRack","DisplayBakery","DisplayProduceSloped","PromotionalBasket",
        };
        static readonly HashSet<string> ColdAssets = new(StringComparer.OrdinalIgnoreCase)
        {
            "ChestFreezer","RefrigeratedDisplay","DisplayRefrigeratedDoors",
        };
        static readonly HashSet<string> CheckoutAssets = new(StringComparer.OrdinalIgnoreCase)
        {
            "CheckoutArea","CheckoutCounter","Conveyor","CashRegister","CashDrawer","CashDrawerAlt",
            "CardTerminal","ReceiptPrinter","CheckoutScanner","CheckoutScannerAlt","CheckoutShelf",
            "BaggingArea","BaggingAreaAlt","CheckoutLaneSign","CashierStool",
        };
        static readonly HashSet<string> FarmAssets = new(StringComparer.OrdinalIgnoreCase)
        {
            "FarmPlotEmpty","FarmPlotFurrows","FarmPlotSeeded","FarmPlotWatered","IrrigationBed",
            "IrrigationChannel","RaisedBed","FarmFenceShort","FarmFenceLong","FarmFenceCorner","FarmGate",
            "Sprinkler","WateringCan","SeedSack","CompostBin","MiniGreenhouse","Scarecrow","FarmWaterTank",
            "FarmToolSet","ChickenPaddock","CowPaddock","WheatGrowing","CropSeed","CropSprout","CropSmall",
            "CropGrowing","WheatRipe","CarrotRipe","TomatoRipe","LettuceRipe","PumpkinRipe","CornRipe",
        };
        static readonly HashSet<string> CropAssets = new(StringComparer.OrdinalIgnoreCase)
        {
            "WheatGrowing","CropSeed","CropSprout","CropSmall","CropGrowing","WheatRipe","CarrotRipe",
            "TomatoRipe","LettuceRipe","PumpkinRipe","CornRipe",
        };
        static readonly HashSet<string> WoodCrateAssets = new(StringComparer.OrdinalIgnoreCase)
        {
            "WoodCrate","Furniture2:WoodCrate","Pallet","Parcel",
        };

        static readonly string[] VehicleColours = { "5594A8", "4779A0", "477346", "E3E1D8" };
        static readonly Dictionary<string,Material> Variants = new(StringComparer.Ordinal);

        public static Color Linear(string value)
        {
            return ColorUtility.TryParseHtmlString($"#{value}",out var color) ? color.linear : Color.magenta;
        }

        public static void Apply(string assetId,GameObject instance)
        {
            if(!instance)return;
            var renderers=instance.GetComponentsInChildren<Renderer>(true);
            var treeTones=TreeTones(instance,renderers);
            var vehicleColour=VehicleColours[VehicleVariant(instance.transform.localPosition)];
            var sequence=0;
            foreach(var renderer in renderers)
            {
                var shared=renderer.sharedMaterials;
                var changed=false;
                for(var index=0;index<shared.Length;index++)
                {
                    var source=shared[index];
                    if(!source)continue;
                    var materialToken=source.name.ToLowerInvariant();
                    // StoreWorldBuilder replaces glass with a transparent URP
                    // material after loading. Recolouring the opaque import here
                    // would hide the token it uses to locate the panes.
                    if(materialToken.Contains("glass")||materialToken.Contains("cristal"))continue;
                    if(!TryResolve(assetId,renderer.name,materialToken,treeTones,renderer,vehicleColour,sequence++,out var role,out var hex))continue;
                    shared[index]=Variant(source,role,Linear(hex));changed=true;
                }
                if(changed)renderer.sharedMaterials=shared;
            }
        }

        static Dictionary<int,string> TreeTones(GameObject instance,IEnumerable<Renderer> renderers)
        {
            if(!instance.name.StartsWith("Tree",StringComparison.OrdinalIgnoreCase))return null;
            var crowns=renderers.Where(item=>item.name.Contains("TreeCrown",StringComparison.OrdinalIgnoreCase))
                .OrderBy(item=>instance.transform.InverseTransformPoint(item.bounds.center).y).ToArray();
            var tones=new Dictionary<int,string>();
            for(var index=0;index<crowns.Length;index++)
            {
                var third=Mathf.Max(1,Mathf.CeilToInt(crowns.Length/3f));
                tones[crowns[index].GetInstanceID()]=index<third?TreeDark:index>=crowns.Length-third?TreeLight:TreeMid;
            }
            return tones;
        }

        static int VehicleVariant(Vector3 position)
        {
            var key=Mathf.Abs(Mathf.RoundToInt(position.x*10f))+Mathf.Abs(Mathf.RoundToInt(position.z*7f));
            return key%VehicleColours.Length;
        }

        static bool TryResolve(string id,string partName,string materialName,Dictionary<int,string> treeTones,
            Renderer renderer,string vehicleColour,int sequence,out string role,out string hex)
        {
            role=null;hex=null;
            var part=partName.ToLowerInvariant();
            var token=SemanticToken(materialName);

            if(id.Equals("StoreEntrance",StringComparison.OrdinalIgnoreCase)||id.Equals("StoreEntranceAlt",StringComparison.OrdinalIgnoreCase))
            {
                if(materialName.Contains("placa_panel")||materialName.Contains("placa_borde")){role="store-green";hex=StoreGreen;return true;}
                if(materialName.Contains("muro")){role="store-wall";hex=StoreWall;return true;}
                if(materialName.Contains("cornisa")||materialName.Contains("detalle")||materialName.Contains("letras")){role="store-trim";hex=StoreTrim;return true;}
                if(materialName.Contains("losa")){role="store-wall-shadow";hex="D4CCB5";return true;}
                if(materialName.Contains("marco")||materialName.Contains("bolardo")){role="store-frame";hex=StoreFrame;return true;}
            }
            if(id.Equals("StorefrontWindow",StringComparison.OrdinalIgnoreCase))
            {
                if(materialName.Contains("trim")){role="store-trim";hex=StoreTrim;return true;}
                role="store-wall";hex=StoreWall;return true;
            }
            if(id.Equals("WallStraight",StringComparison.OrdinalIgnoreCase)||id.Equals("WallCorner",StringComparison.OrdinalIgnoreCase))
            {role="store-wall";hex=StoreWall;return true;}
            if(id.Equals("AutomaticDoor",StringComparison.OrdinalIgnoreCase))
            {role="store-frame";hex=StoreFrame;return true;}

            if(id.Equals("SidewalkSegment",StringComparison.OrdinalIgnoreCase))
            {
                if(part.Contains("joint")){role="floor-joint";hex=FloorJoint;return true;}
                if(part.Contains("kerb")){role="kerb";hex=Kerb;return true;}
                role="sidewalk";hex=Sidewalk;return true;
            }
            if(id.Equals("ParkingSpace",StringComparison.OrdinalIgnoreCase)||id.Equals("RoadSegment",StringComparison.OrdinalIgnoreCase)||id.Equals("Crosswalk",StringComparison.OrdinalIgnoreCase))
            {
                if(part.Contains("line")||part.Contains("dash")||part.Contains("stripe")){role="road-line";hex=RoadLine;return true;}
                if(part.Contains("edge")){role="road-edge";hex=RoadEdge;return true;}
                role="asphalt";hex=Asphalt;return true;
            }
            if(id.Equals("StreetLight",StringComparison.OrdinalIgnoreCase))
            {role="street-lamp";hex=StreetLamp;return true;}

            if(id.Equals("Tree",StringComparison.OrdinalIgnoreCase))
            {
                if(part.Contains("crown")&&treeTones!=null&&treeTones.TryGetValue(renderer.GetInstanceID(),out var treeHex))
                {role=$"tree-{treeHex}";hex=treeHex;return true;}
                if(part.Contains("trunk")){role="tree-trunk";hex=Trunk;return true;}
                if(part.Contains("base")){role="tree-base";hex=Path;return true;}
            }
            if(id.Equals("CityBuilding",StringComparison.OrdinalIgnoreCase))
            {
                if(part.Contains("awning")){role=token=="olive"?"awning-green":"awning-white";hex=token=="olive"?"56753D":"ECE9DC";return true;}
                if(part.Contains("rooftrim")){role="building-roof";hex="F2EFE3";return true;}
                if(part.Contains("roofunit")){role="building-chimney";hex="C9B995";return true;}
                if(part.Contains("plinth")){role="building-shadow";hex="C9C0A7";return true;}
                if(part.Contains("building")){role="building-facade";hex="DDD5BC";return true;}
            }
            if(id.Equals("Car",StringComparison.OrdinalIgnoreCase))
            {
                if(token=="blue"){role=$"vehicle-{vehicleColour}";hex=vehicleColour;return true;}
                if(token is "black" or "dark"){role="vehicle-dark";hex="333936";return true;}
                if(token=="ivory"){role="vehicle-light";hex="E3E1D8";return true;}
                if(token=="silver"){role="vehicle-metal";hex=Metal;return true;}
            }

            if(id.Equals("Cow",StringComparison.OrdinalIgnoreCase))
            {
                if(token=="white"){role="cow-white";hex="E7E6D9";return true;}
                if(token=="black"){role="cow-black";hex="252B29";return true;}
                if(token is "beige" or "cardboard"){role="cow-muzzle";hex="C8B8A1";return true;}
            }
            if(id.Equals("Chicken",StringComparison.OrdinalIgnoreCase))
            {
                if(token=="white"){role="chicken-white";hex="E9E7D9";return true;}
                if(token=="red"){role="chicken-comb";hex="C65A3B";return true;}
                if(token=="yellow"){role="chicken-beak";hex="D69A3D";return true;}
            }

            if(ShelfAssets.Contains(id))return ResolveShelf(token,out role,out hex);
            if(ColdAssets.Contains(id))return ResolveCold(token,out role,out hex);
            if(CheckoutAssets.Contains(id))return ResolveCheckout(token,out role,out hex);
            if(CropAssets.Contains(id))
            {
                if(part.Contains("stem")){role="crop-stem";hex=CropStem;return true;}
                if(token is "leaf" or "leaf2")
                {
                    var leafColours=new[]{CropLeafDark,CropLeaf,CropLeafLight};hex=leafColours[Math.Abs(sequence)%leafColours.Length];role=$"crop-leaf-{hex}";return true;
                }
                if(token=="orange"){role="crop-orange";hex=CropOrange;return true;}
                if(token is "yellow" or "gold"){role="crop-yellow";hex=CropYellow;return true;}
            }
            if(FarmAssets.Contains(id))
            {
                if(part.Contains("furrow")){role="furrow";hex=Furrow;return true;}
                if(token=="wetsoil"){role="soil-dark";hex=SoilDark;return true;}
                if(token=="soil"){role="soil";hex=Soil;return true;}
                if(token=="wood"){role="farm-wood";hex=part.Contains("post")?WoodPost:Wood;return true;}
                if(token=="wood2"){role="farm-wood-light";hex=WoodLight;return true;}
                if(token=="dark"){role="farm-wood-dark";hex=WoodDark;return true;}
                if(token=="green"){role="shed-roof";hex=ShedRoof;return true;}
                if(token is "cream" or "ivory" or "beige"){role="shed-wall";hex=ShedWall;return true;}
                if(token is "steel" or "silver"){role=token=="steel"?"metal-shadow":"metal";hex=token=="steel"?MetalShadow:Metal;return true;}
            }
            if(WoodCrateAssets.Contains(id))
            {
                if(token=="wood"){role="wood";hex=Wood;return true;}
                if(token is "wood2" or "cardboard"){role="wood-crate";hex=WoodCrate;return true;}
            }

            return ResolveMaster(token,out role,out hex);
        }

        static bool ResolveShelf(string token,out string role,out string hex)
        {
            role="shelf";
            switch(token)
            {
                case "dark": hex=ShelfStructure;role+="-structure";return true;
                case "black": hex=ShelfStructureDark;role+="-dark";return true;
                case "steel": hex=ShelfTray;role+="-tray";return true;
                case "silver": hex=ShelfMetal;role+="-metal";return true;
                case "olive":case "green":case "green2":hex=ShelfGreen;role+="-green";return true;
                case "ivory":case "cream":case "beige":case "white":hex=ShelfPanel;role+="-panel";return true;
                default:hex=null;role=null;return false;
            }
        }

        static bool ResolveCold(string token,out string role,out string hex)
        {
            role="cold";
            switch(token)
            {
                case "dark":case "black":hex=ColdFrame;role+="-frame";return true;
                case "steel":case "silver":hex=ColdStructure;role+="-structure";return true;
                case "olive":case "green":case "green2":hex=ColdGreen;role+="-green";return true;
                case "white":hex=ColdInterior;role+="-interior";return true;
                case "ivory":case "cream":case "beige":hex=ColdLight;role+="-light";return true;
                default:hex=null;role=null;return false;
            }
        }

        static bool ResolveCheckout(string token,out string role,out string hex)
        {
            role="checkout";
            switch(token)
            {
                case "dark":hex=CheckoutBase;role+="-base";return true;
                case "black":hex=CheckoutBelt;role+="-belt";return true;
                case "olive":hex=CheckoutGreen;role+="-green";return true;
                case "green":case "green2":hex=CheckoutScreen;role+="-screen";return true;
                case "steel":case "silver":hex=CheckoutMetal;role+="-metal";return true;
                case "ivory":case "cream":case "beige":case "white":hex=CheckoutCream;role+="-cream";return true;
                default:hex=null;role=null;return false;
            }
        }

        static bool ResolveMaster(string token,out string role,out string hex)
        {
            role=$"master-{token}";
            switch(token)
            {
                case "cream":hex=StoreWall;return true;
                case "ivory":case "white":hex=StoreWallLight;return true;
                case "beige":hex=StoreTrim;return true;
                case "olive":hex=StoreGreen;return true;
                case "green":hex=StoreGreenLight;return true;
                case "green2":hex=TreeMid;return true;
                case "dark":case "black":hex=StoreFrame;return true;
                case "steel":hex=MetalShadow;return true;
                case "silver":hex=Metal;return true;
                case "wood":hex=Wood;return true;
                case "wood2":case "cardboard":hex=WoodLight;return true;
                case "soil":hex=Soil;return true;
                case "wetsoil":hex=SoilDark;return true;
                case "leaf":hex=CropLeaf;return true;
                case "leaf2":hex=TreeMid;return true;
                case "orange":hex=CropOrange;return true;
                case "yellow":case "gold":hex=CropYellow;return true;
                case "red":hex="C65A3B";return true;
                case "blue":hex="5594A8";return true;
                default:role=null;hex=null;return false;
            }
        }

        static string SemanticToken(string name)
        {
            const string prefix="polished_";
            var start=name.IndexOf(prefix,StringComparison.OrdinalIgnoreCase);
            if(start<0)return string.Empty;
            start+=prefix.Length;var end=name.IndexOf('_',start);
            return end<0?name[start..]:name[start..end];
        }

        static Material Variant(Material source,string role,Color color)
        {
            var key=$"WorldPalette:{source.GetInstanceID()}:{role}";
            if(Variants.TryGetValue(key,out var existing)&&existing)return existing;
            var material=new Material(source){name=$"{source.name} · {role}"};
            foreach(var property in new[]{"_BaseColorFactor","_BaseColor","_Color"})
                if(material.HasProperty(property))material.SetColor(property,color);
            material.enableInstancing=true;Variants[key]=material;return material;
        }
    }
}
