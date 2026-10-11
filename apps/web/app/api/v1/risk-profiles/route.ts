import { createRiskProfileApi } from '@/lib/api/risk-profiles.ts';
import { apiDeps } from '@/lib/server/api-deps.ts';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return createRiskProfileApi(apiDeps()).list(request);
}

export function POST(request: Request) {
  return createRiskProfileApi(apiDeps()).create(request);
}
