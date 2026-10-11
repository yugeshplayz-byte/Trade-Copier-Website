// Local development launcher: starts the web app and the execution worker as
// separate processes. Usage: node scripts/dev.mjs [web|worker]
// Environment comes from the shell plus the root .env (loaded by the npm script).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const only = process.argv[2];
if (only && only !== 'web' && only !== 'worker') {
  console.error(`Unknown target "${only}". Use "web", "worker" or nothing for both.`);
  process.exit(64);
}

const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };
const require = createRequire(join(root, 'apps', 'web', 'package.json'));

const targets = {
  worker: { cwd: join(root, 'apps', 'worker'), args: ['--watch', 'src/main.ts'] },
  web: {
    cwd: join(root, 'apps', 'web'),
    args: [require.resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3000'],
  },
};

const children = new Map();
for (const [name, target] of Object.entries(targets)) {
  if (only && only !== name) continue;
  const child = spawn(process.execPath, target.args, { cwd: target.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = `[${name}] `;
  const pipe = (stream, out) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) out.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    children.delete(name);
    if (code === 78) {
      process.stderr.write(`${prefix}refused its configuration. Copy .env.example to .env and see README.md.\n`);
    } else {
      process.stderr.write(`${prefix}exited with code ${code}\n`);
    }
    if (children.size === 0) process.exit(code ?? 0);
  });
  children.set(name, child);
}

const stopAll = () => {
  for (const child of children.values()) child.kill();
};
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
