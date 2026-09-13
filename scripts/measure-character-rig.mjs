#!/usr/bin/env node
/**
 * Measures a character GLB of the market cast without Blender:
 *
 *   node scripts/measure-character-rig.mjs public/models/market/characters/owner_man.glb
 *     → body/head bounds in the bind pose, natural floor speed of every
 *       locomotion clip (median backward speed of the planted foot) and the
 *       two-handed hold of the carry pose (POSE_CLIP / POSE_TIME, PALMS as JSON).
 *   PALM_MODE=1 node scripts/measure-character-rig.mjs <glb>
 *     → palm and finger extents in each Hand bone's local frame.
 *   SCAN_MODE=1 SCAN_CLIP=CheckoutBag node scripts/measure-character-rig.mjs <glb>
 *     → hand symmetry (dy, dz, span, reach) across one clip, for choosing a hold.
 *
 * Reads the GLB JSON and binary directly (KHR_mesh_quantization and
 * EXT_meshopt_compression are handled); rig units are the delivered model
 * units where every body stands 0.98 tall.
 */
import fs from "node:fs";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

function parseGlb(file) {
  const glb = fs.readFileSync(file);
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8"));
  const binHeader = 20 + jsonLength;
  const binLength = glb.readUInt32LE(binHeader);
  return { json, binary: glb.subarray(binHeader + 8, binHeader + 8 + binLength), views: new Map() };
}
async function view(glb, index) {
  if (glb.views.has(index)) return glb.views.get(index);
  const v = glb.json.bufferViews[index];
  const c = v.extensions?.EXT_meshopt_compression;
  let bytes;
  if (!c) bytes = glb.binary.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
  else {
    await MeshoptDecoder.ready;
    const target = new Uint8Array(c.count * c.byteStride);
    MeshoptDecoder.decodeGltfBuffer(target, c.count, c.byteStride, glb.binary.subarray(c.byteOffset, c.byteOffset + c.byteLength), c.mode, c.filter ?? "NONE");
    bytes = Buffer.from(target.buffer, target.byteOffset, target.byteLength);
  }
  glb.views.set(index, bytes);
  return bytes;
}
async function accessor(glb, index) {
  const a = glb.json.accessors[index];
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
  const v = glb.json.bufferViews[a.bufferView];
  const bytes = { 5126: 4, 5123: 2, 5122: 2, 5121: 1, 5120: 1 }[a.componentType];
  const stride = v.byteStride ?? comps * bytes;
  const src = await view(glb, a.bufferView);
  const start = a.byteOffset ?? 0;
  const out = new Array(a.count);
  for (let row = 0; row < a.count; row++) {
    const r = new Array(comps);
    for (let k = 0; k < comps; k++) {
      const o = start + row * stride + k * bytes;
      if (a.componentType === 5126) r[k] = src.readFloatLE(o);
      else if (a.componentType === 5122) r[k] = a.normalized ? Math.max(src.readInt16LE(o) / 32767, -1) : src.readInt16LE(o);
      else if (a.componentType === 5123) r[k] = a.normalized ? src.readUInt16LE(o) / 65535 : src.readUInt16LE(o);
      else if (a.componentType === 5121) r[k] = a.normalized ? src.readUInt8(o) / 255 : src.readUInt8(o);
      else r[k] = a.normalized ? Math.max(src.readInt8(o) / 127, -1) : src.readInt8(o);
    }
    out[row] = r;
  }
  return out;
}
// column-major 4x4 helpers
function mul(a, b) { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; }
function trs(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) {
  const [x, y, z, w] = q; const [sx, sy, sz] = s;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [(1 - 2 * (yy + zz)) * sx, 2 * (xy + wz) * sx, 2 * (xz - wy) * sx, 0, 2 * (xy - wz) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + wx) * sy, 0, 2 * (xz + wy) * sz, 2 * (yz - wx) * sz, (1 - 2 * (xx + yy)) * sz, 0, t[0], t[1], t[2], 1];
}
function apply(m, p) { return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]; }
function slerp(a, b, t) { let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; let bb = b; if (d < 0) { d = -d; bb = b.map((v) => -v); } if (d > 0.9995) { const r = a.map((v, i) => v + (bb[i] - v) * t); const n = Math.hypot(...r); return r.map((v) => v / n); } const th = Math.acos(d); const s = Math.sin(th); const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s; return a.map((v, i) => v * wa + bb[i] * wb); }

