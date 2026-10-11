# Billing and administration

## Billing architecture

Stripe is a candidate because hosted checkout, subscription lifecycle and a customer portal avoid building payment infrastructure. Business eligibility remains unverified; trading-related services need accurate disclosure and review against processor restrictions [S10]. Billing integration in test mode is useful engineering work but not merchant approval.

Create plans as versioned configuration: currency, monthly price, connected-account limit, active follower limit, copier-group limit, feature flags and availability date. No invented prices. Start with monthly subscriptions; annual billing/promotions are future decisions. A trial must have an explicit duration and entitlement set before activation. Broker API and exchange fees are separate from this SaaS subscription.

Subscription states: `UNSUBSCRIBED`, `TRIALING`, `ACTIVE`, `PAST_DUE_GRACE`, `ENTRY_DISABLED`, `CANCEL_AT_PERIOD_END`, `CANCELLED`. Define a proposed 7-day payment grace period as a business decision to approve before launch, not a provider default. At grace expiration block new risk, cancel pending opening orders, preserve authorized protective/exit actions, account visibility and incident access. Do not revoke broker secrets or shut down the worker merely because payment failed. Complete a safe wind-down and user takeover/disconnect workflow before final offboarding.

| Event | Entitlement behavior |
|---|---|
| Checkout initiated or browser success redirect | Pending only; never proof of payment |
| Verified subscription/trial activation | Materialize versioned limits server-side |
| Upgrade | Apply after provider confirmation and atomic capacity validation |
| Downgrade | Schedule for renewal; ask user which groups to retain; no arbitrary follower removal with exposure |
| Cancellation at period end | Continue current entitlement until effective end, then safe entry-disable/wind-down |
| Failed payment | Notify, apply documented grace, preserve safety access |
| Refund/dispute | Business workflow plus safe entry restriction if needed; never automatic liquidation for revenue collection |
| Processor unavailable | Continue from durable known entitlement until policy expires; no billing API call in trade path |

Verify webhook signature on the raw body, reject invalid signatures, durably store unique event identity, return success after durable acceptance, process asynchronously, and fetch current subscription state to avoid out-of-order event regression [S11]. Store invoice/provider IDs, not card data. Provider customer/subscription IDs map to server-owned tenants; never trust a browser-provided price or tenant binding. Periodic reconciliation recovers missed billing events.

Capacity checks count claimed accounts/groups in transactions. A malicious UI cannot exceed plan limits. Exits are safety access rather than a premium feature. Billing changes do not loosen trading risk limits.

## Administrative capabilities

| Role | Permitted | Not permitted |
|---|---|---|
| Support | Redacted account metadata, user-visible events, incident lookup, diagnostic export | Broker tokens, discretionary orders, unlogged impersonation |
| Billing | Plans, invoice state, approved refunds through processor, entitlement investigation | Trading decisions or account flatten |
| Operations | Provider/worker/queue health, incident creation, new-entry halt, fenced recovery workflow | Arbitrary price/quantity selection or secret extraction |
| Security | Session/grant revocation, security incident containment, access review | Hidden customer trading or erasing audit history |
| Privileged platform owner | Feature/eligibility releases and role grants with MFA and reason | Bypassing broker approval or tenant isolation |

Admin pages: users/subscriptions; provider/connection health; queue/dead letters; rejected/unknown commands; reconciliations; system metrics; feature flags; support cases; incidents; audit history. Redacted identifiers by default, audited access for sensitive account metadata.

Account suspension distinguishes billing restriction, abuse restriction, and security compromise. Each has explicit handling of open positions and active credentials. Restricting new entries does not imply flattening. Global halt is a logged operational capability; global automatic liquidation is excluded from V1. Any future operator liquidation authority needs explicit customer authorization and legal/provider review.

Feature flags are evaluated server-side, versioned and audited. A flag can disable new risk or hide unfinished functionality, but must not casually remove protection from existing exposure. Required fields for admin mutations: actor, role, reason, target scope, before/after, operation ID, timestamp and verification outcome. Do not label an admin change successful until its durable state transition is recorded.
