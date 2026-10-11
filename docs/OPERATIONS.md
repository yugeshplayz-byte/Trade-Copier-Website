# Observability and incident handling

## Telemetry contract

Structured events include request/operation ID, correlation/causation IDs, tenant pseudonym, group, canonical account, connection, provider/environment, broker event/order ID, logical command/attempt ID, settings version, epoch, state transition, reason, queue age and source freshness. Never log secrets, credential payloads, entire account statements or unredacted personal information.

Audit records are durable decision evidence; application logs are troubleshooting output. Monitoring should remain available when the web application fails. Isolate monitoring reads from hot execution transactions. Use histograms rather than aggregate averages alone; avoid high-cardinality account IDs as unrestricted metric labels.

## Metrics and initial alert policy

| Metric | Meaning / proposed response |
|---|---|
| Unknown submission count | Any unresolved live UNKNOWN raises immediate high-severity incident |
| Unsafe duplicate/reversal evidence | Immediate platform new-entry halt for affected adapter and critical incident |
| Connection/auth health | Notify affected user immediately; page if widespread or exposure exists |
| Event and snapshot age | Block relevant new entries beyond certified freshness; alert on sustained breach |
| Broker receive → intent → send → ack → fill | Separate latency distributions; never advertise internal processing latency as end-to-end fill latency |
| Oldest eligible entry job / queue depth | Drop expired unsent entries; investigate backpressure; reserve exits |
| Reject rate by reason | Alert on baseline deviation; margin/user limits distinguished from adapter failures |
| Reconciliation mismatch | Immediate user-visible incident; page unresolved exposed accounts |
| Protection missing | High-priority exposed-account incident |
| Lease/ownership changes | Track takeover reasons and fencing evidence |
| Database/outbox lag | Block new dispatch if durability uncertain; notify operations |
| Notification delivery | Retry boundedly, retain in-app alert even if email fails |
| Billing projection age | Reconcile provider state; never interrupt exits |

Proposed internal performance target: p95 persisted-event-to-ready-command under 100 ms at agreed beta load, excluding broker/network latency. This is an engineering objective requiring measurement, not a customer guarantee. Freshness and submission-ambiguity thresholds are broker-specific; do not use a universal fixed sleep to assume success.

Proposed availability target for V1 control and monitoring: 99.9% during documented service hours, measured separately from execution/provider availability. Fail-closed execution may reduce availability to protect correctness. Do not publish an SLA until sustained evidence and support coverage exist.

## Incident severity and runbooks

SEV1: duplicate trading, cross-tenant access, unexplained exposure/reversal, lost execution authority, widespread order ambiguity. SEV2: one account out of sync with exposure, protection failure, provider outage. SEV3: delayed UI, notification or billing processing without trading impact. Severity rises with exposure and uncertainty.

For each incident: declare scope → latch new entries as appropriate → preserve broker-held protection → capture evidence → reconcile → communicate account-specific status → authorize bounded recovery → verify → record postmortem and regression scenario. Never restart workers repeatedly as a substitute for resolving unknown orders.

Required runbooks: broker outage; expired/revoked auth; unknown submit; out-of-sync follower; flatten failure; DB outage; worker failover/fencing; compromised secret; deployment rollback; backup restore; billing outage; personal-data request. Every runbook identifies incident owner, customer action, escalation criteria, evidence and safe resume gate. Support access must not imply discretionary trading authority.

Notifications: in-app required, email in beta, SMS/push future with consent and cost controls. Dedupe by incident/account/cause and send resolution messages separately. User acknowledgement does not clear a risk latch or mark a discrepancy resolved. Aggregate outage alerts to prevent floods while preserving per-account detail.

Before live beta name an on-call owner and backup, support hours, maintenance window policy and provider escalation contacts. If required operational coverage is unavailable, restrict beta activity to staffed sessions and disclose that boundary. Never promise unattended production reliability from an unstaffed demonstration.
