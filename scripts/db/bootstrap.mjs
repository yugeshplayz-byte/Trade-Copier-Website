// Runs scripts/db/bootstrap-local.sql as the PostgreSQL superuser.
// psql prompts for the superuser password in this terminal; this script never
// reads, stores or prints it. Role passwords come from the git-ignored env files.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
for (const file of ['.env', '.env.db-admin']) {
  const path = join(root, file);
  if (existsSync(path)) process.loadEnvFile(path);
}

function rolePassword(names, expectedUser) {
  const values = new Set();
  for (const name of names) {
    const raw = process.env[name];
    if (!raw) continue;
    const url = new URL(raw);
    if (decodeURIComponent(url.username) !== expectedUser) {
      console.error(`${name} must connect as ${expectedUser}.`);
      process.exit(64);
    }
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      console.error(`${name} must point at this machine.`);
      process.exit(64);
    }
    values.add(decodeURIComponent(url.password));
  }
  if (values.size !== 1 || [...values][0] === '') {
    console.error(`Expected exactly one non-empty password for ${expectedUser} across ${names.join(', ')}.`);
    process.exit(64);
  }
  return [...values][0];
}

const appPassword = rolePassword(['DATABASE_URL', 'TEST_DATABASE_URL'], 'tradeplex_app');
const migratorPassword = rolePassword(['MIGRATION_DATABASE_URL', 'TEST_MIGRATION_DATABASE_URL'], 'tradeplex_migrator');

function findPsql() {
  if (process.env.PSQL) return process.env.PSQL;
  const base = 'C:\\Program Files\\PostgreSQL';
  if (process.platform === 'win32' && existsSync(base)) {
    const versions = readdirSync(base).filter((v) => /^\d+$/.test(v)).sort((a, b) => Number(b) - Number(a));
    for (const v of versions) {
      const candidate = join(base, v, 'bin', 'psql.exe');
      if (existsSync(candidate)) return candidate;
    }
  }
  return 'psql';
}

const superuser = process.env.PGSUPERUSER ?? 'postgres';
console.log(`Connecting to 127.0.0.1:5432 as ${superuser}. psql will ask for that password.`);
const result = spawnSync(
  findPsql(),
  ['-h', '127.0.0.1', '-p', '5432', '-U', superuser, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', join(root, 'scripts', 'db', 'bootstrap-local.sql')],
  {
    stdio: 'inherit',
    env: { ...process.env, TP_APP_PASSWORD: appPassword, TP_MIGRATOR_PASSWORD: migratorPassword },
  },
);
if (result.error) {
  console.error(`Could not start psql: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
