using System;
using System.Collections;
using MiniMarket.Audio;
using MiniMarket.Core;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.UI;
using MiniMarket.Player;
using MiniMarket.Networking;
using System.Globalization;

namespace MiniMarket.UI
{
    public sealed class RuntimeHud : MonoBehaviour
    {
        static Color Linear(string value){ColorUtility.TryParseHtmlString($"#{value}",out var color);return color.linear;}
        static Color Alpha(Color color,float alpha){color.a=alpha;return color;}
        // globals.css tokens verbatim: --ink, --cream, --mint, --coral, --forest
        // plus .glass-panel's #ffffffe3 and the .positive/.negative ledger pair.
        static readonly Color Ink=Alpha(Linear("183B33"),.98f);static readonly Color Cream=Alpha(Linear("FFF7E5"),.98f);static readonly Color Green=Linear("56B997");static readonly Color Orange=Linear("EF6C4C");static readonly Color Glass=Alpha(Linear("FFFFFF"),.89f);static readonly Color Muted=Linear("637D75");
        static readonly Color Forest=Alpha(Linear("173F35"),.90f);static readonly Color Positive=Linear("4EC694");static readonly Color Negative=Linear("F08A72");
        Canvas canvas;Font font;Sprite roundedSprite;RectTransform loading;Text loadingText;Text money;Text clock;Text level;Text carry;Text save;Text prompt;Text toast;Text player;Text missionSummary;Text tutorialSummary;Text storeStatusText;Image storeStatusImage;RectTransform storeStatus;RectTransform carryChip;RectTransform saveChip;RectTransform promptPanel;RectTransform toastPanel;RectTransform tutorialCard;RectTransform drawer;RectTransform drawerContent;RectTransform drawerClose;RectTransform actions;Text drawerTitle;
        MiniMarketRuntime runtime;AudioManager audioService;Coroutine toastRoutine;VirtualJoystick joystick;

        void Awake()=>Build();
        public void Bind(MiniMarketRuntime value,AudioManager audioManager)
        {
            runtime=value;audioService=audioManager;runtime.Signals.StateChanged+=Refresh;runtime.Signals.Notification+=Notify;runtime.Interactions.NearestChanged+=NearestChanged;
            BuildNavigation();BuildJoystick();Refresh();if(runtime.CompanySetup.Required)OpenPanel("setup");
        }

        public void ShowLoading(string message){if(!loading)Build();loading.gameObject.SetActive(true);loadingText.text=message;}
        public void HideLoading(){if(loading)loading.gameObject.SetActive(false);}
        public void ShowFatal(string message){ShowLoading(message);loadingText.color=new Color(1,.55f,.45f);}

