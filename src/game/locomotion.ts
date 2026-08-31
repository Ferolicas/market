import { CHECKOUT_LANES, checkoutQueuePosition } from "./stations/checkout-layout";

const FULL_TURN = Math.PI * 2;

export function frameDelta(delta: number) {
  return Math.min(Math.max(delta, 0), 0.05);
}

export function dampFactor(response: number, delta: number) {
  return 1 - Math.exp(-response * frameDelta(delta));
}

export function turnTowards(current: number, target: number, maxStep: number) {
  const difference = ((target - current + Math.PI) % FULL_TURN + FULL_TURN) % FULL_TURN - Math.PI;
  if (Math.abs(difference) <= maxStep) return target;
  return current + Math.sign(difference) * maxStep;
}

export function travelProgress(progress: number, ramp = 0.14) {
  const value = Math.min(1, Math.max(0, progress));
  const edge = Math.min(0.45, Math.max(0.02, ramp));
  const area = 1 - edge;
  if (value < edge) return (value * value) / (2 * edge * area);
  if (value > 1 - edge) {
    const remaining = 1 - value;
    return 1 - (remaining * remaining) / (2 * edge * area);
  }
  return (value - edge / 2) / area;
}

export type VisitorAnimation = "Idle" | "Walk" | "Enter" | "Wait" | "Browse" | "ReachShelf" | "CarryBasket" | "Queue" | "LookAround" | "Phone" | "Impatient" | "Talk" | "CheckoutItem" | "Pay" | "ReceiveBag" | "Confused" | "Happy" | "Exit";

export interface VisitorPose {
  animation: VisitorAnimation;
  position: [number, number];
  target: [number, number];
  visible: boolean;
}

type Point = [number, number];

export interface VisitorRoute {
  browse: Point;
  queue: Point;
  enterVia: Point[];
  queueVia: Point[];
}

export const VISITOR_ROUTES: Record<number, VisitorRoute> = {
  1: { browse: [-4.1, -0.9], queue: checkoutQueuePosition(0), enterVia: [[-2.2, 5.6], [-2.2, 0.45]], queueVia: [[-4.1, 0.45], [5.35, 0.45]] },
  2: { browse: [0, -3.35], queue: checkoutQueuePosition(1), enterVia: [[2.15, 5.6], [2.15, -3.35]], queueVia: [[2.15, -3.35], [5.35, -3.35]] },
  3: { browse: [4.1, -0.9], queue: checkoutQueuePosition(2), enterVia: [[2.2, 5.6], [2.2, 0.45]], queueVia: [[5.35, -0.9]] },
  4: { browse: [-4.0, 4.15], queue: checkoutQueuePosition(3), enterVia: [[-2.2, 5.6]], queueVia: [[5.35, 4.15]] },
  5: { browse: [0, 4.2], queue: checkoutQueuePosition(4), enterVia: [[0, 5.6]], queueVia: [[5.35, 4.2]] },
  6: { browse: [4.0, 4.15], queue: checkoutQueuePosition(5), enterVia: [[2.2, 5.6]], queueVia: [[5.35, 4.15]] },
};

const CUSTOMER_CHECKOUT: Point = [...CHECKOUT_LANES[0].customerFront];

export function sampleVisitorJourney(time: number, entryX: number, route: VisitorRoute, confused = false): VisitorPose {
  const { browse, queue } = route;
  let animation: VisitorAnimation = "Idle";
  let position: [number, number] = [entryX, 5.25];
  let target: [number, number] = [entryX, 4.25];

  if (time < 7) {
    const progress = travelProgress(time / 7);
    const path = [[entryX, 15.2], ...route.enterVia, browse] satisfies Point[];
    position = mixPath(path, progress);
    target = mixPath(path, Math.min(1, progress + 0.025));
    animation = "Enter";
  } else if (time < 13) {
    position = browse;
    target = [browse[0] + (entryX < 0 ? -1 : 1), browse[1]];
    animation = "Browse";
  } else if (time < 17) {
    position = browse;
    target = [browse[0] + (entryX < 0 ? -1 : 1), browse[1]];
    animation = "ReachShelf";
  } else if (time < 25) {
    const progress = travelProgress((time - 17) / 8);
    const path = [browse, ...route.queueVia, queue];
    position = mixPath(path, progress);
    target = mixPath(path, Math.min(1, progress + 0.025));
    animation = progress < 0.35 ? "Walk" : "CarryBasket";
  } else if (time < 29) {
    position = queue;
    target = [7.45, 3.95];
    animation = confused ? "Confused" : "Queue";
  } else if (time < 30.5) {
    const progress = travelProgress((time - 29) / 1.5, 0.2);
    position = mixPoint(queue, CUSTOMER_CHECKOUT, progress);
    target = CUSTOMER_CHECKOUT;
    animation = "CarryBasket";
  } else if (time < 33) {
    position = CUSTOMER_CHECKOUT;
    target = [7.55, 3.95];
    animation = "CheckoutItem";
  } else if (time < 35) {
    position = CUSTOMER_CHECKOUT;
    target = [7.55, 3.95];
    animation = "Pay";
  } else if (time < 37) {
    position = CUSTOMER_CHECKOUT;
    target = [7.55, 3.95];
    animation = "ReceiveBag";
  } else if (time < 41) {
    const progress = travelProgress((time - 37) / 4);
    const exitPath = [CUSTOMER_CHECKOUT, [5.35, 5.6], [entryX, 5.6], [entryX, 8.65]] satisfies Point[];
    position = mixPath(exitPath, progress);
    target = mixPath(exitPath, Math.min(1, progress + 0.025));
    animation = "Exit";
  } else {
    const progress = travelProgress((time - 41) / 6);
    position = [entryX, mix(8.65, 15.4, progress)];
    target = [entryX, 16];
    animation = "Exit";
  }

  return { animation, position, target, visible: time < 47.5 };
}

function mix(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function mixPoint(start: [number, number], end: [number, number], progress: number): [number, number] {
  return [mix(start[0], end[0], progress), mix(start[1], end[1], progress)];
}

function mixPath(points: Point[], progress: number): Point {
  if (points.length < 2) return points[0] ?? [0, 0];
  const lengths = points.slice(1).map((point, index) => Math.hypot(point[0] - points[index][0], point[1] - points[index][1]));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let distance = Math.min(1, Math.max(0, progress)) * total;
  for (let index = 0; index < lengths.length; index += 1) {
    if (distance <= lengths[index] || index === lengths.length - 1) {
      return mixPoint(points[index], points[index + 1], lengths[index] ? distance / lengths[index] : 1);
    }
    distance -= lengths[index];
  }
  return points.at(-1) ?? [0, 0];
}
