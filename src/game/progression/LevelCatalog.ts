import { COUNTRIES, FRANCHISE_TEMPLATES, PRODUCTS } from "../catalog";
import { PRODUCT_IDS, type ProductId } from "../economy/ProductRegistry";
import type { CountryCode, EmployeeRole, FranchiseState, GameState } from "../types";
import { CAMPAIGN_PRODUCT_REQUIREMENTS, OPENING_PURCHASES, campaignAvailableProducts, type OpeningPurchaseId } from "./MartCampaign";
import { CAMPAIGN_STAFF_PURCHASES, CASHIER_UNLOCK_LEVELS, campaignCashierSlots, campaignLevel } from "./CampaignLevels";
import { CAMPAIGN_TASK_IDS, PURCHASE_TASK_REQUIREMENTS, campaignTaskStatus, type CampaignTaskId } from "./CampaignTasks";
import { campaignBasketUnits, campaignCustomerLimit } from "./CampaignLocations";
import { campaignContracts } from "./CampaignContracts";
import { campaignExpansionQuote } from "./CampaignExpansion";
import { purchaseQuote } from "./PurchaseState";

/** The pattern a level asks the owner to master. One per level: a level that
 * would teach two things at once is a design error the catalog test catches. */
export type LevelPattern = "harvest" | "stock" | "sell" | "delegate" | "feed" | "operate" | "display" | "expand" | "carry" | "mastery" | "contracts" | "settle";

const PURCHASE_PATTERNS: Record<OpeningPurchaseId, LevelPattern> = {
  "farmer-1": "delegate", "egg-display-1": "display", "chicken-1": "feed", "player-2": "carry",
  "tomato-2": "harvest", "farmer-2": "delegate", "expansion-1": "expand", "chicken-1-tier-3": "feed",
  "tomato-3": "harvest", "chicken-1-tier-2": "feed", "farmer-3": "delegate", "wheat-1": "harvest",
  "chicken-2": "feed", "flour-mill-1": "operate", "bread-oven-1": "operate", "dairy-display-1": "display",
  "cow-1": "feed", "cow-1-tier-2": "feed", "cow-1-tier-3": "feed", "cheese-maker-1": "operate",
  "apple-1": "harvest", "corn-1": "harvest", "coffee-supply-1": "harvest", "orange-1": "harvest",
  "juice-machine-1": "operate", "preserves-supply-1": "display", "corn-canner-1": "operate",
};

export type LevelExam =
  | { kind: "purchase"; purchaseId: OpeningPurchaseId; tasks: readonly CampaignTaskId[] }
  | { kind: "tasks"; tasks: readonly CampaignTaskId[] }
  | { kind: "contracts" }
  | { kind: "expansion" };

export interface LevelEntry {
  level: number;
  title: string;
  /** What reaching this level was granted by. */
  grantedBy: OpeningPurchaseId | "start" | "personal-tasks" | "contracts";
  teaches: LevelPattern;
  /** What the level opens, along the authored purchase order. */
  unlocks: {
    products: ProductId[];
    staff: EmployeeRole[];
    cashierSlots: number;
    customerLimit: number;
    basketUnits: number;
  };
  /** What closes this level and grants the next one. */
  exam: LevelExam;
}

export const CAMPAIGN_LEVEL_COUNT = 30;

function productsAvailableAfter(purchases: readonly OpeningPurchaseId[]): ProductId[] {
  return PRODUCT_IDS.filter((product) => CAMPAIGN_PRODUCT_REQUIREMENTS[product].every((id) => purchases.includes(id)));
}

function staffBroughtBy(purchaseId: OpeningPurchaseId): EmployeeRole[] {
  return (Object.entries(CAMPAIGN_STAFF_PURCHASES) as [EmployeeRole, readonly string[]][])
    .filter(([, purchases]) => purchases.includes(purchaseId))
    .map(([role]) => role);
}

