"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { COUNTRIES, HATS, PRODUCTS, ROLE_INFO, SUPPLIERS } from "@/game/catalog";
import { countryMoneyScale, formatMoney } from "@/game/engine";
import { useMarketStore } from "@/game/store";
import type { AvatarConfig, CountryCode, EmployeeRole, FranchiseState, GameState, ProductId } from "@/game/types";
import { MarketScene, type InteractionId, type InteractionPrompt } from "./MarketScene";
import { GameRuntime } from "./GameRuntime";
import { AvatarCustomizer } from "./AvatarCustomizer";
import { GameInputSurface } from "./GameInputSurface";
import { feedbackBus, type FeedbackCue } from "@/game/feedback/FeedbackBus";
import type { RendererMetrics } from "@/game/debug/PerformanceMonitor";

type Panel = "stock" | "suppliers" | "team" | "map" | "finance" | "build" | "avatar" | "help" | null;

export function GameShell({ playerName }: { playerName: string }) {
  const game = useMarketStore((state) => state.game);
  const status = useMarketStore((state) => state.saveStatus);
  const saveRevision = useMarketStore((state) => state.saveRevision);
  const message = useMarketStore((state) => state.message);
  const dispatch = useMarketStore((state) => state.dispatch);
  const recordPlayerDistance = useMarketStore((state) => state.recordPlayerDistance);
  const queueInteraction = useMarketStore((state) => state.queueInteraction);
  const saveGame = useMarketStore((state) => state.saveGame);
  const [panel, setPanel] = useState<Panel>(null);
  const [prompt, setPrompt] = useState<InteractionPrompt | null>(null);
  const [lastInteraction, setLastInteraction] = useState<{ id: InteractionId; sequence: number } | null>(null);
  const [debug] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug"));
  const [metrics, setMetrics] = useState<RendererMetrics | null>(null);
  const [worldReady, setWorldReady] = useState(false);
  const tutorialStep = game?.tutorialStep ?? 0;
  const interactionSequence = useRef(0);
  const activeInteractionId = useRef<InteractionId | null>(null);
  const interactionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (interactionTimer.current) clearTimeout(interactionTimer.current); }, []);
  useEffect(() => {
    if (tutorialStep === 0) return;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => setWorldReady(true));
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [tutorialStep]);
  useEffect(() => {
    if (!debug) return;
    const receiveMetrics = (event: Event) => setMetrics((event as CustomEvent<RendererMetrics>).detail);
    window.addEventListener("market-debug-metrics", receiveMetrics);
    return () => window.removeEventListener("market-debug-metrics", receiveMetrics);
  }, [debug]);
  useEffect(() => {
    if (!debug || !game) return;
    const qaWindow = window as typeof window & { __MARKET_QA__?: Record<string, unknown> };
    qaWindow.__MARKET_QA__ ??= {};
    qaWindow.__MARKET_QA__.state = game;
    qaWindow.__MARKET_QA__.saveRevision = saveRevision;
    qaWindow.__MARKET_QA__.saveStatus = status;
    qaWindow.__MARKET_QA__.metrics = metrics;
  }, [debug, game, metrics, saveRevision, status]);
  const interact = useCallback((id: InteractionId) => {
    let performed = true;
    if (id === "farm") {
      const current = useMarketStore.getState().game;
      const currentFranchise = current?.franchises.find((item) => item.id === current.currentFranchiseId);
      const crop = currentFranchise?.crops.find((candidate) => candidate.status !== "LOCKED" && (!currentFranchise.carry.item || candidate.productId === currentFranchise.carry.item.productId))
        ?? currentFranchise?.crops.find((candidate) => candidate.status !== "LOCKED");
      if (crop && (crop.status === "EMPTY" || crop.status === "READY")) queueInteraction({ type: "TEND_CROP", productId: crop.productId });
      else performed = false;
    }
    if (id === "mill") queueInteraction({ type: "LOAD_FLOUR_MILL" });
    if (id === "bakery") queueInteraction({ type: "BAKE_BREAD" });
    if (id === "chicken") queueInteraction({ type: "OPERATE_MACHINE", machineId: "chicken-coop-1" });
    if (id === "cow") queueInteraction({ type: "OPERATE_MACHINE", machineId: "cow-station-1" });
    if (id === "cheese") queueInteraction({ type: "OPERATE_MACHINE", machineId: "cheese-maker-1" });
    if (id === "juice") queueInteraction({ type: "OPERATE_MACHINE", machineId: "juice-machine-1" });
    if (id === "shelf") {
      const current = useMarketStore.getState().game;
      const currentFranchise = current?.franchises.find((item) => item.id === current.currentFranchiseId);
      const carriedProduct = currentFranchise?.carry.item?.productId;
      if (carriedProduct) queueInteraction({ type: "STOCK", productId: carriedProduct, quantity: 1, source: "carry" });
      else performed = false;
    }
    if (id === "checkout") {
      const current = useMarketStore.getState().game;
      const currentFranchise = current?.franchises.find((item) => item.id === current.currentFranchiseId);
      if (currentFranchise?.open) queueInteraction({ type: "CHECKOUT", paymentMethod: currentFranchise.customersToday % 2 ? "card" : "cash" });
      else performed = false;
    }
    if (id === "office") queueInteraction({ type: "CONTRIBUTE_BUILD" });
    if (id === "upgrade-station") queueInteraction({ type: "CONTRIBUTE_UPGRADE", upgrade: "station" });
    if (id === "upgrade-speed") queueInteraction({ type: "CONTRIBUTE_UPGRADE", upgrade: "player-speed" });
    if (id === "upgrade-capacity") queueInteraction({ type: "CONTRIBUTE_UPGRADE", upgrade: "player-capacity" });
    if (id === "upgrade-employee") queueInteraction({ type: "CONTRIBUTE_UPGRADE", upgrade: "employee" });
    if (id === "supplier" || id === "door") performed = false;
    // Keep a work gesture active only when a real station action was queued.
    // Locomotion owns the body again as soon as the player leaves its pad.
    if (performed) {
      if (activeInteractionId.current !== id) {
        activeInteractionId.current = id;
        interactionSequence.current += 1;
        setLastInteraction({ id, sequence: interactionSequence.current });
      }
      if (interactionTimer.current) clearTimeout(interactionTimer.current);
      interactionTimer.current = setTimeout(() => {
        activeInteractionId.current = null;
        setLastInteraction(null);
      }, 1050);
    }
    const cue: Partial<Record<InteractionId, FeedbackCue>> = { farm: "harvest", mill: "machine", bakery: "machine", chicken: "pickup", cow: "pickup", cheese: "machine", juice: "machine", shelf: "stock", checkout: "scanner", office: "upgrade", "upgrade-station": "upgrade", "upgrade-speed": "upgrade", "upgrade-capacity": "upgrade", "upgrade-employee": "upgrade", door: "door" };
    if (cue[id] && performed) feedbackBus.emit(cue[id], { source: "player", actorId: "player" });
  }, [queueInteraction]);
  const recordDistance = useCallback((meters: number) => { recordPlayerDistance(meters); }, [recordPlayerDistance]);
  const setDoorPresence = useCallback((active: boolean) => {
    // Persistence QA reloads with the simulation frozen so the restored
    // snapshot can be inspected before any live-world input mutates it.  The
    // player respawns beside the entrance, so the door sensor must observe the
    // same freeze as the timers and store ticks.
    if (debug && sessionStorage.getItem("mini-market-qa-freeze") === "1") return;
    dispatch({ type: "DOOR_SENSOR", active });
  }, [debug, dispatch]);

  if (!game) return <><GameRuntime/><div className="game-loading"><div className="loading-shop">🏪</div><strong>Preparando tu mercado…</strong><span>Sincronizando caja, empleados e inventario</span></div></>;
  const franchise = game.franchises.find((item) => item.id === game.currentFranchiseId) ?? game.franchises[0];
  const hour = `${String(Math.floor(game.minuteOfDay / 60) % 24).padStart(2, "0")}:${String(game.minuteOfDay % 60).padStart(2, "0")}`;
  const progress = ((game.xp % Math.max(120, game.level * game.level * 120)) / Math.max(120, game.level * 120)) * 100;
  const avatarHat = HATS.find((item) => item.id === game.avatar.hat);
  const buildProject = franchise.buildProjects.find((project) => project.level === game.level + 1);

  return (<>
    <GameRuntime />
    <main className="game-shell">
      {worldReady && <div className="world"><MarketScene avatar={game.avatar} carry={franchise.carry} checkoutLevel={franchise.checkoutLevel} playerSpeedTier={franchise.playerSpeedTier} stationTiers={franchise.stationTiers} customers={franchise.customers} checkoutTransactions={franchise.checkoutTransactions} returnsBin={franchise.returnsBin} returnedCartCount={franchise.returnedCartCount} buildProject={buildProject} objectiveComplete={game.progression.objectiveComplete} crops={franchise.crops} productionMachines={franchise.productionMachines} shelves={franchise.shelves} unlockedAreas={franchise.unlockedAreas} lightsOn={franchise.lightsOn} simulationTimeMs={game.simulationTimeMs} employees={franchise.employees} open={franchise.open} doorState={franchise.doorState} doorProgress={franchise.doorProgress} onPrompt={setPrompt} onInteract={interact} onDistance={recordDistance} onDoorPresence={setDoorPresence} lastInteraction={lastInteraction} debug={debug} /><GameInputSurface /></div>}
      <header className="hud-top glass-panel" data-game-ui-interactive="true">
        <div className="hud-brand"><span>🏪</span><div><strong>{franchise.name}</strong><small>{franchise.city}</small></div></div>
        <div className="hud-stat money"><small>Caja global</small><strong>{formatMoney(game.balanceMinor, game)}</strong></div>
        <div className="hud-stat"><small>Día {game.day}</small><strong>{hour}</strong></div>
        <div className="hud-stat level"><small>Nivel {game.level}</small><div className="xp-track"><i style={{ width: `${Math.min(100, progress)}%` }}/></div></div>
        <button className={`store-status ${franchise.open ? "open" : "closed"}`} onClick={() => dispatch({ type: "TOGGLE_STORE" })}><i/>{franchise.open ? "ABIERTO" : "CERRADO"}</button>
      </header>

      <aside className="mission-card glass-panel" data-game-ui-interactive="true">
        <div className="panel-heading"><span>🎯</span><div><strong>Objetivos del día</strong><small>Reinician al cerrar</small></div></div>
        {game.missions.map((mission) => <button key={mission.id} className={`mission ${mission.completed ? "done" : ""}`} onClick={() => mission.completed && !mission.claimed && dispatch({ type: "CLAIM_MISSION", missionId: mission.id })}>
          <span>{mission.completed ? mission.claimed ? "✓" : "🎁" : "○"}</span><div><strong>{mission.label}</strong><div className="mission-track"><i style={{ width: `${mission.progress / mission.target * 100}%` }}/></div><small>{mission.progress}/{mission.target} · {mission.claimed ? "Cobrada" : mission.completed ? "Toca para cobrar" : formatMoney(mission.rewardMinor, game)}</small></div>
        </button>)}
      </aside>

      {game.level === 1 && game.tutorialStep > 0 && <LevelOneGuide game={game} franchise={franchise} nearFarm={prompt?.id === "farm"} />}

      <aside className="quick-menu glass-panel" data-game-ui-interactive="true">
        <QuickButton icon="📦" label="Inventario" onClick={() => setPanel("stock")} />
        <QuickButton icon="🚚" label="Proveedores" onClick={() => setPanel("suppliers")} />
        <QuickButton icon="👥" label="Equipo" onClick={() => setPanel("team")} />
        <QuickButton icon="🗺️" label="Franquicias" onClick={() => setPanel("map")} />
        <QuickButton icon="📊" label="Finanzas" onClick={() => setPanel("finance")} />
        <QuickButton icon="🔨" label="Construir" onClick={() => setPanel("build")} />
        <QuickButton icon="🦊" label="Avatar" onClick={() => setPanel("avatar")} />
      </aside>

      <footer className="game-bottom" data-game-ui-interactive="true">
        <div className={`save-chip ${status}`}><i/>{status === "saving" ? "Guardando…" : status === "offline" ? "Copia local" : status === "dirty" ? "Cambios pendientes" : "Guardado"}</div>
        {franchise.carry.item && <div className="carry-chip"><span>{PRODUCTS[franchise.carry.item.productId].emoji}</span><strong>{franchise.carry.item.quantity}/{franchise.carry.capacity}</strong></div>}
        <div className="player-chip"><span title={avatarHat ? `Gorro ${avatarHat.name}` : "Sin gorro"}>{avatarHat?.emoji ?? "👤"}</span><div><strong>{playerName}</strong><small>Reputación {game.reputation}</small></div><button onClick={() => void saveGame()}>☁</button></div>
      </footer>

      {prompt && <div className="interaction-prompt" aria-live="polite"><kbd>◎</kbd><span>{prompt.label}</span><small>{prompt.id === "door" ? "Sensor automático de la puerta" : prompt.id === "farm" && prompt.label.includes("creciendo") ? "Permanece en el recuadro o muévete de nuevo para salir" : "Acción dentro del recuadro · muévete de nuevo para salir"}</small></div>}
      {message && <div className="toast">{message}</div>}
      {debug && <aside className="debug-overlay" data-game-ui-interactive="true"><strong>QA 3D EN VIVO</strong><span>FPS {metrics?.fps ?? "—"} · p95 {metrics?.p95FrameMs ?? "—"} ms</span><span>Draw calls {metrics?.drawCalls ?? "—"} · triángulos {metrics?.triangles.toLocaleString() ?? "—"}</span><span>Texturas {metrics?.textures ?? "—"} · programas {metrics?.programs ?? "—"}</span><span>Clientes {franchise.customers.length} · rutas {franchise.customers.filter((customer) => customer.path.length > customer.pathIndex).length}</span><span>NavMesh rev. {franchise.structureRevision} · colisiones/sensores visibles</span></aside>}
      {game.tutorialStep === 0 && <SetupPanel gameCountry={game.countryCode} gameAvatar={game.avatar} onComplete={(avatar, countryCode) => {
        dispatch({ type: "SET_AVATAR", ...avatar });
        dispatch({ type: "SET_COUNTRY", countryCode });
        void saveGame();
      }} />}
      {panel && <ManagementPanel panel={panel} close={() => setPanel(null)} />}
      <button className="help-button" onClick={() => setPanel("help")}>?</button>
    </main>
  </>
  );
}

function QuickButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return <button onClick={onClick}><span>{icon}</span><small>{label}</small></button>;
}

function LevelOneGuide({ game, franchise, nearFarm }: { game: GameState; franchise: FranchiseState; nearFarm: boolean }) {
  const crop = franchise.crops.find((candidate) => candidate.productId === "tomatoes" && candidate.status !== "LOCKED");
  const harvested = game.progression.counters["harvest:tomatoes"] ?? 0;
  const stocked = game.progression.counters["stock:tomatoes"] ?? 0;
  const sales = game.progression.counters.customers ?? 0;
  const growingProgress = crop?.status === "GROWING"
    ? Math.round(Math.min(1, Math.max(0, (game.simulationTimeMs - crop.plantedAt) / Math.max(1, crop.readyAt - crop.plantedAt))) * 100)
    : 0;

  let activeStep = 1;
  let eyebrow = "PASO 1 DE 5";
  let title = "Siembra tomates";
  let description = "Camina hasta el portón HUERTA y párate dentro del recuadro verde para sembrar tomates.";
  let progress = 0;

  if (crop?.status === "EMPTY" && harvested < 3 && !franchise.carry.item) {
    progress = harvested / 3 * 100;
  } else if (crop?.status === "GROWING" && harvested < 3 && !franchise.carry.item) {
    title = `Tomates creciendo · ${growingProgress}%`;
    description = "La parcela mostrará brotes, plantas y frutos. Puedes permanecer en el recuadro o moverte para salir.";
    progress = growingProgress;
  } else if (crop?.status === "READY" && harvested < 3 && !franchise.carry.item) {
    activeStep = 2; eyebrow = "PASO 2 DE 5"; title = "Cosecha los tomates";
    description = `Párate en el recuadro HUERTA para cosechar. Llevas ${harvested}/3 tomates para el objetivo.`;
    progress = harvested / 3 * 100;
  } else if (franchise.carry.item?.productId === "tomatoes") {
    activeStep = 3; eyebrow = "PASO 3 DE 5"; title = "Surte la verdulería";
    description = "Entra y párate en el recuadro SURTIR TOMATES frente al expositor verde FRUTAS Y VERDURAS.";
    progress = stocked / 3 * 100;
  } else if (stocked < 3) {
    activeStep = harvested >= 3 ? 3 : 1; eyebrow = `PASO ${activeStep} DE 5`;
    title = harvested >= 3 ? "Lleva producto al expositor" : "Continúa la cosecha";
    description = harvested >= 3 ? "Vuelve a la huerta, recoge la carga pendiente y llévala al expositor de tomates." : "Siembra y cosecha hasta completar tres tomates.";
    progress = Math.max(harvested, stocked) / 3 * 100;
  } else if (!franchise.open) {
    activeStep = 4; eyebrow = "PASO 4 DE 5"; title = "Abre el supermercado";
    description = "Ya hay tomates reales en el expositor. Pulsa CERRADO en la barra superior para dejar entrar clientes.";
    progress = 100;
  } else if (sales < 1) {
    activeStep = 5; eyebrow = "PASO 5 DE 5";
    const waiting = franchise.customers.some((customer) => ["NAVIGATE_TO_QUEUE", "QUEUE_WAIT", "MOVE_QUEUE", "UNLOAD", "WAIT_CHECKOUT", "PAY"].includes(customer.state));
    title = waiting ? "Ve a la caja y cobra" : "Espera al primer comprador";
    description = waiting ? "Párate dentro del rectángulo del trabajador. El cliente descargará, tú escanearás y después pagará." : "El cliente tomará un carro, buscará tomates y formará fila. No se cobrará solo.";
    progress = waiting ? 75 : 35;
  } else {
    activeStep = 5; eyebrow = "NIVEL 1 COMPLETADO"; title = "Tu primera venta está lista";
    description = "Has cerrado el ciclo campo → estante → cliente → caja. Financia la ampliación cuando quieras avanzar.";
    progress = 100;
  }

  return <aside className={`level-one-guide glass-panel${nearFarm ? " near-farm" : ""}`} data-game-ui-interactive="true" aria-label="Guía del nivel 1">
    <header><span>{activeStep}</span><div><small>{eyebrow}</small><strong>{title}</strong></div></header>
    <p>{description}</p>
    <div className="level-one-progress"><i style={{ width: `${Math.min(100, progress)}%` }} /></div>
    <ol>{[1, 2, 3, 4, 5].map((step) => <li key={step} className={step < activeStep ? "done" : step === activeStep ? "active" : ""} aria-current={step === activeStep ? "step" : undefined}>{step}</li>)}</ol>
  </aside>;
}

