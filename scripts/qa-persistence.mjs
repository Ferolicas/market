import fs from "node:fs/promises";
import { chromium } from "playwright";

const output = process.argv[2] ?? "/tmp/market-persistence-qa";
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: "/home/ferney_oliveros/.local/bin/google-chrome",
  args: ["--no-sandbox", "--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=vulkan", "--enable-features=Vulkan"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const suffix = Date.now().toString(36);
await page.goto("http://localhost:3000?debug=1", { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.getByRole("button", { name: "Crear perfil nuevo" }).click();
await page.getByLabel("Tu nombre").fill("Persistence QA");
await page.getByLabel("Nombre de usuario").fill(`persist_${suffix}`.slice(0, 24));
await page.getByLabel("Correo electrónico").fill(`persist.${suffix}@example.test`);
await page.getByLabel("Contraseña").fill(`Persist-${suffix}-Safe!`);
await page.getByRole("button", { name: "Crear perfil y jugar" }).click();
await page.getByRole("button", { name: "Abrir mi primer Mini Market" }).waitFor({ timeout: 60_000 });
await page.getByRole("button", { name: "Abrir mi primer Mini Market" }).click();
await page.waitForFunction(() => Boolean(window.__MARKET_QA__?.player && window.__MARKET_QA__?.saveRevision), null, { timeout: 30_000 });
// Leave the entrance so the saved presence flag is false.  On reload the
// visual player starts beside that sensor; the QA freeze must prevent that
// ephemeral live input from mutating the snapshot under inspection.
await page.mouse.move(640, 560);
await page.mouse.down();
await page.mouse.move(594, 485, { steps: 3 });
await page.waitForTimeout(1_500);
await page.mouse.up();
await page.waitForFunction(() => {
  const state = window.__MARKET_QA__?.state;
  const franchise = state?.franchises?.find((item) => item.id === state.currentFranchiseId);
  return franchise?.doorPlayerPresent === false;
}, null, { timeout: 15_000 });
await page.evaluate(() => sessionStorage.setItem("mini-market-qa-freeze", "1"));
await page.locator(".player-chip button").click();
await page.waitForFunction(() => window.__MARKET_QA__?.saveStatus === "saved", null, { timeout: 30_000 });

const before = await page.evaluate(() => structuredClone(window.__MARKET_QA__.state));
const saved = await readServer(page);
await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForFunction(() => Boolean(window.__MARKET_QA__?.state), null, { timeout: 30_000 });
const after = await page.evaluate(() => structuredClone(window.__MARKET_QA__.state));
const reloaded = await readServer(page);
const report = {
  generatedAt: new Date().toISOString(),
  savedRevision: saved.saveRevision,
  reloadedRevision: reloaded.saveRevision,
  beforeVsSaved: differences(before, saved.state),
  serverVsReloadedClient: differences(reloaded.state, after),
  canonicalBeforeVsSaved: canonical(before) === canonical(saved.state),
  canonicalServerVsClient: canonical(reloaded.state) === canonical(after),
};
await fs.writeFile(`${output}/before.json`, JSON.stringify(before, null, 2));
await fs.writeFile(`${output}/saved.json`, JSON.stringify(saved.state, null, 2));
await fs.writeFile(`${output}/after.json`, JSON.stringify(after, null, 2));
await fs.writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
await browser.close();
console.log(JSON.stringify(report, null, 2));
if (!report.canonicalBeforeVsSaved || !report.canonicalServerVsClient) process.exitCode = 1;

async function readServer(targetPage) {
  return targetPage.evaluate(async () => {
    const response = await fetch("/api/game/save", { cache: "no-store" });
    if (!response.ok) throw new Error(`GET save ${response.status}`);
    return response.json();
  });
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function differences(left, right, currentPath = "$", found = []) {
  if (found.length >= 100) return found;
  if (Object.is(left, right)) return found;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) found.push({ path: `${currentPath}.length`, left: left.length, right: right.length });
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) differences(left[index], right[index], `${currentPath}[${index}]`, found);
    return found;
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      if (!(key in left) || !(key in right)) found.push({ path: `${currentPath}.${key}`, left: left[key], right: right[key] });
      else differences(left[key], right[key], `${currentPath}.${key}`, found);
    }
    return found;
  }
  found.push({ path: currentPath, left, right });
  return found;
}
