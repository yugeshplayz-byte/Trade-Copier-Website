-- 0004 Copier groups, immutable settings versions and exclusive account claims
-- (MASTER_SPEC critical contracts 1-5, COPIER_ENGINE state model, DATABASE.md).

CREATE TABLE app.copier_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES app.tenants (id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  -- EXECUTION copies confirmed fills. ORDER mirroring is gated to Production V1.
  mode text NOT NULL DEFAULT 'EXECUTION' CHECK (mode = 'EXECUTION'),
  desired_state text NOT NULL DEFAULT 'DRAFT' CHECK (desired_state IN (
    'DRAFT', 'ARMING', 'ACTIVE', 'PAUSING', 'PAUSED', 'EXIT_ONLY', 'HALTED', 'FLATTENING', 'DISABLED')),
  state_reason text CHECK (length(state_reason) <= 1000),
  -- Latest saved settings version, and the version frozen at activation.
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  active_version integer CHECK (active_version >= 1),
  -- Incremented on every activation/pause so queued work from an older epoch cannot escape.
  control_epoch integer NOT NULL DEFAULT 0 CHECK (control_epoch >= 0),
  activated_at timestamptz,
  -- Per-account snapshot cursors at activation: earlier events are evidence only.
  activation_boundary jsonb,
  work_claimed_at timestamptz,
  created_by uuid NOT NULL REFERENCES app.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE INDEX copier_groups_arming ON app.copier_groups (updated_at, id) WHERE desired_state = 'ARMING';

-- Immutable configuration snapshots. Changing anything creates a new version.
CREATE TABLE app.copy_settings_versions (
  tenant_id uuid NOT NULL,
  group_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  config jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES app.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, version),
  FOREIGN KEY (tenant_id, group_id) REFERENCES app.copier_groups (tenant_id, id)
);

-- One active owner per account, in any role: no account is in two active
-- copiers, a follower cannot also lead, and chained groups are impossible.
CREATE TABLE app.account_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  group_id uuid NOT NULL,
  account_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('LEADER', 'FOLLOWER')),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  FOREIGN KEY (tenant_id, group_id) REFERENCES app.copier_groups (tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES app.broker_accounts (tenant_id, id)
);
CREATE UNIQUE INDEX account_claims_one_owner ON app.account_claims (account_id) WHERE released_at IS NULL;

ALTER TABLE app.copier_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.copy_settings_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.account_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY copier_groups_tenant ON app.copier_groups TO tradeplex_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY settings_versions_tenant_read ON app.copy_settings_versions FOR SELECT TO tradeplex_app
  USING (tenant_id = app.current_tenant_id());
CREATE POLICY settings_versions_tenant_insert ON app.copy_settings_versions FOR INSERT TO tradeplex_app
  WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY account_claims_tenant ON app.account_claims TO tradeplex_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());

GRANT SELECT, INSERT, UPDATE (name, desired_state, state_reason, current_version, active_version, control_epoch,
  activated_at, activation_boundary, work_claimed_at, updated_at) ON app.copier_groups TO tradeplex_app;
GRANT SELECT, INSERT ON app.copy_settings_versions TO tradeplex_app;
GRANT SELECT, INSERT, UPDATE (released_at) ON app.account_claims TO tradeplex_app;

-- Worker scheduling: claims copiers waiting for activation preflight. A claim
-- older than 60 s (crashed worker) may be reclaimed; the preflight is
-- idempotent and the activation transaction re-checks state and version.
CREATE FUNCTION app.claim_group_activations(p_limit integer)
  RETURNS TABLE (out_group_id uuid, out_tenant_id uuid)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    UPDATE app.copier_groups g
       SET work_claimed_at = now()
     WHERE g.id IN (
       SELECT p.id FROM app.copier_groups p
        WHERE p.desired_state = 'ARMING'
          AND (p.work_claimed_at IS NULL OR p.work_claimed_at < now() - interval '60 seconds')
        ORDER BY p.updated_at, p.id
        LIMIT least(greatest(p_limit, 1), 20)
        FOR UPDATE SKIP LOCKED)
    RETURNING g.id, g.tenant_id
  $$;

REVOKE ALL ON FUNCTION app.claim_group_activations(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.claim_group_activations(integer) TO tradeplex_app;
