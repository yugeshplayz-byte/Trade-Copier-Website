-- One-time local database setup. Run as the PostgreSQL superuser through
-- `npm run db:bootstrap`, which supplies the role passwords from the git-ignored
-- env files. Safe to re-run: existing roles get their attributes and passwords
-- reset, and existing databases are kept.
--
-- Creates:
--   tradeplex_migrator  owns the schema and runs migrations (not a superuser)
--   tradeplex_app       restricted runtime role: no ownership, no RLS bypass
--   tradeplex_dev       local development database
--   tradeplex_test      integration test database (tests reset its schema)

\set ON_ERROR_STOP on
\getenv app_password TP_APP_PASSWORD
\getenv migrator_password TP_MIGRATOR_PASSWORD

\if :{?app_password}
\else
  \echo 'TP_APP_PASSWORD is not set. Run this through npm run db:bootstrap.'
  \quit
\endif
\if :{?migrator_password}
\else
  \echo 'TP_MIGRATOR_PASSWORD is not set. Run this through npm run db:bootstrap.'
  \quit
\endif

SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tradeplex_migrator') AS need_migrator \gset
\if :need_migrator
  CREATE ROLE tradeplex_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'migrator_password';
\else
  ALTER ROLE tradeplex_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'migrator_password';
\endif

SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tradeplex_app') AS need_app \gset
\if :need_app
  CREATE ROLE tradeplex_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD :'app_password';
\else
  ALTER ROLE tradeplex_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD :'app_password';
\endif

SELECT NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'tradeplex_dev') AS need_dev \gset
\if :need_dev
  CREATE DATABASE tradeplex_dev OWNER tradeplex_migrator;
\endif

SELECT NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'tradeplex_test') AS need_test \gset
\if :need_test
  CREATE DATABASE tradeplex_test OWNER tradeplex_migrator;
\endif

REVOKE ALL ON DATABASE tradeplex_dev FROM PUBLIC;
REVOKE ALL ON DATABASE tradeplex_test FROM PUBLIC;
GRANT CONNECT ON DATABASE tradeplex_dev TO tradeplex_app;
GRANT CONNECT ON DATABASE tradeplex_test TO tradeplex_app;

\connect tradeplex_dev
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
\connect tradeplex_test
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

\echo 'Tradeplex local database roles and databases are ready.'
