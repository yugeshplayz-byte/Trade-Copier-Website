# ADR 0002: Environment guard and deny-by-default dispatch gate

Status: proposed (Phase 1, pending review) · Date: 2026-10-11

## Context

Phase 1 acceptance requires a clear environment mode, refusal of production credentials in test mode, and that no broker order can be sent. SECURITY.md and DEPLOYMENT.md require startup guards that abort before an order is possible.

## Decision

### Startup guard (`packages/config`)

Both the web app and the worker validate configuration through `loadConfig`. Every problem is reported at once. A problem names the variable but never echoes its value.

| Rule | Behaviour |
|---|---|
| `APP_ENV` | Required, with no default. One of `LOCAL`, `TEST`, `STAGING`, `PRODUCTION`. |
| `APP_ENV=PRODUCTION` | Refused. No provider, billing or identity configuration is certified. |
| `BROKER_MODE` | Only `SIMULATED` is accepted. Practice and live values are unrepresentable. |
| Provider credentials | Any non-empty `TRADOVATE_*`, `NINJATRADER_*`, `RITHMIC_*`, `PROJECTX_*`, `TOPSTEPX_*`, `TOPSTEP_*`, `CQG_*`, or `BROKER_*` variable other than `BROKER_MODE` is refused in every environment. |
| Live payment keys | `sk_live_`, `rk_live_` and `pk_live_` values are refused outside production. |
| `DATABASE_URL` | In `LOCAL` and `TEST`, it must use a loopback host. |

On refusal, the worker exits with code 78 (EX_CONFIG) after its log line drains. The web app renders a "Configuration refused" page listing the variable names, and logs the refusal at startup through `instrumentation.ts`.

### Dispatch gate (`apps/worker/src/dispatch-gate.ts`)

`evaluateDispatch` is the final egress check the account coordinator must pass before any outbound command. Checks run in order: production refusal, then provider status (`BLOCKED`, then `NOT_APPROVED`, from the provider register), then permitted broker environment, then adapter registration. The adapter registry is empty in this build, so every combination is denied, and a test enumerates all of them. Later phases add ownership epoch, control latch and risk revalidation in front of the adapter check.

TopstepX is `BLOCKED` in the register under the published restriction [S04]. Tradovate, NinjaTrader, Rithmic and ProjectX are `NOT_APPROVED`. The simulator is `INTERNAL_TEST_ONLY` and may only route `SIMULATED`.

### Health contract

The worker serves `GET /healthz` on 127.0.0.1 only. The schema (`packages/contracts`) pins `orderDispatch.enabled` to the literal `false`, so a document claiming dispatch is enabled fails validation in the web app. The web app shows the worker as running only when the document validates, its environment matches the app's, and the heartbeat is no older than 15 s. Otherwise it shows stale, environment mismatch, invalid or not running.

### Logging

`packages/observability` redacts sensitive keys (matched as whole words, so `tradingSession` is not masked) and secret-shaped values: bearer tokens, payment keys, JWTs, private keys, and credentials embedded in URLs. Errors keep only their name and redacted message.

## Consequences

- Phase 3 registers the simulator adapter in the gate. A real provider requires a register change backed by written evidence, plus certification.
- The health endpoint has no authentication; it is loopback-only and carries no account data. The web read route `/api/v1/system/worker-health` gains session authorization in Phase 2.
- A nonce-based CSP replaces the current static policy (`'unsafe-inline'` scripts) once authentication brings per-request rendering.
