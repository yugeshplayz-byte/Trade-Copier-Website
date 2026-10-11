import { createConnectionsApi } from '@/lib/api/connections.ts';
import { apiDeps } from '@/lib/server/api-deps.ts';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return createConnectionsApi(apiDeps()).list(request);
}

export function POST(request: Request) {
  return createConnectionsApi(apiDeps()).create(request);
}
