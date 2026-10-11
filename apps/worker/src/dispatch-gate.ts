import { getProvider, type AppEnv, type BrokerEnvironment, type ProviderId } from '@tradecopier/contracts';

/**
 * Final egress check the account execution coordinator must pass immediately
 * before any outbound broker command (COPIER_ENGINE.md pipeline step 5).
 * Later phases add ownership epoch, control latch and risk revalidation; this
 * phase establishes the deny-by-default seam.
 */
export type DispatchDenialCode =
  | 'ENVIRONMENT_REFUSED'
  | 'PROVIDER_BLOCKED'
  | 'PROVIDER_NOT_APPROVED'
  | 'BROKER_ENVIRONMENT_NOT_PERMITTED'
  | 'NO_ADAPTER_REGISTERED';

export type DispatchDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly code: DispatchDenialCode; readonly reason: string };

export interface DispatchRequest {
  readonly appEnv: AppEnv;
  readonly provider: ProviderId;
  readonly brokerEnvironment: BrokerEnvironment;
}

/**
 * Adapters able to send orders in this build. Deliberately empty: the simulator
 * arrives in Phase 3, and no real provider is approved.
 */
const REGISTERED_ORDER_ADAPTERS: ReadonlySet<ProviderId> = new Set<ProviderId>();

export function evaluateDispatch(request: DispatchRequest): DispatchDecision {
  if (request.appEnv === 'PRODUCTION') {
    return deny('ENVIRONMENT_REFUSED', 'PRODUCTION order dispatch is not enabled in this build.');
  }

  const provider = getProvider(request.provider);
  if (provider.status === 'BLOCKED') {
    return deny('PROVIDER_BLOCKED', `${provider.name}: ${provider.summary}`);
  }
  if (provider.status === 'NOT_APPROVED') {
    return deny('PROVIDER_NOT_APPROVED', `${provider.name} is not approved for this deployment.`);
  }
  if (!provider.permittedEnvironments.includes(request.brokerEnvironment)) {
    return deny(
      'BROKER_ENVIRONMENT_NOT_PERMITTED',
      `${provider.name} may not route ${request.brokerEnvironment} orders.`,
    );
  }
  if (!REGISTERED_ORDER_ADAPTERS.has(request.provider)) {
    return deny('NO_ADAPTER_REGISTERED', `No order adapter is registered for ${provider.name} in this build.`);
  }
  return { allowed: true };
}

/** Process-level summary for health reporting: is any order route possible at all? */
export function orderDispatchSummary(): { enabled: false; reason: string } {
  return {
    enabled: false,
    reason: 'No order adapter is registered for dispatch. Simulated order flow arrives with the durable execution slice (Phase 4); no real provider is approved.',
  };
}

function deny(code: DispatchDenialCode, reason: string): DispatchDecision {
  return { allowed: false, code, reason };
}