function buildCatalog(): LevelEntry[] {
  const entries: LevelEntry[] = [];
  const tasksBefore: CampaignTaskId[] = [];
  entries.push({
    level: 1, title: "Tomates, expositor y caja", grantedBy: "start", teaches: "sell",
    unlocks: { products: productsAvailableAfter([]), staff: [], cashierSlots: 0, customerLimit: campaignCustomerLimit(1), basketUnits: campaignBasketUnits(1).base },
    exam: { kind: "purchase", purchaseId: OPENING_PURCHASES[0].id, tasks: PURCHASE_TASK_REQUIREMENTS[OPENING_PURCHASES[0].id] ?? [] },
  });
  OPENING_PURCHASES.forEach((purchase, index) => {
    const level = index + 2;
    const owned = OPENING_PURCHASES.slice(0, index + 1).map((item) => item.id);
    const before = productsAvailableAfter(owned.slice(0, -1));
    const next = OPENING_PURCHASES[index + 1];
    const cashierSlotsBefore = campaignCashierSlots(level - 1);
    const cashierSlots = campaignCashierSlots(level) - cashierSlotsBefore;
    tasksBefore.push(...(PURCHASE_TASK_REQUIREMENTS[purchase.id] ?? []));
    entries.push({
      level, title: purchase.label, grantedBy: purchase.id, teaches: PURCHASE_PATTERNS[purchase.id],
      unlocks: {
        products: productsAvailableAfter(owned).filter((product) => !before.includes(product)),
        staff: [...staffBroughtBy(purchase.id), ...(cashierSlots > 0 ? ["cashier" as const] : [])],
        cashierSlots,
        customerLimit: campaignCustomerLimit(level),
        basketUnits: campaignBasketUnits(level).base,
      },
      exam: next
        ? { kind: "purchase", purchaseId: next.id, tasks: PURCHASE_TASK_REQUIREMENTS[next.id] ?? [] }
        : { kind: "tasks", tasks: CAMPAIGN_TASK_IDS.filter((id) => !tasksBefore.includes(id)) },
    });
  });
  entries.push({
    level: 29, title: "Maestría personal", grantedBy: "personal-tasks", teaches: "mastery",
    unlocks: { products: [], staff: [], cashierSlots: 0, customerLimit: campaignCustomerLimit(29), basketUnits: campaignBasketUnits(29).base },
    exam: { kind: "contracts" },
  });
  entries.push({
    level: 30, title: "Encargos entregados", grantedBy: "contracts", teaches: "settle",
    unlocks: { products: [], staff: [], cashierSlots: 0, customerLimit: campaignCustomerLimit(30), basketUnits: campaignBasketUnits(30).base },
    exam: { kind: "expansion" },
  });
  return entries;
}

/** Thirty levels, one entry each, derived from the authored purchase order,
 * personal tasks, contracts and cashier rewards. Nothing here is a second
 * source of truth: change `MartCampaign.ts` or `CampaignTasks.ts` and the
 * catalog follows. */
export const LEVEL_CATALOG: readonly LevelEntry[] = buildCatalog();

export function levelEntry(level: number): LevelEntry {
  const index = Math.max(1, Math.min(CAMPAIGN_LEVEL_COUNT, Math.floor(Number.isFinite(level) ? level : 1))) - 1;
  return LEVEL_CATALOG[index];
}

/** Transitive prerequisites of a purchase along `requires`. */
export function purchasePrerequisites(id: OpeningPurchaseId): OpeningPurchaseId[] {
  const seen = new Set<OpeningPurchaseId>();
  const visit = (current: OpeningPurchaseId) => {
    for (const required of OPENING_PURCHASES.find((item) => item.id === current)!.requires) {
      if (!seen.has(required)) { seen.add(required); visit(required); }
    }
  };
  visit(id);
  return [...seen];
}

/** Product a personal task works with (feeding counts for what the animal gives). */
export function taskProduct(id: CampaignTaskId): ProductId {
  return id === "player:feed:chicken" ? "eggs" : id === "player:feed:cow" ? "milk" : id.split(":").at(-1) as ProductId;
}

export interface CampaignNextStep {
  level: number;
  /** What the current level is working towards. */
  goal: string;
  /** The single next thing the owner should do. */
  step: string;
  purchaseId?: OpeningPurchaseId;
}

