"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { COUNTRIES, HATS, PRODUCTS, ROLE_INFO, SUPPLIERS } from "@/game/catalog";
import { canOperateMachine, canProcessCheckoutUnit, countryMoneyScale, employeeHiringQuote, formatMoney, upgradeQuote } from "@/game/engine";
import { levelObjectiveTasks, type LevelObjectiveTask } from "@/game/progression/objectives";
import { buildFundingQuote, LEVELS } from "@/game/progression/levels";
import { useMarketStore } from "@/game/store";
import type { AvatarConfig, CountryCode, EmployeeRole, FranchiseState, GameState, ProductId } from "@/game/types";
import { MarketScene, type InteractionId, type InteractionPrompt, type InteractionVisualEvent } from "./MarketScene";
import { GameRuntime } from "./GameRuntime";
import { AvatarCustomizer } from "./AvatarCustomizer";
import { GameInputSurface } from "./GameInputSurface";
import { feedbackBus, type FeedbackCue } from "@/game/feedback/FeedbackBus";
import { notificationOccurrenceKey, notificationPresentation } from "@/game/feedback/NotificationPolicy";
import type { RendererMetrics } from "@/game/debug/PerformanceMonitor";
import { canPickupWarehouse, carriedProductIds, carryQuantity, carryTotal, departmentStockingPulses } from "@/game/player/CarrySystem";
import { deriveVisualTransferPresentation, updateVisualTransferRemaining } from "@/game/player/VisualTransferLedger";
import { cropIdFromFarmInteraction, isFarmInteractionId } from "@/game/stations/farm-layout";
import { isStockingInteractionId, retailDepartmentFromStockingInteraction, RETAIL_DEPARTMENTS } from "@/game/stations/retail-layout";
import { marketQaQueryEnabled } from "@/game/debug/QaAccess";

type Panel = "stock" | "suppliers" | "team" | "map" | "finance" | "build" | "avatar" | "help" | null;

