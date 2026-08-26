<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Mini Market project rules

- Private browser-first 3D supermarket simulator, installable as a PWA.
- Stack: Next.js 16.3.3, React 19, TypeScript, React Three Fiber 9, PostgreSQL 17, Prisma 7 and Better Auth.
- Use pnpm. Production is native Node under PM2; never introduce Docker or Nginx on the holding VPS.
- Domain/process/port: `market.olcas.app`, PM2 `market`, port `4010`, database `market_db`.
- The server is authoritative for accounts and save revisions. Preserve local recovery and optimistic concurrency.
- Money is always an integer in minor units. Apply `countryMoneyScale` to base catalog amounts.
- Simulation rules stay pure in `src/game/engine.ts` and covered by Vitest. 3D code dispatches actions; it does not duplicate economy rules.
- Every API route authenticates with Better Auth unless explicitly public (`/api/health`).
- Update `docs/PROJECT-MAP.md` when routes, models, game systems or deployment change.
- Before push: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
