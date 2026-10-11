# Tradeplex brand

Working product name: **Tradeplex**, chosen by the founder on 2026-10-11. Mechanical copying of your own futures trades across your own accounts: one trade, multiplexed to several accounts.

## Name screening (preliminary only)

Status: **REQUIRES LEGAL REVIEW.** A web screen is not trademark clearance. Before public use, a trademark attorney should run a knockout and full search for TRADEPLEX in at least Class 9 (downloadable software), Class 42 (SaaS) and Class 36 (financial services). They should also check domains and social handles.

What the 2026-10-11 web screen found:

- No trading product, company, trademark filing or domain mention under the exact name "Tradeplex".
- Nearest existing marks to compare: TRADEX Technologies, Inc. (software for automating marketplaces and exchanges) and TRADELINK (barter exchange services).
- Existing futures copiers to stay distinct from: Tradecopia, TradeSyncer, FutuCopy, Replikanto, CrossTrade, PickMyTrade, TradersPost, Tradecovex, Tradespace.
- Names rejected during screening, and why:
  - TradeEcho: taken.
  - TradeRelay: LuxAlgo uses it in the same space.
  - TradeTandem: CrossTrade has a copier feature called "Tandem Mode".
  - TradeStep: confusable with Topstep.
  - Tradestack, TradeOrbit, TradeHive, Tradevine: existing products.
  - Lockfill: confusable with BlockFills.

## Mark

A leader bar with three follower ticks hanging beneath it. The ticks have different lengths because each follower has its own sizing. Read together, the shape is a **T** and also tick marks on a price ladder. The gap between bar and ticks shows that followers are relayed from the leader, not welded to it. There is deliberately no rising chart, rocket, bull or money imagery: the product never implies profit or signals.

Construction on a 32-unit grid. Every element is 4 units thick with 1-unit corner radii.

| Element | x | y | w | h |
|---|---|---|---|---|
| Leader bar | 6 | 7 | 20 | 4 |
| Follower 1 | 6 | 13 | 4 | 6 |
| Follower 2 (stem) | 14 | 13 | 4 | 13 |
| Follower 3 | 22 | 13 | 4 | 9 |

Assets: `docs/brand/tradeplex-mark.svg`, `docs/brand/tradeplex-lockup.svg`, `docs/brand/tradeplex-app-icon.svg`, app favicon `apps/web/app/icon.svg`, React component `apps/web/components/BrandMark.tsx`.

The lockup wordmark is set in Geist (OFL) in the app. The standalone SVG lockup uses a system font placeholder; convert the text to outlines from a licensed typeface before external use.

## Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| Brand accent | `#2f5bd3` | `#7d9bff` | Leader bar of the mark, focus ring, active nav marker. Never used for status. |
| Ink | `#1c1917` | `#f5f5f4` | Follower ticks, text |
| Canvas | `#f6f6f4` | `#0e0d0c` | Page background |

Status colours (red, amber, green, blue) are reserved for operational meaning and never decorate the brand.

## Usage rules

- Keep clear space of at least one bar thickness (4 units) around the mark.
- Minimum size is 16 px. Below 20 px, use the app icon, which has a solid background.
- Do not rotate, recolour the followers, add effects or rearrange the ticks.
- Do not pair the brand with performance claims, guarantees, broker or prop-firm logos, or "approved/certified" language unless written approval exists (see `docs/LEGAL_REVIEW.md`).