function SetupPanel({ gameCountry, gameAvatar, onComplete }: { gameCountry: CountryCode; gameAvatar: AvatarConfig; onComplete: (avatar: AvatarConfig, country: CountryCode) => void }) {
  const [country, setCountry] = useState(gameCountry); const [avatar, setAvatar] = useState(gameAvatar);
  return <div className="modal-backdrop"><section className="setup-panel setup-panel-expanded"><div className="setup-copy"><span className="eyebrow">BIENVENIDO, FUNDADOR</span><h2>Crea tu empresa</h2><p>El país determina la moneda, la fiscalidad y los costes. Después no podrá cambiarse en esta partida.</p><div className="country-grid">{Object.values(COUNTRIES).map((item) => <button key={item.code} className={country === item.code ? "selected" : ""} onClick={() => setCountry(item.code)}><strong>{flag(item.code)} {item.name}</strong><small>{item.currency} · renta {Math.round(item.corporateTaxRate * 1000) / 10}%</small></button>)}</div></div><div className="avatar-setup"><AvatarCustomizer avatar={avatar} compact onChange={(change) => setAvatar((current) => ({ ...current, ...change }))} /><button className="primary-button" onClick={() => onComplete(avatar, country)}>Abrir mi primer Mini Market</button></div></section></div>;
}

