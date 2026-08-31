import type { CustomerRuntimeState, EmployeeRuntimeState } from "../types";
import { CUSTOMER_VISUAL_HORIZON_MS } from "../core/timing";

const MOVING_STATES = new Set<CustomerRuntimeState["state"]>([
  "ENTER_STORE",
  "NAVIGATE_TO_PRODUCT",
  "NAVIGATE_TO_QUEUE",
  "MOVE_QUEUE",
  "NAVIGATE_TO_BAG",
  "NAVIGATE_TO_RETURNS",
  "NAVIGATE_TO_CART_RETURN",
  "EXIT_STORE",
]);

const MOVING_EMPLOYEE_STATES = new Set<EmployeeRuntimeState["state"]>([
  "NAVIGATE_PICKUP",
  "NAVIGATE_DROPOFF",
  "NAVIGATE_CHECKOUT",
]);

export interface CustomerMotionSnapshot {
  x: number;
  z: number;
  targetX: number;
  targetZ: number;
  path: [number, number][];
  speed: number;
  moving: boolean;
  capturedAtMs: number;
}

export function captureCustomerMotion(customer: CustomerRuntimeState, capturedAtMs: number): CustomerMotionSnapshot {
  return {
    x: customer.x,
    z: customer.z,
    targetX: customer.targetX,
    targetZ: customer.targetZ,
    path: customer.path.slice(customer.pathIndex),
    speed: Math.max(0, customer.currentSpeed ?? customer.speed),
    moving: MOVING_STATES.has(customer.state),
    capturedAtMs,
  };
}

export function captureEmployeeMotion(employee: EmployeeRuntimeState, capturedAtMs: number): CustomerMotionSnapshot {
  return {
    x: employee.x,
    z: employee.z,
    targetX: employee.targetX,
    targetZ: employee.targetZ,
    path: employee.path.slice(employee.pathIndex),
    speed: Math.max(0, employee.currentSpeed ?? employee.speed),
    moving: MOVING_EMPLOYEE_STATES.has(employee.state),
    capturedAtMs,
  };
}

export function projectCustomerMotion(snapshot: CustomerMotionSnapshot, nowMs: number, horizonMs = CUSTOMER_VISUAL_HORIZON_MS) {
  const waypoints = snapshot.path.length ? snapshot.path : [[snapshot.targetX, snapshot.targetZ] as [number, number]];
  if (!snapshot.moving || snapshot.speed <= 0 || !waypoints.some(([x, z]) => Math.hypot(x - snapshot.x, z - snapshot.z) > 0.0001)) {
    return { x: snapshot.x, z: snapshot.z, headingX: 0, headingZ: 0 };
  }

  // World state is authoritative at a fixed interval. Project only through a
  // short safe horizon around the next expected snapshot so the render advances
  // continuously without inventing a route or leaving the NavMesh polyline.
  const elapsedSeconds = Math.min(Math.max(0, nowMs - snapshot.capturedAtMs), horizonMs) / 1_000;
  let remaining = snapshot.speed * elapsedSeconds;
  let x = snapshot.x; let z = snapshot.z;
  let headingX = 0; let headingZ = 0;
  for (const [targetX, targetZ] of waypoints) {
    const dx = targetX - x; const dz = targetZ - z; const distance = Math.hypot(dx, dz);
    if (distance <= 0.0001) continue;
    headingX = dx / distance; headingZ = dz / distance;
    if (remaining < distance) {
      x += headingX * remaining; z += headingZ * remaining;
      remaining = 0;
      break;
    }
    x = targetX; z = targetZ; remaining -= distance;
    if (remaining <= 0) break;
  }
  return { x, z, headingX, headingZ };
}
