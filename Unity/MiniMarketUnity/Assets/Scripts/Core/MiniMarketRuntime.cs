using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using MiniMarket.Animations;
using MiniMarket.Assets;
using MiniMarket.Audio;
using MiniMarket.Characters;
using MiniMarket.Customers;
using MiniMarket.Data;
using MiniMarket.Economy;
using MiniMarket.Employees;
using MiniMarket.Farm;
using MiniMarket.Interactions;
using MiniMarket.Inventory;
using MiniMarket.Networking;
using MiniMarket.Performance;
using MiniMarket.Persistence;
using MiniMarket.Player;
using MiniMarket.Production;
using MiniMarket.Progression;
using MiniMarket.Store;
using MiniMarket.UI;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.Rendering;

namespace MiniMarket.Core
{
    public sealed class MiniMarketRuntime : MonoBehaviour
    {
        public GameSignals Signals { get; private set; }
        public GameSpecRepository Spec { get; private set; }
        public GameStateDocument State { get; private set; }
        public InventorySystem Inventory { get; private set; }
        public PlayerCarrySystem Carry { get; private set; }
        public ProductAvailabilityPolicy ProductPolicy { get; private set; }
        public GameLedger Ledger { get; private set; }
        public EconomySystem Economy { get; private set; }
        public FarmSystem Farm { get; private set; }
        public ProductionSystem Production { get; private set; }
        public ProgressionSystem Progression { get; private set; }
        public UpgradeSystem Upgrades { get; private set; }
        public OrderSystem Orders { get; private set; }
        public HiringSystem Hiring { get; private set; }
        public DaySystem Days { get; private set; }
        public LicenseSystem Licenses { get; private set; }
        public FranchiseSystem Franchises { get; private set; }
        public CompanySetupSystem CompanySetup { get; private set; }
        public SaveCoordinator Saves { get; private set; }
        public InteractionDirector Interactions { get; private set; }
        public PlayerController Player { get; private set; }
        public CharacterActor PlayerActor { get; private set; }
        public CustomerManager Customers { get; private set; }
        public EmployeeManager Employees { get; private set; }
        public StoreWorld World { get; private set; }
        public string LoadStatus { get; private set; }="Preparando Unity…";
        public bool Ready { get; private set; }
        RuntimeGltfLoader gltf;ProductVisualSystem productVisuals;FarmVisualSystem farmVisuals;GameplayInteractionSystem gameplayInteractions;RuntimeHud hud;
        IsometricCamera cameraRig;readonly WorkstationController workstation=new();
        WorldAvailabilityPresenter availabilityPresenter;
        PerformanceGovernor performance;
        AvatarAppearanceSystem avatarAppearance;CharacterFactory characterFactory;string playerCharacterId;
        PlayerCarryVisual playerCarryVisual;
        float simulationClock;float worldClock;float simulationDeltaMs;Vector3 lastPlayerPosition;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void EnsureRuntime()
        {
            if(FindFirstObjectByType<MiniMarketRuntime>())return;
            new GameObject("MiniMarketRuntime").AddComponent<MiniMarketRuntime>();
        }

        async void Start()
        {
            DontDestroyOnLoad(gameObject);
            try{await BootAsync();}
            catch(Exception exception){LoadStatus=$"Error de inicio: {exception.Message}";Debug.LogException(exception);if(hud)hud.ShowFatal(LoadStatus);}
        }

