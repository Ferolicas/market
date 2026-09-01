import { PRODUCT_CONFIG } from "../economy/products";
import type { FranchiseState, GameState, ProductId } from "../types";
import { stationTierModifiers } from "./levels";

export type LevelObjectiveTaskUnit = "count" | "percent" | "distance" | "rating";

export interface LevelObjectiveTask {
  id: string;
  label: string;
  progress: number;
  target: number;
  unit: LevelObjectiveTaskUnit;
}

const CUSTOMER_PRODUCT_UNLOCKS: readonly (readonly [ProductId, number])[] = [
  ["tomatoes", 1],
  ["apples", 2],
  ["bread", 6],
  ["eggs", 8],
  ["coffee", 9],
  ["corn", 11],
  ["milk", 13],
  ["cheese", 16],
  ["juice", 21],
];

export function unlockedCustomerProducts(level: number): ProductId[] {
  const normalizedLevel = Math.max(1, Math.floor(Number.isFinite(level) ? level : 1));
  return CUSTOMER_PRODUCT_UNLOCKS
    .filter(([, unlockLevel]) => normalizedLevel >= unlockLevel)
    .map(([productId]) => productId);
}

export function averageShelfAvailability(franchise: FranchiseState) {
  const unlocked = unlockedCustomerProducts(Math.max(1, franchise.storeRank * 10));
  return unlocked.reduce((sum, productId) => sum + shelfFill(franchise, productId), 0) / Math.max(1, unlocked.length);
}

export function levelObjectiveTasks(level: number, state: GameState): LevelObjectiveTask[] {
  const franchise = currentFranchise(state);
  switch (level) {
    case 1:
      return [
        countTask("harvest:tomatoes", "Cosecha 3 tomates", counter(state, "harvest:tomatoes"), 3),
        countTask("stock:tomatoes", "Surte 3 tomates", counter(state, "stock:tomatoes"), 3),
        countTask("customers", "Atiende 1 cliente", counter(state, "customers"), 1),
      ];
    case 2:
      return [countTask("level:1", "Completa el tutorial inicial", state.progression.completedLevels.includes(1) ? 1 : 0, 1)];
    case 3:
      return [countTask("customers", "Atiende 4 clientes", counter(state, "customers"), 4)];
    case 4:
      return [countTask("stock:all", "Surte 12 productos", counter(state, "stock:all"), 12)];
    case 5:
      return [countTask("harvest:wheat", "Cosecha 6 trigos", counter(state, "harvest:wheat"), 6)];
    case 6:
      return [countTask("sales:bread", "Vende 4 panes", counter(state, "sales:bread"), 4)];
    case 7:
      return [countTask("customers", "Atiende 12 clientes", counter(state, "customers"), 12)];
    case 8:
      return [countTask("sales:eggs", "Vende 8 huevos", counter(state, "sales:eggs"), 8)];
    case 9:
      return [{ id: "shelves:availability", label: "Mantén los estantes al 80 %", progress: averageShelfAvailability(franchise), target: 0.8, unit: "percent" }];
    case 10:
      return [countTask("sales:units", "Vende 20 productos", counter(state, "sales:units"), 20)];
    case 11:
      return [countTask("harvest:corn", "Cosecha 20 maíces", counter(state, "harvest:corn"), 20)];
    case 12:
      return [{ id: "distance:player", label: "Camina 500 m", progress: counter(state, "distance:player"), target: 500, unit: "distance" }];
    case 13:
      return [countTask("sales:milk", "Vende 12 leches", counter(state, "sales:milk"), 12)];
    case 14:
      return [countTask("customers", "Atiende 30 clientes", counter(state, "customers"), 30)];
    case 15:
      return [countTask("transport:all", "Transporta 40 productos", counter(state, "transport:all"), 40)];
    case 16:
      return [countTask("production:cheese", "Produce 10 quesos", counter(state, "production:cheese"), 10)];
    case 17:
      return [countTask("queue:under30", "Mantén una espera de caja inferior a 30 s", counter(state, "queue:under30"), 1)];
    case 18:
      return [countTask("deliveries", "Recibe 5 entregas", counter(state, "deliveries"), 5)];
    case 19:
      return [countTask("orders", "Completa 8 pedidos", counter(state, "orders"), 8)];
    case 20:
      return [countTask("customers", "Atiende 50 clientes", counter(state, "customers"), 50)];
    case 21:
      return [countTask("sales:juice", "Vende 15 zumos", counter(state, "sales:juice"), 15)];
    case 22:
      return [countTask("harvest:all", "Cosecha 60 productos", counter(state, "harvest:all"), 60)];
    case 23:
      return [{ id: "store:rating", label: "Alcanza 4,25 de valoración", progress: franchise.rating, target: 4.25, unit: "rating" }];
    case 24:
      return [countTask("stock:all", "Surte 100 productos", counter(state, "stock:all"), 100)];
    case 25:
      return [countTask("lists:five", "Completa 1 lista de 5 productos", counter(state, "lists:five"), 1)];
    case 26:
      return [countTask("production:all", "Produce 50 lotes", counter(state, "production:all"), 50)];
    case 27:
      return [countTask("sales:units", "Vende 150 productos", counter(state, "sales:units"), 150)];
    case 28: {
      const stationTiers = Object.values(franchise.stationTiers);
      return [countTask("stations:tier-3", "Mejora todas las estaciones al nivel 3", stationTiers.filter((tier) => tier >= 3).length, stationTiers.length)];
    }
    case 29:
      return [countTask("availability:sales", "Completa 50 ventas con disponibilidad", counter(state, "availability:sales"), 50)];
    case 30:
      return [countTask("level:max", "Nivel máximo alcanzado", 1, 1)];
    default:
      return [];
  }
}

export function levelObjectiveSatisfied(level: number, state: GameState) {
  if (!Number.isInteger(level) || level < 1 || level > 30) return false;
  return levelObjectiveTasks(level, state).every((task) => task.progress >= task.target);
}

function countTask(id: string, label: string, progress: number, target: number): LevelObjectiveTask {
  return { id, label, progress, target, unit: "count" };
}

function counter(state: GameState, id: string) {
  return state.progression.counters[id] ?? 0;
}

function currentFranchise(state: GameState) {
  return state.franchises.find((item) => item.id === state.currentFranchiseId) ?? state.franchises[0];
}

function shelfFill(franchise: FranchiseState, productId: ProductId) {
  return franchise.shelves[productId] / shelfCapacity(franchise, productId);
}

function shelfCapacity(franchise: FranchiseState, productId: ProductId) {
  const tier = franchise.stationTiers["shelves-1"] ?? franchise.shelvesLevel;
  return Math.max(1, Math.round((PRODUCT_CONFIG[productId]?.shelfCapacity ?? 12) * stationTierModifiers(tier).capacity));
}
