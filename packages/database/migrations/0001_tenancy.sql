-- 0001 Tenancy foundation (DATABASE.md, SECURITY.md).
--
-- Ownership model: tables are owned by the migration role. The runtime role
-- tradeplex_app owns nothing, cannot bypass RLS, and receives only the grants
-- below. Row-level security filters every tenant table by a transaction-local
-- tenant context; with no context set, policies match no rows (fail closed).
-- The table owner bypasses RLS by design; it is used only for migrations and the
-- narrowly scoped SECURITY DEFINER provisioning function.

CREATE SCHEMA app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO tradeplex_app;

-- Tenant context. set_config(..., true) in the application makes these transaction-local.
CREATE FUNCTION app.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

REVOKE ALL ON FUNCTION app.current_tenant_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.current_user_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_tenant_id() TO tradeplex_app;
GRANT EXECUTE ON FUNCTION app.current_user_id() TO tradeplex_app;

-- ---------- Identity ----------

CREATE TABLE app.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_subject text NOT NULL UNIQUE CHECK (length(auth_subject) BETWEEN 1 AND 255),
  display_name text NOT NULL DEFAULT '' CHECK (length(display_name) <= 200),
  timezone text NOT NULL DEFAULT 'America/New_York' CHECK (length(timezone) BETWEEN 1 AND 64),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DELETED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL DEFAULT 'PERSONAL' CHECK (kind = 'PERSONAL'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.tenant_memberships (
  tenant_id uuid NOT NULL REFERENCES app.tenants (id),
  user_id uuid NOT NULL REFERENCES app.users (id),
  role text NOT NULL CHECK (role = 'OWNER'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

-- Personal tenant invariant: each user owns exactly one tenant initially.
CREATE UNIQUE INDEX tenant_memberships_one_owner_per_user ON app.tenant_memberships (user_id) WHERE role = 'OWNER';

-- ---------- Operations (idempotent control requests) ----------

CREATE TABLE app.operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES app.tenants (id),
  actor_user_id uuid NOT NULL REFERENCES app.users (id),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  kind text NOT NULL CHECK (length(kind) BETWEEN 1 AND 100),
  status text NOT NULL CHECK (status IN ('ACCEPTED', 'SUCCEEDED', 'FAILED')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, id)
);

-- ---------- Audit (append-only for the runtime role) ----------

CREATE TABLE app.audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES app.tenants (id),
  actor_user_id uuid REFERENCES app.users (id),
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 100),
  operation_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, operation_id) REFERENCES app.operations (tenant_id, id)
);
CREATE INDEX audit_logs_tenant_time ON app.audit_logs (tenant_id, created_at);

-- ---------- Versioned configuration: risk profiles ----------

CREATE TABLE app.risk_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES app.tenants (id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  current_version integer NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

-- Immutable versions. The composite foreign key prevents linking a version to another tenant's profile.
CREATE TABLE app.risk_profile_versions (
  tenant_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  limits jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES app.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, version),
  FOREIGN KEY (tenant_id, profile_id) REFERENCES app.risk_profiles (tenant_id, id)
);

-- ---------- Row-level security ----------

ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.risk_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.risk_profile_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_self ON app.users TO tradeplex_app
  USING (id = app.current_user_id()) WITH CHECK (id = app.current_user_id());

CREATE POLICY tenants_current ON app.tenants FOR SELECT TO tradeplex_app
  USING (id = app.current_tenant_id());

CREATE POLICY memberships_visible ON app.tenant_memberships FOR SELECT TO tradeplex_app
  USING (tenant_id = app.current_tenant_id() OR user_id = app.current_user_id());

CREATE POLICY operations_tenant ON app.operations TO tradeplex_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY audit_tenant_read ON app.audit_logs FOR SELECT TO tradeplex_app
  USING (tenant_id = app.current_tenant_id());
CREATE POLICY audit_tenant_insert ON app.audit_logs FOR INSERT TO tradeplex_app
  WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY risk_profiles_tenant ON app.risk_profiles TO tradeplex_app
  USING (tenant_id = app.current_tenant_id()) WITH CHECK (tenant_id = app.current_tenant_id());

CREATE POLICY risk_versions_tenant_read ON app.risk_profile_versions FOR SELECT TO tradeplex_app
  USING (tenant_id = app.current_tenant_id());
CREATE POLICY risk_versions_tenant_insert ON app.risk_profile_versions FOR INSERT TO tradeplex_app
  WITH CHECK (tenant_id = app.current_tenant_id());

-- ---------- Grants: least privilege, no DELETE or TRUNCATE anywhere ----------

GRANT SELECT, UPDATE (display_name, timezone) ON app.users TO tradeplex_app;
GRANT SELECT ON app.tenants TO tradeplex_app;
GRANT SELECT ON app.tenant_memberships TO tradeplex_app;
GRANT SELECT, INSERT, UPDATE (status, result, updated_at) ON app.operations TO tradeplex_app;
GRANT SELECT, INSERT ON app.audit_logs TO tradeplex_app;
GRANT SELECT, INSERT, UPDATE (name, current_version) ON app.risk_profiles TO tradeplex_app;
GRANT SELECT, INSERT ON app.risk_profile_versions TO tradeplex_app;

-- ---------- Provisioning: the only cross-tenant write path for the runtime role ----------

-- Creates (or returns) the user for an identity-provider subject and their
-- personal tenant. Runs with the owner's rights, so it validates input itself,
-- pins search_path and serializes concurrent calls for the same subject.
CREATE FUNCTION app.provision_user(p_auth_subject text, p_display_name text)
  RETURNS TABLE (out_user_id uuid, out_tenant_id uuid, out_status text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_user uuid;
  v_status text;
  v_tenant uuid;
BEGIN
  IF p_auth_subject IS NULL OR length(p_auth_subject) NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION 'invalid auth subject' USING ERRCODE = '22023';
  END IF;
  IF p_display_name IS NULL OR length(p_display_name) > 200 THEN
    RAISE EXCEPTION 'invalid display name' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('tradeplex.provision:' || p_auth_subject, 0));

  SELECT u.id, u.status INTO v_user, v_status FROM app.users u WHERE u.auth_subject = p_auth_subject;
  IF v_user IS NULL THEN
    INSERT INTO app.users (auth_subject, display_name) VALUES (p_auth_subject, p_display_name)
      RETURNING id, status INTO v_user, v_status;
  END IF;

  SELECT m.tenant_id INTO v_tenant FROM app.tenant_memberships m WHERE m.user_id = v_user AND m.role = 'OWNER';
  IF v_tenant IS NULL THEN
    INSERT INTO app.tenants DEFAULT VALUES RETURNING id INTO v_tenant;
    INSERT INTO app.tenant_memberships (tenant_id, user_id, role) VALUES (v_tenant, v_user, 'OWNER');
  END IF;

  RETURN QUERY SELECT v_user, v_tenant, v_status;
END;
$$;

REVOKE ALL ON FUNCTION app.provision_user(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.provision_user(text, text) TO tradeplex_app;
