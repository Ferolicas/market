import type { FranchiseState, GameState, ProductId } from "../types";
import { retailShelfCapacityForTier } from "../stations/retail-layout";

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
  ["oranges", 20],
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
  const playerRequirement = PLAYER_LEVEL_TASKS[level];
  const intentionalAction: LevelObjectiveTask[] = playerRequirement
    ? [countTask(playerRequirement.id, playerRequirement.label, counter(state, playerRequirement.id), playerRequirement.target)]
    : [];
  const tasks: LevelObjectiveTask[] = (() => {
  switch (level) {
    case 1:
      return [
        countTask("player:harvest:tomatoes", "Cosecha tú 3 tomates", counter(state, "player:harvest:tomatoes"), 3),
        countTask("player:stock:tomatoes", "Surte tú 3 tomates", counter(state, "player:stock:tomatoes"), 3),
        countTask("player:action:CHECKOUT", "Atiende tú 1 cliente en caja", counter(state, "player:action:CHECKOUT"), 1),
      ];
    case 2:
      return [countTask("customers", "Atiende 2 clientes en total", counter(state, "customers"), 2)];
    case 3:
      return [countTask("customers", "Atiende 4 clientes en total", counter(state, "customers"), 4)];
    case 4:
      return [countTask("stock:all", "Surte 12 productos en total", counter(state, "stock:all"), 12)];
    case 5:
      return [countTask("harvest:wheat", "Cosecha 6 trigos en total", counter(state, "harvest:wheat"), 6)];
    case 6:
      return [countTask("sales:bread", "Vende 4 panes en total", counter(state, "sales:bread"), 4)];
    case 7:
      return [countTask("customers", "Atiende 12 clientes en total", counter(state, "customers"), 12)];
    case 8:
      return [countTask("sales:eggs", "Vende 8 huevos en total", counter(state, "sales:eggs"), 8)];
    case 9:
      return [{ id: "shelves:availability", label: "Mantén los estantes al 80 %", progress: averageShelfAvailability(franchise), target: 0.8, unit: "percent" }];
    case 10:
      return [countTask("sales:units", "Vende 20 productos en total", counter(state, "sales:units"), 20)];
    case 11:
      return [countTask("harvest:corn", "Cosecha 20 maíces en total", counter(state, "harvest:corn"), 20)];
    case 12:
      return [{ id: "distance:player", label: "Camina 500 m", progress: counter(state, "distance:player"), target: 500, unit: "distance" }];
    case 13:
      return [countTask("sales:milk", "Vende 12 leches en total", counter(state, "sales:milk"), 12)];
    case 14:
      return [countTask("customers", "Atiende 30 clientes en total", counter(state, "customers"), 30)];
    case 15:
      return [countTask("transport:all", "Transporta 40 productos en total", counter(state, "transport:all"), 40)];
    case 16:
      return [countTask("production:cheese", "Produce 10 quesos en total", counter(state, "production:cheese"), 10)];
    case 17:
      return [countTask("queue:under30", "Completa 1 venta con espera menor a 30 s", counter(state, "queue:under30"), 1)];
    case 18:
      return [countTask("deliveries", "Recibe 5 entregas en total", counter(state, "deliveries"), 5)];
    case 19:
      return [countTask("orders", "Realiza 8 pedidos en total", counter(state, "orders"), 8)];
    case 20:
      return [countTask("customers", "Atiende 50 clientes en total", counter(state, "customers"), 50)];
    case 21:
      return [countTask("sales:juice", "Vende 15 zumos en total", counter(state, "sales:juice"), 15)];
    case 22:
      return [countTask("harvest:all", "Cosecha 60 productos en total", counter(state, "harvest:all"), 60)];
    case 23:
      return [{ id: "store:rating", label: "Alcanza 4,25 de valoración", progress: franchise.rating, target: 4.25, unit: "rating" }];
    case 24:
      return [countTask("stock:all", "Surte 100 productos en total", counter(state, "stock:all"), 100)];
    case 25:
      return [countTask("lists:five", "Completa 1 compra con 5 tipos de producto", counter(state, "lists:five"), 1)];
    case 26:
      return [countTask("production:all", "Produce 50 lotes en total", counter(state, "production:all"), 50)];
    case 27:
      return [countTask("sales:units", "Vende 150 productos en total", counter(state, "sales:units"), 150)];
    case 28: {
      const stationTiers = Object.values(franchise.stationTiers);
      return [countTask("stations:tier-3", "Mejora todas las estaciones al nivel 3", stationTiers.filter((tier) => tier >= 3).length, stationTiers.length)];
    }
    case 29:
      return [countTask("availability:sales", "Completa 50 ventas con estantes al 90 %", counter(state, "availability:sales"), 50)];
    case 30:
      return [countTask("level:max", "Nivel máximo alcanzado", 1, 1)];
    default:
      return [];
  }
  })();
  return level === 1 ? tasks : [...tasks, ...intentionalAction];
}

