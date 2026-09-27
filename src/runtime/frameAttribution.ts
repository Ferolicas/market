import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * Per-frame cost attribution for `/runtime`'s worldKit integral test ONLY —
 * constructed exclusively from `ClientRuntime` when `worldKit && debug` are
 * both true (see its call site). `/` and `/play2` never construct this class,
 * so their behaviour is byte-for-byte unchanged.
 *
 * Built for the 2026-09-27 tail-latency investigation: the owner's real
 * 15-minute iPhone playtest of build f1698c5 already has GOOD averages
 * (work avg 3.2ms/p95 5.1ms/p99 7.0ms) but a real `maxWorkMs` of 146.2ms and
 * `maxGapMs` of 154ms — anomalous tail frames `IntegralMetrics`'s histograms
 * already prove exist, but never explains WHY. This attributes each frame's
 * `workMs` to a small number of real subsystems (physics/crowd/stations/
 * worldTick/render/other), and separately records asset-loading events
 * (GLTF parse, GL compile/link/texture-upload counts, in-flight loader
 * count) that happen BETWEEN frames — i.e. as `gapMs`, not `workMs` — since
 * those fire from promise continuations outside the rAF loop.
 *
 * Cost is bounded and cannot become part of what it measures: every
 * `performance.now()` pair is one already-required call site (the same
 * subsystem calls `ClientRuntime.present()` always makes), the GL patch is a
 * counter increment (no per-call `performance.now()`), and the spike buffer
 * is capped at `MAX_SPIKES` entries, replacing the smallest recorded spike
 * once full — never an unbounded array over a 15+ minute session.
 */

export interface FrameBreakdown {
  physics: number;
  crowd: number;
  stations: number;
  worldTick: number;
  render: number;
  other: number;
}

export interface FrameSpike {
  t: number;
  workMs: number;
  gapMs: number;
  breakdown: FrameBreakdown;
  glCompileCount: number;
  glLinkCount: number;
  glTexUploadCount: number;
  assetLoadsInFlight: number;
  heapMb: number | null;
  longTaskMsSinceLastFrame: number;
}

export interface AsyncEvent {
  t: number;
  durMs: number;
  label: string;
}

/** Well above p99 (7ms in the owner's real session) but far below the
 * 100-150ms anomalous tail — catches genuine anomalies, not routine noise. */
const SPIKE_THRESHOLD_MS = 20;
const MAX_SPIKES = 200;
const MAX_ASYNC_EVENTS = 300;

let gltfParsePatched = false;

export class FrameAttribution {
  current: FrameBreakdown = { physics: 0, crowd: 0, stations: 0, worldTick: 0, render: 0, other: 0 };
  private readonly spikes: FrameSpike[] = [];
  private readonly gltfParseEvents: AsyncEvent[] = [];
  private glCompileCount = 0;
  private glLinkCount = 0;
  private glTexUploadCount = 0;
  private longTaskMs = 0;
  private longTaskObserver: PerformanceObserver | null = null;

  constructor(
    private readonly getAssetLoadsInFlight: () => number,
    private readonly getHeapMb: () => number | null,
  ) {
    this.patchGl();
    this.patchGltfParse();
    this.observeLongTasks();
  }

  /** Counts only — no per-call timestamp — so a burst of texture uploads
   * (e.g. `warmUpTexturesIdle`'s chunked upload) never itself adds
   * measurable overhead to the thing it is trying to explain. */
  private patchGl() {
    const patch = (proto: unknown, name: string, onCall: () => void) => {
      const target = proto as Record<string, unknown>;
      const original = target[name];
      if (typeof original !== "function") return;
      target[name] = function (this: unknown, ...args: unknown[]) {
        onCall();
        return (original as (...a: unknown[]) => unknown).apply(this, args);
      };
    };
    for (const ctor of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      if (!ctor) continue;
      patch(ctor.prototype, "compileShader", () => { this.glCompileCount += 1; });
      patch(ctor.prototype, "linkProgram", () => { this.glLinkCount += 1; });
      patch(ctor.prototype, "texImage2D", () => { this.glTexUploadCount += 1; });
      patch(ctor.prototype, "texSubImage2D", () => { this.glTexUploadCount += 1; });
    }
  }

