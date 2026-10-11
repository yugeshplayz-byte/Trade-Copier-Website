-- 0003 Broker connections and discovered accounts (BROKER_ADAPTERS.md, DATABASE.md).
--
-- A connection belongs to one tenant. The execution worker, not the web app,
-- establishes it, discovers accounts and records the first snapshot. In this
-- build only the simulator may be stored: real providers are not approved.

CREATE TABLE app.broker_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES app.tenants (id),
  provider text NOT NULL,
  environment text NOT NULL,
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  state text NOT NULL DEFAULT 'CREATED' CHECK (state IN (
    'CREATED', 'AUTHENTICATING', 'CONNECTING', 'SNAPSHOTTING', 'READY',
    'RECONNECTING', 'AUTH_REQUIRED', 'DISCONNECTED', 'BLOCKED')),
  state_reason text CHECK (length(state_reason) <= 300),
  last_snapshot_at timestamptz,
  created_by uuid NOT NULL REFERENCES app.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  -- Defence in depth: this build stores nothing but simulator connections.
  CONSTRAINT broker_connections_simulator_only CHECK (provider = 'simulated' AND environment = 'SIMULATED')
);
CREATE INDEX broker_connections_pending ON app.broker_connections (updated_at, id) WHERE state IN ('CREATED', 'RECONNECTING');

-- Canonical account identity includes provider, environment and routing scope.
-- It is unique across all tenants and connections: one account, one owner.
CREATE TABLE app.broker_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  provider text NOT NULL,
  environment text NOT NULL,
  provider_account_id text NOT NULL CHECK (length(provider_account_id) BETWEEN 1 AND 100),
  canonical_account_id text NOT NULL UNIQUE CHECK (length(canonical_account_id) BETWEEN 1 AND 300),
  account_class text NOT NULL CHECK (account_class IN ('SIMULATED', 'PROVIDER_PRACTICE', 'EVALUATION', 'FUNDED', 'LIVE_BROKERAGE')),
  display_name text NOT NULL CHECK (length(display_name) <= 100),
  -- Rebuildable projection of the latest broker snapshot, not original evidence.
  positions jsonb NOT NULL DEFAULT '[]'::jsonb,
  open_orders integer NOT NULL DEFAULT 0 CHECK (open_orders >= 0),
  snapshot_cursor text,
  snapshot_as_of timestamptz,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (connection_id, provider_account_id),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES app.broker_connections (tenant_id, id),
  CONSTRAINT broker_accounts_simulator_only CHECK (provider = 'simulated' AND environment = 'SIMULATED' AND account_class = 'SIMULATED')
);

ALTER TABLE app.broker_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.broker_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY broker_connections_tenant ON app.broker_connections TO tradeplex_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY broker_accounts_tenant ON app.broker_accounts TO tradeplex_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());

-- The runtime role is shared by web and worker in this build (a separate,
-- narrower worker role arrives with the execution slice). No DELETE anywhere.
GRANT SELECT, INSERT, UPDATE (label, state, state_reason, last_snapshot_at, updated_at) ON app.broker_connections TO tradeplex_app;
GRANT SELECT, INSERT, UPDATE (display_name, positions, open_orders, snapshot_cursor, snapshot_as_of) ON app.broker_accounts TO tradeplex_app;

-- ---------- Worker scheduling (the only cross-tenant reads/writes here) ----------

-- Atomically claims connections waiting to be (re)established. SKIP LOCKED lets
-- concurrent claimers take disjoint work; returned rows carry their tenant so
-- all further work runs inside that tenant's context.
CREATE FUNCTION app.claim_connection_work(p_limit integer)
  RETURNS TABLE (out_connection_id uuid, out_tenant_id uuid, out_provider text, out_environment text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    UPDATE app.broker_connections c
       SET state = 'CONNECTING', state_reason = NULL, updated_at = now()
     WHERE c.id IN (
       SELECT p.id FROM app.broker_connections p
        WHERE p.state IN ('CREATED', 'RECONNECTING')
        ORDER BY p.updated_at, p.id
        LIMIT least(greatest(p_limit, 1), 50)
        FOR UPDATE SKIP LOCKED)
    RETURNING c.id, c.tenant_id, c.provider, c.environment
  $$;

-- After a worker restart, in-memory sessions are gone: every connection the
-- worker had owned must be re-established and re-snapshotted, never assumed live.
CREATE FUNCTION app.mark_connections_for_reconnect()
  RETURNS integer
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    WITH changed AS (
      UPDATE app.broker_connections
         SET state = 'RECONNECTING', state_reason = 'Worker restarted; re-establishing the session.', updated_at = now()
       WHERE state IN ('AUTHENTICATING', 'CONNECTING', 'SNAPSHOTTING', 'READY')
      RETURNING 1)
    SELECT count(*)::integer FROM changed
  $$;

REVOKE ALL ON FUNCTION app.claim_connection_work(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.mark_connections_for_reconnect() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.claim_connection_work(integer) TO tradeplex_app;
GRANT EXECUTE ON FUNCTION app.mark_connections_for_reconnect() TO tradeplex_app;
