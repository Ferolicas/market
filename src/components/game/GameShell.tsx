"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { COUNTRIES, HATS, PRODUCTS, SUPPLIERS } from "@/game/catalog";
import { canOperateMachine, canProcessCheckoutUnit, countryMoneyScale, formatMoney, isCampaignGame } from "@/game/engine";
import { levelObjectiveTasks } from "@/game/progression/objectives";
import { campaignExpansionQuote } from "@/game/progression/CampaignExpansion";
import { campaignLocation } from "@/game/progression/CampaignLocations";
import { campaignLevel } from "@/game/progression/CampaignLevels";
import { campaignContracts } from "@/game/progression/CampaignContracts";

import { useMarketStore } from "@/game/store";
import type { AvatarConfig, CountryCode, FranchiseState, GameState, ProductId } from "@/game/types";
import { MarketScene, type InteractionId, type InteractionVisualEvent, type PurchaseMarker } from "./MarketScene";
import { GameRuntime } from "./GameRuntime";
import { AvatarCustomizer } from "./AvatarCustomizer";
import { GameInputSurface } from "./GameInputSurface";
import { feedbackBus, type FeedbackCue } from "@/game/feedback/FeedbackBus";
import { saveBadgePresentation, type SaveBadgeStatus } from "@/game/feedback/SaveBadgePolicy";
import type { RendererMetrics } from "@/game/debug/PerformanceMonitor";
import { carriedProductIds, carryQuantity, carryTotal, departmentStockingPulses } from "@/game/player/CarrySystem";
import { rosterEntries } from "@/game/progression/RosterUpgrades";
import { isPurchaseInteractionId, purchaseIdFromInteraction } from "@/game/stations/purchase-layout";
import { AvatarGallery, AvatarThumbnail } from "./AvatarThumbnails";
import { MissionComplete } from "./MissionComplete";
import { LoadingCurtain } from "./LoadingCurtain";
import { deriveVisualTransferPresentation, updateVisualTransferRemaining } from "@/game/player/VisualTransferLedger";
import { cropIdFromFarmInteraction, isFarmInteractionId } from "@/game/stations/farm-layout";
import { isStockingInteractionId, retailDepartmentFromStockingInteraction, RETAIL_DEPARTMENTS } from "@/game/stations/retail-layout";
import { marketQaQueryEnabled } from "@/game/debug/QaAccess";
import { clearRecoverySnapshot } from "@/game/persistence/RecoveryStorage";
import { businessDayIsClosing } from "@/game/time/BusinessDay";
import { isRegisterInteractionId, registerLane } from "@/game/stations/register-layout";
import { campaignPersonalTasks, campaignPurchaseQuotes, canOrderProduct } from "@/game/engine";
import { OPENING_PURCHASES, type OpeningPurchaseId } from "@/game/progression/MartCampaign";
import { purchaseContributionPulseMinor } from "@/game/progression/PurchaseState";
import { cashBundleCount, cashBundleMinor } from "@/game/economy/cash-bundles";

