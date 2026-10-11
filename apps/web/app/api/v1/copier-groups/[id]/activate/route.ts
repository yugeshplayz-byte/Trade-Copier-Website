import { createCopierGroupsApi } from '@/lib/api/copier-groups.ts';
import { apiDeps } from '@/lib/server/api-deps.ts';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return createCopierGroupsApi(apiDeps()).activate(request, id);
}
