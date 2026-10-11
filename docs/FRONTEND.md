# Frontend information architecture and page specifications

## Product hierarchy and design

Public: Home, Features, How it works, Supported platforms, Pricing, Security, FAQ, Docs/Help, Support, Terms, Privacy, Risk disclosure, Status.

App: Overview, Copiers, Accounts, Connections, Activity, Risk, Billing, Settings, Help. Trades is an Activity subview; Notifications is a global inbox with a full history view. This avoids splitting operational history across too many navigation items. Admin is a separate privileged surface, never a hidden navigation item that relies solely on frontend access control.

Use a restrained neutral palette, legible typography, compact tabular numbers, consistent spacing and a limited semantic color system. Show labels/icons alongside color. Red means action/failure, amber means degraded/stale, green means recently verified success. Do not use animated price tickers, fake live data, decorative performance claims or unsupported broker logos.

Desktop uses a left navigation rail, top environment/account-health strip and main workspace. Mobile uses a compact navigation drawer, summary cards, horizontally scrollable data tables and full-page operational details. Persistent emergency entry-halt access remains reachable; group flatten is visually separate and requires a scope review. Trading status is never obscured by promotional banners.

Claude must inspect relevant local `.agents/skills/` before major interface work, explicitly read applicable `SKILL.md` files and document only skill names used. No skill contents enter the app or committed documentation.

## Shared behavior

- Target accessible keyboard operation, visible focus, semantic tables/forms and WCAG 2.2 AA design/testing; do not claim compliance without assessment.
- Every financial/status view shows provider environment, last broker update, freshness and timezone. Store UTC; display America/New_York by default with an explicit timezone label.
- Loading uses skeletons/status text, not zero balances. Empty means no records; unavailable means unknown; these must not share a zero-value display.
- Errors explain affected scope, what is still operating and the available next action. Do not display raw stack traces or broker secrets.
- Success is evidence-specific: saved, requested, acknowledged, filled, cancelled, verified flat. Never use one green toast for all stages.
- Form validation is immediate but backend rules remain authoritative. Show stale settings conflicts with reload/review rather than overwriting another tab's changes.
- Configuration forms include realistic size examples and effective date/boundary. Show unsupported provider features disabled with explanations.

## Page contracts

