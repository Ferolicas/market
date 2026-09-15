import { COUNTRIES } from "../catalog";
import type { CountryCode } from "../types";
import { PRODUCT_IDS, type ProductId } from "../economy/ProductRegistry";

/** Opening purchase graph of the live campaign. Order and prices are the
 * owner's authored level list: index + 2 is the level each purchase grants. */
export const MART_CAMPAIGN_VERSION = 1 as const;
export type OpeningPurchaseId =
  | "farmer-1" | "egg-display-1" | "chicken-1" | "player-2"
  | "tomato-2" | "farmer-2" | "expansion-1" | "chicken-1-tier-3"
  | "tomato-3" | "chicken-1-tier-2" | "farmer-3" | "wheat-1"
  | "chicken-2" | "flour-mill-1" | "bread-oven-1" | "dairy-display-1"
  | "cow-1" | "cow-1-tier-2" | "cow-1-tier-3" | "cheese-maker-1"
  | "apple-1" | "corn-1" | "coffee-supply-1" | "orange-1" | "juice-machine-1" | "preserves-supply-1" | "corn-canner-1";

interface OpeningPurchase {
  id: OpeningPurchaseId;
  label: string;
  requires: readonly OpeningPurchaseId[];
  /** Authored price in Spanish minor units; other countries scale it. */
  baseCostMinor: number;
}

/** Level order authored by the owner: one purchase per level from 2 to 28.
 * The dependency graph follows that same spine, so the cheapest available
 * purchase is always the next level. Prices are final amounts, not ratios. */
export const OPENING_PURCHASES: readonly OpeningPurchase[] = [
  { id: "farmer-1", label: "Primer granjero-reponedor", requires: [], baseCostMinor: 2_000 },
  { id: "egg-display-1", label: "Estante de huevos", requires: ["farmer-1"], baseCostMinor: 2_500 },
  { id: "chicken-1", label: "Primera gallina", requires: ["egg-display-1"], baseCostMinor: 2_000 },
  { id: "player-2", label: "Carga 4 y velocidad +3 %", requires: ["chicken-1"], baseCostMinor: 2_500 },
  { id: "tomato-2", label: "Segunda planta de tomate", requires: ["chicken-1"], baseCostMinor: 5_000 },
  { id: "farmer-2", label: "Segundo granjero-reponedor", requires: ["tomato-2"], baseCostMinor: 9_000 },
  { id: "expansion-1", label: "Ampliación: cereales y segunda granja", requires: ["farmer-2"], baseCostMinor: 40_000 },
  { id: "chicken-1-tier-3", label: "Gallina: comedero de seis tomates", requires: ["chicken-1", "expansion-1"], baseCostMinor: 5_000 },
  { id: "tomato-3", label: "Tercera planta de tomate", requires: ["tomato-2", "expansion-1"], baseCostMinor: 9_000 },
  { id: "chicken-1-tier-2", label: "Gallina: un huevo por segundo", requires: ["chicken-1-tier-3"], baseCostMinor: 9_000 },
  { id: "farmer-3", label: "Tercer granjero-reponedor", requires: ["expansion-1"], baseCostMinor: 12_000 },
  { id: "wheat-1", label: "Primer bancal de trigo", requires: ["expansion-1"], baseCostMinor: 10_000 },
  { id: "chicken-2", label: "Segunda gallina", requires: ["expansion-1"], baseCostMinor: 10_000 },
  { id: "flour-mill-1", label: "Molino y venta de harina", requires: ["wheat-1"], baseCostMinor: 20_000 },
  { id: "bread-oven-1", label: "Horno y venta de pan", requires: ["flour-mill-1"], baseCostMinor: 50_000 },
  { id: "dairy-display-1", label: "Departamento de lácteos", requires: ["bread-oven-1"], baseCostMinor: 70_000 },
  { id: "cow-1", label: "Primera vaca", requires: ["dairy-display-1", "wheat-1"], baseCostMinor: 100_000 },
  { id: "cow-1-tier-2", label: "Vaca: producción mejorada", requires: ["cow-1"], baseCostMinor: 120_000 },
  { id: "cow-1-tier-3", label: "Vaca: comedero ampliado", requires: ["cow-1-tier-2"], baseCostMinor: 150_000 },
  { id: "cheese-maker-1", label: "Quesería", requires: ["cow-1"], baseCostMinor: 160_000 },
  { id: "apple-1", label: "Manzano y venta de manzanas", requires: ["expansion-1"], baseCostMinor: 30_000 },
  { id: "corn-1", label: "Maizal y venta de maíz", requires: ["wheat-1"], baseCostMinor: 60_000 },
  { id: "coffee-supply-1", label: "Suministro de café y góndolas", requires: ["bread-oven-1"], baseCostMinor: 70_000 },
  { id: "orange-1", label: "Naranjo y venta de naranjas", requires: ["apple-1"], baseCostMinor: 90_000 },
  { id: "juice-machine-1", label: "Exprimidora y venta de zumos", requires: ["orange-1"], baseCostMinor: 200_000 },
  { id: "preserves-supply-1", label: "Conservas: expositor y suministro", requires: ["corn-1", "coffee-supply-1"], baseCostMinor: 120_000 },
  { id: "corn-canner-1", label: "Enlatadora de maíz", requires: ["preserves-supply-1"], baseCostMinor: 180_000 },
];