export function levelObjectiveSatisfied(level: number, state: GameState) {
  if (!Number.isInteger(level) || level < 1 || level > 30) return false;
  return levelObjectiveTasks(level, state).every((task) => task.progress >= task.target);
}

function countTask(id: string, label: string, progress: number, target: number): LevelObjectiveTask {
  return { id, label, progress, target, unit: "count" };
}

function counter(state: GameState, id: string) {
  return Math.max(0, (state.progression.counters[id] ?? 0) - (state.progression.levelStartedCounters[id] ?? 0));
}

const PLAYER_LEVEL_TASKS: Record<number, { id: string; label: string; target: number }> = {
  2: { id: "player:harvest:apples", label: "Cosecha tú 2 manzanas", target: 2 },
  3: { id: "player:stock:all", label: "Surte tú 5 productos", target: 5 },
  4: { id: "player:pickup:warehouse", label: "Recoge tú 3 productos del almacén", target: 3 },
  5: { id: "player:harvest:wheat", label: "Cosecha tú 3 trigos", target: 3 },
  6: { id: "player:machine:bread-oven-1", label: "Opera tú el horno de pan", target: 2 },
  7: { id: "player:action:CHECKOUT", label: "Escanea tú en caja 2 veces", target: 2 },
  8: { id: "player:pickup:eggs", label: "Transporta tú 4 huevos", target: 4 },
  9: { id: "player:stock:all", label: "Corrige tú 8 huecos de estante", target: 8 },
  10: { id: "player:action:CHECKOUT", label: "Interviene tú 4 veces en caja", target: 4 },
  11: { id: "player:harvest:corn", label: "Cosecha tú 8 maíces", target: 8 },
  12: { id: "player:stock:all", label: "Repón tú 10 productos durante el recorrido", target: 10 },
  13: { id: "player:pickup:milk", label: "Transporta tú 6 leches", target: 6 },
  14: { id: "player:action:CHECKOUT", label: "Atiende tú 5 pulsos de caja", target: 5 },
  15: { id: "player:transport:all", label: "Transporta tú 12 productos", target: 12 },
  16: { id: "player:machine:cheese-maker-1", label: "Opera tú la quesera", target: 2 },
  17: { id: "player:action:CHECKOUT", label: "Refuerza tú las cajas 5 veces", target: 5 },
  18: { id: "player:orders", label: "Haz tú 2 pedidos de abastecimiento", target: 2 },
  19: { id: "player:orders", label: "Planifica tú 4 pedidos", target: 4 },
  20: { id: "player:action:CHECKOUT", label: "Interviene tú 8 veces en hora punta", target: 8 },
  21: { id: "player:machine:juice-machine-1", label: "Opera tú la máquina de zumo", target: 2 },
  22: { id: "player:harvest:all", label: "Cosecha tú 20 productos", target: 20 },
  23: { id: "player:stock:all", label: "Repón tú 15 productos para recuperar servicio", target: 15 },
  24: { id: "player:pickup:warehouse", label: "Mueve tú 20 productos desde almacén", target: 20 },
  25: { id: "player:action:CHECKOUT", label: "Atiende tú 8 pulsos de una hora variada", target: 8 },
  26: { id: "player:action:OPERATE_MACHINE", label: "Opera tú maquinaria 6 veces", target: 6 },
  27: { id: "player:stock:all", label: "Repón tú 30 productos en la nueva zona", target: 30 },
  28: { id: "player:action:CONTRIBUTE_UPGRADE", label: "Aporta tú a 4 mejoras operativas", target: 4 },
  29: { id: "player:action:CHECKOUT", label: "Supera tú 12 pulsos del desafío final", target: 12 },
};

function currentFranchise(state: GameState) {
  return state.franchises.find((item) => item.id === state.currentFranchiseId) ?? state.franchises[0];
}

function shelfFill(franchise: FranchiseState, productId: ProductId) {
  return franchise.shelves[productId] / shelfCapacity(franchise, productId);
}

function shelfCapacity(franchise: FranchiseState, productId: ProductId) {
  return retailShelfCapacityForTier(franchise.stationTiers["shelves-1"] ?? franchise.shelvesLevel, productId);
}
