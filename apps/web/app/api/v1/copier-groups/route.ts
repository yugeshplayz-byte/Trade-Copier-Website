import { createCopierGroupsApi } from '@/lib/api/copier-groups.ts';
import { apiDeps } from '@/lib/server/api-deps.ts';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return createCopierGroupsApi(apiDeps()).list(request);
}

export function POST(request: Request) {
  return createCopierGroupsApi(apiDeps()).create(request);
}
