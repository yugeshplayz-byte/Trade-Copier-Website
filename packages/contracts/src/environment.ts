/**
 * Deployment environment of this process. Separate identity, billing, broker and
 * database configuration exists per environment (SECURITY.md, DEPLOYMENT.md).
 * TEST is used by CI and automated tests.
 */
export const APP_ENVS = ['LOCAL', 'TEST', 'STAGING', 'PRODUCTION'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

/**
 * Broker environment an account or command belongs to (BROKER_ADAPTERS.md).
 * An account's environment is part of its canonical identity.
 */
export const BROKER_ENVIRONMENTS = ['SIMULATED', 'PROVIDER_PRACTICE', 'LIVE'] as const;
export type BrokerEnvironment = (typeof BROKER_ENVIRONMENTS)[number];

/**
 * Broker modes this build accepts. Only the simulator is permitted; there is no
 * approved provider, so practice and live routing are not representable here.
 */
export const BROKER_MODES = ['SIMULATED'] as const;
export type BrokerMode = (typeof BROKER_MODES)[number];
