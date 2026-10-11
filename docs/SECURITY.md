# Security architecture

## Threat model

| Threat / boundary | Protection | Required evidence |
|---|---|---|
| Customer A accesses Customer B accounts or SSE | Server-derived tenant identity, resource authorization, composite FKs, RLS, scoped jobs and streams | Cross-tenant API/DB/SSE/export tests |
| Stolen broker secret | Envelope encryption, worker-only decrypt, minimal scopes, audit, rotation/revocation | Ciphertext inspection, decrypt-role denial, rotation drill |
| XSS steals sessions or changes copier | CSP, escaped UI, no raw provider HTML, HttpOnly/Secure cookies, CSRF and origin checks | Auth/CSRF/XSS tests and headers inspection |
| Account takeover | Established identity provider, MFA before live access, recovery protections, session revocation | Recovery/step-up/revocation tests |
| Forged billing/webhooks | Signature verification of raw body, timestamp tolerance, event dedupe | Invalid signature and replay tests |
| Worker split brain / queue injection | Account ownership epochs, fenced egress, restricted DB roles, authenticated service identities | Crash and partition scenarios |
| Malicious provider payload | Schema and bounds validation, allowlisted endpoints, redaction | Fuzzed event and log inspection tests |
| Insider misuse | Separate support/security/billing roles, no secret viewing, reasoned audited actions | RBAC and audit tests |
| Dependency/build compromise | Lockfile, vulnerability/secret scans, least-privileged CI, reviewed changes, reproducible artifacts | CI evidence and package inventory |
| Provider endpoint override / SSRF | Server-maintained endpoint allowlist, no arbitrary user URL, egress restrictions | Reject metadata/internal endpoints |

Tenant protections are informed by OWASP guidance [S15]; these requirements remain product-specific design choices, not a certification claim.

## Credential handling

TLS for browser/API/provider/DB connections with certificate validation; production HTTPS-only cookies and transport settings. Encrypt broker credentials with authenticated encryption and envelope keys from a managed KMS. Store key version and context-bound tenant/connection metadata; prevent ciphertext swapping between tenants. Web request processes may ingest a secret but should not have general decrypt permission. Only the session worker obtains broker secrets for an authorized connection.

Separate login credentials from broker API credentials. Prefer delegated OAuth when approved; never ask users for a broker password merely because OAuth integration has not been approved. If the official integration requires a password-like secret, its collection and storage need the provider agreement and a documented threat review. Credentials are never visible again after ingestion. Clear form state, disable telemetry/session recording on secret-entry surfaces, redact request/response bodies and error objects.

No tokens in URLs/logs/client bundles, no `.env` or real keys in Git, no production secret in localhost examples or CI tests. `.env.example` contains names and unmistakable placeholders only. Refresh rotation is transactionally coordinated; reauthentication loops do not repeatedly invalidate another worker's token.

## Authentication and authorization

Use a maintained OIDC identity solution; select the vendor against current MFA/session/availability requirements in Phase 1. Do not implement homegrown passwords or MFA. Customer roles: owner initially. Internal roles: support read-only, billing limited, operations halt/recovery, security administration. Grant no routine admin permission to impersonate a customer or submit discretionary trades.

Require MFA before connecting live-capable accounts. Require recent authentication for adding/replacing secrets, changing account grants, disabling MFA, recovery changes and material risk loosening. An already authenticated emergency halt should remain immediately available; do not force a fresh MFA challenge on every click when time matters. Account-wide flatten needs a clear scope confirmation, not an arbitrary slow approval chain.

Authorize at API, domain command and worker dispatch boundaries. Revoke queued risk-increasing commands when account grant or session-derived authorization is withdrawn. Existing broker orders can survive token revocation; communicate that fact and provide provider-native recovery instructions.

## Data and application defenses

Validate every external payload and business range; parameterize SQL. Enforce request size/time limits, per-user/IP/tenant rate limits and provider limits. CSRF protection applies to cookie-authenticated state changes; verify allowed origins for stream connections. Use strict redirect allowlists for OAuth and billing portals. Export endpoints validate tenant and neutralize spreadsheet-formula injection in CSV fields.

Use TLS and encrypted managed storage/backups; access is logged. Admin audit records append only at application level, exported to restricted immutable storage for stronger tamper resistance before production. An append-only table is not tamper-proof against database administrators. Store no payment card data; use the payment provider's hosted flow.

## Environments and incidents

Separate cloud accounts/projects, databases, keys, broker apps, payment modes and auth clients for LOCAL/STAGING/PRODUCTION. Prevent production credentials from being supplied to local/staging commands. Egress allowlist and environment-tagged account allowlist provide independent safeguards.

Secrets incident runbook: disable affected new entries, assess broker-held orders, rotate/revoke appropriate grants, preserve redacted evidence, communicate to affected users, and follow counsel-approved breach procedures. Do not test a leaked credential by posting it to another service. Security owner must review dependency findings; zero unresolved critical/high exploitable findings in authentication or trading paths before live launch.

Massachusetts privacy/security applicability and a written security program require legal review [S09]. Avoid unnecessary identity documents; rely on provider account grants and appropriate attestations unless counsel/provider rules require more.

## Local skills and build boundary

`.agents/skills/` is local-only development tooling. Read it for relevant guidance but do not modify, delete, move, rename, stage, commit, push, or package it. Verify ignore and tracked-file state without printing private skill contents. A `.gitignore` entry alone does not untrack files already in the index [S16]. If tracked skills are found, report the issue and propose a non-destructive remediation; do not delete local files or rewrite history.

Build from an explicit tracked application file set. Review `.dockerignore`, static/public asset sources, archive scripts and deployment contexts. No skill files, credentials, proprietary broker SDK distributions or restricted agreements should be included accidentally. The running application must have no import, read, startup check or dependency on `.agents/skills/`.
