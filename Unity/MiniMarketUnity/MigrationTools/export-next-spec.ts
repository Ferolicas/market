import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInitialGame } from "../../../src/game/engine";
import * as catalog from "../../../src/game/catalog";
import * as products from "../../../src/game/economy/products";
import * as levels from "../../../src/game/progression/levels";
import * as objectives from "../../../src/game/progression/objectives";
import * as checkout from "../../../src/game/stations/checkout-layout";
import * as farm from "../../../src/game/stations/farm-layout";
import * as production from "../../../src/game/stations/production-layout";
import * as retail from "../../../src/game/stations/retail-layout";
import * as storefront from "../../../src/game/stations/storefront-layout";
import * as services from "../../../src/game/stations/store-service-layout";
import * as warehouse from "../../../src/game/stations/warehouse-layout";
import * as workstations from "../../../src/game/stations/workstation-layout";
import * as worldScale from "../../../src/game/world-scale";

function values(module: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(module).filter(([, value]) => {
    if (typeof value === "function" || value instanceof Map || value instanceof Set) return false;
    return value !== undefined;
  }));
}

const payload = {
  schemaVersion: 1,
  source: "Next.js/React Three Mini Market",
  generatedFromTrackedSources: true,
  catalog: values(catalog),
  productConfig: products.PRODUCT_CONFIG,
  levels: levels.LEVELS,
  initialState: createInitialGame("ES"),
  layouts: {
    checkout: values(checkout),
    farm: values(farm),
    production: values(production),
    retail: values(retail),
    storefront: values(storefront),
    services: values(services),
    warehouse: values(warehouse),
    workstations: values(workstations),
    worldScale: values(worldScale),
  },
  levelObjectives: Array.from({ length: 30 }, (_, index) => {
    const state = createInitialGame("ES");
    state.level = index + 1;
    return { level: index + 1, tasks: objectives.levelObjectiveTasks(index + 1, state) };
  }),
};

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(here, "../Assets/StreamingAssets/Data/next-game-spec.json");
async function main() {
  await writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(output);
}

void main();
