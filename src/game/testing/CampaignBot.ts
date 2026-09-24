import { advanceWorld, applyGameAction, canOperateMachine, canProcessCheckoutUnit, shelfCapacityForTier, type WorldPathfinder } from "../engine";
import { PRODUCT_CONFIG } from "../economy/products";
import type { ProductId } from "../economy/ProductRegistry";
import { carryTotal } from "../player/CarrySystem";
import { businessDayIsClosing } from "../time/BusinessDay";
import type { FranchiseState, GameState, WorldInteractionAction } from "../types";
import { campaignAvailableProducts } from "../progression/MartCampaign";
import { campaignLevel } from "../progression/CampaignLevels";
import { campaignContracts } from "../progression/CampaignContracts";
import { campaignNextStep, taskProduct } from "../progression/LevelCatalog";
import { CAMPAIGN_TASK_IDS, campaignTaskStatus } from "../progression/CampaignTasks";
import { CHECKOUT_LANE_IDS } from "../stations/checkout-layout";
import { FRANCHISE_TEMPLATES } from "../catalog";

/**
 * Headless owner: plays the campaign through the same `advanceWorld`
 * interactions the scene dispatches, one tick at a time, without a browser.
 * It exists to prove the content is traversable (every level reachable with
 * the real economy), to feed determinism checks with a long realistic command
 * stream, and to load rooms with synthetic players. It is not a benchmark of
 * human play: it acts on every tick it may, so its day counts are a floor.
 */
export interface CampaignBotOptions {
  targetLevel?: number;
  /** Stores to finish, in the authored order; the bot buys and travels to the
   * next one once the current store reaches `targetLevel`. */
  targetStores?: number;
  maxTicks?: number;
  tickMs?: number;
  /** Actions the bot may issue in one tick; a human issues about one per second. */
  maxActionsPerTick?: number;
  pathfinder?: WorldPathfinder;
  onTick?: (state: GameState, tick: number) => void;
}

export interface CampaignBotRun {
  state: GameState;
  ticks: number;
  days: number;
  level: number;
  /** Stores that reached the target level, in order. */
  finishedStores: string[];
  /** Tick and day at which each level of each store was first reached. */
  reached: Record<string, Record<number, { tick: number; day: number }>>;
  /** Interactions issued, in order: the command stream of the run. */
  commands: { tick: number; actions: WorldInteractionAction[] }[];
}

function currentFranchise(state: GameState): FranchiseState {
  return state.franchises.find((item) => item.id === state.currentFranchiseId) ?? state.franchises[0];
}

function shelfRoom(franchise: FranchiseState, product: ProductId) {
  const tier = franchise.stationTiers["shelves-1"] ?? franchise.shelvesLevel;
  return Math.max(0, shelfCapacityForTier(tier, product, franchise.unlockedAreas) - (franchise.shelves[product] ?? 0));
}

function machineInputs(franchise: FranchiseState) {
  const inputs = new Map<ProductId, string[]>();
  for (const machine of franchise.productionMachines) {
    if (machine.status === "LOCKED") continue;
    const config = PRODUCT_CONFIG[machine.productId];
    for (const ingredient of Object.keys(config?.recipe ?? {}) as ProductId[]) inputs.set(ingredient, [...(inputs.get(ingredient) ?? []), machine.id]);
  }
  return inputs;
}

/** Products the personal work still asks the owner to touch, most urgent first. */
function pendingTaskProducts(franchise: FranchiseState): ProductId[] {
  if (!franchise.purchases) return [];
  return CAMPAIGN_TASK_IDS
    .map((id) => ({ id, status: campaignTaskStatus(id, franchise.purchases!.personalProgress, franchise.id) }))
    .filter(({ status }) => !status.completed)
    .map(({ id }) => taskProduct(id));
}

/** Interactions for one tick, judged from the state alone. Order matters:
 * empty the basket into the shop first, then fill it again. */
