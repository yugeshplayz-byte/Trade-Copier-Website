import { describe, expect, it } from 'vitest';
import { APP_ENVS, BROKER_ENVIRONMENTS, PROVIDER_IDS } from '@tradecopier/contracts';
import { evaluateDispatch } from './dispatch-gate.ts';

describe('evaluateDispatch', () => {
  it('denies every provider, broker environment and app environment combination in this build', () => {
    for (const appEnv of APP_ENVS) {
      for (const provider of PROVIDER_IDS) {
        for (const brokerEnvironment of BROKER_ENVIRONMENTS) {
          const decision = evaluateDispatch({ appEnv, provider, brokerEnvironment });
          expect(decision.allowed, `${appEnv}/${provider}/${brokerEnvironment}`).toBe(false);
        }
      }
    }
  });

  it('reports TopstepX as blocked by its published restriction', () => {
    expect(evaluateDispatch({ appEnv: 'LOCAL', provider: 'topstepx', brokerEnvironment: 'PROVIDER_PRACTICE' })).toMatchObject({
      allowed: false,
      code: 'PROVIDER_BLOCKED',
    });
  });

  it('treats documented-but-unapproved providers as not approved', () => {
    for (const provider of ['tradovate', 'ninjatrader', 'rithmic', 'projectx'] as const) {
      expect(evaluateDispatch({ appEnv: 'LOCAL', provider, brokerEnvironment: 'LIVE' })).toMatchObject({
        code: 'PROVIDER_NOT_APPROVED',
      });
    }
  });

  it('never lets the simulator route non-simulated environments', () => {
    expect(evaluateDispatch({ appEnv: 'LOCAL', provider: 'simulated', brokerEnvironment: 'LIVE' })).toMatchObject({
      code: 'BROKER_ENVIRONMENT_NOT_PERMITTED',
    });
  });

  it('denies the simulator until its adapter is registered', () => {
    expect(evaluateDispatch({ appEnv: 'LOCAL', provider: 'simulated', brokerEnvironment: 'SIMULATED' })).toMatchObject({
      code: 'NO_ADAPTER_REGISTERED',
    });
  });

  it('refuses PRODUCTION before consulting providers', () => {
    expect(evaluateDispatch({ appEnv: 'PRODUCTION', provider: 'simulated', brokerEnvironment: 'SIMULATED' })).toMatchObject({
      code: 'ENVIRONMENT_REFUSED',
    });
  });
});
