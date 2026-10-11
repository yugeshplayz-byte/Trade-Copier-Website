-- 0002 Read-only user resolution for authenticated requests.
--
-- Maps a verified identity-provider subject to the user, their personal tenant
-- and account status, without writing or taking the provisioning lock. Like
-- provision_user it runs with the owner's rights (users are not readable by the
-- runtime role before a tenant context exists) and pins search_path.

CREATE FUNCTION app.resolve_user(p_auth_subject text)
  RETURNS TABLE (out_user_id uuid, out_tenant_id uuid, out_status text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT u.id, m.tenant_id, u.status
      FROM app.users u
      JOIN app.tenant_memberships m ON m.user_id = u.id AND m.role = 'OWNER'
     WHERE u.auth_subject = p_auth_subject
  $$;

REVOKE ALL ON FUNCTION app.resolve_user(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_user(text) TO tradeplex_app;