        void Build()
        {
            font=Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            roundedSprite=CreateRoundedSprite();
            var root=new GameObject("GameUI",typeof(Canvas),typeof(CanvasScaler),typeof(GraphicRaycaster));root.transform.SetParent(transform,false);canvas=root.GetComponent<Canvas>();canvas.renderMode=RenderMode.ScreenSpaceOverlay;canvas.sortingOrder=30;
            var scaler=root.GetComponent<CanvasScaler>();scaler.uiScaleMode=CanvasScaler.ScaleMode.ScaleWithScreenSize;scaler.referenceResolution=new Vector2(1440,900);scaler.matchWidthOrHeight=.5f;
            var top=Panel("HudTop",root.transform,Glass);Anchor(top,new Vector2(.5f,1),new Vector2(.5f,1),new Vector2(-460,-82),new Vector2(460,-14));var layout=top.gameObject.AddComponent<HorizontalLayoutGroup>();layout.padding=new RectOffset(8,8,6,6);layout.spacing=0;layout.childForceExpandWidth=false;layout.childForceExpandHeight=true;
            var brand=Label(top,"M  Mini Market\n    Distrito inicial",12,TextAnchor.MiddleLeft);SizeForLayout(brand.rectTransform,172);brand.color=Ink;
            money=Label(top,"CAJA GLOBAL\n—",14,TextAnchor.MiddleCenter);SizeForLayout(money.rectTransform,120);
            clock=Label(top,"VENTAS HOY\n—",13,TextAnchor.MiddleCenter);SizeForLayout(clock.rectTransform,100);
            level=Label(top,"NIVEL —\nPROGRESO",12,TextAnchor.MiddleCenter);SizeForLayout(level.rectTransform,80);var progressTrack=Panel("LevelProgress",level.transform,Alpha(Linear("D5E6DF"),.95f));Anchor(progressTrack,new Vector2(.12f,0),new Vector2(.88f,0),new Vector2(0,5),new Vector2(0,10));var progressFill=Panel("Fill",progressTrack,Linear("F2A34D"));Anchor(progressFill,Vector2.zero,new Vector2(.22f,1),Vector2.zero,Vector2.zero);
            storeStatus=Button(top,"CERRADO",()=>{runtime?.ToggleStore();audioService?.UiConfirm();},Alpha(Linear("FBE1DA"),.98f));SizeForLayout(storeStatus,100);storeStatusText=storeStatus.GetComponentInChildren<Text>();storeStatusImage=storeStatus.GetComponent<Image>();

            var mission=Panel("MissionCard",root.transform,Glass);Anchor(mission,new Vector2(0,1),new Vector2(0,1),new Vector2(12,-132),new Vector2(230,-80));var missionButton=mission.gameObject.AddComponent<Button>();missionButton.onClick.AddListener(()=>OpenPanel("missions"));missionSummary=Label(mission,"◎  PROGRESO AL SIGUIENTE NIVEL\n0/0 requisitos · 0/0 objetivos",13,TextAnchor.MiddleLeft);Anchor(missionSummary.rectTransform,Vector2.zero,Vector2.one,new Vector2(12,4),new Vector2(-8,-4));

            tutorialCard=Panel("LevelOneGuide",root.transform,Glass);Anchor(tutorialCard,new Vector2(1,1),new Vector2(1,1),new Vector2(-268,-132),new Vector2(-12,-80));tutorialSummary=Label(tutorialCard,"1    PASO 1 DE 5\n      Cultiva los primeros tomates",13,TextAnchor.MiddleLeft);Anchor(tutorialSummary.rectTransform,Vector2.zero,Vector2.one,new Vector2(12,4),new Vector2(-8,-4));tutorialSummary.color=Ink;tutorialCard.gameObject.SetActive(false);

            promptPanel=Panel("ProximityPrompt",root.transform,Forest);promptPanel.GetComponent<Image>().raycastTarget=false;Anchor(promptPanel,new Vector2(.5f,0),new Vector2(.5f,0),new Vector2(-115,90),new Vector2(115,148));prompt=Label(promptPanel,"",15,TextAnchor.MiddleCenter);Anchor(prompt.rectTransform,Vector2.zero,Vector2.one,new Vector2(8,2),new Vector2(-8,-2));prompt.color=Cream;promptPanel.gameObject.SetActive(false);
            toastPanel=Panel("Toast",root.transform,new Color(1,.99f,.95f,.96f));toastPanel.GetComponent<Image>().raycastTarget=false;Anchor(toastPanel,new Vector2(.5f,0),new Vector2(.5f,0),new Vector2(-230,126),new Vector2(230,166));toast=Label(toastPanel,"",20,TextAnchor.MiddleCenter);Anchor(toast.rectTransform,Vector2.zero,Vector2.one,new Vector2(8,2),new Vector2(-8,-2));toast.color=Ink;var group=toastPanel.gameObject.AddComponent<CanvasGroup>();group.alpha=0;

            saveChip=Panel("SaveChip",root.transform,new Color(.07f,.22f,.18f,.91f));Anchor(saveChip,new Vector2(0,0),new Vector2(0,0),new Vector2(14,14),new Vector2(154,48));save=Label(saveChip,"GUARDADO",13,TextAnchor.MiddleCenter);Anchor(save.rectTransform,Vector2.zero,Vector2.one,new Vector2(8,2),new Vector2(-8,-2));save.color=Cream;saveChip.gameObject.SetActive(false);
            carryChip=Panel("CarryChip",root.transform,new Color(.07f,.22f,.18f,.91f));Anchor(carryChip,new Vector2(1,0),new Vector2(1,0),new Vector2(-194,74),new Vector2(-14,119));carry=Label(carryChip,"CESTA · 0/0",14,TextAnchor.MiddleCenter);Anchor(carry.rectTransform,Vector2.zero,Vector2.one,new Vector2(8,2),new Vector2(-8,-2));carry.color=Cream;carryChip.gameObject.SetActive(false);
            var playerChip=Panel("PlayerChip",root.transform,new Color(.07f,.22f,.18f,.91f));Anchor(playerChip,new Vector2(1,0),new Vector2(1,0),new Vector2(-184,14),new Vector2(-14,62));player=Label(playerChip,"●  PROPIETARIO\n    Reputación —",13,TextAnchor.MiddleLeft);Anchor(player.rectTransform,Vector2.zero,Vector2.one,new Vector2(10,3),new Vector2(-10,-3));player.color=Cream;

            drawer=Panel("ManagementPanel",root.transform,Glass);Anchor(drawer,new Vector2(.12f,.09f),new Vector2(.88f,.91f),Vector2.zero,Vector2.zero);drawerTitle=Label(drawer,"MENÚ",28,TextAnchor.MiddleLeft);drawerTitle.color=Ink;Anchor(drawerTitle.rectTransform,new Vector2(0,1),new Vector2(1,1),new Vector2(28,-72),new Vector2(-90,-12));
            drawerClose=Button(drawer,"×",()=>drawer.gameObject.SetActive(false),new Color(.12f,.31f,.25f));Anchor(drawerClose,new Vector2(1,1),new Vector2(1,1),new Vector2(-68,-64),new Vector2(-16,-12));
            var viewport=Panel("Viewport",drawer,new Color(0,0,0,0));Anchor(viewport,new Vector2(0,0),new Vector2(1,1),new Vector2(26,24),new Vector2(-26,-84));viewport.gameObject.AddComponent<RectMask2D>();var scroll=viewport.gameObject.AddComponent<ScrollRect>();scroll.horizontal=false;scroll.movementType=ScrollRect.MovementType.Clamped;scroll.scrollSensitivity=34;
            drawerContent=new GameObject("Content",typeof(RectTransform),typeof(VerticalLayoutGroup),typeof(ContentSizeFitter)).GetComponent<RectTransform>();drawerContent.SetParent(viewport,false);drawerContent.anchorMin=new Vector2(0,1);drawerContent.anchorMax=new Vector2(1,1);drawerContent.pivot=new Vector2(.5f,1);drawerContent.anchoredPosition=Vector2.zero;drawerContent.sizeDelta=Vector2.zero;var vertical=drawerContent.GetComponent<VerticalLayoutGroup>();vertical.spacing=10;vertical.childForceExpandHeight=false;vertical.childForceExpandWidth=true;drawerContent.GetComponent<ContentSizeFitter>().verticalFit=ContentSizeFitter.FitMode.PreferredSize;scroll.content=drawerContent;scroll.viewport=viewport;drawer.gameObject.SetActive(false);
            loading=Panel("Loading",root.transform,new Color(.055f,.11f,.09f,1));Anchor(loading,Vector2.zero,Vector2.one,Vector2.zero,Vector2.zero);loadingText=Label(loading,"Preparando la tienda…",38,TextAnchor.MiddleCenter);loadingText.color=Cream;Anchor(loadingText.rectTransform,new Vector2(.15f,.35f),new Vector2(.85f,.65f),Vector2.zero,Vector2.zero);
        }

