import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ConfigVersionConflictError,
  IdempotencyConflictError,
  NotFoundError,
  UnsafeDatabaseRoleError,
  assertRestrictedRuntimeRole,
  claimConnectionWork,
  createSimulatedConnection,
  listConnections,
  markConnectionsForReconnect,
  recordDiscoveredAccounts,
  setConnectionState,
  createPool,
  createRiskProfile,
  executeIdempotent,
  getRiskProfile,
  provisionUser,
  publishRiskProfileVersion,
  resolveUser,
  withTenant,
  type Pool,
  type ProvisionedUser,
} from './index.ts';
import { MigrationIntegrityError, loadMigrations, migrate } from './migrate.ts';

/*
 * Integration tests against a real PostgreSQL test database, using the actual
 * restricted runtime role (DATABASE.md: test RLS with production roles and
 * pooling). They reset the schema of the *_test database only.
 */

const adminUrl = process.env.TEST_MIGRATION_DATABASE_URL;
const appUrl = process.env.TEST_DATABASE_URL;
const enabled = Boolean(adminUrl && appUrl);

if (!enabled && process.env.REQUIRE_DB_TESTS === '1') {
  throw new Error('REQUIRE_DB_TESTS=1 but TEST_DATABASE_URL / TEST_MIGRATION_DATABASE_URL are not set');
}
if (!enabled) {
  console.warn('[database] integration tests SKIPPED: TEST_DATABASE_URL and TEST_MIGRATION_DATABASE_URL are not set.');
}

const LIMITS = { maxAbsPosition: 5, maxOrderQuantity: 2, allowedProducts: ['MNQ'] };

function pgCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : undefined;
}