export function GameShell({ playerName }: { playerName: string }) {
  const game = useMarketStore((state) => state.game);
  const status = useMarketStore((state) => state.saveStatus);
  const saveRevision = useMarketStore((state) => state.saveRevision);
  const message = useMarketStore((state) => state.message);
  const messageRevision = useMarketStore((state) => state.messageRevision);
  const dispatch = useMarketStore((state) => state.dispatch);
  const recordPlayerDistance = useMarketStore((state) => state.recordPlayerDistance);
  const queueInteraction = useMarketStore((state) => state.queueInteraction);
  const saveGame = useMarketStore((state) => state.saveGame);
  const [panel, setPanel] = useState<Panel>(null);
  const [prompt, setPrompt] = useState<InteractionPrompt | null>(null);
  const [lastInteraction, setLastInteraction] = useState<InteractionVisualEvent | null>(null);
  const [transferEvents, setTransferEvents] = useState<InteractionVisualEvent[]>([]);
  const [debug] = useState(() => typeof window !== "undefined" && marketQaQueryEnabled(window.location.search));
  const [metrics, setMetrics] = useState<RendererMetrics | null>(null);
  const [worldReady, setWorldReady] = useState(false);
  const tutorialStep = game?.tutorialStep ?? 0;
  const interactionSequence = useRef(0);
  const activeInteractionId = useRef<InteractionId | null>(null);
  const interactionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notification = notificationPresentation(message, status);
  const notificationKey = notificationOccurrenceKey(notification, messageRevision);
  const notificationLifecycle = notification?.lifecycle;
  const notificationDurationMs = notification?.durationMs;
  const [expiredNotificationKey, setExpiredNotificationKey] = useState("");
  const showNotification = Boolean(notification)
    && (notificationLifecycle === "persistent" || expiredNotificationKey !== notificationKey);

  useEffect(() => () => {
    if (interactionTimer.current) clearTimeout(interactionTimer.current);
  }, []);
  useEffect(() => {
    if (notificationLifecycle !== "transient" || notificationDurationMs === null || notificationDurationMs === undefined) return;
    const timeoutId = window.setTimeout(() => setExpiredNotificationKey(notificationKey), notificationDurationMs);
    return () => window.clearTimeout(timeoutId);
  }, [notificationDurationMs, notificationKey, notificationLifecycle]);
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
    if (!debug) return;
    const qaWindow = window as typeof window & { __MARKET_QA__?: Record<string, unknown> };
    qaWindow.__MARKET_QA__ ??= {};
    const advanceMinutes = (minutes: number) => {
      if (!Number.isFinite(minutes)) return;
      const boundedMinutes = Math.max(0, Math.min(24 * 60, Math.floor(minutes)));
      if (boundedMinutes > 0) useMarketStore.getState().simulate(boundedMinutes);
    };
    // Keep commands non-enumerable: QA snapshots intentionally clone the
    // published data object and functions are not structured-cloneable.
    Object.defineProperty(qaWindow.__MARKET_QA__, "advanceMinutes", {
      value: advanceMinutes,
      configurable: true,
      enumerable: false,
      writable: true,
    });
    return () => {
      if (qaWindow.__MARKET_QA__?.advanceMinutes === advanceMinutes) delete qaWindow.__MARKET_QA__.advanceMinutes;
    };
  }, [debug]);
  useEffect(() => {
    if (!debug || !game) return;
    const qaWindow = window as typeof window & { __MARKET_QA__?: Record<string, unknown> };
    qaWindow.__MARKET_QA__ ??= {};
    qaWindow.__MARKET_QA__.state = game;
    qaWindow.__MARKET_QA__.saveRevision = saveRevision;
    qaWindow.__MARKET_QA__.saveStatus = status;
    qaWindow.__MARKET_QA__.message = message;
    qaWindow.__MARKET_QA__.messageRevision = messageRevision;
    qaWindow.__MARKET_QA__.metrics = metrics;
  }, [debug, game, message, messageRevision, metrics, saveRevision, status]);
  const interact = useCallback((id: InteractionId) => {
    let performed = true;
    let visualEvents: Omit<InteractionVisualEvent, "sequence">[] = [{ id, kind: "work" }];
    if (isFarmInteractionId(id)) {
      const current = useMarketStore.getState().game;
      const currentFranchise = current?.franchises.find((item) => item.id === current.currentFranchiseId);
      const cropId = cropIdFromFarmInteraction(id);
      const crop = cropId ? currentFranchise?.crops.find((candidate) => candidate.id === cropId) : undefined;
      if (crop?.status === "READY" && currentFranchise && carryTotal(currentFranchise.carry) < currentFranchise.carry.capacity) {
        const quantity = Math.min(crop.available, currentFranchise.carry.capacity - carryTotal(currentFranchise.carry));
        queueInteraction({ type: "HARVEST", cropId: crop.id, productId: crop.productId, quantity });
        visualEvents = [{
          id,
          kind: "harvest",
          cropId: crop.id,
          productId: crop.productId,
          quantity,
          remainingQuantity: quantity,
          carryStart: carryQuantity(currentFranchise.carry, crop.productId),
          cropStart: crop.available,
        }];
      } else if (crop?.status === "EMPTY") {
        queueInteraction({ type: "TEND_CROP", cropId: crop.id, productId: crop.productId });
        visualEvents = [{ id, kind: "work", cropId: crop.id, productId: crop.productId }];
      } else performed = false;
    }
    const machineInteraction = ({
      mill: { machineId: "flour-mill-1", action: { type: "LOAD_FLOUR_MILL" as const } },
      bakery: { machineId: "bread-oven-1", action: { type: "BAKE_BREAD" as const } },
      chicken: { machineId: "chicken-coop-1", action: { type: "OPERATE_MACHINE" as const, machineId: "chicken-coop-1" } },
      cow: { machineId: "cow-station-1", action: { type: "OPERATE_MACHINE" as const, machineId: "cow-station-1" } },
      cheese: { machineId: "cheese-maker-1", action: { type: "OPERATE_MACHINE" as const, machineId: "cheese-maker-1" } },
      juice: { machineId: "juice-machine-1", action: { type: "OPERATE_MACHINE" as const, machineId: "juice-machine-1" } },
    } as const)[id as "mill" | "bakery" | "chicken" | "cow" | "cheese" | "juice"];
    if (machineInteraction) {
      const current = useMarketStore.getState().game;
      const currentFranchise = current?.franchises.find((item) => item.id === current.currentFranchiseId);
      if (current && currentFranchise && canOperateMachine(currentFranchise, machineInteraction.machineId, current.simulationTimeMs)) {
        queueInteraction(machineInteraction.action);
      } else performed = false;
    }
    if (isStockingInteractionId(id)) {
      const current = useMarketStore.getState().game;
      const currentFranchise = current?.franchises.find((item) => item.id === current.currentFranchiseId);
      const departmentId = retailDepartmentFromStockingInteraction(id);
      const pulses = currentFranchise && departmentId ? departmentStockingPulses(
        currentFranchise.carry,
        currentFranchise.shelves,
        currentFranchise.stationTiers["shelves-1"] ?? currentFranchise.shelvesLevel,
        RETAIL_DEPARTMENTS[departmentId].products,
      ) : [];
      if (pulses.length && currentFranchise) {
        pulses.forEach((pulse) => queueInteraction({ type: "STOCK", ...pulse, source: "carry" }));
        visualEvents = pulses.map((pulse) => ({
            id,
            kind: "stock",
            ...pulse,
            remainingQuantity: pulse.quantity,
            carryStart: carryQuantity(currentFranchise.carry, pulse.productId),
            shelfStart: currentFranchise.shelves[pulse.productId] ?? 0,
          }));
      }
      else performed = false;
    }
    if (id === "checkout") {
      const current = useMarketStore.getState().game;
      const currentFranchise = current?.franchises.find((item) => item.id === current.currentFranchiseId);
      if (current && currentFranchise?.open && canProcessCheckoutUnit(current, currentFranchise)) queueInteraction({ type: "CHECKOUT", paymentMethod: currentFranchise.customersToday % 2 ? "card" : "cash" });
      else performed = false;
    }
    if (id === "supplier") {
      // Re-read the live authoritative snapshot at the sensor tick. The prop
      // only controls presentation; this guard prevents stale renders from
      // queueing repeated failures while the dock is empty or the basket full.
      const current = useMarketStore.getState().game;
      const currentFranchise = current?.franchises.find((item) => item.id === current.currentFranchiseId);
      if (currentFranchise && canPickupWarehouse(currentFranchise.warehouse, currentFranchise.carry)) {
        queueInteraction({ type: "PICKUP_WAREHOUSE" });
      } else performed = false;
    }
    if (id === "door") performed = false;
    // Keep a work gesture active only when a real station action was queued.
    // Locomotion owns the body again as soon as the player leaves its pad.
    if (performed) {
      const transferVisuals = visualEvents.filter((event) => event.kind === "harvest" || event.kind === "stock");
      if (transferVisuals.length || activeInteractionId.current !== id) {
        activeInteractionId.current = id;
        const sequencedEvents = visualEvents.map((event): InteractionVisualEvent => ({
          ...event,
          sequence: ++interactionSequence.current,
        }));
        setLastInteraction(sequencedEvents[sequencedEvents.length - 1] ?? null);
        const sequencedTransfers = sequencedEvents.filter((event) => event.kind === "harvest" || event.kind === "stock");
        if (sequencedTransfers.length) {
          // Proximity pulses are intentionally faster than one flight. Keep
          // every transfer alive independently so no tomato, egg or bottle is
          // removed halfway between the basket and its destination.
          setTransferEvents((current) => [...current, ...sequencedTransfers].slice(-16));
        }
      }
      if (interactionTimer.current) clearTimeout(interactionTimer.current);
      interactionTimer.current = setTimeout(() => {
        activeInteractionId.current = null;
        setLastInteraction(null);
      }, 1050);
    }
    const cue: Partial<Record<InteractionId, FeedbackCue>> = { mill: "machine", bakery: "machine", chicken: "pickup", cow: "pickup", cheese: "machine", juice: "machine", checkout: "scanner", supplier: "pickup", door: "door" };
    if (performed && visualEvents.some((event) => event.kind === "harvest")) feedbackBus.emit("harvest", { source: "player", actorId: "player" });
    else if (performed && visualEvents.some((event) => event.kind === "stock")) feedbackBus.emit("stock", { source: "player", actorId: "player" });
    else if (cue[id] && performed) feedbackBus.emit(cue[id], { source: "player", actorId: "player" });
  }, [queueInteraction]);
  const updateTransferProgress = useCallback((sequence: number, remainingQuantity: number) => {
    setTransferEvents((current) => updateVisualTransferRemaining(current, sequence, remainingQuantity));
  }, []);
  const recordDistance = useCallback((meters: number) => { recordPlayerDistance(meters); }, [recordPlayerDistance]);
  const setDoorPresence = useCallback((active: boolean) => {
    // Persistence QA reloads with the simulation frozen so the restored
    // snapshot can be inspected before any live-world input mutates it.  The
    // player respawns beside the entrance, so the door sensor must observe the
    // same freeze as the timers and store ticks.
    if (debug && sessionStorage.getItem("mini-market-qa-freeze") === "1") return;
    dispatch({ type: "DOOR_SENSOR", active });
  }, [debug, dispatch]);

  const notificationToast = showNotification && notification
    ? <div
      key={notificationKey}
      className={`toast ${notification.tone} ${notification.lifecycle}`}
      data-notification-lifecycle={notification.lifecycle}
      role={notification.tone === "danger" ? "alert" : "status"}
      aria-live={notification.tone === "danger" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <GameIcon name={notification.tone === "danger" ? "warning" : notification.tone === "warning" ? "cloud" : "check"} />
      <span>{notification.message}</span>
    </div>
    : null;

  if (!game) return <><GameRuntime/><div className="game-loading"><div className="loading-shop">🏪</div><strong>Preparando tu mercado…</strong><span>Sincronizando caja, empleados e inventario</span></div>{notificationToast}</>;
  const franchise = game.franchises.find((item) => item.id === game.currentFranchiseId) ?? game.franchises[0];
  const warehousePickupEnabled = canPickupWarehouse(franchise.warehouse, franchise.carry);
  const visualTransfer = deriveVisualTransferPresentation(franchise.carry, franchise.crops, franchise.shelves, transferEvents);
  const hour = `${String(Math.floor(game.minuteOfDay / 60) % 24).padStart(2, "0")}:${String(game.minuteOfDay % 60).padStart(2, "0")}`;
  const avatarHat = HATS.find((item) => item.id === game.avatar.hat);
  const carriedProducts = carriedProductIds(visualTransfer.carry);
  const carriedQuantity = carryTotal(visualTransfer.carry);
  const completedMissions = game.missions.filter((mission) => mission.completed).length;
  const claimableMissions = game.missions.filter((mission) => mission.completed && !mission.claimed).length;
  const objectiveTasks = levelObjectiveTasks(game.level, game);
  const nextProject = game.level < 30 ? franchise.buildProjects.find((candidate) => candidate.level === game.level + 1) : undefined;
  const nextFunding = nextProject ? buildFundingQuote(game.balanceMinor, nextProject) : undefined;
  const objectiveStepsCompleted = objectiveTasks.filter((task) => task.progress >= task.target).length;
  const levelRequirementCount = objectiveTasks.length + (nextProject ? 1 : 0);
  const levelRequirementsCompleted = objectiveStepsCompleted + (nextProject?.completed ? 1 : 0);
  const progressParts = [
    ...objectiveTasks.map((task) => Math.min(1, task.progress / Math.max(task.target, Number.EPSILON))),
    ...(nextProject ? [Math.min(1, nextProject.contributedMinor / Math.max(1, nextProject.costMinor))] : []),
  ];
  const levelProgress = progressParts.length ? progressParts.reduce((total, value) => total + value, 0) / progressParts.length * 100 : 100;
  const nextUnlock = game.level < 30 ? LEVELS[game.level]?.unlock : undefined;
  const saveLabel = status === "saving" ? "Guardando…"
    : status === "offline" ? "Copia local"
      : status === "dirty" ? "Cambios pendientes"
        : status === "conflict" ? "Conflicto de guardado"
          : status === "error" ? "Error al guardar"
            : "Guardado";
  const showSaveStatus = status === "offline" || status === "conflict" || status === "error";

  return (<>
    <GameRuntime />
    <main className="game-shell">
      {worldReady && <div className="world"><MarketScene avatar={game.avatar} carry={franchise.carry} visualCarry={visualTransfer.carry} warehousePickupEnabled={warehousePickupEnabled} checkoutLevel={franchise.checkoutLevel} playerSpeedTier={franchise.playerSpeedTier} customers={franchise.customers} checkoutTransactions={franchise.checkoutTransactions} returnsBin={franchise.returnsBin} returnedCartCount={franchise.returnedCartCount} crops={franchise.crops} visualCrops={visualTransfer.crops} productionMachines={franchise.productionMachines} shelves={franchise.shelves} visualShelves={visualTransfer.shelves} shelfTier={franchise.stationTiers["shelves-1"] ?? franchise.shelvesLevel} unlockedAreas={franchise.unlockedAreas} lightsOn={franchise.lightsOn} simulationTimeMs={game.simulationTimeMs} employees={franchise.employees} open={franchise.open} doorState={franchise.doorState} doorProgress={franchise.doorProgress} onPrompt={setPrompt} onInteract={interact} onDistance={recordDistance} onDoorPresence={setDoorPresence} lastInteraction={lastInteraction} transferEvents={transferEvents} onTransferProgress={updateTransferProgress} debug={debug} /><GameInputSurface /></div>}
      <header className="hud-top glass-panel" data-game-ui-interactive="true" aria-label="Estado de la tienda">
        <div className="hud-brand"><span><GameIcon name="store" /></span><div><strong>{franchise.name}</strong><small>{franchise.city}</small></div></div>
        <div className="hud-stat money"><small>Caja global</small><strong>{formatMoney(game.balanceMinor, game)}</strong></div>
        <div className="hud-stat earnings"><small>Ventas hoy</small><strong>{formatMoney(franchise.revenueTodayMinor, game)}</strong><small>Día {game.day} · {hour}</small></div>
        <div className="hud-stat level"><small>Nivel {game.level}</small><div className="xp-track" role="progressbar" aria-label={`Progreso real para superar el nivel ${game.level}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(100, levelProgress))}><i style={{ width: `${Math.min(100, levelProgress)}%` }}/></div></div>
        <button className={`store-status ${franchise.open ? "open" : "closed"}`} aria-pressed={franchise.open} aria-label={franchise.open ? "Cerrar el supermercado" : "Abrir el supermercado"} onClick={() => dispatch({ type: "TOGGLE_STORE" })}><i/>{franchise.open ? "ABIERTO" : "CERRADO"}</button>
      </header>

      <details className={`mission-card glass-panel${claimableMissions ? " has-reward" : ""}`} data-game-ui-interactive="true">
        <summary className="panel-heading">
          <span><GameIcon name={claimableMissions ? "gift" : "target"} /></span>
          <div><strong>{game.level >= 30 ? "Nivel máximo alcanzado" : `Progreso al nivel ${game.level + 1}`}</strong><small>{levelRequirementsCompleted}/{levelRequirementCount} requisitos · <span>Objetivos del día</span> {completedMissions}/{game.missions.length}</small></div>
          <b className="mission-chevron"><GameIcon name="chevron" /></b>
        </summary>
        <div className="mission-list">
          <div className="mission-section-title"><div><strong>{game.level >= 30 ? "PROGRESIÓN COMPLETADA" : `PARA SUBIR AL NIVEL ${game.level + 1}`}</strong>{nextUnlock && <small>Desbloqueas: {nextUnlock}</small>}</div></div>
          {objectiveTasks.map((task) => <LevelRequirement key={task.id} task={task} />)}
          {nextProject && nextFunding && <LevelRequirement
            task={{ id: nextProject.id, label: `Financia la ampliación al nivel ${nextProject.level}`, progress: nextFunding.contributedMinor, target: nextFunding.costMinor, unit: "money" }}
            game={game}
            action={nextFunding.completed ? undefined : {
              disabled: nextFunding.contributionMinor <= 0,
              label: nextFunding.contributionMinor <= 0
                ? "Necesitas dinero en caja"
                : `${nextFunding.contributionMinor < nextFunding.remainingMinor ? "Aportar" : "Financiar"} ${formatMoney(nextFunding.contributionMinor, game)}`,
              onClick: () => dispatch({ type: "CONTRIBUTE_BUILD", amountMinor: nextFunding.contributionMinor }),
            }}
          />}
          <div className="mission-section-title daily"><div><strong>BONOS DEL DÍA</strong><small>No bloquean tu avance de nivel</small></div>{claimableMissions > 0 && <b>{claimableMissions} por cobrar</b>}</div>
          {game.missions.map((mission) => {
            const missionProgress = Math.min(100, mission.progress / mission.target * 100);
            const canClaim = mission.completed && !mission.claimed;
            return <button key={mission.id} className={`mission ${mission.completed ? "done" : ""}`} disabled={!canClaim} aria-label={canClaim ? `${mission.label}. Cobrar recompensa` : mission.label} onClick={() => canClaim && dispatch({ type: "CLAIM_MISSION", missionId: mission.id })}>
              <span><GameIcon name={mission.claimed ? "check" : canClaim ? "gift" : "circle"} /></span><div><strong>{mission.label}</strong><div className="mission-track" role="progressbar" aria-label={`Progreso de ${mission.label}`} aria-valuemin={0} aria-valuemax={mission.target} aria-valuenow={mission.progress}><i style={{ width: `${missionProgress}%` }}/></div><small>{mission.progress}/{mission.target} · {mission.claimed ? "Cobrada" : canClaim ? "Toca para cobrar" : formatMoney(mission.rewardMinor, game)}</small></div>
            </button>;
          })}
        </div>
      </details>

      {game.level === 1 && game.tutorialStep > 0 && <LevelOneGuide game={game} franchise={franchise} />}

      <nav className="quick-menu glass-panel" data-game-ui-interactive="true" aria-label="Menú del supermercado">
        <QuickButton icon="inventory" label="Inventario" onClick={() => setPanel("stock")} />
        <QuickButton icon="suppliers" label="Proveedores" onClick={() => setPanel("suppliers")} />
        <QuickButton icon="team" label="Equipo" onClick={() => setPanel("team")} />
        <QuickButton icon="map" label="Franquicias" onClick={() => setPanel("map")} />
        <QuickButton icon="finance" label="Finanzas" onClick={() => setPanel("finance")} />
        <QuickButton icon="build" label="Construir" onClick={() => setPanel("build")} />
        <QuickButton icon="avatar" label="Avatar" onClick={() => setPanel("avatar")} />
        <QuickButton icon="help" label="Cómo jugar" onClick={() => setPanel("help")} />
      </nav>

      <footer className="game-bottom" data-game-ui-interactive="true" aria-label="Estado del jugador">
        <div className={`save-chip ${status}`} data-visible={showSaveStatus} role="status" aria-live="polite" aria-hidden={!showSaveStatus}><i/>{saveLabel}</div>
        {carriedQuantity > 0 && <div className="carry-chip" role="status" aria-label={`Cesta: ${carriedQuantity} de ${visualTransfer.carry.capacity}. ${carriedProducts.map((productId) => PRODUCTS[productId].name).join(", ")}`}><span className="carry-preview" aria-hidden="true">{carriedProducts.slice(0, 3).map((productId) => <i key={productId}>{PRODUCTS[productId].emoji}</i>)}</span><div><small>Cesta · {carriedProducts.length} {carriedProducts.length === 1 ? "producto" : "productos"}</small><strong>{carriedQuantity}/{visualTransfer.carry.capacity}</strong></div></div>}
        <div className="player-chip"><span title={avatarHat ? `Gorro ${avatarHat.name}` : "Sin gorro"}>{avatarHat?.emoji ?? "👤"}</span><div><strong>{playerName}</strong><small>Reputación {game.reputation}</small></div><button aria-label="Guardar ahora" title="Guardar ahora" onClick={() => void saveGame()}><GameIcon name="cloud" /></button></div>
      </footer>

      {prompt && <div className="interaction-prompt" role="status" aria-live="polite"><span className="prompt-signal" aria-hidden="true"><i /></span><strong>{prompt.label}</strong><small>{prompt.id === "door" ? "Sensor automático de la puerta" : "Actividad automática por proximidad"}</small></div>}
      {notificationToast}
      {debug && <aside className="debug-overlay" data-game-ui-interactive="true"><strong>QA 3D EN VIVO</strong><span>FPS {metrics?.fps ?? "—"} · p95 {metrics?.p95FrameMs ?? "—"} ms</span><span>Draw calls {metrics?.drawCalls ?? "—"} · triángulos {metrics?.triangles.toLocaleString() ?? "—"}</span><span>Texturas {metrics?.textures ?? "—"} · programas {metrics?.programs ?? "—"}</span><span>Clientes {franchise.customers.length} · rutas {franchise.customers.filter((customer) => customer.path.length > customer.pathIndex).length}</span><span>NavMesh rev. {franchise.structureRevision} · colisiones/sensores visibles</span></aside>}
      {game.tutorialStep === 0 && <SetupPanel gameCountry={game.countryCode} gameAvatar={game.avatar} onComplete={(avatar, countryCode) => {
        dispatch({ type: "SET_AVATAR", ...avatar });
        dispatch({ type: "SET_COUNTRY", countryCode });
        void saveGame();
      }} />}
      {panel && <ManagementPanel panel={panel} close={() => setPanel(null)} />}
    </main>
  </>
  );
}

type GameIconName = "store" | "inventory" | "suppliers" | "team" | "map" | "finance" | "build" | "avatar" | "help" | "target" | "gift" | "check" | "circle" | "chevron" | "cloud" | "warning";

const GAME_ICON_PATHS: Record<GameIconName, string[]> = {
  store: ["M3 10h18", "M5 10v10h14V10", "M4 4h16l2 6H2l2-6Z", "M8 20v-6h5v6"],
  inventory: ["M4 7h16v13H4Z", "M3 4h18v3H3Z", "M9 11h6"],
  suppliers: ["M3 6h11v10H3Z", "M14 10h4l3 3v3h-7Z", "M8 18a2 2 0 1 1-4 0", "M20 18a2 2 0 1 1-4 0"],
  team: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4", "M9 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M22 21v-2a4 4 0 0 0-3-3.87", "M16 5.13a4 4 0 0 1 0 7.75"],
  map: ["M12 22s7-5.2 7-12a7 7 0 1 0-14 0c0 6.8 7 12 7 12Z", "M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"],
  finance: ["M4 20V10", "M10 20V4", "M16 20v-7", "M22 20H2"],
  build: ["m14 5 5 5", "m17 3 2-2 2 2-2 2", "M14 10 5 19l-3 3 3-3 9-9", "m5 5 4 4"],
  avatar: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M4 21a8 8 0 0 1 16 0"],
  help: ["M9.1 9a3 3 0 1 1 4.83 2.37c-1.2.79-1.93 1.24-1.93 2.63", "M12 18h.01", "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z"],
  target: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z", "M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"],
  gift: ["M3 9h18v4H3Z", "M5 13v8h14v-8", "M12 9v12", "M12 9H7.5A2.5 2.5 0 1 1 10 6.5L12 9Zm0 0h4.5A2.5 2.5 0 1 0 14 6.5L12 9Z"],
  check: ["m5 12 4 4L19 6"],
  circle: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"],
  chevron: ["m8 10 4 4 4-4"],
  cloud: ["M17.5 19H6a4 4 0 0 1-.4-7.98A6.5 6.5 0 0 1 18 9a5 5 0 0 1-.5 10Z", "m9 12 3-3 3 3", "M12 9v7"],
  warning: ["M10.3 3.7 2.2 18a2 2 0 0 0 1.74 3h16.12a2 2 0 0 0 1.74-3L13.7 3.7a2 2 0 0 0-3.4 0Z", "M12 9v4", "M12 17h.01"],
};

function GameIcon({ name }: { name: GameIconName }) {
  return <svg className="game-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">{GAME_ICON_PATHS[name].map((path) => <path key={path} d={path} />)}</svg>;
}

function QuickButton({ icon, label, onClick }: { icon: GameIconName; label: string; onClick: () => void }) {
  return <button aria-label={label} title={label} onClick={onClick}><span><GameIcon name={icon} /></span><small>{label}</small></button>;
}

type LevelRequirementTask = LevelObjectiveTask | { id: string; label: string; progress: number; target: number; unit: "money" };

function LevelRequirement({ task, game, action }: {
  task: LevelRequirementTask;
  game?: GameState;
  action?: { disabled: boolean; label: string; onClick: () => void };
}) {
  const completed = task.progress >= task.target;
  const progress = Math.min(100, task.progress / Math.max(task.target, Number.EPSILON) * 100);
  const value = task.unit === "money" && game
    ? `${formatMoney(Math.min(task.progress, task.target), game)} aportados · faltan ${formatMoney(Math.max(0, task.target - task.progress), game)}`
    : task.unit === "percent"
      ? `${Math.round(Math.min(task.progress, task.target) * 100)} % / ${Math.round(task.target * 100)} %`
      : task.unit === "rating"
        ? `${Math.min(task.progress, task.target).toFixed(2)} / ${task.target.toFixed(2)}`
        : task.unit === "distance"
          ? `${Math.floor(Math.min(task.progress, task.target))} / ${task.target} m`
          : `${Math.floor(Math.min(task.progress, task.target))} / ${task.target}`;
  return <div className={`mission level-requirement ${completed ? "done" : ""}`}>
    <span><GameIcon name={completed ? "check" : "circle"} /></span>
    <div><strong>{task.label}</strong><div className="mission-track" role="progressbar" aria-label={`Progreso de ${task.label}`} aria-valuemin={0} aria-valuemax={task.target} aria-valuenow={Math.min(task.progress, task.target)}><i style={{ width: `${progress}%` }} /></div><small>{completed ? "Completado" : value}</small>{task.unit === "money" && !completed && <small className="funding-explanation">Las ventas llenan tu caja; la obra avanza al confirmar este aporte.</small>}{action && <button className="level-funding-action" disabled={action.disabled} onClick={action.onClick}>{action.label}</button>}</div>
  </div>;
}

function LevelOneGuide({ game, franchise }: { game: GameState; franchise: FranchiseState }) {
  const crop = franchise.crops.find((candidate) => candidate.productId === "tomatoes" && candidate.status !== "LOCKED");
  const harvested = game.progression.counters["harvest:tomatoes"] ?? 0;
  const stocked = game.progression.counters["stock:tomatoes"] ?? 0;
  const sales = game.progression.counters.customers ?? 0;
  const tomatoesInBasket = carryQuantity(franchise.carry, "tomatoes");
  const growingProgress = crop?.status === "GROWING"
    ? Math.round(Math.min(1, Math.max(0, (game.simulationTimeMs - crop.plantedAt) / Math.max(1, crop.readyAt - crop.plantedAt))) * 100)
    : 0;

  let activeStep = 1;
  let eyebrow = "PASO 1 DE 5";
  let title = crop?.status === "READY" ? "Cruza el bancal de tomates" : `Tomates creciendo · ${growingProgress}%`;
  let description = crop?.status === "READY"
    ? "Camina sobre las plantas maduras: los tomates saltarán como un imán hasta la cesta que llevas en las manos."
    : "La huerta trabaja sola. Recorre la tienda mientras las plantas crecen y vuelve cuando veas frutos maduros.";
  let progress = Math.max(harvested / 3 * 100, crop?.status === "GROWING" ? growingProgress : 0);

  if (tomatoesInBasket > 0 || (harvested >= 3 && stocked < 3)) {
    activeStep = 2; eyebrow = "PASO 2 DE 5"; title = "Surte frutas y verduras";
    description = tomatoesInBasket > 0
      ? `Lleva la cesta al expositor de frutas y verduras. Se colocarán automáticamente por unidad; tienes ${tomatoesInBasket}.`
      : "Vuelve a cruzar el bancal, recoge tomates maduros y llévalos al expositor de frutas y verduras.";
    progress = stocked / 3 * 100;
  } else if (harvested < 3) {
    progress = Math.max(harvested / 3 * 100, crop?.status === "GROWING" ? growingProgress : 0);
  } else if (!franchise.open) {
    activeStep = 3; eyebrow = "PASO 3 DE 5"; title = "Abre el supermercado";
    description = "Ya hay tomates reales en el expositor. Pulsa CERRADO en la barra superior para dejar entrar clientes.";
    progress = 100;
  } else if (sales < 1) {
    const waiting = franchise.customers.some((customer) => ["NAVIGATE_TO_QUEUE", "QUEUE_WAIT", "MOVE_QUEUE", "UNLOAD", "WAIT_CHECKOUT", "PAY"].includes(customer.state));
    activeStep = waiting ? 5 : 4; eyebrow = `PASO ${activeStep} DE 5`;
    title = waiting ? "Atiende la caja" : "Recibe al primer comprador";
    description = waiting ? "Acércate al puesto de caja. El cliente descargará, tú escanearás y después pagará." : "El cliente tomará un carro, buscará tomates y formará fila con movimiento continuo.";
    progress = waiting ? 75 : 35;
  } else {
    activeStep = 5; eyebrow = "NIVEL 1 COMPLETADO"; title = "Tu primera venta está lista";
    description = "Has cerrado el ciclo campo → estante → cliente → caja. Financia la ampliación cuando quieras avanzar.";
    progress = 100;
  }

  return <details className="level-one-guide glass-panel" data-game-ui-interactive="true">
    <summary className="level-one-summary" aria-label={`${eyebrow}: ${title}. Abrir guía`}>
      <span className="guide-step">{activeStep}</span>
      <div><small>{eyebrow}</small><strong>{title}</strong><div className="level-one-progress" role="progressbar" aria-label="Progreso de la guía inicial" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(100, progress))}><i style={{ width: `${Math.min(100, progress)}%` }} /></div></div>
      <b><GameIcon name="chevron" /></b>
    </summary>
    <div className="level-one-details">
      <p>{description}</p>
      <ol aria-label="Pasos de la guía">{[1, 2, 3, 4, 5].map((step) => <li key={step} className={step < activeStep ? "done" : step === activeStep ? "active" : ""} aria-current={step === activeStep ? "step" : undefined}>{step}</li>)}</ol>
    </div>
  </details>;
}

function SetupPanel({ gameCountry, gameAvatar, onComplete }: { gameCountry: CountryCode; gameAvatar: AvatarConfig; onComplete: (avatar: AvatarConfig, country: CountryCode) => void }) {
  const [country, setCountry] = useState(gameCountry); const [avatar, setAvatar] = useState(gameAvatar);
  return <div className="modal-backdrop"><section className="setup-panel setup-panel-expanded"><div className="setup-copy"><span className="eyebrow">BIENVENIDO, FUNDADOR</span><h2>Crea tu empresa</h2><p>El país determina la moneda, la fiscalidad y los costes. Después no podrá cambiarse en esta partida.</p><div className="country-grid">{Object.values(COUNTRIES).map((item) => <button key={item.code} className={country === item.code ? "selected" : ""} onClick={() => setCountry(item.code)}><strong>{flag(item.code)} {item.name}</strong><small>{item.currency} · renta {Math.round(item.corporateTaxRate * 1000) / 10}%</small></button>)}</div></div><div className="avatar-setup"><AvatarCustomizer avatar={avatar} compact onChange={(change) => setAvatar((current) => ({ ...current, ...change }))} /><button className="primary-button" onClick={() => onComplete(avatar, country)}>Abrir mi primer Mini Market</button></div></section></div>;
}

function ManagementPanel({ panel, close }: { panel: Exclude<Panel, null>; close: () => void }) {
  const game = useMarketStore((state) => state.game)!; const dispatch = useMarketStore((state) => state.dispatch); const franchise = game.franchises.find((item) => item.id === game.currentFranchiseId)!;
  const project = franchise.buildProjects.find((candidate) => candidate.level === game.level + 1);
  const projectFunding = project ? buildFundingQuote(game.balanceMinor, project) : null;
  const stationQuote = upgradeQuote(game, "station");
  const speedQuote = upgradeQuote(game, "player-speed");
  const capacityQuote = upgradeQuote(game, "player-capacity");
  const employeeQuote = upgradeQuote(game, "employee");
  const title = { stock: "Inventario y estanterías", suppliers: "Central de proveedores", team: "Equipo y delegación", map: "Mapa de franquicias", finance: "Dirección financiera", build: "Obras y mobiliario", avatar: "Vestuario del fundador", help: "Cómo jugar" }[panel];
  return <div className="management-wrap" onMouseDown={(event) => event.target === event.currentTarget && close()}><section className="management-panel"><header><div><span className="eyebrow">MINI MARKET OS</span><h2>{title}</h2></div><button className="close-button" onClick={close}>×</button></header>
    <div className="management-body">
      {panel === "stock" && <div className="product-grid">{(Object.keys(PRODUCTS) as ProductId[]).map((id) => <article className="product-card" key={id}><span>{PRODUCTS[id].emoji}</span><div><strong>{PRODUCTS[id].name}</strong><small>Almacén {franchise.warehouse[id]} · Tienda {franchise.shelves[id]}</small></div><b>Repón acercándote al estante con la carga</b></article>)}</div>}
      {panel === "suppliers" && <div className="supplier-list">{SUPPLIERS.map((supplier) => <article key={supplier.id} className={game.level < supplier.unlockLevel ? "locked" : ""}><div className="supplier-head"><div><strong>{supplier.name}</strong><small>{supplier.leadMinutes} min · descuento {Math.round(supplier.discount * 100)}%</small></div>{game.level < supplier.unlockLevel && <b>Nivel {supplier.unlockLevel}</b>}</div><div className="supplier-products">{(Object.keys(PRODUCTS) as ProductId[]).filter((id) => PRODUCTS[id].supplier === supplier.id).map((id) => <button key={id} disabled={game.level < supplier.unlockLevel} onClick={() => dispatch({ type: "ORDER", supplierId: supplier.id, productId: id, quantity: 10 })}><span>{PRODUCTS[id].emoji}</span><strong>{PRODUCTS[id].name}</strong><small>10 × {formatMoney(PRODUCTS[id].wholesaleMinor * countryMoneyScale(game.countryCode) * (1 - supplier.discount), game)}</small></button>)}</div></article>)}</div>}
      {panel === "team" && <div className="team-grid">{(Object.keys(ROLE_INFO) as EmployeeRole[]).map((role) => { const info = ROLE_INFO[role]; const hired = franchise.employees.filter((employee) => employee.role === role); const { salaryMinor, signingCostMinor } = employeeHiringQuote(role, game.countryCode); return <article key={role} className={game.level < info.unlockLevel ? "locked" : ""}><span className="role-icon">{roleIcon(role)}</span><div><strong>{info.name}</strong><p>{info.description}</p><small>{hired.length ? `${hired.map((item) => `${item.name} T${item.level}`).join(", ")} · ` : ""}Nómina {formatMoney(salaryMinor, game)}/día</small></div>{game.level < info.unlockLevel ? <b>Nivel {info.unlockLevel}</b> : <button disabled={game.balanceMinor < signingCostMinor} onClick={() => dispatch({ type: "HIRE", role })}>Contratar · {formatMoney(signingCostMinor, game)}</button>}</article>; })}</div>}
      {panel === "map" && <div className="franchise-map"><div className="map-line"/>{game.franchises.map((item, index) => <article key={item.id} className={`${item.owned ? "owned" : ""} ${item.id === game.currentFranchiseId ? "current" : ""}`}><span>{index === game.franchises.length - 1 ? "🏙️" : "🏪"}</span><div><small>NIVEL {item.unlockLevel}</small><strong>{item.name}</strong><p>{item.city}</p><b>{item.owned ? `${item.employees.length} empleados · ★ ${item.rating.toFixed(1)}` : formatMoney(item.purchaseCostMinor, game)}</b></div>{item.owned ? <button disabled={item.id === game.currentFranchiseId} onClick={() => { dispatch({ type: "TRAVEL", franchiseId: item.id }); close(); }}>{item.id === game.currentFranchiseId ? "Estás aquí" : "Viajar"}</button> : <button disabled={game.level < item.unlockLevel} onClick={() => dispatch({ type: "BUY_FRANCHISE", franchiseId: item.id })}>Comprar</button>}</article>)}</div>}
      {panel === "finance" && <FinancePanel />}
      {panel === "build" && <div className="upgrade-grid">
        <article><span>🏗️</span><div><strong>Ampliación de nivel</strong><p>{buildProgress(franchise, game.level)}. Las ventas aumentan la caja; la obra avanza al confirmar un aporte y se inaugura al completar también el objetivo.</p></div>{project && projectFunding && !projectFunding.completed ? <button disabled={projectFunding.contributionMinor <= 0} onClick={() => dispatch({ type: "CONTRIBUTE_BUILD", amountMinor: projectFunding.contributionMinor })}>{projectFunding.contributionMinor <= 0 ? "Sin caja disponible" : `${projectFunding.contributionMinor < projectFunding.remainingMinor ? "Aportar" : "Financiar"} · ${formatMoney(projectFunding.contributionMinor, game)}`}</button> : <b>{projectFunding?.completed ? "Financiada" : "Rango máximo"}</b>}</article>
        <UpgradePurchase icon="⚙️" title="Estación prioritaria" description="Mejora primero la estación desbloqueada con menor nivel." quote={stationQuote} game={game} onBuy={() => stationQuote && dispatch({ type: "CONTRIBUTE_UPGRADE", upgrade: "station", amountMinor: stationQuote.remainingMinor })} />
        <UpgradePurchase icon="🏃" title="Velocidad del vendedor" description={`Movimiento actual T${franchise.playerSpeedTier}.`} quote={speedQuote} game={game} onBuy={() => speedQuote && dispatch({ type: "CONTRIBUTE_UPGRADE", upgrade: "player-speed", amountMinor: speedQuote.remainingMinor })} />
        <UpgradePurchase icon="🧺" title="Capacidad de cesta" description={`Carga actual: ${franchise.carry.capacity} unidades mezcladas.`} quote={capacityQuote} game={game} onBuy={() => capacityQuote && dispatch({ type: "CONTRIBUTE_UPGRADE", upgrade: "player-capacity", amountMinor: capacityQuote.remainingMinor })} />
        <UpgradePurchase icon="👥" title="Formación del equipo" description="Contrata el siguiente puesto o forma al empleado de menor nivel." quote={employeeQuote} game={game} onBuy={() => employeeQuote && dispatch({ type: "CONTRIBUTE_UPGRADE", upgrade: "employee", amountMinor: employeeQuote.remainingMinor })} />
        <article><span>📜</span><div><strong>Licencia comercial</strong><p>{franchise.licenseDaysLeft} días restantes. Obligatoria para abrir.</p></div><button onClick={() => dispatch({ type: "BUY_LICENSE" })}>Renovar 14 días</button></article>
      </div>}
      {panel === "avatar" && <AvatarCustomizer avatar={game.avatar} onChange={(change) => dispatch({ type: "SET_AVATAR", ...change })} />}
      {panel === "help" && <div className="help-grid"><article><kbd>ARRASTRA</kbd><kbd>WASD</kbd><strong>Moverse</strong><p>Arrastra desde cualquier punto libre con ratón, dedo o lápiz. El teclado sigue disponible.</p></article><article><kbd>🧺</kbd><strong>Cosecha magnética</strong><p>Cruza un bancal maduro sin detenerte. Cada verdura vuela a la cesta y la parcela vuelve a crecer automáticamente.</p></article><article><kbd>◎</kbd><strong>Trabajo por proximidad</strong><p>Acércate al mueble correcto para cargar máquinas, colocar mercancía o atender la caja.</p></article><article><kbd>📦</kbd><strong>Pedidos y gestión</strong><p>Compra a proveedores, contrata personal y mejora mobiliario desde este tablet; no hay botones de compra en el suelo.</p></article><article><kbd>🎮</kbd><strong>Mando</strong><p>El stick izquierdo controla el movimiento; las actividades se activan por proximidad.</p></article><div className="tutorial-flow"><b>1. Cosecha</b><span>→</span><b>2. Surte</b><span>→</span><b>3. Abre</b><span>→</span><b>4. Atiende</b><span>→</span><b>5. Crece</b></div></div>}
    </div>
    <footer className="panel-footer"><span>Empresa: {COUNTRIES[game.countryCode].name} · {game.currency}</span><div className="panel-actions"><button className="danger-soft" onClick={() => dispatch({ type: "CLOSE_DAY" })}>Cerrar jornada y contabilizar</button><button className="danger-soft" onClick={async () => { localStorage.removeItem("mini-market-offline-player-v1"); localStorage.removeItem("mini-market-recovery-v1"); navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_PRIVATE_CACHE" }); await authClient.signOut(); window.location.reload(); }}>Cerrar sesión</button></div></footer>
  </section></div>;
}

function UpgradePurchase({ icon, title, description, quote, game, onBuy }: { icon: string; title: string; description: string; quote: ReturnType<typeof upgradeQuote>; game: GameState; onBuy: () => void }) {
  return <article className={quote ? "" : "locked"}>
    <span>{icon}</span>
    <div><strong>{title}</strong><p>{quote ? `${quote.label} · T${quote.currentTier} → T${quote.nextTier}. ${description}` : description}</p>{quote && quote.contributedMinor > 0 && <small>{formatMoney(quote.contributedMinor, game)} ya financiados</small>}</div>
    {quote ? <button disabled={game.balanceMinor < quote.remainingMinor} onClick={onBuy}>{game.balanceMinor < quote.remainingMinor ? `Faltan ${formatMoney(quote.remainingMinor - game.balanceMinor, game)}` : `Mejorar · ${formatMoney(quote.remainingMinor, game)}`}</button> : <b>Aún no disponible</b>}
  </article>;
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