        async Task BootAsync()
        {
            Application.backgroundLoadingPriority=ThreadPriority.Low;
            BuildEventSystem();BuildPresentation();
            var audio=gameObject.AddComponent<AudioManager>();audio.Build();
            performance=gameObject.AddComponent<PerformanceGovernor>();
            hud=gameObject.AddComponent<RuntimeHud>();hud.ShowLoading(LoadStatus);

            LoadStatus="Leyendo reglas originales…";hud.ShowLoading(LoadStatus);
            Signals=new GameSignals();Spec=new GameSpecRepository();await Spec.LoadAsync();
            var catalog=new RuntimeAssetCatalog();await catalog.LoadAsync();gltf=new RuntimeGltfLoader(catalog);avatarAppearance=new AvatarAppearanceSystem(catalog,gltf);await avatarAppearance.LoadAsync();
            var api=new MarketApiClient();Saves=new SaveCoordinator(api,Signals);State=await Saves.LoadAsync(Spec);
            Inventory=new InventorySystem(State);Carry=new PlayerCarrySystem(State,Inventory,Signals);ProductPolicy=new ProductAvailabilityPolicy(Spec);ProductPolicy.ReconcileProgressionState(State);
            Ledger=new GameLedger(State,Saves);Progression=new ProgressionSystem(State,Spec,Signals,Ledger);Progression.ReconcileAllUnlocks();Economy=new EconomySystem(State,Spec,Inventory,Signals,Progression,Ledger);
            Farm=new FarmSystem(State,Spec,Inventory,Carry,ProductPolicy,Signals,Progression);Production=new ProductionSystem(State,Spec,Inventory,Carry,ProductPolicy,Signals,Progression);
            Upgrades=new UpgradeSystem(State,Spec,Signals,Ledger,Progression);Orders=new OrderSystem(State,Spec,Inventory,ProductPolicy,Progression,Signals,Ledger);Hiring=new HiringSystem(State,Spec,Signals,Ledger,Progression);Days=new DaySystem(State,Spec,Signals,Ledger);Licenses=new LicenseSystem(State,Spec,Ledger,Signals);Franchises=new FranchiseSystem(State,Progression,Ledger,Signals);CompanySetup=new CompanySetupSystem(State,Spec,Ledger,Signals);

            // Localhost is the live art/gameplay review environment. It must
            // enter the store immediately even when an old recovery snapshot
            // predates company setup. Production keeps the real setup flow.
            if(LocalQaAllowed()&&CompanySetup.Required)
            {
                if(!CompanySetup.Configure("ES"))
                {
                    State.Root["countryCode"]="ES";State.Root["currency"]="EUR";State.Root["tutorialStep"]=1;State.Changed();
                }
            }

            LoadStatus="Construyendo supermercado…";hud.ShowLoading(LoadStatus);
            Interactions=gameObject.AddComponent<InteractionDirector>();
            var worldRoot=new GameObject("World").transform;World=await new StoreWorldBuilder(gltf,Spec,Interactions,worldRoot).BuildAsync();
            availabilityPresenter=new WorldAvailabilityPresenter(World,State,ProductPolicy,Signals);

            LoadStatus="Cargando personaje y animaciones…";hud.ShowLoading(LoadStatus);
            characterFactory=new CharacterFactory(gltf);var body=BodyAsset(State.Root["avatar"]?.Value<string>("body"));playerCharacterId=body;
            PlayerActor=await characterFactory.CreateAsync(body,transform,new Vector3(0,0,12.5f),true);
            PlayerActor.gameObject.tag="Player";
            Player=PlayerActor.gameObject.AddComponent<PlayerController>();Player.Bind(State);Player.InputEnabled=!CompanySetup.Required;Interactions.Bind(Player);lastPlayerPosition=Player.transform.position;
            var bridge=PlayerActor.gameObject.AddComponent<PlayerAnimationBridge>();bridge.Bind(Player,PlayerActor,Carry);
            cameraRig=Camera.main.GetComponent<IsometricCamera>();cameraRig.target=Player.transform;
            playerCarryVisual=gameObject.AddComponent<PlayerCarryVisual>();await playerCarryVisual.BindAsync(gltf,PlayerActor,Carry);

            productVisuals=new ProductVisualSystem(gltf,World,State,ProductPolicy,Signals);
            farmVisuals=new FarmVisualSystem(gltf,World,State);farmVisuals.Tick(State.SimulationTimeMs);
            gameplayInteractions=new GameplayInteractionSystem(Interactions,World,State,Spec,Inventory,Carry,ProductPolicy,Farm,Production,Progression,Signals,PlayerActor);
            Customers=new GameObject("Customers").AddComponent<CustomerManager>();Customers.transform.SetParent(transform);Customers.Bind(characterFactory,gltf,World,State,Spec,Inventory,Economy,ProductPolicy,Signals,performance,Progression);
            gameplayInteractions.CheckoutRequested+=lane=>Customers.ServeLane(lane);
            Employees=new GameObject("Employees").AddComponent<EmployeeManager>();Employees.transform.SetParent(transform);Employees.Bind(characterFactory,gltf,World,State,Spec,Inventory,Farm,Production,ProductPolicy,Signals,performance,Progression);
            hud.Bind(this,audio);gameplayInteractions.OpenPanelRequested+=hud.OpenPanel;
            Ready=true;LoadStatus="Listo";hud.HideLoading();
            Debug.Log($"MINIMARKET_READY characters=9 animations={PlayerActor.AnimationCount} morphs={PlayerActor.BlendShapeCount} shelves={World.Shelves.Count}");
        }

