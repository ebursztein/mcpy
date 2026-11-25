# mcpy: working rules

Read `docs/ARCHITECTURE.md` before changing code. The short version:

- `packages/mcpy` is the SDK (published to npm as `mcpy`). `apps/server` is
  the Cloudflare Worker built on it. The server imports only the public SDK
  entry points (`mcpy`, `mcpy/providers`, `mcpy/mcp`, `mcpy/telemetry`).
- Callers never see provider names. Public schemas have no provider field.
- Providers call the network only through `HttpClient`; JSON is parsed with zod.
- Categorical values are `z.enum`s with exported constants. No free-form
  strings for things with a fixed set of values.
- Every source file stays under 300 lines (`test/structure.test.ts` enforces it).
- Every bug fix lands with a regression test in `test/regression/`.
- Never commit secrets. Local secrets live in `apps/server/.dev.vars` (gitignored).

Commands (from the repo root):

```bash
npm test            # unit, contract, regression, structure, perf
npm run test:e2e    # boots the Worker locally and exercises MCP + REST against elie.net
npm run test:live   # real provider APIs (needs keys in apps/server/.dev.vars)
npm run typecheck
npm run build       # builds the SDK to packages/mcpy/dist
```