function formatMinor(amountMinor: number, countryCode: CountryCode) {
  const country = COUNTRIES[countryCode];
  return new Intl.NumberFormat(country.locale, { style: "currency", currency: country.currency, maximumFractionDigits: 0 }).format(amountMinor / 100);
}

/** Goal and next step for the visited store: what the HUD shows when the
 * owner comes back, so the game remembers for the player (§10.1). Returns
 * `null` for legacy saves without the purchase campaign. */
export function campaignNextStep(state: GameState, franchise: FranchiseState = state.franchises.find((item) => item.id === state.currentFranchiseId) ?? state.franchises[0]): CampaignNextStep | null {
  const purchases = franchise.purchases;
  if (!purchases || !franchise.owned) return null;
  const level = campaignLevel(franchise);
  const registerMinor = (franchise.registerCashMinor ?? []).reduce((sum, lane) => sum + lane, 0);
  if (level <= 28 && purchases.purchased.length < OPENING_PURCHASES.length) {
    // The authored order is the canonical path: the first unbought purchase
    // whose prerequisites are met is the next level.
    const definition = OPENING_PURCHASES.find((item) => !purchases.purchased.includes(item.id) && item.requires.every((required) => purchases.purchased.includes(required)))!;
    const quote = purchaseQuote(purchases, definition.id, state.countryCode);
    const goal = `Nivel ${level + 1}: ${definition.label}`;
    const pending = quote.tasks.find((task) => !task.completed);
    if (pending) return { level, goal, step: `${pending.label} (${pending.progress}/${pending.target})`, purchaseId: definition.id };
    const remaining = quote.remainingMinor ?? 0;
    if (state.balanceMinor >= remaining) return { level, goal, step: `Paga ${formatMinor(remaining, state.countryCode)} en el recuadro de la compra`, purchaseId: definition.id };
    if (registerMinor > 0) return { level, goal, step: `Recoge ${formatMinor(registerMinor, state.countryCode)} de la caja`, purchaseId: definition.id };
    const available = campaignAvailableProducts(purchases);
    const emptyShelf = available.find((product) => (franchise.shelves[product] ?? 0) === 0);
    if (emptyShelf) return { level, goal, step: `Surte ${productName(emptyShelf)} y vende para reunir ${formatMinor(remaining - state.balanceMinor, state.countryCode)}`, purchaseId: definition.id };
    return { level, goal, step: `Vende para reunir ${formatMinor(remaining - state.balanceMinor, state.countryCode)} más`, purchaseId: definition.id };
  }
  if (level === 28) {
    const pending = CAMPAIGN_TASK_IDS.map((id) => campaignTaskStatus(id, purchases.personalProgress, franchise.id)).find((task) => !task.completed)!;
    return { level, goal: "Nivel 29: maestría personal", step: `${pending.label} (${pending.progress}/${pending.target})` };
  }
  if (level === 29) {
    const contract = campaignContracts(franchise).find((item) => !item.completed)!;
    const missing = contract.products.filter((product) => (franchise.carry.items[product] ?? 0) < 1);
    return { level, goal: "Nivel 30: encargos personales", step: contract.ready ? `Entrega «${contract.label}» en Pedidos` : `Reúne en tu cesta ${missing.map(productName).join(", ")} para «${contract.label}»` };
  }
  const index = FRANCHISE_TEMPLATES.findIndex((item) => item.id === franchise.id);
  const nextTemplate = FRANCHISE_TEMPLATES[index + 1];
  if (!nextTemplate) return { level, goal: "Campaña completada", step: "Has dominado los seis locales" };
  const owned = state.franchises.find((item) => item.id === nextTemplate.id)?.owned;
  if (owned) return { level, goal: `${nextTemplate.name} ya abierto`, step: `Viaja a ${nextTemplate.name} desde Franquicias` };
  const expansion = campaignExpansionQuote(state, nextTemplate.id);
  return { level, goal: `Abre ${nextTemplate.name}`, step: expansion.available ? `Paga ${formatMinor(expansion.costMinor, state.countryCode)} en Franquicias` : expansion.reason };
}

function productName(product: ProductId) {
  return PRODUCTS[product].name.toLowerCase();
}

export { CASHIER_UNLOCK_LEVELS };