describe.skipIf(!enabled)('database (integration)', () => {
  let admin: Pool;
  let app: Pool;
  let alice: ProvisionedUser;
  let bob: ProvisionedUser;

  beforeAll(async () => {
    for (const url of [adminUrl!, appUrl!]) {
      if (!new URL(url).pathname.endsWith('_test')) throw new Error('refusing to run against a non-test database');
    }
    admin = createPool({ connectionString: adminUrl!, applicationName: 'tradeplex-test-admin', max: 2 });
    await admin.query('DROP SCHEMA IF EXISTS app CASCADE');
    await admin.query('DROP SCHEMA IF EXISTS meta CASCADE');
    await migrate(admin);
    app = createPool({ connectionString: appUrl!, applicationName: 'tradeplex-test-app', max: 4 });
    alice = await provisionUser(app, 'test|alice', 'Alice');
    bob = await provisionUser(app, 'test|bob', 'Bob');
  });

  afterAll(async () => {
    await app?.end();
    await admin?.end();
  });

  describe('migrations', () => {
    it('are idempotent on re-run', async () => {
      const report = await migrate(admin);
      expect(report.applied).toEqual([]);
      expect(report.alreadyApplied).toEqual(loadMigrations().map((m) => m.name));
    });

    it('refuse an applied migration whose content changed', async () => {
      const tampered = loadMigrations().map((m) => ({ ...m, checksum: '0'.repeat(64) }));
      await expect(migrate(admin, tampered)).rejects.toBeInstanceOf(MigrationIntegrityError);
    });
  });

  describe('roles', () => {
    it('runtime role is restricted; the owner role is refused as a runtime connection', async () => {
      await expect(assertRestrictedRuntimeRole(app)).resolves.toBeUndefined();
      await expect(assertRestrictedRuntimeRole(admin)).rejects.toBeInstanceOf(UnsafeDatabaseRoleError);
    });

    it('runtime role cannot delete, truncate or rewrite history', async () => {
      await withTenant(app, alice, async (tx) => {
        await tx.query('SAVEPOINT s');
        for (const sql of [
          'DELETE FROM app.audit_logs',
          'UPDATE app.audit_logs SET action = $$x$$',
          'DELETE FROM app.risk_profiles',
          'UPDATE app.risk_profile_versions SET limits = $${}$$',
          'TRUNCATE app.operations',
          'UPDATE app.users SET auth_subject = $$x$$',
        ]) {
          await expect(tx.query(sql)).rejects.toSatisfy((e) => pgCode(e) === '42501');
          await tx.query('ROLLBACK TO SAVEPOINT s');
        }
      });
    });
  });

  describe('provisioning', () => {
    it('is idempotent and gives each user one personal tenant', async () => {
      const again = await provisionUser(app, 'test|alice', 'Alice');
      expect(again).toEqual(alice);
      expect(bob.tenantId).not.toBe(alice.tenantId);
    });

    it('resolves known identities read-only and returns null for unknown ones', async () => {
      expect(await resolveUser(app, 'test|alice')).toEqual(alice);
      expect(await resolveUser(app, 'test|nobody')).toBeNull();
      expect(await resolveUser(app, '')).toBeNull();
    });

    it('is safe under concurrent first sign-ins', async () => {
      const results = await Promise.all(Array.from({ length: 5 }, () => provisionUser(app, 'test|carol', 'Carol')));
      expect(new Set(results.map((r) => r.tenantId)).size).toBe(1);
      expect(new Set(results.map((r) => r.userId)).size).toBe(1);
    });
  });

  describe('tenant isolation', () => {
    it('returns no rows without a tenant context (fail closed)', async () => {
      await withTenant(app, alice, (tx) => createRiskProfile(tx, alice, 'Context check'));
      for (const table of ['risk_profiles', 'operations', 'audit_logs', 'users', 'tenants', 'tenant_memberships']) {
        const { rows } = await app.query<{ n: string }>(`SELECT count(*)::text AS n FROM app.${table}`);
        expect(rows[0]!.n, table).toBe('0');
      }
    });

    it('does not leak tenant context across pooled connections', async () => {
      const single = createPool({ connectionString: appUrl!, applicationName: 'tradeplex-test-single', max: 1 });
      try {
        const seen = await withTenant(single, alice, async (tx) => (await tx.query('SELECT count(*)::int AS n FROM app.risk_profiles')).rows[0].n);
        expect(seen).toBeGreaterThan(0);
        const after = await single.query<{ t: string | null }>("SELECT current_setting('app.tenant_id', true) AS t");
        expect(after.rows[0]!.t ?? '').toBe('');
        const leaked = await single.query<{ n: number }>('SELECT count(*)::int AS n FROM app.risk_profiles');
        expect(leaked.rows[0]!.n).toBe(0);
      } finally {
        await single.end();
      }
    });

    it('customer B cannot read, update or version customer A config', async () => {
      const { id } = await withTenant(app, alice, (tx) => createRiskProfile(tx, alice, 'Alice limits'));
      await withTenant(app, alice, (tx) => publishRiskProfileVersion(tx, alice, { profileId: id, expectedVersion: 0, limits: LIMITS }));

      await withTenant(app, bob, async (tx) => {
        await expect(getRiskProfile(tx, id)).rejects.toBeInstanceOf(NotFoundError);
        await expect(publishRiskProfileVersion(tx, bob, { profileId: id, expectedVersion: 1, limits: LIMITS })).rejects.toBeInstanceOf(NotFoundError);
        const updated = await tx.query('UPDATE app.risk_profiles SET name = $$hijacked$$ WHERE id = $1', [id]);
        expect(updated.rowCount).toBe(0);
      });

      const unchanged = await withTenant(app, alice, (tx) => getRiskProfile(tx, id));
      expect(unchanged).toMatchObject({ name: 'Alice limits', currentVersion: 1 });
    });

    it('rejects writing rows that claim another tenant', async () => {
      await withTenant(app, bob, async (tx) => {
        await expect(
          tx.query('INSERT INTO app.risk_profiles (tenant_id, name) VALUES ($1, $$spoof$$)', [alice.tenantId]),
        ).rejects.toSatisfy((e) => pgCode(e) === '42501');
      });
    });

    it('composite keys stop a version from linking to another tenant profile', async () => {
      const bobProfile = await withTenant(app, bob, (tx) => createRiskProfile(tx, bob, 'Bob limits'));
      await withTenant(app, alice, async (tx) => {
        await expect(
          tx.query(
            `INSERT INTO app.risk_profile_versions (tenant_id, profile_id, version, limits, created_by)
             VALUES ($1, $2, 1, '{}'::jsonb, $3)`,
            [alice.tenantId, bobProfile.id, alice.userId],
          ),
        ).rejects.toSatisfy((e) => pgCode(e) === '23503');
      });
    });
  });

  describe('broker connections', () => {
    const FLAT = { positions: [], openOrders: 0, snapshotCursor: '0', snapshotAsOf: '2026-10-11T12:00:00.000Z' };

    it('stores only simulator connections and isolates them per tenant', async () => {
      const conn = await withTenant(app, alice, (tx) => createSimulatedConnection(tx, alice, 'Alice sim'));
      expect(conn.state).toBe('CREATED');
      expect(await withTenant(app, bob, (tx) => listConnections(tx))).toEqual([]);
      await withTenant(app, alice, async (tx) => {
        await tx.query('SAVEPOINT s');
        await expect(
          tx.query(
            `INSERT INTO app.broker_connections (tenant_id, provider, environment, label, created_by)
             VALUES ($1, 'tradovate', 'LIVE', 'real', $2)`,
            [alice.tenantId, alice.userId],
          ),
        ).rejects.toSatisfy((e) => pgCode(e) === '23514');
        await tx.query('ROLLBACK TO SAVEPOINT s');
      });
    });

    it('keeps canonical account identity unique across tenants', async () => {
      const a = await withTenant(app, alice, (tx) => createSimulatedConnection(tx, alice, 'Alice unique'));
      const b = await withTenant(app, bob, (tx) => createSimulatedConnection(tx, bob, 'Bob unique'));
      const account = { providerAccountId: 'SIM-LEADER-1', canonicalAccountId: 'sim:shared-canonical', displayName: 'x', ...FLAT };
      await withTenant(app, alice, (tx) => recordDiscoveredAccounts(tx, alice, a.id, [account]));
      await expect(withTenant(app, bob, (tx) => recordDiscoveredAccounts(tx, bob, b.id, [account]))).rejects.toSatisfy(
        (e) => pgCode(e) === '23505',
      );
      const bobView = await withTenant(app, bob, (tx) => listConnections(tx));
      expect(bobView.flatMap((c) => c.accounts)).toEqual([]);
    });

    it('records accounts idempotently per connection', async () => {
      const c = await withTenant(app, alice, (tx) => createSimulatedConnection(tx, alice, 'Alice idempotent'));
      const account = { providerAccountId: 'SIM-FOLLOWER-A', canonicalAccountId: `sim:${c.id}:SIM-FOLLOWER-A`, displayName: 'A', ...FLAT };
      await withTenant(app, alice, (tx) => recordDiscoveredAccounts(tx, alice, c.id, [account]));
      await withTenant(app, alice, (tx) => recordDiscoveredAccounts(tx, alice, c.id, [{ ...account, snapshotCursor: '7' }]));
      const view = (await withTenant(app, alice, (tx) => listConnections(tx))).find((x) => x.id === c.id)!;
      expect(view.accounts).toHaveLength(1);
      expect(view.accounts[0]!.snapshotCursor).toBe('7');
    });

    it('gives concurrent claimers disjoint work and recovers connections after a restart', async () => {
      await admin.query("UPDATE app.broker_connections SET state = 'DISCONNECTED'");
      const ids: string[] = [];
      for (let i = 0; i < 4; i++) ids.push((await withTenant(app, alice, (tx) => createSimulatedConnection(tx, alice, `Claim ${i}`))).id);
      const [first, second] = await Promise.all([claimConnectionWork(app, 2), claimConnectionWork(app, 2)]);
      const claimed = [...first!, ...second!].map((c) => c.connectionId);
      expect(new Set(claimed).size).toBe(claimed.length);
      expect(claimed.sort()).toEqual([...ids].sort());
      expect(await claimConnectionWork(app, 5)).toEqual([]);

      await withTenant(app, alice, (tx) => setConnectionState(tx, ids[0]!, 'READY', null, new Date()));
      expect(await markConnectionsForReconnect(app)).toBeGreaterThanOrEqual(1);
      const reclaimed = await claimConnectionWork(app, 10);
      expect(reclaimed.map((c) => c.connectionId)).toContain(ids[0]);
      expect(reclaimed.every((c) => c.userId === null)).toBe(true);
    });
  });

  describe('versioned configuration', () => {
    it('raises a conflict for a stale expected version instead of overwriting', async () => {
      const { id } = await withTenant(app, alice, (tx) => createRiskProfile(tx, alice, 'Versioned'));
      await withTenant(app, alice, (tx) => publishRiskProfileVersion(tx, alice, { profileId: id, expectedVersion: 0, limits: LIMITS }));
      const stale = withTenant(app, alice, (tx) => publishRiskProfileVersion(tx, alice, { profileId: id, expectedVersion: 0, limits: LIMITS }));
      await expect(stale).rejects.toBeInstanceOf(ConfigVersionConflictError);
    });

    it('lets exactly one of two concurrent publishes with the same expected version win', async () => {
      const { id } = await withTenant(app, alice, (tx) => createRiskProfile(tx, alice, 'Race'));
      const attempts = await Promise.allSettled(
        [1, 2].map(() => withTenant(app, alice, (tx) => publishRiskProfileVersion(tx, alice, { profileId: id, expectedVersion: 0, limits: LIMITS }))),
      );
      expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
      const loser = attempts.find((a) => a.status === 'rejected') as PromiseRejectedResult;
      expect(loser.reason).toBeInstanceOf(ConfigVersionConflictError);
    });

    it('validates limits before touching the database', async () => {
      const { id } = await withTenant(app, alice, (tx) => createRiskProfile(tx, alice, 'Validation'));
      await expect(
        withTenant(app, alice, (tx) =>
          publishRiskProfileVersion(tx, alice, { profileId: id, expectedVersion: 0, limits: { ...LIMITS, maxOrderQuantity: 9 } }),
        ),
      ).rejects.toThrow();
    });
  });

  describe('idempotent operations', () => {
    it('repeating the same request has one effect and returns the stored result', async () => {
      const request = { idempotencyKey: 'create-profile-0001', kind: 'risk_profile.create', payload: { name: 'Once' } };
      const handler = (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) => createRiskProfile(tx, alice, 'Once');
      const first = await executeIdempotent(app, alice, request, handler);
      const second = await executeIdempotent(app, alice, request, handler);
      expect(second).toEqual({ ...first, replayed: true });
      const counts = await withTenant(app, alice, async (tx) => ({
        profiles: (await tx.query("SELECT count(*)::int AS n FROM app.risk_profiles WHERE name = 'Once'")).rows[0].n,
        audits: (await tx.query('SELECT count(*)::int AS n FROM app.audit_logs WHERE operation_id = $1', [first.operationId])).rows[0].n,
      }));
      expect(counts).toEqual({ profiles: 1, audits: 1 });
    });

    it('reusing a key with a different request is a conflict', async () => {
      const key = 'create-profile-0002';
      await executeIdempotent(app, alice, { idempotencyKey: key, kind: 'risk_profile.create', payload: { name: 'A' } }, (tx) =>
        createRiskProfile(tx, alice, 'A'),
      );
      await expect(
        executeIdempotent(app, alice, { idempotencyKey: key, kind: 'risk_profile.create', payload: { name: 'B' } }, (tx) =>
          createRiskProfile(tx, alice, 'B'),
        ),
      ).rejects.toBeInstanceOf(IdempotencyConflictError);
    });

    it('keys are scoped per tenant', async () => {
      const request = { idempotencyKey: 'shared-key-0003', kind: 'risk_profile.create', payload: { name: 'Mine' } };
      const a = await executeIdempotent(app, alice, request, (tx) => createRiskProfile(tx, alice, 'Mine'));
      const b = await executeIdempotent(app, bob, request, (tx) => createRiskProfile(tx, bob, 'Mine'));
      expect(b.replayed).toBe(false);
      expect(b.operationId).not.toBe(a.operationId);
    });

    it('records nothing when the handler fails, so the request can be retried', async () => {
      const request = { idempotencyKey: 'failing-op-0004', kind: 'risk_profile.create', payload: { name: 'Retry' } };
      await expect(
        executeIdempotent(app, alice, request, async () => {
          throw new Error('handler failed');
        }),
      ).rejects.toThrow('handler failed');
      const retried = await executeIdempotent(app, alice, request, (tx) => createRiskProfile(tx, alice, 'Retry'));
      expect(retried.replayed).toBe(false);
    });
  });

  it('rejects tenant contexts that are not UUIDs', async () => {
    await expect(withTenant(app, { tenantId: "x' OR 1=1 --", userId: alice.userId }, async () => 1)).rejects.toBeInstanceOf(RangeError);
  });
});
