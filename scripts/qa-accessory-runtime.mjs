import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const outputRoot = process.argv[2] ?? "/tmp/market-accessory-runtime-qa";
await fs.mkdir(outputRoot, { recursive: true });

const bodies = [
  ["adult-man", "Hombre Adulto"],
  ["adult-woman", "Mujer Adulta"],
  ["boy", "Niño Joven"],
  ["girl", "Niña Joven"],
];
const hair = [
  ["side-part", "Raya lateral"], ["fade", "Degradado"], ["waves", "Ondulado"], ["swept", "Peinado atrás"],
  ["bob", "Bob"], ["ponytail", "Coleta"], ["long-wavy", "Largo ondulado"], ["bun", "Moño"],
  ["messy", "Despeinado"], ["curls", "Rizos"], ["short-fringe", "Flequillo corto"], ["quiff", "Tupé"],
  ["blunt-bob", "Bob recto"], ["pigtails", "Dos coletas"], ["braid", "Trenza"], ["high-ponytail", "Coleta alta"],
];
const hats = [
  ["red-panda", "Panda rojo"], ["red-fox", "Zorro rojo"], ["chicken", "Gallina"], ["owl", "Búho"],
  ["elephant", "Elefante"], ["rhino", "Rinoceronte"], ["giraffe", "Jirafa"], ["panda", "Panda"],
  ["frog", "Sapo"], ["cow", "Vaca"], ["rabbit", "Conejo"], ["capybara", "Capibara"],
];

const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan", "--disable-background-timer-throttling"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleErrors = [];
const pageErrors = [];
const failedResponses = [];
const loadedModels = new Map();
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
page.on("response", (response) => {
  const pathname = new URL(response.url()).pathname;
  if (pathname.startsWith("/models/market/")) loadedModels.set(pathname, response.status());
  if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() });
});

const suffix = Date.now().toString(36);
await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.getByRole("button", { name: "Crear perfil nuevo" }).click();
await page.getByLabel("Tu nombre").fill("Accessory Runtime QA");
await page.getByLabel("Nombre de usuario").fill(`accessory_${suffix}`.slice(0, 24));
await page.getByLabel("Correo electrónico").fill(`accessory.${suffix}@example.test`);
await page.getByLabel("Contraseña").fill(`Accessory-${suffix}-Safe!`);
await page.getByRole("button", { name: "Crear perfil y jugar" }).click();
await page.getByRole("button", { name: "Abrir mi primer Mini Market" }).waitFor({ timeout: 60_000 });
const preview = page.locator(".avatar-preview-3d");
await preview.locator("canvas").waitFor({ state: "visible", timeout: 30_000 });
await page.waitForTimeout(900);

for (const [bodyId, bodyLabel] of bodies) {
  await page.getByRole("button", { name: bodyLabel }).click();
  await page.getByRole("button", { name: "Sin gorro" }).click();
  for (let index = 0; index < hair.length; index += 1) {
    const [hairId, label] = hair[index];
    await selectAsset(page.locator(`.hair-options button[title="${label}"]`), `/models/market/hair/${bodyId}/${hairId}.glb`);
    await preview.screenshot({ path: path.join(outputRoot, `hair-${bodyId}-${String(index + 1).padStart(2, "0")}-${hairId}.png`) });
  }
  for (let index = 0; index < hats.length; index += 1) {
    const [hatId, label] = hats[index];
    await selectAsset(page.locator(`.animal-hat-options button[title="${label}"]`), `/models/market/hats/${bodyId}/${hatId}.glb`);
    await preview.screenshot({ path: path.join(outputRoot, `hat-${bodyId}-${String(index + 1).padStart(2, "0")}-${hatId}.png`) });
  }
}

const webgl = await preview.locator("canvas").evaluate((canvas) => {
  const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
  const extension = gl?.getExtension("WEBGL_debug_renderer_info");
  return gl ? { renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), contextLost: gl.isContextLost() } : null;
});
const expectedAccessoryModels = bodies.length * (hair.length + hats.length);
const loadedAccessories = [...loadedModels.keys()].filter((model) => model.includes("/hair/") || model.includes("/hats/"));
const report = {
  generatedAt: new Date().toISOString(),
  expectedAccessoryModels,
  loadedAccessories: loadedAccessories.length,
  loadedModels: Object.fromEntries([...loadedModels].sort()),
  webgl,
  consoleErrors,
  pageErrors,
  failedResponses,
};
await fs.writeFile(path.join(outputRoot, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify({ ...report, loadedModels: `${loadedModels.size} model responses` }, null, 2));

if (loadedAccessories.length !== expectedAccessoryModels) throw new Error(`Se cargaron ${loadedAccessories.length}/${expectedAccessoryModels} accesorios`);
if (!webgl?.renderer.includes("NVIDIA GeForce RTX 4080 SUPER") || webgl.contextLost) throw new Error(`La GPU esperada no está activa: ${JSON.stringify(webgl)}`);
if (consoleErrors.length || pageErrors.length || failedResponses.length) throw new Error(`Errores durante QA de accesorios: ${JSON.stringify({ consoleErrors, pageErrors, failedResponses })}`);

async function selectAsset(button, modelPath) {
  if (!loadedModels.has(modelPath)) {
    await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === modelPath && response.status() === 200, { timeout: 30_000 }),
      button.click(),
    ]);
  } else {
    await button.click();
  }
  // The response ending precedes Meshopt decode, scene cloning and a rendered
  // frame. Wait for that complete visual pipeline, not just HTTP success.
  await page.waitForTimeout(520);
}
