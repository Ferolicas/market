import { writeFile } from 'node:fs/promises';
import { MARKET_ASSETS, EXPOSURE_ASSET_IDS, EQUIPMENT_ASSET_IDS, FARM_ASSET_IDS, MARKET_REFERENCE_ROOT } from '../src/game/assets/AssetRegistry.ts';
const tables = { MARKET_ASSETS, EXPOSURE_ASSET_IDS, EQUIPMENT_ASSET_IDS, FARM_ASSET_IDS, MARKET_REFERENCE_ROOT };
await writeFile(new URL('../godot/game/assets/registry_data.json', import.meta.url), JSON.stringify(tables, null, 2) + '\n');
console.log(`Exported ${MARKET_ASSETS.length} approved asset definitions without changing source metadata`);