type Panel = "stock" | "orders" | "team" | "map" | "finance" | "avatar" | "help" | null;

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
  const adoptLocalCopy = useMarketStore((state) => state.adoptLocalCopy);
  const restoreServerCopy = useMarketStore((state) => state.restoreServerCopy);
  const lastSaveConfirmedAt = useMarketStore((state) => state.lastSaveConfirmedAt);
  const [panel, setPanel] = useState<Panel>(null);
  const [completedPurchase, setCompletedPurchase] = useState<{ id: string; label: string } | null>(null);
  const [levelHint, setLevelHint] = useState<{ level: number; purchase: OpeningPurchaseId; label: string } | null>(null);
  const [lastInteraction, setLastInteraction] = useState<InteractionVisualEvent | null>(null);
  const [transferEvents, setTransferEvents] = useState<InteractionVisualEvent[]>([]);
  const [debug] = useState(() => typeof window !== "undefined" && marketQaQueryEnabled(window.location.search));
  const [metrics, setMetrics] = useState<RendererMetrics | null>(null);
  const [worldReady, setWorldReady] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const tutorialStep = game?.tutorialStep ?? 0;
  const interactionSequence = useRef(0);
  const activeInteractionId = useRef<InteractionId | null>(null);
  const interactionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (interactionTimer.current) clearTimeout(interactionTimer.current);
  }, []);

  // Celebration and hint are driven by the authoritative save, not by the
  // action that happened to be dispatched, so a reload never replays them.
  const activeFranchise = game?.franchises.find((item) => item.id === game.currentFranchiseId) ?? game?.franchises[0];
  const purchasedSignature = (activeFranchise?.purchases?.purchased ?? []).join("|");
  const previousPurchased = useRef<string[] | null>(null);
  useEffect(() => {
    if (!activeFranchise) return;
    const purchased = purchasedSignature ? purchasedSignature.split("|") : [];
    const previous = previousPurchased.current;
    previousPurchased.current = purchased;
    if (!previous) return;
    const added = purchased.find((id) => !previous.includes(id));
    const definition = OPENING_PURCHASES.find((purchase) => purchase.id === added);
    if (definition) setCompletedPurchase({ id: definition.id, label: definition.label });
  }, [purchasedSignature, activeFranchise]);

  const availablePurchases = game ? campaignPurchaseQuotes(game).filter((purchase) => purchase.available) : [];
  const availableSignature = availablePurchases.map((purchase) => purchase.id).join("|");
  const currentLevel = activeFranchise ? campaignLevel(activeFranchise) : 1;
  const previousAvailable = useRef<string[] | null>(null);
  const previousLevel = useRef<number | null>(null);
  const loaded = Boolean(game);
  useEffect(() => {
    // The first snapshot after loading is the baseline: opening a saved game
    // is not a level-up and must not announce what was already available.
    if (!loaded) return;
    const available = availableSignature ? availableSignature.split("|") : [];
    const previous = previousAvailable.current;
    const previousLevelValue = previousLevel.current;
    previousAvailable.current = available;
    previousLevel.current = currentLevel;
    if (previous === null || previousLevelValue === null || currentLevel <= previousLevelValue) return;
    // Every level shows a pointer: what it just opened, or failing that what
    // the owner can already pay for next.
    const fresh = available.find((id) => !previous.includes(id)) ?? available[0];
    const definition = OPENING_PURCHASES.find((purchase) => purchase.id === fresh);
    if (definition) setLevelHint({ level: currentLevel, purchase: definition.id, label: definition.label });
  }, [availableSignature, currentLevel, loaded]);
  useEffect(() => {
    if (!levelHint) return;
    const timer = setTimeout(() => setLevelHint(null), 9_000);
    return () => clearTimeout(timer);
  }, [levelHint]);
  useEffect(() => {
    if (tutorialStep === 0 || worldReady) return;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => setWorldReady(true));
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [tutorialStep, worldReady]);
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
      chicken2: { machineId: "chicken-coop-2", action: { type: "OPERATE_MACHINE" as const, machineId: "chicken-coop-2" } },
      cow: { machineId: "cow-station-1", action: { type: "OPERATE_MACHINE" as const, machineId: "cow-station-1" } },
      cheese: { machineId: "cheese-maker-1", action: { type: "OPERATE_MACHINE" as const, machineId: "cheese-maker-1" } },
      juice: { machineId: "juice-machine-1", action: { type: "OPERATE_MACHINE" as const, machineId: "juice-machine-1" } },
      canner: { machineId: "corn-canner-1", action: { type: "OPERATE_MACHINE" as const, machineId: "corn-canner-1" } },
    } as const)[id as "mill" | "bakery" | "chicken" | "chicken2" | "cow" | "cheese" | "juice" | "canner"];
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
        currentFranchise.unlockedAreas,
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
    if (isPurchaseInteractionId(id)) {
      // Each ring pays for the thing standing on it, so walking into it is the
      // whole interaction: no selection step and no menu.
      const current = useMarketStore.getState().game;
      const purchaseId = purchaseIdFromInteraction(id);
      const quote = current && campaignPurchaseQuotes(current).find((purchase) => purchase.id === purchaseId);
      if (current && quote?.available && current.balanceMinor > 0) {
        queueInteraction({ type: "CONTRIBUTE_PURCHASE", purchaseId: quote.id });
        // Every pulse throws the bundles it pays for from the owner's hands
        // into the marker square; the engine decides the money, this only draws it.
        const pulseMinor = Math.min(current.balanceMinor, quote.remainingMinor ?? 0, purchaseContributionPulseMinor(quote.costMinor ?? 0));
        visualEvents = [{ id, kind: "pay", purchaseId: quote.id, quantity: Math.min(8, cashBundleCount(pulseMinor, cashBundleMinor(countryMoneyScale(current.countryCode)))) }];
      } else performed = false;
    }
    if (isRegisterInteractionId(id)) {
      const current = useMarketStore.getState().game;
      const currentFranchise = current?.franchises.find((item) => item.id === current.currentFranchiseId);
      const lane = registerLane(id);
      if (currentFranchise && currentFranchise.registerCashMinor[lane] > 0) queueInteraction({ type: "COLLECT_REGISTER", lane });
      else performed = false;
    }
    if (id === "orders") {
      // The PEDIDOS terminal is the counter for the warehouse and the
      // suppliers: stepping up to it opens that panel instead of silently
      // dropping goods into the basket.
      setPanel((current) => current ?? "orders");
    }
    if (id === "warehouseReturn" || id === "farmBarn") {
      const current = useMarketStore.getState().game;
      const currentFranchise = current?.franchises.find((item) => item.id === current.currentFranchiseId);
      const productIds = currentFranchise ? carriedProductIds(currentFranchise.carry) : [];
      if (currentFranchise && productIds.length) {
        queueInteraction({ type: "RETURN_TO_WAREHOUSE" });
        visualEvents = productIds.map((productId) => ({
          id,
          kind: "return" as const,
          productId,
          quantity: carryQuantity(currentFranchise.carry, productId),
          remainingQuantity: carryQuantity(currentFranchise.carry, productId),
          carryStart: carryQuantity(currentFranchise.carry, productId),
        }));
      } else performed = false;
    }
    if (id === "door") performed = false;
    // Keep a work gesture active only when a real station action was queued.
    // Locomotion owns the body again as soon as the player leaves its pad.
    if (performed) {
      const transferVisuals = visualEvents.filter((event) => event.kind === "harvest" || event.kind === "stock" || event.kind === "return" || event.kind === "pay");
      if (transferVisuals.length || activeInteractionId.current !== id) {
        activeInteractionId.current = id;
        const sequencedEvents = visualEvents.map((event): InteractionVisualEvent => ({
          ...event,
          sequence: ++interactionSequence.current,
        }));
        setLastInteraction(sequencedEvents[sequencedEvents.length - 1] ?? null);
        const sequencedTransfers = sequencedEvents.filter((event) => event.kind === "harvest" || event.kind === "stock" || event.kind === "return" || event.kind === "pay");
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
    const cue: Partial<Record<InteractionId, FeedbackCue>> = { mill: "machine", bakery: "machine", chicken: "pickup", cow: "pickup", cheese: "machine", juice: "machine", checkout: "scanner", door: "door" };
    if (performed && visualEvents.some((event) => event.kind === "harvest")) feedbackBus.emit("harvest", { source: "player", actorId: "player" });
    else if (performed && visualEvents.some((event) => event.kind === "stock" || event.kind === "return")) feedbackBus.emit("stock", { source: "player", actorId: "player" });
    else if (cue[id] && performed) feedbackBus.emit(cue[id], { source: "player", actorId: "player" });
  }, [queueInteraction]);
  // Product flights report each landing from inside the frame loop. Coalesce
  // them into one state update per animation frame so a twenty-unit burst
  // cannot re-render the shell and the furniture twenty times in a second.
  const pendingTransferProgress = useRef(new Map<number, number>());
  const transferFlushFrame = useRef(0);
  useEffect(() => () => {
    if (transferFlushFrame.current) cancelAnimationFrame(transferFlushFrame.current);
  }, []);
  const updateTransferProgress = useCallback((sequence: number, remainingQuantity: number) => {
    pendingTransferProgress.current.set(sequence, remainingQuantity);
    if (transferFlushFrame.current) return;
    transferFlushFrame.current = requestAnimationFrame(() => {
      transferFlushFrame.current = 0;
      const pending = pendingTransferProgress.current;
      pendingTransferProgress.current = new Map();
      setTransferEvents((current) => {
        let next = current;
        for (const [pendingSequence, remaining] of pending) next = updateVisualTransferRemaining(next, pendingSequence, remaining);
        return next;
      });
    });
  }, []);
  const recordDistance = useCallback((meters: number) => { recordPlayerDistance(meters); }, [recordPlayerDistance]);
  const revealScene = useCallback(() => setSceneReady(true), []);
  const setDoorPresence = useCallback((active: boolean) => {
    // Persistence QA reloads with the simulation frozen so the restored
    // snapshot can be inspected before any live-world input mutates it.  The
    // player respawns beside the entrance, so the door sensor must observe the
    // same freeze as the timers and store ticks.
    if (debug && sessionStorage.getItem("mini-market-qa-freeze") === "1") return;
    dispatch({ type: "DOOR_SENSOR", active });
  }, [debug, dispatch]);

  // No floating notices: the world signs, the panels and the HUD badge carry
  // every state, and "Misión completada" is a full screen, not a toast.

  if (!game) return <><GameRuntime/><LoadingCurtain title="Preparando la tienda…" detail="Sincronizando caja, empleados e inventario" /></>;
  const franchise = game.franchises.find((item) => item.id === game.currentFranchiseId) ?? game.franchises[0];
  const purchaseQuotes = campaignPurchaseQuotes(game);
  const purchaseMarkers: PurchaseMarker[] = purchaseQuotes.filter((purchase) => purchase.available).map((purchase) => ({
    id: purchase.id,
    label: purchase.label,
    remainingLabel: formatMoney(purchase.remainingMinor ?? 0, game),
    funded: purchase.costMinor ? purchase.contributedMinor / purchase.costMinor : 0,
    highlighted: levelHint?.purchase === purchase.id,
  }));
  const visualTransfer = deriveVisualTransferPresentation(franchise.carry, franchise.crops, franchise.shelves, transferEvents);
  const displayMinuteOfDay = Math.floor(game.minuteOfDay);
  const hour = `${String(Math.floor(displayMinuteOfDay / 60) % 24).padStart(2, "0")}:${String(displayMinuteOfDay % 60).padStart(2, "0")}`;
  const dayClosing = businessDayIsClosing(game.minuteOfDay);
  const avatarHat = HATS.find((item) => item.id === game.avatar.hat);
  const carriedProducts = carriedProductIds(visualTransfer.carry);
  const carriedQuantity = carryTotal(visualTransfer.carry);
  const levelLabel = `Nivel ${franchise.purchases ? campaignLevel(franchise) : game.level}`;

  return (<>
    <GameRuntime />
    <main className="game-shell">
      {worldReady && <div className={`world${sceneReady ? " scene-ready" : " scene-preparing"}`} aria-hidden={!sceneReady}><MarketScene purchaseMarkers={purchaseMarkers} registerCashMinor={franchise.registerCashMinor} cashBundleMinor={cashBundleMinor(countryMoneyScale(game.countryCode))} avatar={game.avatar} carry={franchise.carry} visualCarry={visualTransfer.carry} checkoutLevel={franchise.checkoutLevel} playerSpeedTier={franchise.playerSpeedTier} customers={franchise.customers} checkoutTransactions={franchise.checkoutTransactions} returnsBin={franchise.returnsBin} returnedCartCount={franchise.returnedCartCount} crops={franchise.crops} visualCrops={visualTransfer.crops} productionMachines={franchise.productionMachines} shelves={franchise.shelves} visualShelves={visualTransfer.shelves} shelfTier={franchise.stationTiers["shelves-1"] ?? franchise.shelvesLevel} unlockedAreas={franchise.unlockedAreas} lightsOn={franchise.lightsOn} minuteOfDay={game.minuteOfDay} simulationTimeMs={game.simulationTimeMs} employees={franchise.employees} open={franchise.open} doorState={franchise.doorState} doorProgress={franchise.doorProgress} onInteract={interact} onDistance={recordDistance} onDoorPresence={setDoorPresence} onSceneReady={revealScene} lastInteraction={lastInteraction} transferEvents={transferEvents} onTransferProgress={updateTransferProgress} debug={debug} />{sceneReady && <GameInputSurface />}</div>}
      {worldReady && !sceneReady && <LoadingCurtain title="Preparando la tienda…" detail="Cargando personajes y maquinaria sin interrupciones" />}
      <header className="hud-top glass-panel" data-game-ui-interactive="true" aria-label="Estado de la tienda">
        <div className="hud-brand"><span><GameIcon name="store" /></span><div><strong>{franchise.name}</strong><small>{franchise.city}</small></div></div>
        {/* Only the number: the till total and the daily sales moved out of
            the bar, where they were competing with the money that matters. */}
        <div className="hud-stat money"><strong>{formatMoney(game.balanceMinor, game)}</strong></div>
        <div className="hud-stat clock"><strong>{hour}</strong></div>
        <div className="hud-stat level"><strong>{levelLabel}</strong></div>
        <button className={`store-status ${franchise.open ? "open" : "closed"}`} disabled={dayClosing} aria-pressed={franchise.open} aria-label={dayClosing ? "Cierre de caja en curso" : franchise.open ? "Cerrar el supermercado y terminar el día" : "Abrir el supermercado"} onClick={() => dispatch({ type: "TOGGLE_STORE" })}><i/>{dayClosing ? "CERRANDO" : franchise.open ? "ABIERTO" : "CERRADO"}</button>
        <SaveBadge status={status} lastSaveConfirmedAt={lastSaveConfirmedAt} lastSavedAt={game.lastSavedAt} detail={status === "error" || status === "conflict" || status === "offline" ? message : ""} onSave={() => void saveGame()} />
      </header>


      {status === "conflict" && <div className="level-hint conflict glass-panel" data-game-ui-interactive="true" role="alertdialog" aria-live="assertive" aria-label="Partida distinta en otro dispositivo">
        <span className="level-hint-pin" aria-hidden="true"><GameIcon name="warning" /></span>
        <div>
          <small>PARTIDA DISTINTA EN OTRO DISPOSITIVO</small>
          <strong>Aquí vas por el {levelLabel.toLowerCase()} · {formatMoney(game.balanceMinor, game)}</strong>
          <p>El servidor guarda otra copia. Elige cuál conservar; la otra se descarta.</p>
          <div className="conflict-actions">
            <button type="button" onClick={() => void adoptLocalCopy()}>Conservar esta copia</button>
            <button type="button" className="secondary" onClick={() => void restoreServerCopy()}>Usar la del servidor</button>
          </div>
        </div>
      </div>}


      {game.level === 1 && game.tutorialStep > 0 && <LevelOneGuide game={game} franchise={franchise} />}

      <nav className="quick-menu glass-panel" data-game-ui-interactive="true" aria-label="Menú del supermercado">
        <QuickButton icon="inventory" label="Inventario" onClick={() => setPanel("stock")} />
        <QuickButton icon="suppliers" label="Pedidos" onClick={() => setPanel("orders")} />
        <QuickButton icon="team" label="Equipo" onClick={() => setPanel("team")} />
        <QuickButton icon="map" label="Franquicias" onClick={() => setPanel("map")} />
        <QuickButton icon="finance" label="Finanzas" onClick={() => setPanel("finance")} />
        <QuickButton icon="avatar" label="Avatar" onClick={() => setPanel("avatar")} />
        <QuickButton icon="help" label="Cómo jugar" onClick={() => setPanel("help")} />
      </nav>

      <footer className="game-bottom" data-game-ui-interactive="true" aria-label="Estado del jugador">
        {carriedQuantity > 0 && <div className="carry-chip" role="status" aria-label={`Cesta: ${carriedQuantity} de ${visualTransfer.carry.capacity}. ${carriedProducts.map((productId) => PRODUCTS[productId].name).join(", ")}`}><span className="carry-preview" aria-hidden="true">{carriedProducts.slice(0, 3).map((productId) => <i key={productId}>{PRODUCTS[productId].emoji}</i>)}</span><div><small>Cesta · {carriedProducts.length} {carriedProducts.length === 1 ? "producto" : "productos"}</small><strong>{carriedQuantity}/{visualTransfer.carry.capacity}</strong></div></div>}
        <div className="player-chip"><span title={avatarHat ? `Gorro ${avatarHat.name}` : "Sin gorro"}>{avatarHat?.emoji ?? "👤"}</span><div><strong>{playerName}</strong><small>Reputación {game.reputation}</small></div><button aria-label="Guardar ahora" title="Guardar ahora" onClick={() => void saveGame()}><GameIcon name="cloud" /></button></div>
      </footer>

      {debug && <aside className="debug-overlay" data-game-ui-interactive="true"><strong>QA 3D EN VIVO</strong><span>FPS {metrics?.fps ?? "—"} · frame {metrics?.averageFrameMs ?? "—"} ms · p95 {metrics?.p95FrameMs ?? "—"} ms</span><span>Draw calls {metrics?.drawCalls ?? "—"} · triángulos {metrics?.triangles.toLocaleString() ?? "—"}</span><span>Geometrías {metrics?.geometries ?? "—"} · texturas {metrics?.textures ?? "—"} · programas {metrics?.programs ?? "—"}</span><span>Puntos {metrics?.points ?? "—"} · líneas {metrics?.lines ?? "—"}</span><span>Clientes {franchise.customers.length} · rutas {franchise.customers.filter((customer) => customer.path.length > customer.pathIndex).length}</span><span>NavMesh rev. {franchise.structureRevision} · colisiones/sensores visibles</span></aside>}
      {game.tutorialStep === 0 && <SetupPanel campaign={isCampaignGame(game)} gameCountry={game.countryCode} gameAvatar={game.avatar} onComplete={(avatar, countryCode) => {
        dispatch({ type: "SET_AVATAR", ...avatar });
        dispatch({ type: "SET_COUNTRY", countryCode });
        void saveGame();
      }} />}
      {panel && <ManagementPanel panel={panel} close={() => setPanel(null)} />}
      {completedPurchase && <MissionComplete label={completedPurchase.label} onDone={() => setCompletedPurchase(null)} />}
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
    description = "Has cerrado el ciclo campo → estante → cliente → caja. Recoge el dinero de la caja y entra en un círculo dorado para comprar tu siguiente mejora.";
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

function SetupPanel({ campaign, gameCountry, gameAvatar, onComplete }: { campaign: boolean; gameCountry: CountryCode; gameAvatar: AvatarConfig; onComplete: (avatar: AvatarConfig, country: CountryCode) => void }) {
  const [country, setCountry] = useState(gameCountry); const [avatar, setAvatar] = useState(gameAvatar);
  return <div className="modal-backdrop"><section className="setup-panel setup-panel-expanded"><div className="setup-copy"><span className="eyebrow">BIENVENIDO, FUNDADOR</span><h2>Crea tu empresa</h2><p>{campaign ? "El país determina la moneda y la escala de precios. Sin impuestos ni cargos diarios en la campaña." : "El país determina la moneda, la fiscalidad y los costes."} Después no podrá cambiarse en esta partida.</p><div className="country-grid">{Object.values(COUNTRIES).map((item) => <button key={item.code} className={country === item.code ? "selected" : ""} onClick={() => setCountry(item.code)}><strong>{flag(item.code)} {item.name}</strong><small>{item.currency}{!campaign && <> · renta {Math.round(item.corporateTaxRate * 1000) / 10}%</>}</small></button>)}</div></div><div className="avatar-setup"><AvatarCustomizer avatar={avatar} compact onChange={(change) => setAvatar((current) => ({ ...current, ...change }))} /><button className="primary-button" onClick={() => onComplete(avatar, country)}>Abrir mi primer Mini Market</button></div></section></div>;
}

function ManagementPanel({ panel, close }: { panel: Exclude<Panel, null>; close: () => void }) {
  const game = useMarketStore((state) => state.game)!; const dispatch = useMarketStore((state) => state.dispatch); const franchise = game.franchises.find((item) => item.id === game.currentFranchiseId)!;
  const dayClosing = businessDayIsClosing(game.minuteOfDay);
  const supplierUnlocked = (id: string) => (Object.keys(PRODUCTS) as ProductId[]).some((product) => PRODUCTS[product].supplier === id && canOrderProduct(game, product));
  const title = { stock: "Inventario y estanterías", orders: "Pedidos", team: "Equipo y mejoras", map: "Mapa de franquicias", finance: "Dirección financiera", avatar: "Vestuario del fundador", help: "Cómo jugar" }[panel];
  const contracts = campaignContracts(franchise);
  const personalTasks = franchise.purchases ? campaignPersonalTasks(game) : levelObjectiveTasks(game.level, game);
  const warehouseProducts = (Object.keys(PRODUCTS) as ProductId[]).filter((id) => franchise.warehouse[id] > 0);
  const freeCarry = Math.max(0, franchise.carry.capacity - carryTotal(franchise.carry));
  return <div className="management-wrap" onMouseDown={(event) => event.target === event.currentTarget && close()}><section className="management-panel"><header><div><span className="eyebrow">MINI MARKET OS</span><h2>{title}</h2></div><button className="close-button" onClick={close}>×</button></header>
    <div className="management-body">
      {/* Inventory is a board of product cards: the picture, the name and the
          two numbers. Where to restock is taught by the world, not by a line
          of copy repeated on every card. */}
      {panel === "stock" && <div className="stock-card-grid">{(Object.keys(PRODUCTS) as ProductId[]).map((id) => <article className="stock-card" key={id}>
        <span className="stock-card-art" aria-hidden="true">{PRODUCTS[id].emoji}</span>
        <strong>{PRODUCTS[id].name}</strong>
        <div className="stock-card-counts">
          <div><small>ALMACÉN</small><b>{franchise.warehouse[id]}</b></div>
          <div><small>TIENDA</small><b>{franchise.shelves[id]}</b></div>
        </div>
      </article>)}</div>}

      {panel === "orders" && <div className="orders-layout">
        <section className="orders-block">
          <h3>Encargos de clientes</h3>
          {contracts.length === 0 && <p className="orders-empty">Todavía no hay encargos en este local.</p>}
          {contracts.map((contract) => <article key={contract.id} className={contract.completed ? "done" : ""}>
            <div><strong>{contract.label}</strong><small>{contract.products.map((product) => `1 ${PRODUCTS[product].name}`).join(" + ")}</small></div>
            {contract.completed
              ? <b>Entregado</b>
              : <button disabled={!contract.ready} onClick={() => dispatch({ type: "DELIVER_CONTRACT", contractId: contract.id })}>{!contract.previousDone ? "Completa el anterior" : !contract.unlocked ? "Desbloquea sus productos" : contract.ready ? "Entregar cesta" : "Reúne los 3 en tu cesta"}</button>}
          </article>)}
        </section>

        <section className="orders-block">
          <h3>Tu trabajo personal</h3>
          {personalTasks.map((task) => <article key={task.id} className={task.progress >= task.target ? "done" : ""}>
            <div><strong>{task.label}</strong><small>{Math.floor(Math.min(task.progress, task.target))} / {task.target}</small></div>
            <b>{task.progress >= task.target ? "✓" : `${Math.round(Math.min(100, task.progress / Math.max(task.target, 1) * 100))} %`}</b>
          </article>)}
        </section>

        {/* Warehouse goods are taken here, deliberately: walking past the dock
            used to drop produce into the basket that nobody asked for. */}
        <section className="orders-block">
          <h3>Retirar del almacén</h3>
          <p className="orders-empty">Espacio libre en tu cesta: {freeCarry} de {franchise.carry.capacity}.</p>
          <div className="warehouse-picks">{warehouseProducts.map((id) => <button key={id} disabled={freeCarry <= 0} onClick={() => dispatch({ type: "PICKUP_WAREHOUSE", productId: id, quantity: Math.min(freeCarry, franchise.warehouse[id]) })}>
            <span aria-hidden="true">{PRODUCTS[id].emoji}</span><strong>{PRODUCTS[id].name}</strong><small>{franchise.warehouse[id]} en almacén</small>
          </button>)}
          {warehouseProducts.length === 0 && <p className="orders-empty">El almacén está vacío.</p>}</div>
        </section>

        <section className="orders-block">
          <h3>Pedidos a proveedores</h3>
          {game.pendingOrders.length > 0 && <ul className="pending-orders">{game.pendingOrders.map((order) => <li key={order.id}><span aria-hidden="true">{PRODUCTS[order.productId].emoji}</span><strong>{order.quantity} × {PRODUCTS[order.productId].name}</strong><small>En camino</small></li>)}</ul>}
          <div className="supplier-list">{SUPPLIERS.map((supplier) => <article key={supplier.id} className={!supplierUnlocked(supplier.id) ? "locked" : ""}>
            <div className="supplier-head"><div><strong>{supplier.name}</strong><small>{supplier.leadMinutes} min · descuento {Math.round(supplier.discount * 100)}%</small></div>{!supplierUnlocked(supplier.id) && <b>{franchise.purchases ? "Desbloquea su cadena" : `Nivel ${supplier.unlockLevel}`}</b>}</div>
            <div className="supplier-products">{(Object.keys(PRODUCTS) as ProductId[]).filter((id) => PRODUCTS[id].supplier === supplier.id).map((id) => <button key={id} disabled={!canOrderProduct(game, id)} onClick={() => dispatch({ type: "ORDER", supplierId: supplier.id, productId: id, quantity: 10 })}><span>{PRODUCTS[id].emoji}</span><strong>{PRODUCTS[id].name}</strong><small>10 × {formatMoney(PRODUCTS[id].wholesaleMinor * countryMoneyScale(game.countryCode) * (1 - supplier.discount), game)}</small></button>)}</div>
          </article>)}</div>
        </section>
      </div>}

      {panel === "team" && <TeamPanel />}

      {panel === "map" && <div className="franchise-map"><div className="map-line"/>{game.franchises.map((item, index) => {
        const campaign = isCampaignGame(game);
        const quote = campaignExpansionQuote(game, item.id);
        const pendingTask = quote.tasks.find((task) => !task.completed);
        const available = campaign ? quote.available : game.level >= item.unlockLevel;
        return <article key={item.id} className={`${item.owned ? "owned" : ""} ${item.id === game.currentFranchiseId ? "current" : ""}`}>
          <span>{index === game.franchises.length - 1 ? "🏙️" : "🏪"}</span>
          <div><small>{campaign ? `LOCAL ${index + 1}` : `NIVEL ${item.unlockLevel}`}</small><strong>{item.name}</strong><p>{item.city}</p>
            {campaign && <p>{campaignLocation(item.id).specialty}</p>}
            {campaign && !item.owned && quote.previousName && <small>Encargos del local anterior: {quote.contracts.filter((contract) => contract.completed).length}/{quote.contracts.length}</small>}
            <b>{item.owned ? `${item.employees.length} empleados · ★ ${item.rating.toFixed(1)}` : formatMoney(item.purchaseCostMinor, game)}</b>
            {campaign && !item.owned && <><p>{quote.reason}</p>{quote.previousName && <small>{quote.tasks.filter((task) => task.completed).length}/{quote.tasks.length} tareas personales · {quote.missingPurchases.length} compras pendientes</small>}{pendingTask && !quote.missingPurchases.length && <p>{pendingTask.label}: {pendingTask.progress}/{pendingTask.target}</p>}</>}
          </div>
          {item.owned ? <button disabled={item.id === game.currentFranchiseId} onClick={() => { dispatch({ type: "TRAVEL", franchiseId: item.id }); close(); }}>{item.id === game.currentFranchiseId ? "Estás aquí" : "Viajar"}</button> : <button disabled={!available || game.balanceMinor < item.purchaseCostMinor} onClick={() => dispatch({ type: "BUY_FRANCHISE", franchiseId: item.id })}>Abrir local</button>}
        </article>;
      })}</div>}
      {panel === "finance" && <FinancePanel />}
      {panel === "avatar" && <AvatarCustomizer avatar={game.avatar} onChange={(change) => dispatch({ type: "SET_AVATAR", ...change })} />}
      {panel === "help" && <div className="help-grid"><article><kbd>ARRASTRA</kbd><kbd>WASD</kbd><strong>Moverse</strong><p>Arrastra desde cualquier punto libre con ratón, dedo o lápiz. El teclado sigue disponible.</p></article><article><kbd>🧺</kbd><strong>Cosecha magnética</strong><p>Cruza un bancal maduro sin detenerte. Cada verdura vuela a la cesta y la parcela vuelve a crecer automáticamente.</p></article><article><kbd>◎</kbd><strong>El elemento es el imán</strong><p>Acércate a cualquier lado de la máquina, el corral o el expositor: no hay casillas exactas ni avisos que pulsar.</p></article><article><kbd>🟡</kbd><strong>Círculos dorados</strong><p>Cada compra se paga en el sitio donde va a estar. Entra en su círculo con dinero recogido de la caja.</p></article><article><kbd>📦</kbd><strong>Pedidos</strong><p>Encargos, trabajo personal, retirada del almacén y compras a proveedores viven en el panel de Pedidos.</p></article><div className="tutorial-flow"><b>1. Cosecha</b><span>→</span><b>2. Surte</b><span>→</span><b>3. Abre</b><span>→</span><b>4. Atiende</b><span>→</span><b>5. Crece</b></div></div>}
    </div>
    <footer className="panel-footer"><span>Empresa: {COUNTRIES[game.countryCode].name} · {game.currency}</span><div className="panel-actions"><button className="danger-soft" disabled={!franchise.open || dayClosing} onClick={() => dispatch({ type: "CLOSE_DAY" })}>Cerrar tienda y jornada</button><button className="danger-soft" onClick={async () => { localStorage.removeItem("mini-market-offline-player-v1"); await clearRecoverySnapshot(); navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_PRIVATE_CACHE" }); await authClient.signOut(); window.location.reload(); }}>Cerrar sesión</button></div></footer>
  </section></div>;
}

/**
 * The roster: one card per person, animal, machine and crop bed, each with the
 * same four upgrade steps. Hiring and staffing quotas are gone from here —
 * staff arrives with its purchase or its level, so this panel is only about
 * making what you already own faster and bigger.
 */
function TeamPanel() {
  const game = useMarketStore((state) => state.game)!;
  const dispatch = useMarketStore((state) => state.dispatch);
  const franchise = game.franchises.find((item) => item.id === game.currentFranchiseId)!;
  const entries = rosterEntries(franchise, countryMoneyScale(game.countryCode));
  const bodies: AvatarConfig["body"][] = ["adult-woman", "adult-man", "adult-woman", "adult-man"];
  const hairs: AvatarConfig["hair"][] = ["ponytail", "fade", "bun", "waves"];
  const employeeOrdinal = new Map(entries.filter((entry) => entry.kind === "employee").map((entry, index) => [entry.id, index]));
  return <AvatarGallery><div className="roster-grid">
    {entries.map((entry) => {
      const portraitIndex = employeeOrdinal.get(entry.id) ?? 0;
      const portrait = entry.kind === "player"
        ? { ...game.avatar }
        : entry.kind === "employee"
          ? { ...game.avatar, body: bodies[portraitIndex % bodies.length], hair: hairs[portraitIndex % hairs.length], hat: "none" as const }
          : null;
      return <article key={entry.id} className={`roster-card ${entry.kind}`}>
        <div className="roster-portrait">
          {portrait
            ? <AvatarThumbnail alt={entry.label} request={{ id: `roster:${entry.id}:${portrait.body}:${portrait.hair}`, framing: "head", avatar: portrait }} />
            : <span className="roster-emoji" aria-hidden="true">{entry.icon}</span>}
        </div>
        <strong>{entry.label}</strong>
        <small>{entry.detail}</small>
        <p>Velocidad ×{entry.speed.toFixed(2)} · capacidad ×{entry.capacity.toFixed(2)}</p>
        <div className="roster-upgrades" role="group" aria-label={`Mejoras de ${entry.label}`}>
          {entry.stepCostsMinor.map((costMinor, index) => {
            const bought = index < entry.step;
            const next = index === entry.step;
            return <button
              key={index}
              className={bought ? "bought" : next ? "next" : "locked"}
              disabled={!next || game.balanceMinor < costMinor}
              aria-label={`Mejora ${index + 1} de ${entry.label}`}
              onClick={() => dispatch({ type: "UPGRADE_ROSTER", entryId: entry.id })}
            >
              <b>{index + 1}</b>
              <small>{bought ? "Hecho" : formatMoney(costMinor, game)}</small>
            </button>;
          })}
        </div>
      </article>;
    })}
  </div></AvatarGallery>;
}


/**
 * Saved state lives in the top bar next to OPEN/CLOSED, with the time of the
 * last confirmed save, instead of a toast at the bottom of the screen.
 */
function SaveBadge({ status, lastSaveConfirmedAt, lastSavedAt, detail, onSave }: { status: SaveBadgeStatus; lastSaveConfirmedAt: number; lastSavedAt: string; detail: string; onSave: () => void }) {
  const time = useMemo(() => {
    const parsed = new Date(lastSavedAt);
    return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleTimeString("es-ES", { hour12: false });
  }, [lastSavedAt]);
  // The clock lives in state so the age check stays pure during render.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const { label, tone } = saveBadgePresentation(status, lastSaveConfirmedAt, now);
  return <button type="button" className={`save-badge ${tone}`} onClick={onSave} title={detail || "Guardar ahora"} aria-label={`${label}${detail ? `. ${detail}` : ""}. Guardar ahora`}>
    <span className="save-badge-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="m7.5 12.4 3 3 6-6.4" /></svg>
    </span>
    <strong>{label}</strong>
    <small>{time}</small>
  </button>;
}


function FinancePanel() {
  const game = useMarketStore((state) => state.game)!; const country = COUNTRIES[game.countryCode]; const f = game.finances;
  const rows = [{ label: "Ingresos netos de ventas", value: f.grossRevenueMinor, positive: true }, { label: "Coste de mercancía", value: -f.costOfGoodsMinor }, { label: "Nóminas y cargas", value: -f.payrollMinor }, { label: "Alquiler, energía y operación", value: -f.operatingCostsMinor }, { label: "Impuesto sobre beneficio provisionado", value: -f.taxesMinor }];
  return <div className="finance-layout"><div className="finance-summary"><small>RESULTADO ACUMULADO</small><strong className={f.netProfitMinor >= 0 ? "positive" : "negative"}>{formatMoney(f.netProfitMinor, game)}</strong><p>Caja disponible: {formatMoney(game.balanceMinor, game)}</p></div><div className="ledger-table">{rows.map((row) => <div key={row.label}><span>{row.label}</span><b className={row.positive ? "positive" : ""}>{formatMoney(row.value, game)}</b></div>)}</div><div className="tax-card"><span>{flag(country.code)}</span><div><strong>{isCampaignGame(game) ? "Economía de campaña" : `Régimen simulado: ${country.name}`}</strong><p>{isCampaignGame(game) ? "Precios finales, personal de pago único y licencia permanente. Sin bonos ni cargos diarios. La mercancía, las compras y las mejoras sí cuestan dinero." : `Renta corporativa ${Math.round(country.corporateTaxRate * 1000) / 10}% · impuesto de ventas ${Math.round(country.salesTaxRate * 1000) / 10}% · carga laboral aproximada ${Math.round(country.payrollBurdenRate * 1000) / 10}%.`}</p><small>Modelo educativo simplificado. No constituye asesoría fiscal ni reproduce todas las reglas, deducciones o tributos locales.</small></div></div></div>;
}

function flag(code: CountryCode) { return ({ ES: "🇪🇸", US: "🇺🇸", CO: "🇨🇴", MX: "🇲🇽", AR: "🇦🇷", CL: "🇨🇱", PE: "🇵🇪" })[code]; }