export function planBotInteractions(state: GameState, maxActions = 4): WorldInteractionAction[] {
  const franchise = currentFranchise(state);
  const actions: WorldInteractionAction[] = [];
  const push = (action: WorldInteractionAction) => { if (actions.length < maxActions) actions.push(action); };
  const available = franchise.purchases ? campaignAvailableProducts(franchise.purchases) : [];
  const urgent = pendingTaskProducts(franchise);
  const contractNeeds = new Set(campaignContracts(franchise).filter((contract) => !contract.completed && contract.unlocked && contract.previousDone).flatMap((contract) => contract.products));
  const inputs = machineInputs(franchise);
  const carried = (Object.entries(franchise.carry.items) as [ProductId, number][]).filter(([, quantity]) => quantity > 0);

  for (const lane of CHECKOUT_LANE_IDS) if ((franchise.registerCashMinor?.[lane] ?? 0) > 0) push({ type: "COLLECT_REGISTER", lane });

  const next = campaignNextStep(state, franchise);
  if (next?.purchaseId && next.step.startsWith("Paga") && state.balanceMinor > 0) push({ type: "CONTRIBUTE_PURCHASE", purchaseId: next.purchaseId, amountMinor: state.balanceMinor });

  if (!franchise.employees.some((employee) => employee.role === "cashier") && canProcessCheckoutUnit(state, franchise)) push({ type: "CHECKOUT", paymentMethod: "cash" });

  // Basket out: shelves first, then machines that take the ingredient, keeping
  // one unit of each contract product in hand, else back to the warehouse.
  for (const [product, quantity] of carried) {
    const keep = contractNeeds.has(product) ? 1 : 0;
    const spare = quantity - keep;
    if (spare <= 0) continue;
    if (available.includes(product) && shelfRoom(franchise, product) > 0) { push({ type: "STOCK", productId: product, quantity: spare, source: "carry" }); continue; }
    const machine = (inputs.get(product) ?? []).find((id) => canOperateMachine(franchise, id, state.simulationTimeMs));
    if (machine) { push({ type: "OPERATE_MACHINE", machineId: machine }); continue; }
    if (keep === 0) push({ type: "RETURN_TO_WAREHOUSE" });
  }
  if (actions.length >= maxActions) return actions;

  const room = franchise.carry.capacity - carryTotal(franchise.carry);
  if (room <= 0) return actions;
  // Basket in: finished goods waiting in a machine, ripe crops (personal work
  // first, then the emptiest shelf), then whatever the warehouse holds for an
  // empty shelf.
  for (const machine of franchise.productionMachines) {
    if (machine.status !== "LOCKED" && machine.output > 0 && canOperateMachine(franchise, machine.id, state.simulationTimeMs)) push({ type: "OPERATE_MACHINE", machineId: machine.id });
  }
  const ripe = franchise.crops.filter((crop) => crop.status === "READY" && crop.available > 0);
  const wanted = (product: ProductId) => (urgent.includes(product) ? 0 : 1) * 1_000 + (available.includes(product) ? -shelfRoom(franchise, product) : inputs.has(product) ? 0 : 500);
  ripe.sort((a, b) => wanted(a.productId) - wanted(b.productId));
  for (const crop of ripe) {
    if (!available.includes(crop.productId) && !inputs.has(crop.productId) && !contractNeeds.has(crop.productId)) continue;
    push({ type: "HARVEST", cropId: crop.id, productId: crop.productId, quantity: room });
  }
  for (const product of available) {
    if ((franchise.warehouse[product] ?? 0) > 0 && shelfRoom(franchise, product) > 0) push({ type: "PICKUP_WAREHOUSE", productId: product, quantity: room });
  }
  return actions;
}

export function runCampaignBot(initial: GameState, options: CampaignBotOptions = {}): CampaignBotRun {
  const targetLevel = options.targetLevel ?? 30;
  const maxTicks = options.maxTicks ?? 100_000;
  const tickMs = options.tickMs ?? 1_000;
  const targetStores = options.targetStores ?? 1;
  let state = initial;
  const reached: CampaignBotRun["reached"] = {};
  const commands: CampaignBotRun["commands"] = [];
  const finishedStores: string[] = [];
  let level = 0;
  const note = (tick: number) => {
    const franchise = currentFranchise(state);
    const store = (reached[franchise.id] ??= {});
    const current = campaignLevel(franchise);
    for (let step = 1; step <= current; step += 1) store[step] ??= { tick, day: state.day };
    level = current;
  };
  note(0);
  let tick = 0;
  for (; tick < maxTicks && finishedStores.length < targetStores; tick += 1) {
    if (level >= targetLevel) {
      const finished = currentFranchise(state);
      if (!finishedStores.includes(finished.id)) finishedStores.push(finished.id);
      if (finishedStores.length >= targetStores) break;
      // Move on: the next store opens with the money the finished one earned.
      const nextTemplate = FRANCHISE_TEMPLATES[FRANCHISE_TEMPLATES.findIndex((item) => item.id === finished.id) + 1];
      const next = nextTemplate && state.franchises.find((item) => item.id === nextTemplate.id);
      if (!next) break;
      if (!next.owned) {
        const bought = applyGameAction(state, { type: "BUY_FRANCHISE", franchiseId: next.id });
        if (bought.ok) state = bought.state;
      }
      if (next.owned || state.franchises.find((item) => item.id === next.id)?.owned) {
        const travelled = applyGameAction(state, { type: "TRAVEL", franchiseId: next.id });
        if (travelled.ok) { state = travelled.state; note(tick); }
      }
    }
    const franchise = currentFranchise(state);
    if (!franchise.open && !businessDayIsClosing(state.minuteOfDay)) {
      const opened = applyGameAction(state, { type: "TOGGLE_STORE" });
      if (opened.ok) state = opened.state;
    }
    for (const contract of campaignContracts(currentFranchise(state))) {
      if (!contract.ready) continue;
      const delivered = applyGameAction(state, { type: "DELIVER_CONTRACT", contractId: contract.id });
      if (delivered.ok) state = delivered.state;
    }
    const interactions = planBotInteractions(state, options.maxActionsPerTick ?? 4);
    if (interactions.length) commands.push({ tick, actions: interactions });
    state = advanceWorld(state, tickMs, options.pathfinder, { interactions, playerDistanceMeters: interactions.length ? 2 : 0 }).state;
    note(tick + 1);
    options.onTick?.(state, tick + 1);
  }
  if (level >= targetLevel && !finishedStores.includes(currentFranchise(state).id)) finishedStores.push(currentFranchise(state).id);
  return { state, ticks: tick, days: state.day, level, finishedStores, reached, commands };
}
