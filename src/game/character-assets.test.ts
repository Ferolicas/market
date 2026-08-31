import fs from "node:fs";
import path from "node:path";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { describe, expect, it } from "vitest";

const PLAYER_MODELS = [
  "market/characters/owner_man.glb",
  "market/characters/owner_woman.glb",
  "market/characters/owner_boy.glb",
  "market/characters/owner_girl.glb",
];
const CUSTOMER_MODELS = [
  "market/customers/customer_01_man_young.glb",
  "market/customers/customer_02_man_senior.glb",
  "market/customers/customer_03_woman_young.glb",
  "market/customers/customer_04_woman_adult.glb",
  "market/customers/customer_05_woman_mature.glb",
  "market/customers/customer_06_woman_senior.glb",
];

interface GlbJson {
  asset: { generator?: string };
  accessors: Array<{
    bufferView: number;
    byteOffset?: number;
    componentType: number;
    count: number;
    type: "SCALAR" | "VEC2" | "VEC3" | "VEC4";
  }>;
  animations: Array<{
    name: string;
    channels: Array<{ sampler: number; target: { node: number; path: string } }>;
    samplers: Array<{ input: number; interpolation?: string; output: number }>;
  }>;
  bufferViews: Array<{
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
    extensions?: {
      EXT_meshopt_compression?: {
        byteOffset: number;
        byteLength: number;
        byteStride: number;
        count: number;
        mode: "ATTRIBUTES" | "TRIANGLES" | "INDICES";
        filter?: "NONE" | "OCTAHEDRAL" | "QUATERNION" | "EXPONENTIAL";
      };
    };
  }>;
  nodes: Array<{ name?: string; rotation?: number[] }>;
}

function parseGlb(file: string) {
  const glb = fs.readFileSync(path.join(process.cwd(), "public", "models", file));
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8")) as GlbJson;
  const binHeader = 20 + jsonLength;
  const binLength = glb.readUInt32LE(binHeader);
  const binary = glb.subarray(binHeader + 8, binHeader + 8 + binLength);
  return { binary, decodedViews: new Map<number, Buffer>(), json };
}

async function readNumericAccessor(json: GlbJson, binary: Buffer, decodedViews: Map<number, Buffer>, index: number) {
  const accessor = json.accessors[index];
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
  const view = json.bufferViews[accessor.bufferView];
  const componentBytes = accessor.componentType === 5126 ? 4 : accessor.componentType === 5122 ? 2 : 0;
  expect(componentBytes, `supported component type ${accessor.componentType}`).toBeGreaterThan(0);
  const stride = view.byteStride ?? components * componentBytes;
  const source = await decodedView(json, binary, decodedViews, accessor.bufferView);
  const start = accessor.byteOffset ?? 0;
  return Array.from({ length: accessor.count }, (_, row) => (
    Array.from({ length: components }, (_, component) => {
      const offset = start + row * stride + component * componentBytes;
      if (accessor.componentType === 5126) return source.readFloatLE(offset);
      const value = source.readInt16LE(offset);
      return Math.max(value / 32767, -1);
    })
  ));
}

async function decodedView(json: GlbJson, binary: Buffer, cache: Map<number, Buffer>, index: number) {
  const cached = cache.get(index);
  if (cached) return cached;
  const view = json.bufferViews[index];
  const compression = view.extensions?.EXT_meshopt_compression;
  if (!compression) {
    const bytes = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    cache.set(index, bytes);
    return bytes;
  }
  await MeshoptDecoder.ready;
  const target = new Uint8Array(compression.count * compression.byteStride);
  const compressed = binary.subarray(compression.byteOffset, compression.byteOffset + compression.byteLength);
  MeshoptDecoder.decodeGltfBuffer(target, compression.count, compression.byteStride, compressed, compression.mode, compression.filter ?? "NONE");
  const bytes = Buffer.from(target.buffer, target.byteOffset, target.byteLength);
  cache.set(index, bytes);
  return bytes;
}

function multiplyQuaternion(a: number[], b: number[]) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function relativeForwardSwing(rest: number[], pose: number[]) {
  const relative = multiplyQuaternion([-rest[0], -rest[1], -rest[2], rest[3]], pose);
  const sign = relative[3] < 0 ? -1 : 1;
  const [x, y, z, w] = relative.map((value) => value * sign);
  // The rebuilt, Mixamo-compatible skeleton has its upper-leg flexion axis on
  // local Y after glTF's coordinate conversion. Extract that anatomical swing
  // instead of assuming a Blender-local X axis.
  return Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x))));
}

