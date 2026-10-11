# Risk engine and enforcement

## Scope and limits

Risk rules constrain customer-authorized copying; they do not select trades. Enforce at configuration, intent creation and immediately before dispatch. Backend enforcement is mandatory regardless of UI validation.

| Control | MVP | Beta | Production V1 / Future |
|---|---|---|---|
| Allowed instruments, explicit expiry, size multiplier cap | Required | Required | Versioned per account/provider |
| Per-order quantity, per-instrument and account position caps | Required | Include all pending and unknown reservations | Group caps with atomic reservations |
| Kill switches, entry halt, stale-state block | Required | Certified broker cancellation/close | Platform-wide incident controls |
| Daily loss | Simulator fixtures and rule semantics | Real account data/fee validation | Group aggregates and audited reset |
| Account loss / equity floor | Simulated | Optional only with validated balance source | Required when marketed; custom base/high-water rules |
| Trade count | Simulator | Optional defined entry-episode count | Configurable hard cap |
| Session rules and market calendar | Simulated timezone/DST tests | Live calendar/holiday source | Provider/firm rule packs after verification |
| Prop-firm trailing drawdown | None claimed | None assumed | Future dedicated rule models; no passing guarantee |

## Admission order

1. Verify tenant authorization, account control, live/practice environment and provider eligibility.
2. Verify account execution ownership and current fencing/control epoch.
3. Identify purpose: new entry, increase, reduction, cancel entry, protective action, or explicit flatten. Split reversals.
4. Check control latch and policy. HALTED/PAUSED/billing-expired prevents risk increases; it is not a blanket veto of authorized reductions.
5. Require known command outcomes, coherent positions/orders, and appropriate balance/price freshness.
6. Validate contract, expiry, tick/lot increment, order type, TIF and protection capability.
7. Check session and market availability. Out-of-session reductions remain allowed if the broker/exchange allows them.
8. Validate size/multiplier and worst-case position, including every working/unknown opening order and reservation. Do not net opposite-side opening orders or assume an OCO relationship removes exposure unless certified.
9. Check account, follower, group and platform limits, then loss/trade-count latches for increases.
10. Check effective subscription entitlements for increases without an external billing call.
11. Reserve capacity atomically and persist the decision with settings version and measured inputs.
12. At dispatch revalidate; if invalid, supersede unsent entry and release only safe reservations.

Acquire shared group/account limits in stable order. Two followers cannot each pass against the same remaining group capacity. Unknown submitted quantity retains its reservation until resolved. Cancel requests do not release exposure before confirmation. Partial fills transfer reservation to actual exposure; they do not double-count it.

## Loss definitions

Initial daily-loss definition: account equity change since the configured trading-day start, adjusted for deposits/withdrawals, including realized/unrealized P&L and known fees. Store start equity, flow adjustments, valuation source, currency and timestamps. If broker equity or fee updates are inconsistent, report unavailable rather than enforce a fabricated dollar number.

Account loss uses a customer-selected reference equity or equity floor, with clear reset semantics. Group loss aggregates distinct follower accounts in the same currency and aligned measurement window; leader inclusion is explicit and off by default. No FX conversion or nominal-evaluation-balance sizing until specified and tested. Store currency in every money value. Points are useful instrument-level displays, but do not sum points across different futures contracts as though they were dollars.

Daily trading boundary is configurable in IANA timezone and may span midnight. Default display timezone America/New_York is independent of exchange/firm accounting day. Use calendar-aware dates, including DST and half days. Never reset a loss latch on process restart. Rule reset at the scheduled boundary requires valid baseline data; manual override is audited and unavailable to ordinary support.

When a threshold trips: durably latch new entries off, cancel pending opening orders, notify and preserve exits. Optional flatten-on-breach is an explicit user risk policy, not a promise of stopping exactly at the limit. Gaps, open orders, stale data, fees and broker outages can exceed the configured threshold.

## Quantity and reduction safety

Account maximum position includes external positions even though manual follower activity is unsupported. Such activity also causes a reconciliation incident. Never count only copier fills and ignore other broker exposure.

Reduction permission requires current signed quantity, managed ownership or explicit account-wide authorization, and outstanding close/protection knowledge. Clip a requested reduction to verified remaining quantity after resolving competing exits, or use certified native reduce-only behavior. Account position cap cannot block a supported close of an already oversized position. Daily-loss, billing, or session-entry gates cannot strand the account by rejecting a legitimate close.

## Example acceptance cases

- Cap 5, actual long 3, working buy 1, new buy 2: reject; projected exposure 6.
- Cap 5, actual long 6, authorized sell-to-close 6: allow supported reduction despite existing breach.
- Loss latch trips after intent creation: dispatch rejects that unsent entry under the newer epoch.
- Group remaining capacity 1, two simultaneous follower entries of 1: exactly one reservation succeeds.
- Unknown buy 2 after timeout: retain potential exposure 2, do not submit another buy or blindly flatten against an assumed zero position.
