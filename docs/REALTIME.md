# Events, workers and real-time presentation

## Durability before fanout

Broker stream → schema normalization → durable inbox → ordered domain transaction → risk reservation and command → dispatcher → broker acknowledgement/execution → ledger and reconciliation → durable UI outbox → tenant-authorized SSE. Audit evidence is written with each decision transaction, not added at the end as a best-effort log.

Event fields: schema version, stable ID, tenant/account/provider/environment, provider sequence and its scope, occurred/received times, correlation and causation IDs, settings version, source quality, and redacted payload. UI event types: `connection.changed`, `copier.changed`, `order.changed`, `position.changed`, `copy.failed`, `risk.latched`, `reconciliation.changed`, `operation.changed`, `notification.created`, `entitlement.changed`, `incident.changed`.

## Worker scheduling

Use PostgreSQL-backed inbox/outbox and jobs initially. Jobs are at-least-once, so handlers are idempotent. Separate lanes for trade/control, reconciliation, and utility jobs. Reserve outbound provider quota for cancellations/exits/health reads; entry backlogs must not consume every token. Provider limits, retry-after and penalties override optimistic local budgets.

Partition by canonical account and order causality. Worker claim code cannot process account sequence N+1 when N remains unresolved, except a specifically modeled halt/cancel operation that supersedes an unsent entry. Explicit priority alone does not override causal dependencies. Across accounts, bounded concurrency permits fanout. Fair scheduling prevents one tenant starving another.

Proposed simulation defaults: 5-second TTL for unsent risk-increasing intents; 1-second stale-target warning; 3 safe submission attempts maximum; heartbeat every 5 seconds; 15-second heartbeat timeout. These are test knobs to calibrate against provider timestamps, liveness guarantees and measured latency before live beta. A quiet event channel alone must not mark a healthy provider disconnected; use certified heartbeat behavior. Expired entries are skipped and visible. Protective and exit operations have separate escalation deadlines and fresh-state revalidation; never blindly discard an open-position exit because a generic job TTL expired.

## Reconnect and replay

On stream disconnect: block entries, preserve native orders, notify, perform bounded exponential reconnect with jitter, serialize token refresh, fetch missing execution history and coherent snapshots, reconcile, then require resume policy. Backlog is evidence of past events, not permission to execute all past trades. Resubscription confirms account grants and environment. Provider maintenance intervals are not treated as zero-position updates.

Database or durable queue failure blocks new order dispatch. In-memory queues cannot substitute for lost persistence. If an external broker may have accepted a request during that failure, mark the account unknown after recovery. Dead-letter jobs show on operations dashboards; dropping them does not resolve account inconsistency.

## Browser behavior

Initial REST snapshot includes a read-model cursor; SSE begins after that cursor so the snapshot-to-stream race cannot hide events. Supply monotonic per-tenant sequence IDs. On reconnect use Last-Event-ID for bounded replay; if cursor is older than retention, send `resync_required` and fetch a new snapshot. UI event deduplication prevents repeated toasts.

Authenticate SSE with the established secure session, authorize every subscription and recheck revocation. Never accept arbitrary account/channel IDs without ownership checks. Close streams on logout/revocation. Use bounded server buffers and disconnect slow consumers with a resync message. Coalesce high-frequency projection updates while retaining every financial event in durable storage. No broker credentials in SSE URLs or payloads.

The UI renders cached data only with its `asOf` and stale badge. It may show an operation as pending immediately, but cannot optimistically mark broker cancellation, flatness, or synchronization as successful. Trading proceeds without browser heartbeats. Notifications are asynchronous side effects and do not block risk-reducing actions.
