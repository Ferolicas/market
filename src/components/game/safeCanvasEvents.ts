import { events as createPointerEvents, type RootStore } from "@react-three/fiber";

// R3F configures its event manager asynchronously. React 19 can unmount a short-lived
// preview Canvas before that promise resolves, so the default connector may receive null.
export function safeCanvasEvents(store: RootStore) {
  const manager = createPointerEvents(store);
  const connect = manager.connect?.bind(manager);
  return {
    ...manager,
    connect(target: HTMLElement) {
      if (target) connect?.(target);
    },
  };
}
