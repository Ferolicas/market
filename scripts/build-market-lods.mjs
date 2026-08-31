import { mkdirSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const cli = join(root, "node_modules", ".bin", "gltf-transform");
for (const family of ["characters", "customers"]) {
  const source = join(root, "public", "models", "market", family);
  for (const level of [1, 2]) mkdirSync(join(source, `lod${level}`), { recursive: true });
  for (const file of readdirSync(source).filter((name) => name.endsWith(".glb"))) {
    const input = join(source, file);
    for (const [level, ratio, error] of [[1, "0.6", "0.003"], [2, "0.25", "0.01"]]) {
      const output = join(source, `lod${level}`, basename(file));
      const result = spawnSync(cli, ["simplify", input, output, "--ratio", ratio, "--error", error], { stdio: "inherit" });
      if (result.status !== 0) process.exit(result.status ?? 1);
    }
  }
}
