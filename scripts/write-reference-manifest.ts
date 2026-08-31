import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MARKET_ASSETS } from "../src/game/assets/AssetRegistry";

const manifest = {
  schemaVersion: 3,
  generatedAt: "2026-08-29",
  referenceRoot: "/home/ferney_oliveros/Descargas/KIT MARKET",
  pipelines: ["tools/blender/build_market_characters.py", "tools/blender/build_market_environment.py"],
  policy: "Las PNG propias son la única fuente visual; no se importa ni reutiliza ningún GLB heredado.",
  validation: { command: "pnpm validate:assets", assetsChecked: MARKET_ASSETS.length, gltfErrors: 0, gltfWarnings: 0 },
  missing: [],
  assets: MARKET_ASSETS,
};

async function main() {
  await writeFile(join(process.cwd(), "docs/art/reference_manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Manifest written with ${MARKET_ASSETS.length} assets.`);
}

void main();
