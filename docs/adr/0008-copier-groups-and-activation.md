# ADR 0008: Copier groups, immutable settings and activation preflight

Status: proposed (Phase 4b) · Date: 2026-10-11

## Context

MASTER_SPEC's critical contracts:
- every group member belongs to one customer;
- one active execution owner per account;
- no follower may also lead, and no cycles or chains;
- activation requires flat accounts, no working orders, fresh snapshots, supported capabilities and authorization;
- settings are immutable versions;
- copy mode is explicit, and EXECUTION comes first.

ARCHITECTURE.md requires activation to claim memberships atomically after preflight, and forbids claiming success before the broker state is verified.

## Decision

- **Schema** (migration 0004):
  - `app.copier_groups` has a mode CHECK of EXECUTION only (ORDER stays gated), the full desired-state set, `current_version`, `active_version` and `control_epoch`, plus an activation boundary storing the per-account snapshot cursors.
  - `app.copy_settings_versions` stores immutable configuration JSON (insert-only for the runtime role).
  - `app.account_claims` carries a partial unique index on `account_id WHERE released_at IS NULL`. That makes "one active owner per account, in any role" a database invariant, which also makes chains and cycles impossible.
  - All three tables use RLS and composite tenant keys.
- **Validation:** `validateGroupConfig` in `packages/domain` checks:
  - the leader is not a follower, and followers are distinct;
  - 1 to 5 followers;
  - the ratio is made of whole-number terms from 1 to 100, at most 10x;
  - the position cap is 1 to 100, and the order cap is at most the position cap;
  - all accounts share one environment and have READY connections;
  - at least one contract.

  It reports every problem at once, and accounts the tenant cannot see are reported as missing. The API maps problems to 422 `invalid_copier_config`. Contracts come from the server's simulated catalog, never from the client.
- **Activation:** `POST /copier-groups/{id}/activate` with `expectedVersion` moves DRAFT to ARMING (202). The worker's activation processor then:
  1. claims ARMING groups (`app.claim_group_activations`, `SKIP LOCKED`, reclaimable after 60 s);
  2. re-validates the configuration;
  3. reads a **fresh** snapshot of every account from its live session, requiring no positions and no working orders;
  4. in one transaction, inserts claims for the leader and followers, freezes `active_version`, increments `control_epoch`, records the activation boundary and sets ACTIVE.

  Any blocker returns the group to DRAFT with every blocker listed. A unique-index violation means an account already belongs to another active copier. Existing positions are never adopted.
- **Size preview:** follower targets for sample leader positions (rounding skips included) are returned on group reads and shown live in the form.

## Evidence

- Domain tests for validation rules and the preview.
- API integration tests:
  - 201 DRAFT, with a preview showing 0.5x giving 0/1/1/0 and 2x giving 2/4/6/−2;
  - 422 listing every problem;
  - another tenant's account reported as missing, and their copier as 404;
  - 409 for a stale version, 202 then replay, and 409 for a repeated activation;
  - 401 without sign-in.
- Worker integration tests (real database and simulator):
  - a flat leader and two followers activate, with 3 claims, version frozen, epoch 1 and a 3-account boundary;
  - an account already in an active copier is blocked;
  - an open follower position is blocked;
  - no live session is blocked.
- Live, as the owner: a copier with leader 1, follower A at 1x and follower B at 2x went DRAFT, then ARMING, then ACTIVE within one worker tick. The worker logged "copier activated, version 1, accounts 3".

## Not yet done

- Copying itself (slice 4c): leader fill ingestion, durable intents and commands, dispatch.
- Pause, halt, flatten and deactivation (releasing claims): Phases 4–5.
- Editing settings (a new version at a flat boundary): later.
- The creation form does not yet hide accounts already claimed by an active copier; activation blocks them instead.