        void BuildNavigation()
        {
            actions=Panel("QuickMenu",canvas.transform,Glass);Anchor(actions,new Vector2(.5f,0),new Vector2(.5f,0),new Vector2(-201,10),new Vector2(201,66));var row=actions.gameObject.AddComponent<GridLayoutGroup>();row.padding=new RectOffset(6,6,5,5);row.spacing=new Vector2(3,0);row.constraint=GridLayoutGroup.Constraint.FixedColumnCount;row.constraintCount=8;row.cellSize=new Vector2(45.5f,46);
            QuickButton(row.transform,"INV",()=>OpenPanel("inventory"),"Inventario");
            QuickButton(row.transform,"PED",()=>OpenPanel("supplier"),"Proveedores");
            QuickButton(row.transform,"EQ",()=>OpenPanel("hiring"),"Equipo");
            QuickButton(row.transform,"MAP",()=>OpenPanel("map"),"Franquicias");
            QuickButton(row.transform,"$",()=>OpenPanel("finance"),"Finanzas");
            QuickButton(row.transform,"+",()=>OpenPanel("upgrade"),"Construir");
            QuickButton(row.transform,"YO",()=>OpenPanel("closet"),"Avatar");
            QuickButton(row.transform,"?",()=>OpenPanel("help"),"Cómo jugar");
            var responsive=gameObject.AddComponent<ResponsiveHudLayout>();responsive.Bind(actions,drawer,row);
        }

        void BuildJoystick()
        {
            var area=Panel("GameInputSurface",canvas.transform,new Color(0,0,0,0));Anchor(area,Vector2.zero,Vector2.one,Vector2.zero,Vector2.zero);area.SetAsFirstSibling();
            var visual=Panel("DragJoystick",area,new Color(.07f,.22f,.18f,.24f));visual.anchorMin=visual.anchorMax=new Vector2(.5f,.5f);visual.pivot=new Vector2(.5f,.5f);visual.sizeDelta=new Vector2(144,144);
            var knob=Panel("Knob",visual,new Color(1f,1f,1f,.7f));knob.anchorMin=knob.anchorMax=new Vector2(.5f,.5f);knob.pivot=new Vector2(.5f,.5f);knob.sizeDelta=new Vector2(44,44);knob.anchoredPosition=Vector2.zero;
            joystick=area.gameObject.AddComponent<VirtualJoystick>();joystick.Bind(area,visual,knob,runtime.Player);
        }

        public void OpenPanel(string id)
        {
            if(!runtime)return;Clear(drawerContent);drawerTitle.text=id switch{"supplier"=>"PROVEEDORES","hiring"=>"EQUIPO","upgrade"=>"CONSTRUIR Y MEJORAR","closet"=>"AVATAR","map"=>"FRANQUICIAS","finance"=>"FINANZAS","help"=>"CÓMO JUGAR","missions"=>"PROGRESO Y OBJETIVOS","setup"=>"CREA TU EMPRESA",_=>"INVENTARIO"};
            if(id=="supplier"||id=="inventory")BuildProducts(id=="supplier");else if(id=="hiring")BuildHiring();else if(id=="closet")BuildCloset();else if(id=="map")BuildFranchises();else if(id=="finance")BuildFinance();else if(id=="help")BuildHelp();else if(id=="missions")BuildMissions();else if(id=="setup")BuildSetup();else BuildUpgrades();
            var setup=id=="setup";if(drawerClose)drawerClose.gameObject.SetActive(!setup);if(actions)actions.gameObject.SetActive(!setup);
            drawer.gameObject.SetActive(true);
        }
        void BuildSetup()
        {
            HelpLine("PRIMER PASO","El país fija moneda, impuestos y costes y no podrá cambiarse después de empezar a vender.");
            Label(drawerContent,"PERSONAJE INICIAL",24,TextAnchor.MiddleLeft).gameObject.AddComponent<LayoutElement>().preferredHeight=46;
            Button(drawerContent,"Hombre adulto",()=>_ = runtime.ChangePlayerBody("adult-man"),new Color(.31f,.44f,.63f));Button(drawerContent,"Mujer adulta",()=>_ = runtime.ChangePlayerBody("adult-woman"),new Color(.31f,.44f,.63f));Button(drawerContent,"Niño",()=>_ = runtime.ChangePlayerBody("boy"),new Color(.31f,.44f,.63f));Button(drawerContent,"Niña",()=>_ = runtime.ChangePlayerBody("girl"),new Color(.31f,.44f,.63f));
            Label(drawerContent,"PAÍS FISCAL",24,TextAnchor.MiddleLeft).gameObject.AddComponent<LayoutElement>().preferredHeight=46;
            if(runtime.Spec.Root["catalog"]?["COUNTRIES"] is JObject countries)foreach(var property in countries.Properties())
            {
                var code=property.Name;var country=(JObject)property.Value;Button(drawerContent,$"{country.Value<string>("name")} · {country.Value<string>("currency")}",()=>CompleteSetup(code),Green);
            }
        }
        void CompleteSetup(string countryCode)
        {
            if(!runtime.CompleteCompanySetup(countryCode)){Notify("No se pudo registrar la empresa");return;}
            DismissSetup();audioService.UiConfirm();
        }
        public void DismissSetup(){drawer.gameObject.SetActive(false);if(drawerClose)drawerClose.gameObject.SetActive(true);if(actions)actions.gameObject.SetActive(true);}

