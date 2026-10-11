# Deployment and recovery architecture

## Environment matrix

| Area | LOCAL | STAGING | PRODUCTION |
|---|---|---|---|
| Compute | User's existing Windows project, local web and worker | Persistent isolated containers | Persistent paid worker(s), web/control service, independent monitoring |
| Broker | Simulator default | Simulator plus explicitly permitted provider practice | Approved adapters/account classes only |
| Database | Local PostgreSQL via supported local install/container | Dedicated managed DB | Managed encrypted PostgreSQL with backup/PITR and availability plan |
| Identity | Development tenant/client | Separate staging client | Production client, MFA and audited admin |
| Billing | Fixtures/test mode | Test mode/webhook tests | Approved merchant/live billing |
| Secrets | Ignored local file with test values | Separate secret store and keys | Managed KMS/secrets, worker-scoped roles |
| Egress | Simulator only by default | Provider practice endpoint/account allowlist | Certified routing allowlist, enforceable writer fencing |

## Hosting decision

Reference production setup: AWS ECS/Fargate services for web/control and persistent execution containers, managed PostgreSQL, KMS/secrets, load balancer/TLS, restricted object storage for audit exports, and independent monitoring. AWS documents Fargate as a container compute option [S14]. Specific regions, quotas, pricing, backups, network costs and provider endpoint latency must be verified before provisioning. Prefer one region near approved provider infrastructure after measurement, not a guessed latency promise.

For a small beta a simpler always-on managed container host or VM is acceptable if it supports durable operations, predictable networking, secrets, backups, observability and enforceable single-writer recovery. Free sleeping tiers are unsuitable for active execution. GitHub is source control and CI; GitHub Pages/static hosting cannot operate server-side broker sessions. Next.js hosting can be separated later, but reducing initial service count is preferable.

Do not create cloud resources, purchase plans or deploy production as part of documentation work. Developer previews use simulator data and no production broker credentials.

## Local developer workflow

Claude inspects the current package manager and lockfile before installing dependencies. Use existing commands; add documented scripts only when needed. Run web, worker and DB locally, seed synthetic accounts, and expose a localhost URL to the user. Closing the browser does not stop the local worker, but shutting down the computer does. The production always-on requirement is met by hosting, not by a localhost preview.

Use explicit environment flags and startup guards. An environment mismatch or live-capable credentials in local/staging mode must abort before an order is possible. Provider practice accounts are allowlisted by verified account ID, not by a name containing 'demo'.

## CI/CD

On proposed application change: install locked dependencies → secret scan → lint/typecheck → domain/integration/fault tests → migration compatibility check → build → inspect artifact contents → simulator E2E. Test that `.agents/skills/`, `.env`, private agreements and credentials are absent from tracked files and build/deployment artifacts.

User reviews local preview and report before commit/push. Remote CI can then build a staging candidate; production deployment remains an explicit release action. Keep web and worker artifacts tied to the same protocol/schema compatibility matrix. Database changes use expand/migrate/contract patterns. Never automatically run destructive migrations on startup.

No deployment rolls two trading writers over the same account concurrently. During release: block new entries or drain a documented idle account scope, resolve in-flight commands, record checkpoint, terminate/fence old writer, start compatible new writer, resnapshot/reconcile, then resume only allowed scopes. Existing broker-held orders may continue to execute during this interval.

## Fencing and failover

Initial production is one active writer per execution shard, not an autoscaling competition for account leases. A standby can observe but cannot send. Database epoch fencing prevents stale database writes; it does not stop a stale process from reaching a broker. Use infrastructure/session/egress controls that can demonstrably disable old outbound order access before takeover. If termination or revocation is unproven, stay halted; do not guess after a timeout.

The account coordinator checks current epoch and kill state immediately before dispatch. Commands already in flight at a halt may still be accepted; surface and reconcile them. Document the remaining network ambiguity rather than claiming that a kill switch instantly cancels all possible exposure.

Scale by assigning disjoint canonical account shards to workers while respecting provider-login connection ownership and quotas. No active-active regional writers. Future disaster recovery requires the same fencing proof across regions.

## Backups, restore and rollback

Back up database and protected audit exports; ensure encryption key recovery is part of the plan. Proposed storage-recovery targets: RPO ≤5 minutes and RTO ≤60 minutes, to validate with the chosen provider. Financial execution has a stricter rule: a restored database is not presumed to contain all accepted orders. Keep execution disabled until provider history and actual account state reconcile. Incomplete history requires manual resolution.

Quarterly restore drills before production maturity; first successful restore before beta. Restore into isolated infrastructure with no broker egress. Recovery starts with all entry dispatch disabled, never auto-runs old jobs. Rebuild projections and dedupe history, resolve old UNKNOWN/READY commands, then reopen fresh activations deliberately.

Rollback code only if schema compatibility is proven; do not roll back migrations blindly. Preserve every command and audit event through rollback. A failed migration or uncertain worker shutdown blocks new entries and alerts operations.
