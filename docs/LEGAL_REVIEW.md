# Legal, broker and contract review register

This is an engineering and business review checklist, not a legal opinion or assurance that a registration exemption applies. Use US counsel with CFTC/NFA and trading-technology experience. Review the actual product, customer agreement, marketing, compensation, account authority and deployment topology together.

NFA describes compensated advice about commodity-interest trading as potentially within the CTA definition and identifies registration/exemption considerations [S08]. CFTC Regulation 4.14 contains specific exemptions and conditions [S17]. Mechanical own-account copying is the intended boundary, but a disclaimer or customer checkbox does not determine regulatory status.

## Classification vocabulary

- **ASSUMPTION:** provisional planning input; not established by evidence.
- **REQUIRES VERIFICATION:** fact must be checked against current official source or actual system.
- **REQUIRES BROKER APPROVAL:** written permission needed from the relevant broker/platform/firm before enabling that deployment.
- **REQUIRES CONTRACT REVIEW:** signed/licensed rights and restrictions must be interpreted for the proposed use.
- **REQUIRES LEGAL REVIEW:** qualified counsel must assess law, obligations and legal documents.
- **FUTURE DECISION:** outside the initial release; cannot silently become implemented scope.

## Work register

| Topic | Question to close | Classification / responsible party | Launch evidence |
|---|---|---|---|
| CTA/other CFTC registration | Does the final compensated software behavior constitute advice, discretion or another regulated role? Do any exclusions/exemptions apply and require filings? | REQUIRES LEGAL REVIEW / counsel | Written analysis tied to feature and marketing versions |
| Introducing broker / referrals | Do referrals, solicitation, commissions or broker compensation change obligations? | REQUIRES LEGAL REVIEW / counsel | Approved compensation and marketing policy |
| Account authorization | What proof/attestation of control is appropriate, including evaluation accounts and grants that cover multiple accounts? | REQUIRES LEGAL REVIEW + REQUIRES BROKER APPROVAL | Consent language, approved authorization flow and account scope |
| Third-party signals | Any social leader, signal marketplace, recommendations or unrelated portfolio management | FUTURE DECISION + REQUIRES LEGAL REVIEW | Separate review before any feature work beyond isolated mockups |
| Commercial API rights | May this company sell multi-customer copying using this specific API and credential flow? | REQUIRES BROKER APPROVAL + REQUIRES CONTRACT REVIEW | Executed agreement or written authoritative permission |
| Hosting/origin | May order flow originate from our hosted servers, regions and static IPs? Are relays or customer-device bridges allowed? | REQUIRES BROKER APPROVAL | Written deployment-specific answer |
| Account categories | Which retail, evaluation, simulated funded and live funded accounts may use it? | REQUIRES VERIFICATION + REQUIRES BROKER APPROVAL | Provider/firm/account-class eligibility matrix |
| API credential custody | May we store/refresh user tokens or keys? Required scopes, revocation, isolation and incident notification? | REQUIRES CONTRACT REVIEW | Security and credential requirements approved |
| Provider certification | Which conformance tests, SDK licenses, trademarks and support arrangements apply? | REQUIRES BROKER APPROVAL + REQUIRES CONTRACT REVIEW | Certification and license record |
| Prop-firm rules | Copying own accounts, multiple firms, hedging, automation, account limits and session restrictions | REQUIRES CONTRACT REVIEW / each firm | Dated firm-specific conditions, no generic blanket support |
| Market data | Does account display, P&L calculation, storage, non-display automation or redistribution require rights and reporting? | REQUIRES CONTRACT REVIEW / exchange and provider | Written licensing determination for each usage |
| Privacy and security | Which state/federal laws apply to broker account information, access keys and customers? | REQUIRES LEGAL REVIEW | Data inventory, retention/deletion schedule, incident plan and notices |
| Massachusetts operations | Does 201 CMR 17 apply to the financial-account data held; what written program and service-provider controls are required? | REQUIRES LEGAL REVIEW | Appropriate written security program and contract terms [S09] |
| Customer contracts | Terms, risks, acceptable use, outage responsibility, incident communication, limitations, dispute terms, consent | REQUIRES LEGAL REVIEW | Counsel-approved versions and acceptance logging |
| Subscription rules | Auto-renewal, cancellation, refunds, trials, sales tax and geography | REQUIRES LEGAL REVIEW | Approved billing policies and processor configuration |
| Payment acceptance | Does processor accept this exact trading software business? | REQUIRES CONTRACT REVIEW / processor | Eligibility decision; no incorrect business category |
| Business setup | Legal entity, contracting capacity, owners, insurance and support contacts | REQUIRES LEGAL REVIEW / founder | Actual entity and approved commercial contracts |
| Advertising | No guarantees, unsubstantiated latency/performance/safety claims, fabricated partnerships or certification badges | REQUIRES LEGAL REVIEW | Reviewed public copy and capability evidence |
| Vendors | Hosting, auth, analytics/email, subprocessor agreements, cross-border data and incident terms | REQUIRES CONTRACT REVIEW | Vendor register and executed terms |

CME maintains licensing resources for display, distribution and non-display use [S18]. Avoid public price feeds or pooled customer market data in the MVP. A user's personal data subscription does not establish SaaS redistribution rights. Store only account/execution information needed for copying while legal/provider review determines the exact permissible uses.

## Broker questions to send later

Do not send this inquiry automatically. Founder can use it after choosing a contact:

1. We propose subscription software that mechanically copies each customer's own leader trades to their own authorized follower accounts. Is that permitted under your commercial API program?
2. Which exact API product, OAuth/client registration or API-key flow and developer agreement should we use?
3. Can orders originate from our hosted service, and are region/static-IP/session restrictions applicable?
4. Which account classes, partner brokers and prop firms are supported? Does approval carry across them?
5. What user account-control consent, credential custody, permissions and revocation requirements apply?
6. Which limits apply across users/logins/connections? Which endpoints can resolve ambiguous order submissions?
7. Which order/protection/flatten features are server-native, and what conformance/certification is required?
8. Which data display, non-display use, storage and redistribution rights/fees are required for this product?
9. What fees, minimums, reporting, trademark rules, outage contacts and termination requirements apply?

## Engineering allowed before approvals

Claude can build the simulator, interface, disabled adapters, capability model, consent record model, logging/redaction, test infrastructure, public-page drafts and payment test-mode integration. Claude can document blockers and evidence requests. Claude cannot issue legal opinions, invent approvals, bypass provider terms, substitute undocumented login automation, or present a draft Terms/Privacy page as counsel-approved.

## Launch gate

Maintain a private approval register with named owner, scope, source/agreement, reviewer, date, expiration, allowed environments and unresolved conditions. Store only nonsensitive approval references in source control. Production flags require approved provider eligibility plus technical certification plus legal/business readiness; no single checkbox replaces the other gates. Re-review material feature, fee-model, hosting or customer-population changes.