        void BuildProducts(bool ordering)
        {
            var carried=Label(drawerContent,$"CARGA PERSONAL · {runtime.Carry.Total}/{runtime.Carry.Capacity} · {runtime.Carry.Summary()}",22,TextAnchor.MiddleLeft);carried.gameObject.AddComponent<LayoutElement>().preferredHeight=50;
            if(runtime.Carry.Total>0)Button(drawerContent,"Devolver toda la carga al almacén",()=>{runtime.ReturnCarriedItems();RefreshPanel("inventory");},new Color(.26f,.42f,.38f));
            foreach(var property in runtime.Spec.Products.Properties())
            {
                var id=property.Name;var name=property.Value.Value<string>("name");var wholesale=runtime.Spec.ScaleMoney(property.Value.Value<long>("wholesaleMinor")*10,runtime.State.CountryCode);
                var unlocked=runtime.ProductPolicy.IsProductUnlocked(id,runtime.State.Level);
                if(ordering&&!unlocked)continue;
                if(!ordering&&!unlocked&&runtime.State.Quantity("warehouse",id)==0&&runtime.State.Quantity("shelves",id)==0&&runtime.Carry.Quantity(id)==0)continue;
                var status=unlocked?"":$" · bloqueado hasta nivel {runtime.ProductPolicy.ProductUnlockLevel(id)}";
                var line=Label(drawerContent,$"{name}   carga {runtime.Carry.Quantity(id)} · almacén {runtime.State.Quantity("warehouse",id)} · estante {runtime.State.Quantity("shelves",id)}{status}",22,TextAnchor.MiddleLeft);line.gameObject.AddComponent<LayoutElement>().preferredHeight=42;
                if(ordering)Button(drawerContent,$"Pedir 10 · {Money(wholesale)}",()=>{if(!runtime.Orders.Order(id,10))Notify("Pedido no disponible o caja insuficiente");else audioService.UiConfirm();RefreshPanel("supplier");},Orange);
            }
        }

        void BuildHiring()
        {
            foreach(var property in ((JObject)runtime.Spec.Root["catalog"]["ROLE_INFO"]).Properties())
            {
                var role=property.Name;var info=(JObject)property.Value;var salary=runtime.Spec.ScaleMoney(info.Value<long>("salaryMinor"),runtime.State.CountryCode);
                Button(drawerContent,$"{info.Value<string>("name")} · alta {Money(salary*2)} · nivel {info.Value<int>("unlockLevel")}",()=>{if(!runtime.Hiring.Hire(role))Notify("Contratación bloqueada o caja insuficiente");else audioService.UiConfirm();RefreshPanel("hiring");},new Color(.22f,.5f,.68f));
            }
        }

