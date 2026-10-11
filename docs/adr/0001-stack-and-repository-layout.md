# ADR 0001: Stack and repository layout

Status: proposed (Phase 1, pending review) · Date: 2026-10-11

## Context

The Phase 0 audit found no existing application, so there was no stack to preserve. ARCHITECTURE.md recommends TypeScript, React/Next.js, a persistent Node worker and PostgreSQL in a modular monolith with two deployables. The local machine has Node 24 and npm 11. It has no pnpm, Docker or PostgreSQL.

## Decision

- **npm workspaces monorepo**, following the proposed tree incrementally: `apps/web`, `apps/worker`, `packages/{config,contracts,observability}`. No empty adapter or domain packages were scaffolded.
- **Next.js 16 (App Router) with React 19** for the control app. Every route renders at request time (`force-dynamic`), so no environment-dependent output is baked into the build. The dev server binds to 127.0.0.1.
- **Persistent worker on Node 24 with native TypeScript type stripping**, which avoids a transpile step and a runtime dependency (`tsx`). This constrains the code to erasable syntax only (`erasableSyntaxOnly`) and explicit `.ts` import extensions. Workspace packages export their `src/index.ts` and resolve through npm workspace symlinks; real-process smoke tests prove this works.
- **zod** validates external input: the environment and the worker health document.
- **Vitest** for tests; **ESLint 9 + typescript-eslint + eslint-config-next** for lint.
- **TypeScript 6.0**, not 7.0, because typescript-eslint supports TypeScript below 6.1.
- **Plain CSS with custom properties.** No Tailwind or component library, because the shell is small and a dependency would add nothing yet. Fonts are Geist and Geist Mono via `next/font`: downloaded at build time and self-hosted, so the browser never contacts Google.
- **No database yet.** Phase 2 needs local PostgreSQL. Installing it is a decision for the owner (`docs/REPO_AUDIT.md`).

## Versions

Exact pins, each release at least two weeks old except where noted:

| Package | Version |
|---|---|
| next | 16.3.8 (a 2026-09-30 patch, chosen over 16.3.6 for six security advisories) |
| eslint-config-next | 16.3.8 |
| react / react-dom | 19.3.0 |
| typescript | 6.0.3 |
| zod | 4.6.5 |
| vitest | 4.1.11 |
| eslint | 9.39.5 |
| typescript-eslint | 8.70.1 |
| @types/node | 24.19.0 |

Dependencies install with `--ignore-scripts`.

## Accepted risk

`npm audit` reports `braces` ≤3.0.3 (GHSA-vfj7-8cjw-p6xm, a denial of service through crafted brace patterns). It is reached only through `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch`. No patched `braces` release exists, and the suggested fix downgrades to eslint-config-next 14. The package runs only at lint time over patterns from our own config. It is absent from runtime and build output. Revisit when a patched release appears.

## Consequences

- Production containers must use Node 24 or later.
- Adding syntax that needs transpilation (enums, namespaces, parameter properties) to worker or package code is a typecheck error by design.
