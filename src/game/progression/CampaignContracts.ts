import type { FranchiseState, ProductId } from "../types";
import { campaignAvailableProducts } from "./MartCampaign";

interface ContractDefinition { id: string; location: string; label: string; products: readonly ProductId[] }

/** Original composed orders. Three carried units fit even the initial basket.
 * No cash bonuses: these are personal completion requirements, not idle income. */
export const CAMPAIGN_CONTRACTS = [
  { id: "barrio-huerta", location: "barrio", label: "Cesta de la huerta", products: ["tomatoes", "eggs", "corn"] },
  { id: "barrio-molienda", location: "barrio", label: "Del campo al horno", products: ["wheat", "flour", "bread"] },
  { id: "barrio-despensa", location: "barrio", label: "Despensa del vecino", products: ["milk", "cheese", "coffee"] },
  { id: "estacion-desayuno", location: "estacion", label: "Desayuno del viajero", products: ["bread", "coffee", "milk"] },
  { id: "estacion-merienda", location: "estacion", label: "Merienda para llevar", products: ["bread", "apples", "juice"] },
  { id: "estacion-frescos", location: "estacion", label: "Bolsa de frescos", products: ["eggs", "cheese", "oranges"] },
  { id: "marina-frutal", location: "marina", label: "Cesta frutal", products: ["apples", "oranges", "juice"] },
  { id: "marina-huerta", location: "marina", label: "Huerta costera", products: ["tomatoes", "corn", "cheese"] },
  { id: "marina-familia", location: "marina", label: "Desayuno en familia", products: ["eggs", "milk", "bread"] },
  { id: "terminal-salida", location: "aeropuerto", label: "Salida temprana", products: ["coffee", "milk", "bread"] },
  { id: "terminal-escala", location: "aeropuerto", label: "Tentempié de escala", products: ["cheese", "apples", "juice"] },
  { id: "terminal-destino", location: "aeropuerto", label: "Cesta de destino", products: ["tomatoes", "eggs", "cannedCorn"] },
  { id: "campus-estudio", location: "campus", label: "Tarde de estudio", products: ["coffee", "bread", "cheese"] },
  { id: "campus-cereales", location: "campus", label: "Taller de cereales", products: ["wheat", "corn", "flour"] },
  { id: "campus-lacteos", location: "campus", label: "Cesta láctea", products: ["milk", "cheese", "eggs"] },
  { id: "mega-campo", location: "megastore", label: "Maestría del campo", products: ["tomatoes", "wheat", "corn"] },
  { id: "mega-produccion", location: "megastore", label: "Maestría de producción", products: ["flour", "cheese", "juice"] },
  { id: "mega-comercio", location: "megastore", label: "Maestría comercial", products: ["coffee", "bread", "milk"] },
] as const satisfies readonly ContractDefinition[];
export type CampaignContractId = typeof CAMPAIGN_CONTRACTS[number]["id"];
export const CAMPAIGN_CONTRACT_IDS = CAMPAIGN_CONTRACTS.map((contract) => contract.id);

export function campaignContracts(franchise: FranchiseState) {
  if (!franchise.purchases) return [];
  const availableProducts = campaignAvailableProducts(franchise.purchases);
  const completed = franchise.purchases.completedContracts ?? [];
  const definitions = CAMPAIGN_CONTRACTS.filter((contract) => contract.location === franchise.id);
  return definitions.map((contract, index) => {
    const unlocked = contract.products.every((product) => availableProducts.includes(product));
    const previousDone = definitions.slice(0, index).every((previous) => completed.includes(previous.id));
    return { ...contract, completed: completed.includes(contract.id), unlocked, previousDone,
      ready: !completed.includes(contract.id) && unlocked && previousDone && contract.products.every((product) => (franchise.carry.items[product] ?? 0) >= 1) };
  });
}
