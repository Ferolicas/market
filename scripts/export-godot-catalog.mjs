import { writeFile } from 'node:fs/promises';
import * as catalog from '../src/game/catalog.ts';
// Only immutable source tables are generated. Simulation remains native GDScript.
const literal = (value) => JSON.stringify(value, null, '\t');
const body = 'class_name Catalog\nextends RefCounted\n## Generated from src/game/catalog.ts by scripts/export-godot-catalog.mjs.\n\n' +
  Object.entries(catalog).filter(([key]) => /^[A-Z][A-Z_]+$/.test(key)).map(([key, value]) => `const ${key} = ${literal(value)}\n`).join('\n');
await writeFile(new URL('../godot/game/catalog.gd', import.meta.url), body);