        void Update()
        {
            if(!Ready)return;
            Saves.Tick(Time.unscaledTime);
            worldClock+=Time.deltaTime;simulationClock+=Time.deltaTime;simulationDeltaMs+=Time.deltaTime*1000;
            if(worldClock>=.25f){worldClock=0;State.SimulationTimeMs+=(long)simulationDeltaMs;simulationDeltaMs=0;Farm.Tick(State.SimulationTimeMs);Production.Tick(State.SimulationTimeMs);farmVisuals?.Tick(State.SimulationTimeMs);}
            if(simulationClock>=5f){simulationClock-=5f;Days.AdvanceMinutes(1);Orders.Tick();}
            workstation.Sync(WorkstationController.ZoneOf(Interactions.Nearest?Interactions.Nearest.interactionId:null),Player.InputMagnitude);
            workstation.UpdateInput(Player.InputMagnitude);
            if(cameraRig)cameraRig.checkoutFocused=workstation.PerformingZoneId()=="checkout";
            RecoverIfFallen();
            var moved=Vector3.Distance(lastPlayerPosition,Player.transform.position);if(moved>.01f){lastPlayerPosition=Player.transform.position;RecordPlayerDistance(moved);}
        }

        /// Safety net: no hole should exist now that the outer ground is solid, but
        /// falling out of the world is unrecoverable for the player, so put them
        /// back at the door and say so rather than leaving them invisible.
        void RecoverIfFallen()
        {
            if(!Player||Player.transform.position.y>-5f||Time.unscaledTime<nextFallRecovery)return;
            nextFallRecovery=Time.unscaledTime+1f;
            var entrance=World?.EntranceInside;
            Debug.LogWarning($"MINIMARKET_FALL recovered from y={Player.transform.position.y:0.0} at x={Player.transform.position.x:0.0} z={Player.transform.position.z:0.0}");
            // A CharacterController owns its position while enabled, so a plain
            // transform write is discarded and the guard would refire every frame.
            var body=Player.GetComponent<CharacterController>();
            if(body)body.enabled=false;
            Player.transform.position=entrance?entrance.position:new Vector3(0,0,12.5f);
            if(body)body.enabled=true;
        }

        float pendingDistance;float nextFallRecovery;
        void RecordPlayerDistance(float distance){pendingDistance+=distance;if(pendingDistance<1)return;var meters=Mathf.FloorToInt(pendingDistance);pendingDistance-=meters;Progression.Record("distance:player",meters);}