  /** `GLTFLoader.parse()` is synchronous CPU work invoked from a fetch's
   * `.then()` continuation — a real main-thread task entirely OUTSIDE the
   * rAF loop. A slow parse there delays the next `requestAnimationFrame`
   * callback, showing up as `gapMs`, never `workMs` — this is why it is
   * recorded as its own timestamped event, not folded into `FrameBreakdown`.
   * Patched once, module-scope (a second `FrameAttribution` instance, which
   * never happens in practice — one `ClientRuntime` per page — would just
   * skip re-patching). */
  private patchGltfParse() {
    if (gltfParsePatched) return;
    gltfParsePatched = true;
    const recordGltfParse = this.recordGltfParse.bind(this);
    const proto = GLTFLoader.prototype as unknown as {
      parse: (data: ArrayBuffer | string, path: string, onLoad: (gltf: unknown) => void, onError?: (error: unknown) => void) => void;
    };
    const original = proto.parse;
    proto.parse = function (data, path, onLoad, onError) {
      const start = performance.now();
      const wrappedLoad = (gltf: unknown) => {
        recordGltfParse(performance.now() - start, path);
        onLoad(gltf);
      };
      const wrappedError = (error: unknown) => {
        recordGltfParse(performance.now() - start, `${path} (error)`);
        onError?.(error);
      };
      original.call(this, data, path, wrappedLoad, wrappedError);
    };
  }

  private recordGltfParse(durMs: number, label: string) {
    if (this.gltfParseEvents.length >= MAX_ASYNC_EVENTS) this.gltfParseEvents.shift();
    this.gltfParseEvents.push({ t: performance.now(), durMs, label });
  }

  private readonly asyncEvents: AsyncEvent[] = [];

  /** Times any call that runs OUTSIDE the rAF loop (e.g. `setProps`, fired
   * from React's own passive-effect flush on every world tick/HUD change —
   * see `ClientRuntime.setProps`'s call site) — same reasoning as
   * `patchGltfParse`'s doc comment: a slow call here shows up as `gapMs`
   * between two rAF frames, never as `workMs`, so it needs its own
   * timestamped record instead of folding into `FrameBreakdown`. Below
   * `minMs` is real, ordinary cost — not recorded, so this can never grow
   * into a log of every routine call. */
  markAsync<T>(label: string, fn: () => T, minMs = 4): T {
    const start = performance.now();
    try {
      return fn();
    } finally {
      const dur = performance.now() - start;
      if (dur >= minMs) {
        if (this.asyncEvents.length >= MAX_ASYNC_EVENTS) this.asyncEvents.shift();
        this.asyncEvents.push({ t: performance.now(), durMs: dur, label });
      }
    }
  }

  getAsyncEvents(): AsyncEvent[] {
    return this.asyncEvents.slice();
  }

  private observeLongTasks() {
    if (typeof PerformanceObserver === "undefined" || !(PerformanceObserver.supportedEntryTypes?.includes("longtask"))) return;
    try {
      this.longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) this.longTaskMs += entry.duration;
      });
      this.longTaskObserver.observe({ type: "longtask" });
    } catch {
      this.longTaskObserver = null;
    }
  }

  dispose() {
    this.longTaskObserver?.disconnect();
    this.longTaskObserver = null;
  }

  /** Brackets `fn` and adds its cost to `current[key]` — the one shared code
   * path `ClientRuntime.present()` runs whether or not attribution is
   * active (see its call site: a no-op passthrough when this class isn't
   * constructed at all). */
  mark<T>(key: keyof FrameBreakdown, fn: () => T): T {
    const start = performance.now();
    try {
      return fn();
    } finally {
      this.current[key] += performance.now() - start;
    }
  }

  addWorldTick(ms: number) {
    this.current.worldTick += ms;
  }

  /** Called once per rendered frame, after `workMs`/`gapMs` are known. */
  endFrame(workMs: number, gapMs: number) {
    if (workMs >= SPIKE_THRESHOLD_MS) {
      const attributed = this.current.physics + this.current.crowd + this.current.stations + this.current.worldTick + this.current.render;
      const snapshot: FrameSpike = {
        t: performance.now(),
        workMs,
        gapMs,
        breakdown: { ...this.current, other: Math.max(0, workMs - attributed) },
        glCompileCount: this.glCompileCount,
        glLinkCount: this.glLinkCount,
        glTexUploadCount: this.glTexUploadCount,
        assetLoadsInFlight: this.getAssetLoadsInFlight(),
        heapMb: this.getHeapMb(),
        longTaskMsSinceLastFrame: this.longTaskMs,
      };
      if (this.spikes.length < MAX_SPIKES) {
        this.spikes.push(snapshot);
      } else {
        let minIndex = 0;
        for (let index = 1; index < this.spikes.length; index += 1) if (this.spikes[index].workMs < this.spikes[minIndex].workMs) minIndex = index;
        if (snapshot.workMs > this.spikes[minIndex].workMs) this.spikes[minIndex] = snapshot;
      }
    }
    this.glCompileCount = 0;
    this.glLinkCount = 0;
    this.glTexUploadCount = 0;
    this.longTaskMs = 0;
    this.current = { physics: 0, crowd: 0, stations: 0, worldTick: 0, render: 0, other: 0 };
  }

  getSpikes(): FrameSpike[] {
    return this.spikes.slice().sort((a, b) => b.workMs - a.workMs);
  }

  getGltfParseEvents(): AsyncEvent[] {
    return this.gltfParseEvents.slice();
  }
}
