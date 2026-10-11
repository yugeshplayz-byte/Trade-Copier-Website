import { createConnectionsApi } from '@/lib/api/connections.ts';
import { apiDeps } from '@/lib/server/api-deps.ts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return createConnectionsApi(apiDeps()).get(request, id);
}
