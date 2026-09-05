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
            cameraRig=Camera.main.GetComponent<IsometricCamera>();cameraRig.target=Player.transform;CharacterLod.Focus=Player.transform;if(PlayerActor.GetComponent<CharacterLod>() is CharacterLod playerLod)playerLod.PinNear=true;
            playerCarryVisual=gameObject.AddComponent<PlayerCarryVisual>();await playerCarryVisual.BindAsync(gltf,PlayerActor,Carry);

            productVisuals=new ProductVisualSystem(gltf,World,State,ProductPolicy,Signals);
            farmVisuals=new FarmVisualSystem(gltf,World,State);farmVisuals.Tick(State.SimulationTimeMs);
            gameplayInteractions=new GameplayInteractionSystem(Interactions,World,State,Spec,Inventory,Carry,ProductPolicy,Farm,Production,Progression,Signals,PlayerActor);
            Customers=new GameObject("Customers").AddComponent<CustomerManager>();Customers.transform.SetParent(transform);Customers.Bind(characterFactory,gltf,World,State,Spec,Inventory,Economy,ProductPolicy,Signals,performance,Progression);
            gameplayInteractions.CheckoutRequested+=lane=>Customers.ServeLane(lane);
            Employees=new GameObject("Employees").AddComponent<EmployeeManager>();Employees.transform.SetParent(transform);Employees.Bind(characterFactory,gltf,World,State,Spec,Inventory,Farm,Production,ProductPolicy,Signals,performance,Progression);
            hud.Bind(this,audio);gameplayInteractions.OpenPanelRequested+=hud.OpenPanel;
            Ready=true;LoadStatus="Listo";hud.HideLoading();
            await Customers.WarmAsync();
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

        /// Reports the world height of every actor on stage. Comparing the GLB
        /// files only proves the assets match; this proves what reaches the
        /// screen, scale chain and all.
        /// Puts a worker on the floor with the store open, so the agent can be
        /// watched doing real errands instead of standing at its home spot.
        public void DebugHireAndOpen()
        {
            State.Level=Math.Max(State.Level,6);
            Progression.ReconcileAllUnlocks();
            foreach(var role in new[]{"stocker","farmer","cashier"})
                Debug.Log($"MINIMARKET_HIRE {role}={Hiring.Hire(role)}");
            if(!Days.IsOpen)Days.ToggleOpen();
            Debug.Log($"MINIMARKET_HIRE abierto={Days.IsOpen}");
        }

        /// Names whatever stands behind the doorway, by looking through it the
        /// way the camera does. Comparing colours guesses; this reads the scene.
        public void ReportThroughDoor()
        {
            var camera=Camera.main;
            if(!camera){Debug.Log("MINIMARKET_THROUGH sin camara");return;}
            // Straight through the middle of the opening, and a little above the
            // mat so the ray clears the floor.
            var target=new Vector3(0,2.4f,15.9f);
            var origin=camera.transform.position;
            var direction=(target-origin).normalized;
            var hits=Physics.RaycastAll(origin,direction,120f,~0,QueryTriggerInteraction.Ignore);
            System.Array.Sort(hits,(a,b)=>a.distance.CompareTo(b.distance));
            foreach(var hit in hits)
                Debug.Log($"MINIMARKET_THROUGH d={hit.distance:0.0} {hit.collider.name} " +
                          $"padre={hit.collider.transform.parent?.name} z={hit.point.z:0.0}");
            // Colliders can be absent on decoration, so the renderers along the
            // same line are reported too.
            foreach(var r in FindObjectsByType<Renderer>(FindObjectsSortMode.None))
            {
                if(!r.enabled)continue;
                var b=r.bounds;
                if(b.size.x<1f&&b.size.y<1f)continue;
                if(!b.IntersectRay(new Ray(origin,direction)))continue;
                if(b.center.z>15.5f||b.center.z<-30f)continue;
                Debug.Log($"MINIMARKET_THROUGH_R {r.name} padre={r.transform.parent?.name} " +
                          $"centro_z={b.center.z:0.0} tam={b.size}");
            }
        }

        /// Counts what actually blocks movement. A placement flag says a
        /// collider was requested; this says whether one exists.
        public void ReportColliders()
        {
            var solid=0;var triggers=0;
            var names=new System.Collections.Generic.SortedDictionary<string,int>();
            foreach(var c in FindObjectsByType<Collider>(FindObjectsSortMode.None))
            {
                if(c.isTrigger){triggers++;continue;}
                solid++;
                var key=c.transform.parent?c.transform.parent.name:c.name;
                names.TryGetValue(key,out var n);names[key]=n+1;
            }
            Debug.Log($"MINIMARKET_COL solidos={solid} disparadores={triggers}");
            foreach(var pair in names)Debug.Log($"MINIMARKET_COL_N {pair.Key} x{pair.Value}");
            var floors=0f;
            var probe=new Vector3(0,3f,15.2f);
            if(Physics.Raycast(probe,Vector3.down,out var hit,8f,~0,QueryTriggerInteraction.Ignore))
            {
                floors=hit.point.y;
                Debug.Log($"MINIMARKET_COL suelo bajo la entrada y={floors:0.000} sobre {hit.collider.name}");
            }
            else Debug.Log("MINIMARKET_COL sin suelo bajo la entrada");
            var mesh=new Vector3(0,3f,15.2f);
            foreach(var r in FindObjectsByType<Renderer>(FindObjectsSortMode.None))
            {
                var b=r.bounds;
                if(b.Contains(new Vector3(mesh.x,b.center.y,mesh.z))&&b.max.y>0f&&b.max.y<1.2f)
                    Debug.Log($"MINIMARKET_COL_SUP {r.name} padre={r.transform.parent?.name} techo_y={b.max.y:0.003}");
            }
        }

        public void ReportActorScale()
        {
            foreach(var actor in FindObjectsByType<MiniMarket.Animations.CharacterActor>(FindObjectsSortMode.None))
            {
                var renderers=actor.GetComponentsInChildren<Renderer>();
                if(renderers.Length==0)continue;
                var bounds=renderers[0].bounds;
                for(var i=1;i<renderers.Length;i++)bounds.Encapsulate(renderers[i].bounds);
                Debug.Log($"MINIMARKET_ACTORSCALE {actor.name} alto={bounds.size.y:0.000} escala={actor.transform.lossyScale.x:0.000}");
            }
        }
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
        /// Diagnostic: the twenty visible renderers that cost the most triangles,
        /// so the budget is cut where it is actually spent.
        public void LogHeavyRenderers()
        {
            var rows=new List<(long tris,string name)>();
            foreach(var renderer in FindObjectsByType<Renderer>(FindObjectsInactive.Exclude,FindObjectsSortMode.None))
            {
                if(!renderer.enabled||!renderer.isVisible)continue;
                long tris=0;
                if(renderer is SkinnedMeshRenderer skinned&&skinned.sharedMesh){for(var i=0;i<skinned.sharedMesh.subMeshCount;i++)tris+=skinned.sharedMesh.GetIndexCount(i)/3;}
                else if(renderer is MeshRenderer mr&&mr.GetComponent<MeshFilter>()?.sharedMesh is Mesh mesh)
                {
                    var first=mr.isPartOfStaticBatch?mr.subMeshStartIndex:0;var count=mr.isPartOfStaticBatch?Math.Min(mesh.subMeshCount-first,mr.sharedMaterials?.Length??0):mesh.subMeshCount;
                    for(var i=first;i<first+count;i++)tris+=mesh.GetIndexCount(i)/3;
                }
                var owner=renderer.transform;while(owner.parent&&owner.parent!=transform&&owner.parent.name!="StoreWorld"&&owner.parent.parent)owner=owner.parent;
                rows.Add((tris,$"{owner.name}/{renderer.name}{(renderer is SkinnedMeshRenderer?"[skin]":"")}"));
            }
            rows.Sort((a,b)=>b.tris.CompareTo(a.tris));
            var top=new List<string>();for(var i=0;i<Math.Min(20,rows.Count);i++)top.Add($"{rows[i].name}={rows[i].tris}");
            Debug.Log("MINIMARKET_HEAVY total="+rows.Count+" "+string.Join(" ",top));
        }
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
            PlayerActor=next;Player=controller;playerCharacterId=asset;Interactions.Bind(Player);gameplayInteractions.SetPlayerActor(PlayerActor);cameraRig=Camera.main.GetComponent<IsometricCamera>();cameraRig.target=Player.transform;CharacterLod.Focus=Player.transform;if(next.GetComponent<CharacterLod>() is CharacterLod swappedLod)swappedLod.PinNear=true;hud.BindPlayer(Player);await playerCarryVisual.BindAsync(gltf,PlayerActor,Carry);
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