| Page / purpose | Components and actions | Empty / loading / success / error | Mobile behavior |
|---|---|---|---|
| Home / explain service | Clear own-account copying statement, workflow illustration, supported release status, CTA to learn or try simulator | Empty content unpublished; fast static rendering; valid CTA navigation; service incident link on outage | Single-column content; concise CTA |
| Features / describe actual capabilities | Release-tagged copy/risk/recovery sections, limitations, docs links | Missing capability marked planned; loading placeholders if fetched; current release labels; unavailable info not claimed | Stacked feature sections |
| How it works / set expectations | Connect/select/configure/activate walkthrough, execution vs order-mode distinction, failure example | No invented accounts; static diagram; completed walkthrough links to simulator; broken docs link visible | Vertical walkthrough |
| Supported platforms / prevent false claims | Provider/account/environment/mode matrix, approved/limited/planned/blocked states and verification dates | No approved providers explicitly stated; load skeleton; eligibility displayed; approval unknown blocks Connect | Provider cards with details drawer |
| Pricing / set commercial expectations | Versioned approved prices, limits, API fees distinguished, cancellation terms and FAQ | Before prices approved show beta/waitlist, not fake plans; pending checkout state; success only after entitlement confirmation; payment errors actionable | Stacked plans, no dense comparison overflow |
| Security / describe safeguards | Actual controls, support contact and disclosure process | No unsupported SOC/insurance claims; static content; current review dates; incident/status links | Readable article layout |
| FAQ / resolve common concerns | Browser closure, fees, ownership, slippage, pause vs flatten, disconnects | Empty search suggestions; loading if remote search; results; no-results with support link | Accessible accordions |
| Docs/Help / teach operations | Quickstart, mode guide, provider limitations, emergency runbooks, search | No docs → contact; loading index; version-matched guides; missing page recovery | Sticky contents collapsed |
| Support / submit issue | Incident ID, redacted diagnostic bundle, issue form, support hours | No open cases; sending indicator; case ID; retry without duplicate case | Full-width form, optional attachment restrictions |
| Terms/Privacy/Risk / approved disclosures | Versioned counsel-reviewed text and effective date; agreement history | Draft clearly labeled and not represented as approved; loading document; accepted version recorded; outdated acceptance prompt | Article, accessible download |
| Status / operating conditions | Web/control, execution, providers separately; incident history | No incidents text; timestamped load; resolved incident details; monitoring stale badge | Compact component cards |
| Sign in/onboarding / secure entry | Auth-provider flow, MFA setup, ownership boundaries, terms and timezone | New user checklist; redirect loading; account created; auth recovery without leaking account existence | Single-column provider UI |
| Overview / operate safely | Active copiers, connected accounts, failures, stale/out-of-sync panel, positions, recent activity, entry-halt shortcut | Connect/simulate CTA; skeleton not zero; freshly reconciled badges; prioritized incident banner | Health and emergency control first; details drill-down |
| Connections / manage access | Provider tiles, permission scopes, environment, expiry, Test/Reconnect/Revoke | Add connection; account discovery progress; READY after snapshot; auth/outage/unsupported error | Cards with safe actions in detail view |
| Accounts / inspect actual state | Account class, canonical alias, grants, positions/orders/balance and freshness, eligibility, authorized flatten | No eligible account explains reason; loading broker snapshot; verified state; unavailable/stale state persists | Summary cards then instrument rows |
| Copiers list / select group | Mode, leader/followers, control/connectivity/consistency badges, active risks, create/pause | Create simulated group; load skeleton; saved/active labels; per-group issues visible | One group per card |
| Copier wizard / review intent | Leader, followers, size examples, risk, disconnect/exit policy, review, activation preflight | No accounts → connections; preflight pending; ACTIVE only after ownership/snapshot; specific blocking conditions | Step-by-step full page, sticky next/back |
| Copier detail / inspect/operate | Topology summary, target vs actual per follower, orders/protection, settings versions, timeline, pause/resume/halt/flatten | No activity explicitly; fresh-state spinner; operation progress by follower; isolated failures and unknown outcomes | Health and follower cards prioritized; settings separate |
| Activity/Trades / trace behavior | Filters, timeline, order lineage, executions, skip/reject reasons, export | No activity; cursor pagination; causal chain available; missing broker data flagged | Summary rows expand to lineage details |
| Risk / configure safeguards | Per-account/group limits, units, baselines, latches, session timezone/calendar | No profile CTA; load actual effective versions; saved effective timing; conflict/stale-input/trigger banner | Stacked sections with examples |
| Notifications / acknowledge issues | Severity, incident grouping, channel preferences and delivery status | No alerts; load history; acknowledged separate from resolved; failed delivery still visible in-app | Touch-friendly history and details |
| Billing / manage subscription | Current plan, effective limits, invoice/portal links, grace status and safety access | Trial/unsubscribed; checkout pending; verified entitlements; failed-payment instructions | Compact summary and hosted portal |
| Settings / secure account | Profile/timezone, MFA/session management, export/delete, consent history | Defaults shown; saving; persisted settings; verification/recovery conflicts | Single-column forms |
| Admin / operate platform | Restricted user metadata, incident/queue/health panels, feature flags, suspension controls, audit | No incidents; loading projections; operation recorded; unauthorized/unknown state explicit | Read-only triage prioritized; complex config desktop |

## Connection workflow

Choose provider → check commercial/account eligibility → authorize through the official method → discover accounts → show environment/class/permissions → select accounts → record consent → test reads and stream → READY. Test does not place an order. Add a practice trade test only inside an explicitly authorized provider-certification flow.

If token expires: badge AUTH_REQUIRED, pause entries, explain open broker orders may remain, offer reconnect. Do not say connection is healthy merely because stored credentials exist. Revoke flow previews effects on active groups and exposure.

## Copier wizard acceptance

1. Leader: eligible account, environment badge, current position and freshness.
2. Followers: exclusive ownership checks, no duplicate canonical account or cycle; unsupported accounts disabled with reason.
3. Mode and sizing: execution mode default, quantity examples for partial fills/zero rounding, immutable episode behavior.
4. Risk: limits with units, session/timezone, daily baseline, protection and disconnect-exit policy.
5. Review: exact account names/IDs masked appropriately, contract allowlist, output examples, pause/flatten meaning, protection limitations and external fees.
6. Activate: server preflight, durable activation operation, individual account results. Show all blockers together. No automatically adopted positions.

## Incident and emergency UX

Timeline example: leader buy 2 → follower A command persisted → broker accepted → partial fill 1 → final fill 1 → reconciled; follower B rejected → marked OUT_OF_SYNC. Include event time and received time when delayed. A successful follower does not turn the whole group green.

Emergency halt is one action with immediate pending feedback. Flatten displays which follower accounts and instruments will be affected, confirms scope, then shows each account as pending/closed/unknown/failed. Repeated clicks reuse operation identity until resolved. Offer provider-native recovery instructions when the platform cannot reach an account. Do not claim a position is closed based solely on submitting a close request.