        void BuildUpgrades()
        {
            Button(drawerContent,"Mapa de franquicias",()=>OpenPanel("map"),new Color(.22f,.5f,.68f));
            var project=NextProject();var text=project==null?"Rango máximo":$"Nivel {runtime.State.Level+1} · {Money(project.Value<long>("contributedMinor"))} / {Money(project.Value<long>("costMinor"))}";
            Button(drawerContent,text,()=>{if(!runtime.Progression.ContributeToNextLevel())Notify("No se pudo financiar o falta el objetivo");else audioService.UiConfirm();RefreshPanel("upgrade");},new Color(.43f,.33f,.72f));
            var licenseDays=runtime.State.CurrentFranchise.Value<int?>("licenseDaysLeft")??0;
            Button(drawerContent,$"Renovar licencia 14 días · quedan {licenseDays} · {Money(runtime.Licenses.RenewalCost)}",()=>{if(!runtime.Licenses.Renew())Notify("Caja insuficiente para renovar la licencia");else audioService.UiConfirm();RefreshPanel("upgrade");},Orange);
            UpgradeContributionButton("station","Estación prioritaria",new Color(.26f,.5f,.68f));
            UpgradeContributionButton("player-speed","Velocidad del vendedor",new Color(.31f,.44f,.63f));
            UpgradeContributionButton("player-capacity","Capacidad de carga",new Color(.63f,.3f,.52f));
            UpgradeContributionButton("employee","Formación del equipo",new Color(.43f,.33f,.72f));
            Button(drawerContent,"Mejorar estantes",()=>Upgrade("shelves"),Green);Button(drawerContent,"Mejorar caja",()=>Upgrade("checkout"),Green);Button(drawerContent,"Ampliar tienda",()=>Upgrade("expansion"),Green);
            Label(drawerContent,$"VALORACIÓN · {runtime.State.CurrentFranchise.Value<double?>("rating")??3.5:0.00} / 5",24,TextAnchor.MiddleLeft).gameObject.AddComponent<LayoutElement>().preferredHeight=48;
            if(runtime.State.Root["missions"] is JArray missions)
            {
                Label(drawerContent,"MISIONES DE LA JORNADA",24,TextAnchor.MiddleLeft).gameObject.AddComponent<LayoutElement>().preferredHeight=48;
                foreach(var token in missions)
                {
                    if(token is not JObject mission)continue;var id=mission.Value<string>("id");var progress=mission.Value<int?>("progress")??0;var target=mission.Value<int?>("target")??1;
                    var completed=mission.Value<bool>("completed");var claimed=mission.Value<bool>("claimed");
                    if(completed&&!claimed)Button(drawerContent,$"Cobrar · {mission.Value<string>("label")} · {Money(mission.Value<long?>("rewardMinor")??0)}",()=>{runtime.Progression.ClaimMission(id);audioService.UiConfirm();RefreshPanel("upgrade");},Green);
                    else
                    {
                        var line=Label(drawerContent,$"{mission.Value<string>("label")} · {progress}/{target}{(claimed?" · COBRADA":"")}",21,TextAnchor.MiddleLeft);line.gameObject.AddComponent<LayoutElement>().preferredHeight=44;
                    }
                }
            }
        }
        void BuildMissions()
        {
            var next=NextProject();
            HelpLine(runtime.State.Level>=30?"PROGRESIÓN COMPLETADA":$"PARA SUBIR AL NIVEL {runtime.State.Level+1}",next==null?"Has alcanzado el rango máximo.":$"Financiación: {Money(next.Value<long>("contributedMinor"))} / {Money(next.Value<long>("costMinor"))}");
            if(next!=null&&!next.Value<bool>("completed"))Button(drawerContent,"Aportar a la ampliación",()=>{runtime.Progression.ContributeToNextLevel();audioService.UiConfirm();RefreshPanel("missions");},Green);
            Label(drawerContent,"BONOS DEL DÍA · no bloquean el avance",22,TextAnchor.MiddleLeft).gameObject.AddComponent<LayoutElement>().preferredHeight=44;
            foreach(var token in runtime.State.Array("missions"))
            {
                if(token is not JObject mission)continue;var id=mission.Value<string>("id");var progress=mission.Value<int?>("progress")??0;var target=Math.Max(1,mission.Value<int?>("target")??1);var completed=mission.Value<bool>("completed");var claimed=mission.Value<bool>("claimed");
                if(completed&&!claimed)Button(drawerContent,$"COBRAR · {mission.Value<string>("label")} · {Money(mission.Value<long?>("rewardMinor")??0)}",()=>{runtime.Progression.ClaimMission(id);audioService.UiConfirm();RefreshPanel("missions");},Green);
                else
                {
                    var line=Label(drawerContent,$"{(claimed?"✓":"○")}  {mission.Value<string>("label")}\n     {progress}/{target}{(claimed?" · COBRADA":"")}",20,TextAnchor.MiddleLeft);line.gameObject.AddComponent<LayoutElement>().preferredHeight=58;
                }
            }
        }
        void BuildFranchises()
        {
            if(runtime.State.Root["franchises"] is not JArray franchises)return;
            foreach(var token in franchises)
            {
                if(token is not JObject franchise)continue;var id=franchise.Value<string>("id");var owned=franchise.Value<bool>("owned");var current=id==runtime.State.Root.Value<string>("currentFranchiseId");
                var title=$"{franchise.Value<string>("name")} · {franchise.Value<string>("city")}";
                if(current){var line=Label(drawerContent,$"{title} · ESTÁS AQUÍ",22,TextAnchor.MiddleLeft);line.gameObject.AddComponent<LayoutElement>().preferredHeight=54;}
                else if(owned)Button(drawerContent,$"Viajar · {title}",()=>{if(runtime.TravelFranchise(id)){audioService.UiConfirm();drawer.gameObject.SetActive(false);}else Notify("No se pudo viajar");},Green);
                else Button(drawerContent,$"Comprar · {title} · nivel {franchise.Value<int>("unlockLevel")} · {Money(franchise.Value<long>("purchaseCostMinor"))}",()=>{if(!runtime.BuyFranchise(id))Notify("Franquicia bloqueada o caja insuficiente");else audioService.UiConfirm();RefreshPanel("map");},Orange);
            }
        }
        void BuildFinance()
        {
            var finances=runtime.State.Root["finances"] as JObject??new JObject();
            var franchise=runtime.State.CurrentFranchise;
            FinanceLine("Ingresos brutos acumulados",finances.Value<long?>("grossRevenueMinor")??0,Positive);
            FinanceLine("Coste de mercancía",-(finances.Value<long?>("costOfGoodsMinor")??0),Negative);
            FinanceLine("Nóminas",-(finances.Value<long?>("payrollMinor")??0),Negative);
            FinanceLine("Operación",-(finances.Value<long?>("operatingCostsMinor")??0),Negative);
            FinanceLine("Impuestos",-(finances.Value<long?>("taxesMinor")??0),Negative);
            FinanceLine("Beneficio neto",finances.Value<long?>("netProfitMinor")??0,new Color(.26f,.5f,.68f));
            FinanceLine("Ventas de hoy",franchise.Value<long?>("revenueTodayMinor")??0,Positive);
            FinanceLine("Gastos de hoy",-(franchise.Value<long?>("expensesTodayMinor")??0),Negative);
            FinanceLine("Valoración",(long)Math.Round((franchise.Value<double?>("rating")??3.5)*100),new Color(.43f,.33f,.72f)," / 500");
            Button(drawerContent,"Sincronizar progreso ahora",async ()=>{var ok=await runtime.SyncNow();Notify(ok?"Progreso sincronizado":"Guardado local; sincronización remota aplazada");RefreshPanel("finance");},new Color(.26f,.42f,.38f));
            Button(drawerContent,"Cerrar jornada y contabilizar",()=>{runtime.CloseDay();audioService.UiConfirm();RefreshPanel("finance");},new Color(.58f,.2f,.17f));
            Button(drawerContent,"Cerrar sesión",()=>WebSessionBridge.Logout(),new Color(.58f,.2f,.17f));
        }
        void FinanceLine(string label,long amount,Color color,string suffix="")
        {
            var line=Label(drawerContent,$"{label} · {(suffix.Length>0?amount.ToString():Money(amount))}{suffix}",23,TextAnchor.MiddleLeft);line.color=color;line.gameObject.AddComponent<LayoutElement>().preferredHeight=48;
        }
        void BuildHelp()
        {
            HelpLine("MOVERSE","WASD, flechas o arrastra en cualquier zona libre de la pantalla.");
            HelpLine("COSECHAR","Acércate a un bancal maduro; la actividad se inicia por proximidad.");
            HelpLine("PRODUCIR","Lleva el ingrediente a la máquina; recoge su salida al terminar.");
            HelpLine("REPONER","Recoge mercancía en el almacén y llévala al expositor compatible.");
            HelpLine("DEVOLVER","DEVOLVER CARGA regresa íntegramente todo lo transportado al almacén.");
            HelpLine("CLIENTES","Abre la tienda; comprarán solo productos desbloqueados y disponibles.");
            HelpLine("CRECER","Completa el objetivo y financia la ampliación para subir de nivel.");
            HelpLine("GUARDADO","Recuperación local cada 10 s; servidor cada 30 min y al cerrar la jornada.");
        }
        void HelpLine(string title,string description)
        {
            var line=Label(drawerContent,$"{title}\n{description}",22,TextAnchor.MiddleLeft);line.gameObject.AddComponent<LayoutElement>().preferredHeight=76;
        }
        void BuildCloset()
        {
            Label(drawerContent,"PERSONAJE",24,TextAnchor.MiddleLeft).gameObject.AddComponent<LayoutElement>().preferredHeight=46;
            Button(drawerContent,"Hombre adulto",()=>_ = runtime.ChangePlayerBody("adult-man"),new Color(.31f,.44f,.63f));Button(drawerContent,"Mujer adulta",()=>_ = runtime.ChangePlayerBody("adult-woman"),new Color(.31f,.44f,.63f));Button(drawerContent,"Niño",()=>_ = runtime.ChangePlayerBody("boy"),new Color(.31f,.44f,.63f));Button(drawerContent,"Niña",()=>_ = runtime.ChangePlayerBody("girl"),new Color(.31f,.44f,.63f));
            Label(drawerContent,"GORROS",24,TextAnchor.MiddleLeft).gameObject.AddComponent<LayoutElement>().preferredHeight=46;
            Button(drawerContent,"Sin gorro",()=>_ = runtime.SelectAccessory("Hats","none","none"),new Color(.33f,.38f,.43f));
            var hats=new[]{("Hat_01_RedPanda","red-panda"),("Hat_02_Fox","red-fox"),("Hat_03_Chicken","chicken"),("Hat_04_Owl","owl"),("Hat_05_Elephant","elephant"),("Hat_06_Rhino","rhino"),("Hat_07_Giraffe","giraffe"),("Hat_08_Panda","panda"),("Hat_09_Frog","frog"),("Hat_10_Cow","cow"),("Hat_11_Rabbit","rabbit"),("Hat_12_Capybara","capybara")};
            foreach(var pair in hats){var asset=pair.Item1;var id=pair.Item2;Button(drawerContent,asset,()=>_ = runtime.SelectAccessory("Hats",asset,id),new Color(.63f,.3f,.52f));}
            Label(drawerContent,"PEINADOS (16 encajes)",24,TextAnchor.MiddleLeft).gameObject.AddComponent<LayoutElement>().preferredHeight=46;
            var hairIds=new[]{"side-part","fade","waves","swept","bob","ponytail","long-wavy","bun","messy","curls","short-fringe","quiff","blunt-bob","pigtails","braid","high-ponytail"};
            var hairAssets=new[]{"Hair_01_SidePart","Hair_02_Fade","Hair_03_Wavy","Hair_04_SlickBack","Hair_05_Bob","Hair_06_Ponytail","Hair_07_LongWavy","Hair_08_Bun","Hair_09_MessyMale","Hair_10_CurlyMale","Hair_11_SideSweepMale","Hair_12_SpikyMale","Hair_13_BobBangs","Hair_14_Pigtails","Hair_15_SideBraid","Hair_16_HighPonytail"};
            for(var i=0;i<hairAssets.Length;i++){var asset=hairAssets[i];var id=hairIds[i];Button(drawerContent,asset,()=>_ = runtime.SelectAccessory("Hair",asset,id),new Color(.31f,.44f,.63f));}
        }
        public void BindPlayer(PlayerController playerController){if(joystick){var area=joystick.GetComponent<RectTransform>();var visual=area.Find("DragJoystick") as RectTransform;var knob=visual?.Find("Knob") as RectTransform;joystick.Bind(area,visual,knob,playerController);}}
        void UpgradeContributionButton(string kind,string fallback,Color color)
        {
            var quote=runtime.Upgrades.Quote(kind);if(quote==null)return;
            var progress=quote.ContributedMinor>0?$" · aportado {Money(quote.ContributedMinor)}":"";
            Button(drawerContent,$"{fallback}: {quote.Label} · T{quote.CurrentTier} → T{quote.NextTier} · {Money(quote.RemainingMinor)}{progress}",()=>
            {
                var current=runtime.Upgrades.Quote(kind);if(current==null||!runtime.Upgrades.Contribute(kind,current.RemainingMinor))Notify("Caja insuficiente o mejora no disponible");else audioService.UiConfirm();RefreshPanel("upgrade");
            },color);
        }
        void Upgrade(string id){if(!runtime.Upgrades.Upgrade(id))Notify("Caja insuficiente");else audioService.UiConfirm();RefreshPanel("upgrade");}
        JObject NextProject(){foreach(var token in runtime.State.Array("buildProjects"))if(token.Value<int>("level")==runtime.State.Level+1)return token as JObject;return null;}
        void RefreshPanel(string id){if(drawer.gameObject.activeSelf)OpenPanel(id);}

