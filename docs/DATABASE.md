# Database and persistent mapping design

## Conventions

Use PostgreSQL migrations, UUID internal IDs, `timestamptz` timestamps in UTC, integers for contracts, exact numeric/decimal values for money, and integer ticks plus contract specification version for price calculations. Provider IDs are text, never JavaScript floating point. Every customer table carries `tenant_id`; sensitive references include it in composite foreign keys.

Use one personal tenant per user initially, with `tenants` and `tenant_memberships` supporting ownership cleanly. Do not expose organizational pooled-trading features simply because the schema permits multiple memberships. Authentication provider stores authentication secrets/session infrastructure; app stores subject mapping and revocation/authorization metadata as necessary.

## Entities and keys

| Table | Important fields and relationships |
|---|---|
| users | id, auth_subject unique, display name, timezone, status |
| tenants / tenant_memberships | id, owner, membership role; unique tenant/user; personal tenant invariant initially |
| consent_records | tenant/user, policy/version, capability/account scope, accepted_at, revoked_at |
| plans / subscriptions | provider customer/subscription IDs unique, period/status, plan version |
| entitlements | tenant, capability, limit, effective interval, billing generation, safety-access policy |
| billing_events | provider event ID unique, raw-safe hash, processed state and subscription reference |
| broker_connections | tenant, provider/API/system/environment, auth state, permissions, connection version, last heartbeat |
| broker_secrets | connection, encrypted ciphertext, wrapped key, nonce, key version, expiry; restricted role only |
| broker_accounts | canonical routing identity, account class, currency, status; unique provider/system/environment/account ID |
| connection_accounts | tenant-scoped authorized connection/account association; avoids duplicating one account across logins |
| provider_eligibility | provider/account class/firm/deployment/environment, approved status, evidence reference and expiry |
| instruments / instrument_aliases | exchange/product/expiry/currency/spec version and provider IDs; exact ticks and point value |
| copier_groups | tenant, leader account, mode, desired state, control epoch, activation boundary, config version |
| copier_members | group, follower account, membership interval, isolation state; exclusive active account claim |
| copy_settings_versions | group/member, immutable sizing/instrument/exit policies, effective activation |
| risk_profiles / risk_versions | owner scope, immutable limits, effective_at |
| risk_latches / risk_day_baselines | scope, reason, trading-day key, inputs and reset history |
| broker_events | tenant, connection/account, environment, dedupe key, provider sequence/cursor, normalized payload, processed_at |
| orders | internal ID, account/instrument, provider order ID, lineage root, replace predecessor, parent/OCO IDs, desired and reported versions, totals/status |
| executions | account, provider execution ID, order ID, qty/ticks/time, correction_of; economic facts retained |
| copy_episodes | group activation/instrument, opening boundary, fixed sizing anchor, leader/follower target history, closure state |
| order_mappings | group/episode, leader order, follower account, mapping ID, active revision; one mapping can have several physical child orders |
| order_mapping_legs | mapping ID, follower order ID, role entry/stop/target/replacement, revision |
| execution_allocations | leader execution, follower execution, mapping/episode, allocated quantities; supports many-to-many partial fills |
| positions | current actual projection per account/instrument, source cursor and as_of; not original evidence |
| expected_positions | group/episode/account/instrument, desired qty, settings version, causal event |
| position_snapshots / account_snapshots | actual state, read interval/cursor/completeness, balance/fee inputs |
| copy_intents | source event/target version, follower, decision/rule version, desired delta, expiry, superseded_by |
| order_commands / command_attempts | command ID, idempotency key, account sequence, epoch, payload hash, outcome, provider reference; individual transport attempts |
| risk_reservations | command/account/group scope, reserved qty/exposure, state and release reason |
| operations | customer/admin action, authorization, scope, per-account results, status |
| outbox / jobs | event/job type, tenant/account partition, sequence, priority, eligible_at, attempt budget, lease, completion |
| worker_leases | canonical execution scope, owner, epoch, expiration, takeover evidence |
| reconciliation_runs / discrepancies | expected/actual evidence, severity, classification, recommended action, resolution |
| connection_events / copier_events | transition provenance, reason, correlation IDs |
| notifications / notification_deliveries | incident dedupe key, channel, attempt status, acknowledged_at |
| audit_logs / admin_actions | actor, tenant, action, reason, before/after hashes or redacted values, operation IDs |
| system_incidents | severity, affected providers/accounts, operational timeline, resolution |

One leader order → many follower mappings → many physical follower order legs → many executions. Never overwrite the mapping with only the latest broker order ID after a replace. Positions are aggregates, not uniquely owned by one order; episode and execution allocation tables explain their provenance.

## Required constraints

1. Tenant-scoped foreign keys prevent accidentally linking a group to another tenant's account or settings.
2. Unique canonical account claim prevents simultaneous copier writers across alternate connections and tenants. Ownership conflicts enter a recovery process without exposing the other customer.
3. Unique broker event identity includes provider/system/environment/account/stream scope as needed. Execution uniqueness is by provider-defined execution scope, not timestamp+price.
4. Unique `(tenant_id, source_cause_id, follower_account_id, action_kind, target_version, leg)` prevents duplicate logical commands. Client order ID is derived stably from command identity and provider length constraints, with collision testing.
5. One attempt in ambiguous/dispatching state blocks conflicting new commands for that account.
6. Quantity nonnegative, fill totals consistent, valid order transitions; corrected fills use explicit correction records instead of unlogged mutation.
7. Unique HTTP operation idempotency key plus payload hash; same key/different payload is rejected.
8. Immutable settings versions and explicit activation epochs prevent replaying old settings accidentally.

## Transactions and indexes

Inbox processing transaction includes event claim, ledger/projection changes, intent, risk reservation, outbox and audit. Outbound API calls happen afterward. Result persistence and reservation transitions are transactional. Index jobs on eligibility/partition/sequence and unfinished state; events on account/cursor and unprocessed state; orders on account/environment/provider ID; executions on account/time and stable identity; audit/activity on tenant/time/correlation.

Read-committed plus explicit ordered locks and constraints is the default; use serializable transactions only where an invariant requires it and implement bounded serialization retries. A serialization retry must never repeat an external API call. `SKIP LOCKED` may distribute work but cannot skip a required earlier command within one account [S12].

## Isolation, lifecycle and retention

Apply row-level security for tenant request paths with a nonowner role; migration/service roles are separate. PostgreSQL table owners and privileged roles may bypass RLS, so test using actual production roles and connection pooling [S13]. Set tenant context transaction-locally. Background jobs carry authenticated tenant context; only narrowly scoped worker duties can cross tenants.

Persistent: intent, orders, executions, mappings, approvals, risk baselines/latches, jobs, eligibility and audit. Rebuildable: UI aggregates, in-memory subscription state, caches, derived position views. Secrets are persisted encrypted or in a managed secret service, never as plaintext rows.

Provisional retention proposal: operational logs 30 days, normalized events/snapshots 90 days hot then controlled archival, trading decision/audit records one year minimum business target. These are not legal retention periods; counsel/provider contracts must set final schedules and litigation holds before live launch. Avoid storing raw market-data streams without license. Redact raw provider payloads and do not keep authentication bodies. On account deletion revoke access promptly, purge erasable data by schedule, and preserve only required records with restricted access.

Partition high-volume event tables only when justified. Back up encrypted data and key recovery dependencies; test restoration before beta. Restored databases must not replay pending trading commands automatically.
