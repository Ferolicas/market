import type { CustomerRuntimeState, Employee, EmployeeRole, EmployeeRuntimeState, HatId } from "@/game/types";
import { publishLiveActors } from "@/game/render/LiveActors";
import { HAT_FILES } from "@/game/render/CrowdSystems";
import { RUNTIME_CONTRACT } from "./contract";
import { POSE_STRIDE, writePlaceholderPose, type SnapshotStepListener } from "./snapshot";

/** All 12 hat kinds, in a fixed order — the diversity phase's round-robin source. */
const HAT_IDS = Object.keys(HAT_FILES) as HatId[];

/**
 * Data adapter (phase 4, extended in phase 5 with a constant cart/basket):
 * turns one committed SnapshotSimulation tick into the same
 * CustomerRuntimeState/EmployeeRuntimeState shapes production already feeds
 * through `publishLiveActors`, so `CrowdCustomersSystem` and
 * `CrowdEmployeesSystem` render them with zero new logic of their own. The
 * positions are the same deterministic circular walk `writePlaceholderPose`
 * already used for the base-phase markers — not the real store layout.
 */

/** Level-30 staff roster: 8 farmer-stockers, 3 feeders, 5 operators, 3 cashiers
 * (`campaignEmployeeLimit`, all three cashier levels unlocked). */
const EMPLOYEE_ROLE_SEQUENCE: readonly EmployeeRole[] = [
  ...Array<EmployeeRole>(8).fill("farmer"),
  ...Array<EmployeeRole>(3).fill("feeder"),
  ...Array<EmployeeRole>(5).fill("operator"),
  ...Array<EmployeeRole>(3).fill("cashier"),
];

/** `writePlaceholderPose` advances its angle by 0.35 rad every committed
 * tick (200 ms), so ω = 0.35 / 0.2 = 1.75 rad/s; tangential speed = r·ω. */
const ANGULAR_SPEED_PER_SEC = 0.35 / (RUNTIME_CONTRACT.simulationStepMs / 1_000);
const orbitRadius = (actorIndex: number) => 1.6 + (actorIndex % 6) * 0.35;

/** Static roster (id/role/level/hat never change tick to tick). Built once
 * and reused by both `CrowdEmployeesSystem.setEmployees` and every tick's
 * `publishLiveActors` call, matched by `id`. */
export function createSyntheticEmployeeRoster(): Employee[] {
  return EMPLOYEE_ROLE_SEQUENCE.map((role, index) => ({
    id: `runtime-employee-${index}`,
    name: `Runtime Employee ${index}`,
    role,
    level: 1,
    salaryMinor: 0,
    energy: 1,
    // Diversity phase: round-robin through all 12 kinds, deterministic by index.
    hat: HAT_IDS[index % HAT_IDS.length],
  }));
}

const nextTickPose = new Float32Array(RUNTIME_CONTRACT.placeholderActors * POSE_STRIDE);

/**
 * Builds a `SnapshotSimulation.onStep` listener bound to a fixed roster. Each
 * call turns the just-committed pose buffer into this tick's synthetic
 * customers and employees, projects one tick ahead for `path`/`targetX`/
 * `targetZ` (what `captureCustomerMotion` + `projectCustomerMotion` need to
 * extrapolate smoothly between ticks), and publishes them exactly as the real
 * game's store does — `CrowdCustomersSystem`/`CrowdEmployeesSystem` do the rest.
 */
export function createSyntheticCrowdPublisher(roster: readonly Employee[]): SnapshotStepListener {
  return (pose, stepIndex, currentTimeMs) => publishSyntheticCrowd(pose, stepIndex, currentTimeMs, roster);
}

function publishSyntheticCrowd(pose: Float32Array, stepIndex: number, currentTimeMs: number, roster: readonly Employee[]) {
  writePlaceholderPose(nextTickPose, stepIndex + 1);
  const customerCount = RUNTIME_CONTRACT.crowdCustomerActors;
  const employeeCount = RUNTIME_CONTRACT.crowdEmployeeActors;

  const customers: CustomerRuntimeState[] = [];
  for (let index = 0; index < customerCount; index += 1) {
    const offset = index * POSE_STRIDE;
    const speed = orbitRadius(index) * ANGULAR_SPEED_PER_SEC;
    customers.push({
      id: `runtime-customer-${index}`,
      identity: ((index % 6) + 1) as CustomerRuntimeState["identity"],
      state: "ENTER_STORE",
      shoppingList: [],
      currentLine: 0,
      basket: {},
      patienceMs: 0,
      checkoutPatienceMs: 0,
      waitingSince: null,
      queueSlot: null,
      transactionId: null,
      // Phase 5: a cart is always in hand, constant — no get/return cart logic.
      hasCart: true,
      hasBag: false,
      angry: false,
      x: pose[offset],
      z: pose[offset + 1],
      targetX: nextTickPose[offset],
      targetZ: nextTickPose[offset + 1],
      path: [[nextTickPose[offset], nextTickPose[offset + 1]]],
      pathIndex: 0,
      speed,
      currentSpeed: speed,
      stateSince: currentTimeMs,
      reservedSocketId: null,
      blockedSince: null,
      routeFailures: 0,
    });
  }

  const employeeRuntimes: { id: string; runtime: EmployeeRuntimeState }[] = [];
  for (let index = 0; index < employeeCount; index += 1) {
    const actorIndex = customerCount + index;
    const offset = actorIndex * POSE_STRIDE;
    const speed = orbitRadius(actorIndex) * ANGULAR_SPEED_PER_SEC;
    employeeRuntimes.push({
      id: roster[index].id,
      runtime: {
        state: "NAVIGATE_PICKUP",
        assignedProduct: null,
        assignedStationId: null,
        // Phase 5: the minimum non-zero carry that makes CrowdEmployeesSystem
        // draw the basket (`carryTotal > 0`) — one unit, constant, no real
        // pickup/dropoff gameplay behind it.
        carry: { capacity: 1, items: { wheat: 1 } },
        x: pose[offset],
        z: pose[offset + 1],
        targetX: nextTickPose[offset],
        targetZ: nextTickPose[offset + 1],
        path: [[nextTickPose[offset], nextTickPose[offset + 1]]],
        pathIndex: 0,
        speed,
        currentSpeed: speed,
        stateSince: currentTimeMs,
      },
    });
  }

  publishLiveActors(customers, [], employeeRuntimes, currentTimeMs);
}