        public void ToggleStore(){Days.ToggleOpen();Debug.Log($"MINIMARKET_STORE open={Days.IsOpen}");}
        public void CloseDay(){Days.CloseDay();_ = Saves.SyncRemoteAsync();}
        public void Interact()=>Interactions.ActivateNearest();
        public void ReturnCarriedItems()=>gameplayInteractions?.ReturnCarry();
        public bool BuyFranchise(string id)=>Franchises.Buy(id);
        public bool TravelFranchise(string id)
        {
            if(!Franchises.Travel(id))return false;
            ProductPolicy.ReconcileProgressionState(State);Customers?.ResetForFranchise();Employees?.ResetForFranchise();Player.transform.position=World.EntranceInside.position;return true;
        }
        public Task<bool> SyncNow()=>Saves.SyncRemoteAsync();
        public bool CompleteCompanySetup(string countryCode)
        {
            if(!CompanySetup.Configure(countryCode))return false;Player.InputEnabled=true;Saves.SaveLocal(true);return true;
        }
        public void PrepareLocalQaScenario()
        {
            if(!LocalQaAllowed())return;
            EnsureLocalQaSetup();
            State.SetQuantity("shelves","tomatoes",Math.Max(8,State.Quantity("shelves","tomatoes")));
            Debug.Log("MINIMARKET_QA seeded=tomatoes shelf="+State.Quantity("shelves","tomatoes"));
        }
        public void PrepareLocalWorkerQaScenario()
        {
            if(!LocalQaAllowed())return;
            EnsureLocalQaSetup();
            State.Level=6;ProductPolicy.ReconcileProgressionState(State);
            foreach(var token in State.Array("crops"))
            {
                if(token is not JObject crop||!ProductPolicy.IsCropUnlocked(crop.Value<string>("id"),State.Level))continue;
                crop["status"]="READY";crop["available"]=6;crop["readyAt"]=State.SimulationTimeMs;
            }
            State.SetQuantity("shelves","tomatoes",ProductPolicy.ShelfCapacity(State,"tomatoes"));
            State.SetQuantity("shelves","apples",ProductPolicy.ShelfCapacity(State,"apples"));
            foreach(var id in new[]{"wheat","flour","bread"}){State.SetQuantity("warehouse",id,0);State.SetQuantity("shelves",id,0);}
            EnsureQaEmployee("farmer",0);EnsureQaEmployee("operator",1);EnsureQaEmployee("stocker",2);State.Changed();
            Debug.Log("MINIMARKET_WORKER_QA level=6 target=wheat-to-flour-to-bread");
        }
        public void LogRuntimeState()
        {
            var snapshot=new JObject
            {
                ["ready"]=Ready,["open"]=Days?.IsOpen??false,["day"]=State?.Day??0,
                ["minuteOfDay"]=State?.MinuteOfDay??0,["balanceMinor"]=State?.BalanceMinor??0,
                ["customers"]=Customers?.ActiveCount??0,["saveStatus"]=Saves?.Status??"unavailable",
                ["animations"]=PlayerActor?.AnimationCount??0,["morphs"]=PlayerActor?.BlendShapeCount??0,
                ["carryTotal"]=Carry?.Total??0,["carryCapacity"]=Carry?.Capacity??0,
                // Y is the tell for the character sinking through the ground.
                ["playerX"]=Player?Math.Round(Player.transform.position.x,3):0,
                ["playerY"]=Player?Math.Round(Player.transform.position.y,3):0,
                ["playerZ"]=Player?Math.Round(Player.transform.position.z,3):0,
                ["grounded"]=Player&&Player.TryGetComponent<CharacterController>(out var body)&&body.isGrounded,
            };
            Debug.Log("MINIMARKET_STATE "+snapshot.ToString(Newtonsoft.Json.Formatting.None));
        }
        public void LogPerformanceState()=>performance?.LogRuntimeBudget();
        /// Diagnostic: names every renderer whose bounds sit near the player, so
        /// a stray attachment or a mis-scaled prop can be identified instead of
        /// guessed at from a screenshot.
        public void LogNearbyRenderers()
        {
            if(!Player)return;
            var origin=Player.transform.position+Vector3.up;
            var rows=new List<string>();
            foreach(var renderer in FindObjectsByType<Renderer>(FindObjectsInactive.Exclude,FindObjectsSortMode.None))
            {
                if(!renderer.enabled)continue;
                var bounds=renderer.bounds;
                var distance=Vector3.Distance(bounds.ClosestPoint(origin),origin);
                if(distance>2.5f)continue;
                var path=renderer.name;var parent=renderer.transform.parent;var depth=0;
                while(parent&&depth<4){path=parent.name+"/"+path;parent=parent.parent;depth++;}
                rows.Add($"{path}|d={distance:0.00}|size={bounds.size.x:0.00},{bounds.size.y:0.00},{bounds.size.z:0.00}|scale={renderer.transform.lossyScale.x:0.00},{renderer.transform.lossyScale.y:0.00},{renderer.transform.lossyScale.z:0.00}");
            }
            Debug.Log($"MINIMARKET_NEAR count={rows.Count} :: {string.Join(" ;; ",rows)}");
        }
        public async Task SelectAccessory(string category,string assetId,string stateId)
        {
            try{await avatarAppearance.ApplyAsync(playerCharacterId,PlayerActor,category,assetId);var avatar=(JObject)State.Root["avatar"];avatar[category=="Hats"?"hat":"hair"]=stateId;State.Changed();Signals.PublishNotification($"Vestuario aplicado: {stateId}");}
            catch(Exception exception){Signals.PublishNotification($"No se pudo aplicar: {exception.Message}");}
        }
        public async Task ChangePlayerBody(string bodyId)
        {
            var asset=BodyAsset(bodyId);if(asset==playerCharacterId)return;var position=Player.transform.position;var rotation=Player.transform.rotation;Player.InputEnabled=false;
            var previous=PlayerActor.gameObject;var next=await characterFactory.CreateAsync(asset,transform,position,true);next.transform.rotation=rotation;
            next.gameObject.tag="Player";
            var controller=next.gameObject.AddComponent<PlayerController>();controller.Bind(State);controller.InputEnabled=!CompanySetup.Required;var bridge=next.gameObject.AddComponent<PlayerAnimationBridge>();bridge.Bind(controller,next,Carry);
            PlayerActor=next;Player=controller;playerCharacterId=asset;Interactions.Bind(Player);gameplayInteractions.SetPlayerActor(PlayerActor);cameraRig=Camera.main.GetComponent<IsometricCamera>();cameraRig.target=Player.transform;hud.BindPlayer(Player);await playerCarryVisual.BindAsync(gltf,PlayerActor,Carry);
            ((JObject)State.Root["avatar"])["body"]=bodyId;State.Changed();Destroy(previous);Signals.PublishNotification($"Personaje cambiado: {bodyId}");
        }

