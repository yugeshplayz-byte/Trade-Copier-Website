import 'server-only';
import { loadConfig, type ConfigResult } from '@tradecopier/config';

let cached: ConfigResult | undefined;

/** Validated server configuration. Never import this into client components. */
export function getServerConfig(): ConfigResult {
  cached ??= loadConfig(process.env);
  return cached;
}