function ManagementPanel({ panel, close }: { panel: Exclude<Panel, null>; close: () => void }) {
  const game = useMarketStore((state) => state.game)!; const dispatch = useMarketStore((state) => state.dispatch); const franchise = game.franchises.find((item) => item.id === game.currentFranchiseId)!;
  const title = { stock: "Inventario y estanterías", suppliers: "Central de proveedores", team: "Equipo y delegación", map: "Mapa de franquicias", finance: "Dirección financiera", build: "Obras y mobiliario", avatar: "Vestuario del fundador", help: "Cómo jugar" }[panel];
  return <div className="management-wrap" onMouseDown={(event) => event.target === event.currentTarget && close()}><section className="management-panel"><header><div><span className="eyebrow">MINI MARKET OS</span><h2>{title}</h2></div><button className="close-button" onClick={close}>×</button></header>
    <div className="management-body">
      {panel === "stock" && <div className="product-grid">{(Object.keys(PRODUCTS) as ProductId[]).map((id) => <article className="product-card" key={id}><span>{PRODUCTS[id].emoji}</span><div><strong>{PRODUCTS[id].name}</strong><small>Almacén {franchise.warehouse[id]} · Tienda {franchise.shelves[id]}</small></div><b>Repón acercándote al estante con la carga</b></article>)}</div>}
      {panel === "suppliers" && <div className="supplier-list">{SUPPLIERS.map((supplier) => <article key={supplier.id} className={game.level < supplier.unlockLevel ? "locked" : ""}><div className="supplier-head"><div><strong>{supplier.name}</strong><small>{supplier.leadMinutes} min · descuento {Math.round(supplier.discount * 100)}%</small></div>{game.level < supplier.unlockLevel && <b>Nivel {supplier.unlockLevel}</b>}</div><div className="supplier-products">{(Object.keys(PRODUCTS) as ProductId[]).filter((id) => PRODUCTS[id].supplier === supplier.id).map((id) => <button key={id} disabled={game.level < supplier.unlockLevel} onClick={() => dispatch({ type: "ORDER", supplierId: supplier.id, productId: id, quantity: 10 })}><span>{PRODUCTS[id].emoji}</span><strong>{PRODUCTS[id].name}</strong><small>10 × {formatMoney(PRODUCTS[id].wholesaleMinor * countryMoneyScale(game.countryCode) * (1 - supplier.discount), game)}</small></button>)}</div></article>)}</div>}
      {panel === "team" && <div className="team-grid">{(Object.keys(ROLE_INFO) as EmployeeRole[]).map((role) => { const info = ROLE_INFO[role]; const hired = franchise.employees.filter((employee) => employee.role === role); return <article key={role} className={game.level < info.unlockLevel ? "locked" : ""}><span className="role-icon">{roleIcon(role)}</span><div><strong>{info.name}</strong><p>{info.description}</p><small>{hired.length ? `${hired.map((item) => `${item.name} T${item.level}`).join(", ")} · ` : ""}Nómina {formatMoney(info.salaryMinor * countryMoneyScale(game.countryCode), game)}/día</small></div><b>{game.level < info.unlockLevel ? `Nivel ${info.unlockLevel}` : "Usa el pad EQUIPO"}</b></article>; })}</div>}
      {panel === "map" && <div className="franchise-map"><div className="map-line"/>{game.franchises.map((item, index) => <article key={item.id} className={`${item.owned ? "owned" : ""} ${item.id === game.currentFranchiseId ? "current" : ""}`}><span>{index === game.franchises.length - 1 ? "🏙️" : "🏪"}</span><div><small>NIVEL {item.unlockLevel}</small><strong>{item.name}</strong><p>{item.city}</p><b>{item.owned ? `${item.employees.length} empleados · ★ ${item.rating.toFixed(1)}` : formatMoney(item.purchaseCostMinor, game)}</b></div>{item.owned ? <button disabled={item.id === game.currentFranchiseId} onClick={() => { dispatch({ type: "TRAVEL", franchiseId: item.id }); close(); }}>{item.id === game.currentFranchiseId ? "Estás aquí" : "Viajar"}</button> : <button disabled={game.level < item.unlockLevel} onClick={() => dispatch({ type: "BUY_FRANCHISE", franchiseId: item.id })}>Comprar</button>}</article>)}</div>}
      {panel === "finance" && <FinancePanel />}
      {panel === "build" && <div className="upgrade-grid"><article><span>🏗️</span><div><strong>Ampliación de nivel</strong><p>{buildProgress(franchise, game.level)}. Deposita dinero permaneciendo sobre el pad del mapa.</p></div><b>Automático por proximidad</b></article><article><span>⚙️</span><div><strong>Estaciones T1–T10</strong><p>Capacidad, velocidad, presentación y aspecto se aplican desde valores base, con límites.</p></div><b>Usa el pad ESTACIÓN</b></article><article><span>🏃</span><div><strong>Vendedor y carga</strong><p>Velocidad T{franchise.playerSpeedTier} · carga {franchise.carry.capacity} unidades.</p></div><b>Usa los pads físicos</b></article><article><span>📜</span><div><strong>Licencia comercial</strong><p>{franchise.licenseDaysLeft} días restantes. Obligatoria para abrir.</p></div><button onClick={() => dispatch({ type: "BUY_LICENSE" })}>Renovar 14 días</button></article></div>}
      {panel === "avatar" && <AvatarCustomizer avatar={game.avatar} onChange={(change) => dispatch({ type: "SET_AVATAR", ...change })} />}
      {panel === "help" && <div className="help-grid"><article><kbd>ARRASTRA</kbd><kbd>WASD</kbd><strong>Moverse</strong><p>Arrastra desde cualquier punto libre con ratón, dedo o lápiz. El teclado sigue disponible.</p></article><article><kbd>◎</kbd><strong>Interacción automática</strong><p>Siembra, cosecha, carga máquinas, repón y cobra simplemente acercándote a cada zona.</p></article><article><kbd>🎮</kbd><strong>Mando</strong><p>El stick izquierdo controla el movimiento; las actividades se activan por proximidad.</p></article><article><kbd>↗</kbd><strong>Movimiento libre</strong><p>Salir de una zona pausa la actividad sin bloquear al personaje.</p></article><div className="tutorial-flow"><b>1. Siembra tomates</b><span>→</span><b>2. Cosecha</b><span>→</span><b>3. Surte verduras</b><span>→</span><b>4. Abre</b><span>→</span><b>5. Cobra</b></div></div>}
    </div>
    <footer className="panel-footer"><span>Empresa: {COUNTRIES[game.countryCode].name} · {game.currency}</span><div className="panel-actions"><button className="danger-soft" onClick={() => dispatch({ type: "CLOSE_DAY" })}>Cerrar jornada y contabilizar</button><button className="danger-soft" onClick={async () => { localStorage.removeItem("mini-market-offline-player-v1"); localStorage.removeItem("mini-market-recovery-v1"); navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_PRIVATE_CACHE" }); await authClient.signOut(); window.location.reload(); }}>Cerrar sesión</button></div></footer>
  </section></div>;
}

function FinancePanel() {
  const game = useMarketStore((state) => state.game)!; const country = COUNTRIES[game.countryCode]; const f = game.finances;
  const rows = [{ label: "Ingresos netos de ventas", value: f.grossRevenueMinor, positive: true }, { label: "Coste de mercancía", value: -f.costOfGoodsMinor }, { label: "Nóminas y cargas", value: -f.payrollMinor }, { label: "Alquiler, energía y operación", value: -f.operatingCostsMinor }, { label: "Impuesto sobre beneficio provisionado", value: -f.taxesMinor }];
  return <div className="finance-layout"><div className="finance-summary"><small>RESULTADO ACUMULADO</small><strong className={f.netProfitMinor >= 0 ? "positive" : "negative"}>{formatMoney(f.netProfitMinor, game)}</strong><p>Caja disponible: {formatMoney(game.balanceMinor, game)}</p></div><div className="ledger-table">{rows.map((row) => <div key={row.label}><span>{row.label}</span><b className={row.positive ? "positive" : ""}>{formatMoney(row.value, game)}</b></div>)}</div><div className="tax-card"><span>{flag(country.code)}</span><div><strong>Régimen simulado: {country.name}</strong><p>Renta corporativa {Math.round(country.corporateTaxRate * 1000) / 10}% · impuesto de ventas {Math.round(country.salesTaxRate * 1000) / 10}% · carga laboral aproximada {Math.round(country.payrollBurdenRate * 1000) / 10}%.</p><small>Modelo educativo simplificado. No constituye asesoría fiscal ni reproduce todas las reglas, deducciones o tributos locales.</small></div></div></div>;
}

function flag(code: CountryCode) { return ({ ES: "🇪🇸", US: "🇺🇸", CO: "🇨🇴", MX: "🇲🇽", AR: "🇦🇷", CL: "🇨🇱", PE: "🇵🇪" })[code]; }
function roleIcon(role: EmployeeRole) { return ({ farmer: "🌾", operator: "⚙️", stocker: "📦", cashier: "🧾", builder: "🔨", manager: "📋" })[role]; }
function buildProgress(franchise: { buildProjects: { level: number; costMinor: number; contributedMinor: number }[] }, level: number) {
  const project = franchise.buildProjects.find((candidate) => candidate.level === level + 1);
  return project ? `${Math.floor(project.contributedMinor / Math.max(1, project.costMinor) * 100)} % financiado` : "Sin ampliaciones pendientes";
}
