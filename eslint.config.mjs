import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The Unity client is a separate project: its WebGL payloads are engine
    // output, not source, and linting them reports emscripten's own patterns
    // (aliased `this`, a GLctx.useProgram call read as a React hook) as errors.
    "Unity/**",
  ]),
]);

export default eslintConfig;