async function measure(file) {
  const glb = parseGlb(file);
  const { json } = glb;
  const nodes = json.nodes;
  const parent = new Array(nodes.length).fill(-1);
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => { parent[c] = i; }));
  const byName = (name) => nodes.findIndex((n) => n.name === name);
  const worldOf = (locals) => {
    const world = new Array(nodes.length);
    const get = (i) => { if (world[i]) return world[i]; const l = locals[i]; world[i] = parent[i] < 0 ? l : mul(get(parent[i]), l); return world[i]; };
    nodes.forEach((_, i) => get(i));
    return world;
  };
  const bindLocals = nodes.map((n) => n.matrix ?? trs(n.translation, n.rotation, n.scale));
  const bind = worldOf(bindLocals);
  const out = { file };

  // --- Head bounds from the skinned body mesh in the bind pose.
  const skin = json.skins?.[0];
  if (skin) {
    const ibm = await accessor(glb, skin.inverseBindMatrices);
    const jointWorld = skin.joints.map((j, k) => mul(bind[j], ibm[k]));
    const headJoint = skin.joints.indexOf(byName("Head"));
    const meshNode = nodes.find((n) => n.skin !== undefined);
    const mesh = json.meshes[meshNode.mesh];
    const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    const bodyBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const prim of mesh.primitives) {
      const pos = await accessor(glb, prim.attributes.POSITION);
      const joints = await accessor(glb, prim.attributes.JOINTS_0);
      const weights = await accessor(glb, prim.attributes.WEIGHTS_0);
      for (let v = 0; v < pos.length; v++) {
        let p = [0, 0, 0];
        for (let k = 0; k < 4; k++) { const w = weights[v][k]; if (w <= 0) continue; const q = apply(jointWorld[joints[v][k]], pos[v]); p = [p[0] + q[0] * w, p[1] + q[1] * w, p[2] + q[2] * w]; }
        for (let a = 0; a < 3; a++) { bodyBounds.min[a] = Math.min(bodyBounds.min[a], p[a]); bodyBounds.max[a] = Math.max(bodyBounds.max[a], p[a]); }
        const headWeight = joints[v].reduce((s, j, k) => s + (j === headJoint ? weights[v][k] : 0), 0);
        if (headWeight >= 0.5) for (let a = 0; a < 3; a++) { bounds.min[a] = Math.min(bounds.min[a], p[a]); bounds.max[a] = Math.max(bounds.max[a], p[a]); }
      }
    }
    const headPos = apply(bind[byName("Head")], [0, 0, 0]);
    out.body = { min: bodyBounds.min.map((v) => +v.toFixed(3)), max: bodyBounds.max.map((v) => +v.toFixed(3)) };
    out.head = { bone: headPos.map((v) => +v.toFixed(3)), min: bounds.min.map((v) => +v.toFixed(3)), max: bounds.max.map((v) => +v.toFixed(3)), size: bounds.max.map((v, i) => +(v - bounds.min[i]).toFixed(3)) };
  }

  // --- Animation sampling.
  const clips = {};
  for (const anim of json.animations) {
    const channels = [];
    let duration = 0;
    for (const ch of anim.channels) {
      const s = anim.samplers[ch.sampler];
      const times = (await accessor(glb, s.input)).map((r) => r[0]);
      const values = await accessor(glb, s.output);
      duration = Math.max(duration, times[times.length - 1]);
      channels.push({ node: ch.target.node, path: ch.target.path, times, values });
    }
    clips[anim.name] = { duration, channels };
  }
  const poseAt = (clip, time) => {
    const locals = nodes.map((n) => ({ t: n.translation ?? [0, 0, 0], r: n.rotation ?? [0, 0, 0, 1], s: n.scale ?? [1, 1, 1] }));
    for (const ch of clip.channels) {
      const { times, values } = ch;
      let i = 0; while (i < times.length - 2 && times[i + 1] <= time) i++;
      const j = Math.min(i + 1, times.length - 1);
      const span = times[j] - times[i];
      const a = span > 0 ? Math.min(1, Math.max(0, (time - times[i]) / span)) : 0;
      const value = ch.path === "rotation" ? slerp(values[i], values[j], a) : values[i].map((v, k) => v + (values[j][k] - v) * a);
      if (ch.path === "rotation") locals[ch.node].r = value; else if (ch.path === "translation") locals[ch.node].t = value; else if (ch.path === "scale") locals[ch.node].s = value;
    }
    return worldOf(locals.map((l) => trs(l.t, l.r, l.s)));
  };
  const footL = byName("Foot_L"), footR = byName("Foot_R"), handL = byName("Hand_L"), handR = byName("Hand_R"), chest2 = byName("Chest2"), hips = byName("Hips");
  out.clips = {};
  for (const name of ["Walk", "Run", "CarryWalk", "CarryRun", "CarryBasket", "BasketWalk", "Enter", "Exit", "CarryIdle", "Idle"]) {
    const clip = clips[name];
    if (!clip) continue;
    const N = 120;
    const samples = [];
    for (let k = 0; k <= N; k++) {
      const t = (k / N) * clip.duration;
      const w = poseAt(clip, t);
      samples.push({ t, fl: apply(w[footL], [0, 0, 0]), fr: apply(w[footR], [0, 0, 0]), hips: apply(w[hips], [0, 0, 0]) });
    }
    // Stance foot = lower foot; its horizontal speed relative to the rig root
    // is the natural forward speed of the in-place cycle.
    const speeds = [];
    for (let k = 1; k < samples.length; k++) {
      const a = samples[k - 1], b = samples[k];
      const dt = b.t - a.t; if (dt <= 0) continue;
      const stanceA = a.fl[1] <= a.fr[1] ? a.fl : a.fr; const stanceB = b.fl[1] <= b.fr[1] ? b.fl : b.fr;
      const sameFoot = (a.fl[1] <= a.fr[1]) === (b.fl[1] <= b.fr[1]);
      if (!sameFoot) continue;
      const dz = stanceB[2] - stanceA[2]; const dx = stanceB[0] - stanceA[0]; const dy = stanceB[1] - stanceA[1];
      if (Math.abs(dy) / dt > 0.35) continue; // swinging foot lifts
      speeds.push({ v: Math.hypot(dx, dz) / dt, dz: dz / dt });
    }
    speeds.sort((p, q) => p.v - q.v);
    const median = speeds.length ? speeds[Math.floor(speeds.length / 2)] : { v: 0, dz: 0 };
    const hipY = samples.map((s) => s.hips[1]);
    out.clips[name] = { duration: +clip.duration.toFixed(3), naturalSpeed: +median.v.toFixed(3), backwardZ: +median.dz.toFixed(3), hipsBob: +(Math.max(...hipY) - Math.min(...hipY)).toFixed(3), samples: speeds.length };
  }
  // --- Palms in the CarryBox pose at t = 0.5 s (what composeCarryAnimations freezes).
  const carry = clips[process.env.POSE_CLIP ?? "CarryBox"];
  const poseTime = Number(process.env.POSE_TIME ?? "0.5");
  if (carry && handL >= 0) {
    const w = poseAt(carry, poseTime);
    const palms = process.env.PALMS ? JSON.parse(process.env.PALMS) : { left: [0, 0, 0], right: [0, 0, 0] };
    const pl = apply(w[handL], palms.left), pr = apply(w[handR], palms.right);
    const wl = apply(w[handL], [0, 0, 0]), wr = apply(w[handR], [0, 0, 0]);
    const chest = apply(w[chest2], [0, 0, 0]);
    const hip = apply(w[hips], [0, 0, 0]);
    out.carryBox = { wristL: wl.map((v) => +v.toFixed(3)), wristR: wr.map((v) => +v.toFixed(3)), palmL: pl.map((v) => +v.toFixed(3)), palmR: pr.map((v) => +v.toFixed(3)), palmMid: pl.map((v, i) => +((v + pr[i]) / 2).toFixed(3)), palmDy: +(pl[1] - pr[1]).toFixed(3), palmDz: +(pl[2] - pr[2]).toFixed(3), span: +Math.hypot(...pl.map((v, i) => v - pr[i])).toFixed(3), chest2: chest.map((v) => +v.toFixed(3)), hips: hip.map((v) => +v.toFixed(3)) };
    // How much do the palms move across a CarryWalk cycle when clavicles are
    // left animated (current composition) vs frozen?
    const walk = clips.CarryWalk;
    if (walk) {
      const clav = ["Clavicle_L", "Clavicle_R"].map(byName);
      const armSet = new Set(["Rig_Arm_L", "Forearm_L", "Hand_L", "Rig_Arm_R", "Forearm_R", "Hand_R"].map(byName));
      const carryLocals = null;
      const measureSpread = (freezeClavicle) => {
        const pts = [];
        for (let k = 0; k <= 60; k++) {
          const t = (k / 60) * walk.duration;
          // Rebuild: walk pose, then override arm (and optionally clavicle) locals with the CarryBox pose.
          const locals = nodes.map((n) => ({ t: n.translation ?? [0, 0, 0], r: n.rotation ?? [0, 0, 0, 1], s: n.scale ?? [1, 1, 1] }));
          const applyClip = (clip, time, filter) => {
            for (const ch of clip.channels) {
              if (!filter(ch.node)) continue;
              const { times, values } = ch;
              let i = 0; while (i < times.length - 2 && times[i + 1] <= time) i++;
              const j = Math.min(i + 1, times.length - 1);
              const span = times[j] - times[i];
              const a = span > 0 ? Math.min(1, Math.max(0, (time - times[i]) / span)) : 0;
              const value = ch.path === "rotation" ? slerp(values[i], values[j], a) : values[i].map((v, q) => v + (values[j][q] - v) * a);
              if (ch.path === "rotation") locals[ch.node].r = value; else if (ch.path === "translation") locals[ch.node].t = value; else locals[ch.node].s = value;
            }
          };
          const frozen = (n) => armSet.has(n) || (freezeClavicle && clav.includes(n));
          applyClip(walk, t, (n) => !frozen(n));
          applyClip(carry, poseTime, (n) => frozen(n));
          const wm = worldOf(locals.map((l) => trs(l.t, l.r, l.s)));
          const l = apply(wm[handL], palms.left), r = apply(wm[handR], palms.right);
          const c2 = wm[chest2];
          // palm midpoint relative to chest2 frame: invert chest2 (rigid) via transpose of rotation part
          const mid = l.map((v, i) => (v + r[i]) / 2);
          pts.push({ mid, span: Math.hypot(...l.map((v, i) => v - r[i])), dy: l[1] - r[1], chestY: c2[13] });
        }
        const range = (arr) => +(Math.max(...arr) - Math.min(...arr)).toFixed(3);
        return { midXRange: range(pts.map((p) => p.mid[0])), midYRange: range(pts.map((p) => p.mid[1])), midZRange: range(pts.map((p) => p.mid[2])), spanRange: range(pts.map((p) => p.span)), dyRange: range(pts.map((p) => p.dy)), chestYRange: range(pts.map((p) => p.chestY)) };
      };
      out.carryWalkPalmMotion = { clavicleAnimated: measureSpread(false), clavicleFrozen: measureSpread(true) };
      void carryLocals;
    }
  }
  return out;
}
if (!process.env.PALM_MODE && !process.env.SCAN_MODE) for (const file of process.argv.slice(2)) console.log(JSON.stringify(await measure(file), null, 1));

