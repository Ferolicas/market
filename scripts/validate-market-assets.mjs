import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { inspect } from "@gltf-transform/functions";
import validator from "gltf-validator";
import { MeshoptDecoder } from "meshoptimizer";

const projectRoot = path.resolve(import.meta.dirname, "..");
const modelRoot = path.join(projectRoot, "public", "models", "market");
const characterFolders = new Set(["characters", "customers"]);
const requiredClips = [
  "Idle", "Walk", "Run", "TurnLeft", "TurnRight", "CarryIdle", "CarryWalk",
  "HarvestLow", "HarvestHigh", "PickupLow", "PickupHigh", "StockLow", "StockMid",
  "StockHigh", "CheckoutScan", "CheckoutBag", "Pay", "ReceiveBag", "Happy",
  "Confused", "Impatient", "Talk", "LookAround", "Phone", "Enter", "Exit",
];
const requiredMorphs = [
  "Blink_L", "Blink_R", "EyeWide_L", "EyeWide_R", "BrowUp_L", "BrowUp_R",
  "BrowDown_L", "BrowDown_R", "Smile", "Frown", "JawOpen", "MouthOpen",
  "MouthNarrow", "CheekUp", "Surprise", "Confused",
];
const requiredBones = ["Root", "Hips", "Spine", "Chest", "Neck", "Head", "Hand_L", "Hand_R", "Foot_L", "Foot_R"];
const requiredCustomerClips = ["Wait", "Browse", "ReachShelf", "CarryBasket", "Queue", "CheckoutItem"];
const lodBudgets = {
  characters: {
    lod1: { maxRenderVertices: 30_000, maxSourceRatio: 0.34 },
    lod2: { maxRenderVertices: 18_000, maxSourceRatio: 0.22 },
  },
  customers: {
    lod1: { maxRenderVertices: 20_000, maxSourceRatio: 0.49 },
    lod2: { maxRenderVertices: 12_000, maxSourceRatio: 0.31 },
  },
};

function glbJson(buffer) {
  const jsonLength = buffer.readUInt32LE(12);
  return JSON.parse(buffer.subarray(20, 20 + jsonLength).toString("utf8").replace(/\u0000+$/u, ""));
}

async function assets() {
  const result = [];
  for (const folder of ["characters", "customers", "hair", "hats", "environment"]) {
    const directory = path.join(modelRoot, folder);
    for (const absolute of await glbs(directory)) result.push({ folder, file: path.relative(directory, absolute), absolute });
  }
  return result;
}

async function glbs(directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await glbs(absolute));
    else if (entry.name.endsWith(".glb")) result.push(absolute);
  }
  return result.sort();
}

await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const assetList = await assets();
const characterSources = new Map();
for (const asset of assetList.filter((candidate) => characterFolders.has(candidate.folder) && !candidate.file.includes(path.sep))) {
  const buffer = await fs.readFile(asset.absolute);
  const document = await io.read(asset.absolute);
  characterSources.set(`${asset.folder}/${path.basename(asset.file)}`, {
    renderVertices: sceneRenderVertices(document),
    signature: characterSignature(glbJson(buffer)),
  });
}

const reports = [];
for (const asset of assetList) {
  const buffer = await fs.readFile(asset.absolute);
  const report = await validator.validateBytes(new Uint8Array(buffer), { uri: path.relative(projectRoot, asset.absolute) });
  const document = await io.read(asset.absolute);
  const json = glbJson(buffer);
  const animations = (json.animations ?? []).map((animation) => animation.name);
  const targetNames = (json.meshes ?? []).flatMap((mesh) => mesh.extras?.targetNames ?? []);
  const nodeNames = (json.nodes ?? []).map((node) => node.name);
  const expectedClips = asset.folder === "customers" ? [...requiredClips, ...requiredCustomerClips] : requiredClips;
  const missingClips = characterFolders.has(asset.folder) ? expectedClips.filter((clip) => !animations.includes(clip)) : [];
  const missingMorphs = characterFolders.has(asset.folder) ? requiredMorphs.filter((morph) => !targetNames.includes(morph)) : [];
  const missingBones = characterFolders.has(asset.folder) ? requiredBones.filter((bone) => !nodeNames.includes(bone)) : [];
  const failures = report.issues.messages.filter((issue) => issue.severity <= 1);
  const renderVertices = sceneRenderVertices(document);
  const lod = asset.file.split(path.sep)[0];
  const lodBudget = lodBudgets[asset.folder]?.[lod];
  const source = lodBudget ? characterSources.get(`${asset.folder}/${path.basename(asset.file)}`) : undefined;
  const sourceRenderVertices = source?.renderVertices;
  const sourceRatio = sourceRenderVertices ? renderVertices / sourceRenderVertices : undefined;
  const lodPreservationFailure = Boolean(source && JSON.stringify(characterSignature(json)) !== JSON.stringify(source.signature));
  const lodFailure = lodBudget && (
    renderVertices > lodBudget.maxRenderVertices
    || sourceRatio === undefined
    || sourceRatio > lodBudget.maxSourceRatio
    || lodPreservationFailure
  );
  reports.push({
    asset: path.relative(projectRoot, asset.absolute),
    bytes: buffer.byteLength,
    errors: report.issues.numErrors,
    warnings: report.issues.numWarnings,
    animations: animations.length,
    morphs: new Set(targetNames).size,
    renderVertices,
    sourceRenderVertices,
    sourceRatio: sourceRatio === undefined ? undefined : Number(sourceRatio.toFixed(4)),
    lodBudget,
    lodFailure: Boolean(lodFailure),
    lodPreservationFailure,
    missingClips,
    missingMorphs,
    missingBones,
    failures,
  });
}

const failed = reports.filter((report) => report.errors || report.warnings || report.lodFailure || report.missingClips.length || report.missingMorphs.length || report.missingBones.length);
console.log(JSON.stringify({ checked: reports.length, failed: failed.length, reports }, null, 2));
if (failed.length) process.exitCode = 1;

function sceneRenderVertices(document) {
  return inspect(document).scenes.properties.reduce((sum, scene) => sum + scene.renderVertexCount, 0);
}

function characterSignature(json) {
  const nodeNames = (json.nodes ?? []).map((node) => node.name ?? "");
  return {
    animations: [...new Set((json.animations ?? []).map((animation) => animation.name ?? ""))].sort(),
    morphs: [...new Set((json.meshes ?? []).flatMap((mesh) => mesh.extras?.targetNames ?? []))].sort(),
    joints: [...new Set((json.skins ?? []).flatMap((skin) => skin.joints ?? []).map((index) => nodeNames[index] ?? `#${index}`))].sort(),
  };
}
