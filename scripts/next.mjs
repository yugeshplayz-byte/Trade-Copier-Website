// Runs the Next.js CLI for apps/web with telemetry disabled.
// Usage: node scripts/next.mjs <build|start> [...args]
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = join(fileURLToPath(new URL('..', import.meta.url)), 'apps', 'web');
const nextBin = createRequire(join(webDir, 'package.json')).resolve('next/dist/bin/next');
const result = spawnSync(process.execPath, [nextBin, ...process.argv.slice(2)], {
  cwd: webDir,
  stdio: 'inherit',
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
});
process.exit(result.status ?? 1);