        void Refresh()
        {
            if(runtime==null||runtime.State==null||runtime.State.Root==null||!runtime.State.Root.HasValues)return;
            var franchise=runtime.State.CurrentFranchise;var open=franchise.Value<bool?>("open")??false;var status=runtime.Saves?.Status?.ToLowerInvariant()??"local";
            var franchiseName=franchise.Value<string>("name")??"Mini Market";var franchiseCity=franchise.Value<string>("city")??"Distrito inicial";
            canvas.transform.Find("HudTop/Text");
            var topBrand=canvas.transform.Find("HudTop/Text")?.GetComponent<Text>();if(topBrand)topBrand.text=$"M  {franchiseName}\n    {franchiseCity}";
            money.text=$"CAJA GLOBAL\n{Money(runtime.State.BalanceMinor)}";
            clock.text=$"VENTAS HOY\n{Money(franchise.Value<long?>("revenueTodayMinor")??0)} · Día {runtime.State.Day} {runtime.State.MinuteOfDay/60:00}:{runtime.State.MinuteOfDay%60:00}";
            level.text=$"NIVEL {runtime.State.Level}\nPROGRESO";
            carry.text=$"CESTA · {runtime.Carry.Summary()}\n{runtime.Carry.Total}/{runtime.Carry.Capacity}";carryChip.gameObject.SetActive(runtime.Carry.Total>0);
            save.text=status switch{"saving"=>"GUARDANDO…","offline"=>"COPIA LOCAL","dirty"=>"CAMBIOS PENDIENTES","conflict"=>"CONFLICTO","error"=>"ERROR AL GUARDAR",_=>"GUARDADO"};saveChip.gameObject.SetActive(status is "offline" or "conflict" or "error");
            player.text=$"●  PROPIETARIO\n    Reputación {runtime.State.Root.Value<int?>("reputation")??0}";
            storeStatusText.text=open?"●  ABIERTO":"●  CERRADO";storeStatusImage.color=open?new Color(.84f,.95f,.89f):new Color(.98f,.87f,.84f);storeStatusText.color=open?new Color(.09f,.39f,.28f):new Color(.6f,.22f,.17f);
            var completed=0;var claimable=0;var total=runtime.State.Array("missions").Count;foreach(var token in runtime.State.Array("missions")){if(token.Value<bool>("completed"))completed++;if(token.Value<bool>("completed")&&!token.Value<bool>("claimed"))claimable++;}
            missionSummary.text=$"{(claimable>0?"◆":"◎")}  PROGRESO AL NIVEL {Math.Min(30,runtime.State.Level+1)}\nObjetivos del día {completed}/{total}{(claimable>0?$" · {claimable} por cobrar":"")}";
            RefreshTutorial(franchise,open);
        }
        void RefreshTutorial(JObject franchise,bool open)
        {
            var tutorial=runtime.State.Root.Value<int?>("tutorialStep")??0;var visible=runtime.State.Level==1&&tutorial>0;tutorialCard.gameObject.SetActive(visible);if(!visible)return;
            var counters=runtime.State.Root["progression"]?["counters"] as JObject;long Counter(string id)=>counters?.Value<long?>(id)??0;
            var harvested=Counter("harvest:tomatoes");var stocked=Counter("stock:tomatoes");var sales=Counter("customers");var carried=runtime.Carry.Quantity("tomatoes");
            var step=1;var title="Cultiva los primeros tomates";
            if(carried>0||(harvested>=3&&stocked<3)){step=2;title="Surte frutas y verduras";}
            else if(harvested>=3&&!open){step=3;title="Abre el supermercado";}
            else if(open&&sales<1){var waiting=runtime.Customers?.ActiveCount>0;step=waiting?5:4;title=waiting?"Atiende la caja":"Recibe al primer comprador";}
            else if(sales>=1){step=5;title="Tu primera venta está lista";}
            tutorialSummary.text=$"{step}    PASO {step} DE 5\n      {title}";
        }
        string Money(long minor)
        {
            if(runtime==null)return minor.ToString();var code=runtime.State.Root.Value<string>("currency")??"EUR";var symbol=code switch{"EUR"=>"€","USD"=>"$","COP"=>"$","MXN"=>"$","ARS"=>"$",_=>code};
            return $"{(minor/100d).ToString("N2",CultureInfo.GetCultureInfo("es-ES"))} {symbol}";
        }
        void NearestChanged(MiniMarket.Interactions.InteractionPoint point){promptPanel.gameObject.SetActive(point);prompt.text=point?$"●  {point.label}":"";}
        void Notify(string message){if(toastRoutine!=null)StopCoroutine(toastRoutine);toastRoutine=StartCoroutine(Toast(message));}
        IEnumerator Toast(string message){toast.text=message;var group=toastPanel.GetComponent<CanvasGroup>();group.alpha=1;yield return new WaitForSecondsRealtime(2.8f);for(var t=0f;t<.35f;t+=Time.unscaledDeltaTime){group.alpha=1-t/.35f;yield return null;}group.alpha=0;}