        static string BodyAsset(string id)=>id switch{"adult-woman"=>"AdultFemale","boy"=>"Boy","girl"=>"Girl",_=>"AdultMale"};
        static bool LocalQaAllowed()
        {
#if UNITY_EDITOR
            return true;
#elif UNITY_WEBGL
            return Uri.TryCreate(Application.absoluteURL,UriKind.Absolute,out var current)&&current.IsLoopback;
#else
            return Debug.isDebugBuild;
#endif
        }
        void EnsureLocalQaSetup(){if(CompanySetup.Required){CompanySetup.Configure("ES");Player.InputEnabled=true;hud?.DismissSetup();}}
        void EnsureQaEmployee(string role,int index)
        {
            foreach(var token in State.Array("employees"))if(token.Value<string>("role")==role)return;
            State.Array("employees").Add(new JObject{{"id",$"qa-{role}"},{"name",$"QA {role}"},{"role",role},{"level",2},{"salaryMinor",0},{"energy",100},{"hat","none"}});
        }
        void BuildEventSystem(){if(FindFirstObjectByType<EventSystem>())return;var go=new GameObject("EventSystem");go.AddComponent<EventSystem>();go.AddComponent<UnityEngine.InputSystem.UI.InputSystemUIInputModule>();}
        void BuildPresentation()
        {
            // Match the neutral studio daylight used by the authoritative
            // Three scene.  The previous warm/high-energy rig clipped the
            // cream floor and made the approved rubber materials look yellow.
            RenderSettings.ambientMode=AmbientMode.Trilight;RenderSettings.ambientSkyColor=new Color(.86f,.89f,.93f);RenderSettings.ambientEquatorColor=new Color(.72f,.75f,.76f);RenderSettings.ambientGroundColor=new Color(.48f,.46f,.43f);RenderSettings.ambientIntensity=.68f;
            var sun=new GameObject("Sun").AddComponent<Light>();sun.type=LightType.Directional;sun.color=new Color(1f,.97f,.91f);sun.intensity=.78f;sun.shadows=LightShadows.Soft;
            // MarketKeyLight sits at (8, 13, 7) aiming at the origin. X is
            // mirrored like the rest of the world, otherwise every shadow
            // falls on the opposite side of its object from the Next scene.
            sun.transform.rotation=Quaternion.Euler(50.754f,131.185f,0f);
            var cameraGo=new GameObject("Main Camera");cameraGo.tag="MainCamera";var camera=cameraGo.AddComponent<Camera>();camera.orthographic=true;camera.orthographicSize=5.4625f;camera.nearClipPlane=.1f;camera.farClipPlane=120;camera.clearFlags=CameraClearFlags.SolidColor;camera.backgroundColor=new Color(.72f,.875f,.81f);cameraGo.AddComponent<AudioListener>();cameraGo.AddComponent<IsometricCamera>();
        }

        void OnDestroy()
        {
            if(gameplayInteractions!=null&&hud)gameplayInteractions.OpenPanelRequested-=hud.OpenPanel;
            gameplayInteractions?.Dispose();productVisuals?.Dispose();availabilityPresenter?.Dispose();Saves?.Dispose();gltf?.Dispose();
        }
    }
}