// --- Palm centroid in each hand bone's local frame (bind pose).
export async function measurePalms(file) {
  const glb = parseGlb(file);
  const { json } = glb;
  const nodes = json.nodes;
  const parent = new Array(nodes.length).fill(-1);
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => { parent[c] = i; }));
  const byName = (name) => nodes.findIndex((n) => n.name === name);
  const locals = nodes.map((n) => n.matrix ?? trs(n.translation, n.rotation, n.scale));
  const world = new Array(nodes.length);
  const get = (i) => { if (world[i]) return world[i]; world[i] = parent[i] < 0 ? locals[i] : mul(get(parent[i]), locals[i]); return world[i]; };
  nodes.forEach((_, i) => get(i));
  const invRigid = (m) => { // rotation+translation only
    const r = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]; // column-major 3x3 as [c0..c2]
    const t = [m[12], m[13], m[14]];
    // transpose R
    const rt = [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]];
    const tt = [-(rt[0] * t[0] + rt[3] * t[1] + rt[6] * t[2]), -(rt[1] * t[0] + rt[4] * t[1] + rt[7] * t[2]), -(rt[2] * t[0] + rt[5] * t[1] + rt[8] * t[2])];
    return [rt[0], rt[1], rt[2], 0, rt[3], rt[4], rt[5], 0, rt[6], rt[7], rt[8], 0, tt[0], tt[1], tt[2], 1];
  };
  const skin = json.skins[0];
  const ibm = await accessor(glb, skin.inverseBindMatrices);
  const jointWorld = skin.joints.map((j, k) => mul(world[j], ibm[k]));
  const meshNode = nodes.find((n) => n.skin !== undefined);
  const mesh = json.meshes[meshNode.mesh];
  const result = {};
  for (const hand of ["Hand_L", "Hand_R"]) {
    const handNode = byName(hand);
    const handJoint = skin.joints.indexOf(handNode);
    const fingerJoints = skin.joints.map((j, k) => (nodes[j].name.endsWith(hand.slice(-2)) && /Index|Thumb/.test(nodes[j].name) ? k : -1)).filter((k) => k >= 0);
    const inv = invRigid(world[handNode]);
    const pts = []; const fingerPts = [];
    for (const prim of mesh.primitives) {
      const pos = await accessor(glb, prim.attributes.POSITION);
      const joints = await accessor(glb, prim.attributes.JOINTS_0);
      const weights = await accessor(glb, prim.attributes.WEIGHTS_0);
      for (let v = 0; v < pos.length; v++) {
        let p = [0, 0, 0];
        for (let k = 0; k < 4; k++) { const w = weights[v][k]; if (w <= 0) continue; const q = apply(jointWorld[joints[v][k]], pos[v]); p = [p[0] + q[0] * w, p[1] + q[1] * w, p[2] + q[2] * w]; }
        const wHand = joints[v].reduce((s, j, k) => s + (j === handJoint ? weights[v][k] : 0), 0);
        const wFinger = joints[v].reduce((s, j, k) => s + (fingerJoints.includes(j) ? weights[v][k] : 0), 0);
        if (wHand >= 0.5) pts.push(apply(inv, p));
        else if (wFinger >= 0.5) fingerPts.push(apply(inv, p));
      }
    }
    const stats = (arr) => {
      const n = arr.length; if (!n) return null;
      const c = [0, 1, 2].map((a) => arr.reduce((s, p) => s + p[a], 0) / n);
      const min = [0, 1, 2].map((a) => Math.min(...arr.map((p) => p[a]))), max = [0, 1, 2].map((a) => Math.max(...arr.map((p) => p[a])));
      return { count: n, centroid: c.map((v) => +v.toFixed(3)), min: min.map((v) => +v.toFixed(3)), max: max.map((v) => +v.toFixed(3)) };
    };
    result[hand] = { palm: stats(pts), fingers: stats(fingerPts) };
  }
  return result;
}
if (process.env.PALM_MODE) for (const file of process.argv.slice(2)) console.log(file.split("/").pop(), JSON.stringify(await measurePalms(file)));