        Sprite CreateRoundedSprite()
        {
            const int size=64;const float radius=15f;var texture=new Texture2D(size,size,TextureFormat.RGBA32,false,true){name="RuntimeHud_RoundedRect",filterMode=FilterMode.Bilinear,wrapMode=TextureWrapMode.Clamp};var pixels=new Color32[size*size];
            for(var y=0;y<size;y++)for(var x=0;x<size;x++)
            {
                var qx=Mathf.Abs(x-(size-1)*.5f)-((size-1)*.5f-radius);var qy=Mathf.Abs(y-(size-1)*.5f)-((size-1)*.5f-radius);var outside=Mathf.Sqrt(Mathf.Max(qx,0)*Mathf.Max(qx,0)+Mathf.Max(qy,0)*Mathf.Max(qy,0))+Mathf.Min(Mathf.Max(qx,qy),0)-radius;var alpha=(byte)Mathf.RoundToInt(255*Mathf.Clamp01(.5f-outside));pixels[y*size+x]=new Color32(255,255,255,alpha);
            }
            texture.SetPixels32(pixels);texture.Apply(false,true);return Sprite.Create(texture,new Rect(0,0,size,size),new Vector2(.5f,.5f),100,0,SpriteMeshType.FullRect,new Vector4(16,16,16,16));
        }
        RectTransform Panel(string name,Transform parent,Color color){var go=new GameObject(name,typeof(RectTransform),typeof(Image));go.transform.SetParent(parent,false);var image=go.GetComponent<Image>();image.color=color;if(roundedSprite){image.sprite=roundedSprite;image.type=Image.Type.Sliced;}return go.GetComponent<RectTransform>();}
        Text Label(Transform parent,string value,int size,TextAnchor anchor){var go=new GameObject("Text",typeof(RectTransform),typeof(Text));go.transform.SetParent(parent,false);var text=go.GetComponent<Text>();text.font=font;text.text=value;text.fontSize=size;text.color=Ink;text.alignment=anchor;text.resizeTextForBestFit=true;text.resizeTextMinSize=9;text.resizeTextMaxSize=size;return text;}
        RectTransform Button(Transform parent,string label,UnityEngine.Events.UnityAction action,Color color){var go=new GameObject(label,typeof(RectTransform),typeof(Image),typeof(Button),typeof(LayoutElement));go.transform.SetParent(parent,false);go.GetComponent<Image>().color=color;var button=go.GetComponent<Button>();button.onClick.AddListener(action);var element=go.GetComponent<LayoutElement>();element.preferredHeight=58;element.minHeight=46;var text=Label(go.transform,label,19,TextAnchor.MiddleCenter);text.color=color.grayscale<.42f?Cream:Ink;Anchor(text.rectTransform,Vector2.zero,Vector2.one,new Vector2(8,4),new Vector2(-8,-4));return go.GetComponent<RectTransform>();}
        void QuickButton(Transform parent,string icon,UnityEngine.Events.UnityAction action,string tooltip){var button=Button(parent,icon,action,Alpha(Linear("E8F4EC"),.96f));button.gameObject.name=tooltip;var text=button.GetComponentInChildren<Text>();text.fontSize=icon.Length>1?13:22;text.fontStyle=FontStyle.Bold;text.resizeTextMinSize=10;text.resizeTextMaxSize=icon.Length>1?13:22;}
        static void SizeForLayout(RectTransform rect,float width){var element=rect.GetComponent<LayoutElement>()??rect.gameObject.AddComponent<LayoutElement>();element.preferredWidth=width;element.minWidth=width;}
        static void Anchor(RectTransform rect,Vector2 min,Vector2 max,Vector2 offsetMin,Vector2 offsetMax){rect.anchorMin=min;rect.anchorMax=max;rect.offsetMin=offsetMin;rect.offsetMax=offsetMax;}
        static void Clear(Transform root){for(var i=root.childCount-1;i>=0;i--)Destroy(root.GetChild(i).gameObject);}
        void OnDestroy(){if(runtime?.Signals!=null){runtime.Signals.StateChanged-=Refresh;runtime.Signals.Notification-=Notify;}if(runtime?.Interactions!=null)runtime.Interactions.NearestChanged-=NearestChanged;}
    }
}