/** Purchase that grants the level reached once it is completed. */
export const OPENING_PURCHASE_LEVEL = new Map<OpeningPurchaseId, number>(
  OPENING_PURCHASES.map((purchase, index) => [purchase.id, index + 2]),
);

/** Exhaustive by type: adding a catalog product requires an explicit purchase path. */
export const CAMPAIGN_PRODUCT_REQUIREMENTS = {
  tomatoes: [], eggs: ["egg-display-1", "chicken-1"],
  wheat: ["wheat-1"], flour: ["flour-mill-1"], bread: ["bread-oven-1"],
  apples: ["apple-1"], corn: ["corn-1"], coffee: ["coffee-supply-1"],
  milk: ["dairy-display-1", "cow-1"], cheese: ["cheese-maker-1"],
  oranges: ["orange-1"], juice: ["juice-machine-1"],
  cannedCorn: ["preserves-supply-1"],
} as const satisfies Record<ProductId, readonly OpeningPurchaseId[]>;

export function campaignAvailableProducts(state: Pick<OpeningCampaignState, "purchased">): ProductId[] {
  return PRODUCT_IDS.filter((product) => CAMPAIGN_PRODUCT_REQUIREMENTS[product].every((purchase) => state.purchased.includes(purchase)));
}

export interface OpeningCampaignState {
  version: typeof MART_CAMPAIGN_VERSION;
  walletMinor: number;
  registerMinor: number;
  earnedMinor: number;
  collectedMinor: number;
  investedMinor: number;
  contributions: Partial<Record<OpeningPurchaseId, number>>;
  purchased: OpeningPurchaseId[];
}

export function createOpeningCampaign(): OpeningCampaignState {
  return { version: MART_CAMPAIGN_VERSION, walletMinor: 0, registerMinor: 0,
    earnedMinor: 0, collectedMinor: 0, investedMinor: 0,
    contributions: {}, purchased: [] };
}

