# Product definition and release scope

## Product

A subscription web application that lets one customer connect authorized futures accounts, designate a leader account, select followers, and apply explicit mechanical copy and risk rules. Copy execution runs on approved server infrastructure even when the browser closes. The core value is fewer repetitive manual orders, visible account divergence, and a traceable explanation of every follower action.

Target initial customer: an adult self-directed futures trader with multiple eligible accounts under their own control. Evaluation, simulated funded, and live brokerage accounts are distinct account classes; each requires its own eligibility checks. Legal ownership, trading authorization, and prop-firm permission are separate facts. A checkbox alone does not prove them.

The service is not a broker, exchange, signal marketplace, discretionary portfolio manager, investment recommender, or custody product. These describe intended functionality, not a legal conclusion. It must not promise identical prices, guaranteed replication, loss prevention, a prop-firm pass, regulatory approval, or profit. Losses and timing can differ across accounts.

## Critical product contracts

1. A customer controls all members of their copier group. No cross-customer leaders or followers.
2. One follower account has one active execution owner. In initial releases it cannot also be a leader, including via an alternate connection. Reject cycles and chained groups.
3. Activation requires all selected accounts flat, no working orders on selected instruments, fresh broker snapshots, supported capabilities, valid authorization, and an acknowledged settings preview. Existing-position adoption is deferred.
4. Manual follower trades or another copier operating on the same account are unsupported. Detect them, freeze new entries, and request review; do not silently absorb them into expected state.
5. All effective settings are immutable versioned snapshots. Size, membership, mode, instrument, and risk loosening changes require a flat boundary. Risk tightening may take effect immediately with an explicit consequence preview.
6. Copy mode is explicit. `EXECUTION` copies confirmed fills into follower orders; it does not put a follower limit order on the book when a leader places one. `ORDER` mirrors accepted orders and has different fill behavior. Never run both on the same trade lineage.
7. Every accepted control action receives a durable operation ID. A queued command is not an acknowledged broker order, and an acknowledged broker order is not a fill.
8. Losing market data or account freshness prevents risk-increasing commands. Risk-reducing operations require sufficient fresh position knowledge or a certified broker-native close primitive.
9. Users can always view incidents and request supported risk-reducing actions while their authorization remains valid, even when billing disallows new entries.
10. Broker is authoritative for actual orders and positions; the database is authoritative for customer intent, settings, expected state, and command history.

## Release map

MVP here means internal simulation, not a commercial launch.

| Capability | MVP: internal simulator | Private Beta | Production V1 | Future |
|---|---|---|---|---|
| Execution | Deterministic execution-based copying; multiplier sizing | One approved provider, narrowly certified account types and contracts | Approved provider/account combinations with documented limits | More providers after separate certification |
| Size | Positive rational multiplier, floor-to-contract rounding, hard caps | Fixed opening-order quantity and rational ratio | Follower overrides and validated configuration UX | Equity proportional sizing and explicit micro/mini mapping |
| Orders | All leader fill sources simulated; follower market orders | Certified native protective bracket/OCO where available | Certified order-mirroring mode for supported order families | Emulated advanced order structures only after dedicated review |
| Risk | Product allowlist, quantity/position caps, entry halt, flatten simulator, freshness | Daily loss, session/calendar, account-wide reservations, kill latches | Group/account loss controls, real-time freshness policies, trade limits | Prop-firm rule packs verified per firm/version |
| Reliability | Durable inbox/outbox, unknown-submit handling, reconciliation, restart tests | Disconnect/reconnect, crash/partition exercises | Controlled failover and restore drills | Multi-region recovery; never simultaneous writers |
| Identity/security | Real tenant authorization and secure sessions for development | MFA required before live access, encrypted provider secrets | Independent security review, hardened admin and audit export | Organization teams with separately reviewed account authority |
| UI | Shell, simulated setup and health, explicit demo label | Complete account/copy operations and incident recovery | Public site, support and operational documentation | Mobile app, rich analytics |
| Billing | Local entitlement fixtures | Stripe test mode and provider eligibility review | Approved paid subscriptions and customer portal | Annual plans, taxes expansion, promotions |
| Operations | Structured logs and test incidents | In-app/email alerts, minimal admin, on-call ownership | Status page, runbooks, tested backups | Additional notification channels |

Risk controls are safeguards, not guaranteed loss ceilings. No multi-broker atomic execution is promised. A single follower rejection does not justify reversing already-filled orders in other accounts.

## First usable vertical slice

Sign in → create simulated connection → choose one flat leader and two flat followers → set 1x and 2x sizing with caps → activate → simulate a leader buy → durable follower intents → simulated fills → reconcile → show synced positions and full audit trail → simulate a lost acknowledgement → show unknown outcome without duplicate submission → recover by broker query → pause and close safely.

The first live integration is a separate gate. Keep paid launch disabled until provider authorization, legal review, conformance testing, and operational acceptance are complete.

## Decisions and open items

| Item | Classification | Default / closure evidence |
|---|---|---|
| Current repository framework and skills | REQUIRES VERIFICATION | Phase 0 local audit |
| Tradovate as first provider | ASSUMPTION | Best initial investigation candidate, conditional on commercial access and hosted routing permission |
| NinjaTrader API compatibility with Tradovate | REQUIRES VERIFICATION | Treat as separate products/adapters until provider confirms credential and account routing compatibility |
| Rithmic commercial deployment | REQUIRES BROKER APPROVAL / REQUIRES CONTRACT REVIEW | Developer agreement, credentials, conformance and eligible account evidence |
| TopstepX server-side execution | REQUIRES BROKER APPROVAL / REQUIRES CONTRACT REVIEW | Disabled under currently reviewed published restriction [S04] |
| CTA or other registration analysis | REQUIRES LEGAL REVIEW | Written counsel analysis of actual features and marketing |
| Subscription prices and trial length | FUTURE DECISION | No invented sale prices in UI |
| Supported countries, entity owner, contracting eligibility | REQUIRES LEGAL REVIEW | Business setup and target-market decision before paid launch |
| Default display timezone | ASSUMPTION | America/New_York; account trading day is separately configured |
| Customer-device execution edition | FUTURE DECISION | Separate architecture; cannot satisfy always-on hosted execution when the device is off |