async function expectArticulatedClip(file: string, clipName: string, arms: boolean) {
    const { binary, decodedViews, json } = parseGlb(file);
    expect(json.asset.generator).toMatch(/Khronos glTF Blender I\/O|glTF-Transform/);
    const clip = json.animations.find((animation) => animation.name === clipName);
    expect(clip).toBeDefined();

    const animatedBones = [
      "Rig_Leg_L",
      "Rig_Leg_R",
      "Shin_L",
      "Shin_R",
      ...(arms ? ["Rig_Arm_L", "Rig_Arm_R"] : []),
    ];

    for (const bone of animatedBones) {
      const nodeIndex = json.nodes.findIndex((node) => node.name === bone);
      const channel = clip!.channels.find((item) => item.target.node === nodeIndex && item.target.path === "rotation");
      expect(channel, `${bone}.rotation`).toBeDefined();
      const sampler = clip!.samplers[channel!.sampler];
      const values = await readNumericAccessor(json, binary, decodedViews, sampler.output);
      expect(sampler.interpolation).toBe("LINEAR");
      expect(values.length).toBeGreaterThanOrEqual(24);
      const variation = Math.max(...values[0].map((_, component) => {
        const series = values.map((value) => value[component]);
        return Math.max(...series) - Math.min(...series);
      }));
      expect(variation, `${bone} must move`).toBeGreaterThan(0.03);
      if (bone.startsWith("Shin_")) {
        const first = values[0];
        const maxBend = Math.max(...values.map((value) => {
          const dot = Math.abs(value.reduce((sum, component, index) => sum + component * first[index], 0));
          return 2 * Math.acos(Math.min(1, dot));
        }));
        expect(maxBend, `${bone} must visibly flex`).toBeGreaterThan(0.45);
      }
      expect(values.at(-1)).toEqual(values[0]);
    }

    const hipsIndex = json.nodes.findIndex((node) => node.name === "Hips");
    const hipsChannel = clip!.channels.find((item) => item.target.node === hipsIndex && item.target.path === "translation");
    const translations = await readNumericAccessor(json, binary, decodedViews, clip!.samplers[hipsChannel!.sampler].output);
    const xValues = translations.map((value) => value[0]);
    const yValues = translations.map((value) => value[1]);
    const zValues = translations.map((value) => value[2]);
    const lateralSway = Math.max(...xValues) - Math.min(...xValues);
    const forwardTravel = Math.max(...zValues) - Math.min(...zValues);
    expect(lateralSway, "hips need a subtle lateral weight transfer").toBeGreaterThan(0.015);
    expect(lateralSway, "hips must not slide sideways").toBeLessThan(0.1);
    expect(forwardTravel, "an in-place cycle must not travel forward").toBeLessThan(0.02);
    expect(Math.max(...yValues) - Math.min(...yValues)).toBeGreaterThan(0.008);
    expect(Math.max(...yValues) - Math.min(...yValues)).toBeLessThan(0.08);
    expect(translations.at(-1)).toEqual(translations[0]);

    const leftLegIndex = json.nodes.findIndex((node) => node.name === "Rig_Leg_L");
    const leftLegChannel = clip!.channels.find((item) => item.target.node === leftLegIndex && item.target.path === "rotation");
    const leftLegRotations = await readNumericAccessor(json, binary, decodedViews, clip!.samplers[leftLegChannel!.sampler].output);
    const leftLegRest = json.nodes[leftLegIndex].rotation ?? [0, 0, 0, 1];
    const initialContact = relativeForwardSwing(leftLegRest, leftLegRotations[0]);
    const endOfSupport = relativeForwardSwing(leftLegRest, leftLegRotations[Math.round((leftLegRotations.length - 1) * 0.61)]);
    expect(initialContact, "left foot must start ahead of the body").toBeLessThan(-0.14);
    expect(endOfSupport, "left foot must sweep behind during support").toBeGreaterThan(0.15);
}

describe("character locomotion clips", () => {
  it.each(PLAYER_MODELS)("%s has an articulated, in-place walk cycle", async (file) => {
    await expectArticulatedClip(file, "Walk", true);
  });

  it.each(CUSTOMER_MODELS)("%s has natural in-place visitor locomotion", async (file) => {
    await expectArticulatedClip(file, "Walk", true);
    await expectArticulatedClip(file, "Enter", true);
    await expectArticulatedClip(file, "CarryBasket", false);
    await expectArticulatedClip(file, "Exit", true);
  });
});
