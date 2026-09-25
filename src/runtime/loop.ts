import { createSyntheticCrowdPublisher, createSyntheticEmployeeRoster } from "./crowdFeed";
import { FrameMetrics } from "./metrics";
import { PlaceholderScene } from "./scene";
import { SnapshotSimulation } from "./snapshot";

/**
 * The only animation frame in this runtime. Simulation steps at 5 Hz inside
 * that callback; the scene draws the interpolated pose on the same tick.
 * The callback records counters and returns. The panel reads them later.
 */
export class RuntimeLoop {
  // Phase 4: `crowdFeed.ts` publishes synthetic customers/employees through
  // `publishLiveActors` on every committed tick; the scene's crowd systems
  // read them from there, not from the interpolated pose buffer below.
  private readonly simulation = new SnapshotSimulation(undefined, createSyntheticCrowdPublisher(createSyntheticEmployeeRoster()));
  private readonly metrics = new FrameMetrics();
  private readonly scene: PlaceholderScene;
  private frame = 0;
  private lastMs = 0;
  private running = false;
  private rafActive = false;

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new PlaceholderScene(canvas);
  }

  /**
   * The first animation frame waits only on the baked store, never on the
   * crowd: `crowdReady` is awaited separately so ~18.5 MB of bodies and
   * baked animations cannot delay the store's own first frame.
   */
  start() {
    if (this.running) return Promise.resolve();
    this.running = true;
    void this.scene.crowdReady.then(() => {
      this.metrics.markCrowdReady(this.scene.crowdReadyAtMs);
      this.metrics.setCrowdBytes(this.scene.crowdBytes);
    });
    return this.scene.ready.then(() => {
      if (!this.running || this.rafActive) return;
      this.rafActive = true;
      this.lastMs = 0;
      this.frame = window.requestAnimationFrame(this.tick);
    });
  }

  /** Drops the hidden-tab gap so it is not recorded as a stutter. */
  suspend() {
    this.running = false;
    this.rafActive = false;
    window.cancelAnimationFrame(this.frame);
    this.lastMs = 0;
  }

  resume() {
    if (this.running) return;
    this.start();
  }

  stop() {
    this.running = false;
    this.rafActive = false;
    window.cancelAnimationFrame(this.frame);
    this.scene.dispose();
  }

  resize() {
    this.scene.resize();
  }

  /** Read by the panel timer, never by the animation callback. */
  snapshot() {
    return this.metrics.publish();
  }

  resetStats() {
    this.metrics.reset();
  }

  private readonly tick = (now: number) => {
    if (!this.running) return;
    this.metrics.markRaf();
    const delta = this.lastMs === 0 ? 0 : now - this.lastMs;
    this.lastMs = now;
    const workStarted = performance.now();
    const pose = this.simulation.sample(delta);
    const stats = this.scene.render(pose, delta);
    const workMs = performance.now() - workStarted;
    this.metrics.markRender();
    if (delta === 0) this.metrics.markLoad(now);
    else this.metrics.addFrame(workMs, delta, stats.drawCalls, stats.triangles);
    this.frame = window.requestAnimationFrame(this.tick);
  };
}
