import path from "node:path";
import { defineConfig } from "vitest/config";

// Route handlers import through the `@/` alias of tsconfig; the unit tests
// that load them need the same resolution.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { include: ["src/**/*.test.ts", "src/**/*.test.tsx"] },
});