function nonnegativeInteger(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function openingPurchaseCost(id: OpeningPurchaseId, country: CountryCode): number | null {
  const definition = OPENING_PURCHASES.find((purchase) => purchase.id === id);
  if (!definition) return null;
  const scale = COUNTRIES[country].startingCapitalMinor / COUNTRIES.ES.startingCapitalMinor;
  return Math.round(definition.baseCostMinor * scale);
}

export function openingPurchaseQuote(state: OpeningCampaignState, id: OpeningPurchaseId, country: CountryCode) {
  const definition = OPENING_PURCHASES.find((purchase) => purchase.id === id)!;
  const costMinor = openingPurchaseCost(id, country);
  const completed = state.purchased.includes(id);
  const available = !completed && costMinor !== null && definition.requires.every((required) => state.purchased.includes(required));
  const contributedMinor = state.contributions[id] ?? 0;
  return { ...definition, available, completed, costMinor, contributedMinor,
    remainingMinor: costMinor === null ? null : Math.max(0, costMinor - contributedMinor) };
}

/** A confirmed checkout credits the till, never the player's wallet.
 * Caller must invoke once inside the paymentCommitted domain transition. */
export function creditOpeningRegister(state: OpeningCampaignState, amountMinor: number): OpeningCampaignState {
  if (!nonnegativeInteger(amountMinor) || amountMinor === 0
    || !Number.isSafeInteger(state.earnedMinor + amountMinor)
    || !Number.isSafeInteger(state.registerMinor + amountMinor)) return state;
  return { ...state, registerMinor: state.registerMinor + amountMinor, earnedMinor: state.earnedMinor + amountMinor };
}

/** One proximity pulse transfers real money; animation only presents the delta. */
export function collectOpeningRegister(state: OpeningCampaignState, amountMinor = state.registerMinor): OpeningCampaignState {
  if (!nonnegativeInteger(amountMinor)) return state;
  const moved = Math.min(state.registerMinor, amountMinor);
  if (!moved || !Number.isSafeInteger(state.walletMinor + moved)
    || !Number.isSafeInteger(state.collectedMinor + moved)) return state;
  return { ...state, registerMinor: state.registerMinor - moved,
    walletMinor: state.walletMinor + moved, collectedMinor: state.collectedMinor + moved };
}

export function fundOpeningPurchase(state: OpeningCampaignState, id: OpeningPurchaseId, country: CountryCode, amountMinor: number) {
  const quote = openingPurchaseQuote(state, id, country);
  if (!quote.available || quote.remainingMinor === null || !nonnegativeInteger(amountMinor)) return state;
  const moved = Math.min(state.walletMinor, amountMinor, quote.remainingMinor);
  if (moved <= 0) return state;
  const total = quote.contributedMinor + moved;
  return { ...state, walletMinor: state.walletMinor - moved, investedMinor: state.investedMinor + moved,
    contributions: { ...state.contributions, [id]: total },
    purchased: total === quote.costMinor ? [...state.purchased, id] : [...state.purchased] };
}

export function openingEconomyIsConserved(state: OpeningCampaignState) {
  return [state.walletMinor, state.registerMinor, state.earnedMinor, state.collectedMinor, state.investedMinor].every(nonnegativeInteger)
    && state.earnedMinor === state.registerMinor + state.collectedMinor
    && state.collectedMinor === state.walletMinor + state.investedMinor
    && state.investedMinor === Object.values(state.contributions).reduce((sum, value) => sum + value, 0);
}

export function openingPlayerStats(state: OpeningCampaignState) {
  const upgraded = state.purchased.includes("player-2");
  return { capacity: upgraded ? 4 : 3, maximumSpeedRatio: upgraded ? 0.7 * 1.03 : 0.7 };
}

export const OPENING_FARMER_STATS = {
  capacity: 3,
  maximumPlayerSpeedRatio: 0.7 * 0.7,
  harvests: true,
  stocksShelves: true,
  collectsEggs: true,
  feedsAnimals: false,
} as const;

/** Dependencies, not historical XP, control demand and expansion access. */
export function openingAvailability(state: OpeningCampaignState) {
  return {
    customerLimit: 2,
    products: campaignAvailableProducts(state).sort((a, b) => a === "tomatoes" ? -1 : b === "tomatoes" ? 1 : 0),
    tomatoYield: 8,
    tomatoSaleMinor: 100,
    eggSaleMinor: 200,
    expansionAvailable: state.purchased.includes("farmer-1"),
  };
}