export async function scanCarryBox(file) {
  const glb = parseGlb(file);
  const { json } = glb;
  const nodes = json.nodes;
  const parent = new Array(nodes.length).fill(-1);
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => { parent[c] = i; }));
  const byName = (name) => nodes.findIndex((n) => n.name === name);
  const anim = json.animations.find((a) => a.name === (process.env.SCAN_CLIP ?? "CarryBox"));
  const channels = [];
  let duration = 0;
  for (const ch of anim.channels) {
    const sm = anim.samplers[ch.sampler];
    const times = (await accessor(glb, sm.input)).map((r) => r[0]);
    const values = await accessor(glb, sm.output);
    duration = Math.max(duration, times[times.length - 1]);
    channels.push({ node: ch.target.node, path: ch.target.path, times, values });
  }
  const handL = byName("Hand_L"), handR = byName("Hand_R"), chest = byName("Chest2");
  const rows = [];
  for (let k = 0; k <= 60; k++) {
    const t = (k / 60) * duration;
    const locals = nodes.map((n) => ({ t: n.translation ?? [0, 0, 0], r: n.rotation ?? [0, 0, 0, 1], s: n.scale ?? [1, 1, 1] }));
    for (const ch of channels) {
      const { times, values } = ch;
      let i = 0; while (i < times.length - 2 && times[i + 1] <= t) i++;
      const j = Math.min(i + 1, times.length - 1);
      const span = times[j] - times[i];
      const a = span > 0 ? Math.min(1, Math.max(0, (t - times[i]) / span)) : 0;
      const value = ch.path === "rotation" ? slerp(values[i], values[j], a) : values[i].map((v, q) => v + (values[j][q] - v) * a);
      if (ch.path === "rotation") locals[ch.node].r = value; else if (ch.path === "translation") locals[ch.node].t = value; else locals[ch.node].s = value;
    }
    const mats = locals.map((l) => trs(l.t, l.r, l.s));
    const world = new Array(nodes.length);
    const get = (i) => { if (world[i]) return world[i]; world[i] = parent[i] < 0 ? mats[i] : mul(get(parent[i]), mats[i]); return world[i]; };
    const wl = apply(get(handL), [0, 0.04, 0]), wr = apply(get(handR), [0, 0.04, 0]), c = apply(get(chest), [0, 0, 0]);
    rows.push({ t: +t.toFixed(2), dy: +(wl[1] - wr[1]).toFixed(3), dz: +(wl[2] - wr[2]).toFixed(3), span: +Math.hypot(wl[0] - wr[0], wl[1] - wr[1], wl[2] - wr[2]).toFixed(3), front: +(((wl[2] + wr[2]) / 2) - c[2]).toFixed(3), height: +(((wl[1] + wr[1]) / 2) - c[1]).toFixed(3) });
  }
  return { duration: +duration.toFixed(3), rows };
}
if (process.env.SCAN_MODE) for (const file of process.argv.slice(2)) { const r = await scanCarryBox(file); console.log(file.split("/").pop(), "duration", r.duration); console.log(r.rows.map((x) => `t=${x.t} dy=${x.dy} dz=${x.dz} span=${x.span} front=${x.front} h=${x.height}`).join("\n")); }
