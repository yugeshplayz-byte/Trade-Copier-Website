// Verifies that local-only tooling, environment files and secret-shaped values
// are absent from the commit candidate set and from web build output.
// This is a basic heuristic gate, not a replacement for a dedicated secret scanner.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const failures = [];
const passes = [];

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const lines = (text) => text.split(/\r?\n/).filter(Boolean);

function check(name, problems) {
  if (problems.length === 0) passes.push(name);
  else failures.push(`${name}:\n    ${problems.join('\n    ')}`);
}

// 1. Local tooling and env files are not tracked.
const tracked = lines(git('ls-files'));
check(
  'no local tooling or env files tracked',
  tracked.filter(
    (f) => f.startsWith('.agents/') || f.startsWith('.claude/skills') || (/(^|\/)\.env(\.|$)/.test(f) && !f.endsWith('.env.example')),
  ),
);

// 2. Ignore protections are in force.
const mustBeIgnored = ['.agents/skills/', '.claude/skills/', '.env', '.env.local'];
check(
  'ignore rules protect local tooling and env files',
  mustBeIgnored.filter((p) => {
    try {
      git('check-ignore', '-q', '--no-index', '--', p);
      return false;
    } catch {
      return true;
    }
  }).map((p) => `${p} is not ignored`),
);

// 3. Commit candidates (tracked + untracked-not-ignored) contain no secret-shaped values.
const SECRET_PATTERNS = [
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['live payment key', /\b(?:sk|rk)_live_[A-Za-z0-9]{8,}/],
  ['AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\b(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
];
const candidates = lines(git('ls-files', '--cached', '--others', '--exclude-standard'));
const secretHits = [];
for (const file of candidates) {
  const abs = join(root, file);
  if (!existsSync(abs) || statSync(abs).size > 1_000_000) continue;
  const text = readFileSync(abs, 'utf8');
  for (const [label, pattern] of SECRET_PATTERNS) {
    if (pattern.test(text)) secretHits.push(`${file}: ${label}`);
  }
}
check('no secret-shaped values in commit candidates', secretHits);

// 4. Application source never references local-only tooling.
const sourceHits = candidates
  .filter((f) => /^(apps|packages)\//.test(f) && /\.(ts|tsx|js|mjs|json|css)$/.test(f))
  .filter((f) => /\.agents[\\/]|\.claude[\\/]skills|SKILL\.md/.test(readFileSync(join(root, f), 'utf8')))
  .map((f) => `${f} references local tooling`);
check('application source is independent of local tooling', sourceHits);

// 5. Build output contains no local tooling.
const nextDir = join(root, 'apps', 'web', '.next');
if (existsSync(nextDir)) {
  const buildHits = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const rel = relative(root, abs).split(sep).join('/');
      if (entry.isDirectory()) {
        if (entry.name === 'cache') continue;
        walk(abs);
        continue;
      }
      if (/\.agents|SKILL\.md/.test(rel)) buildHits.push(`${rel}: local tooling path in build output`);
      else if (/\.(js|json|html|txt|rsc|css)$/.test(entry.name) && statSync(abs).size < 5_000_000) {
        if (/\.agents[\\/]skills|SKILL\.md/.test(readFileSync(abs, 'utf8'))) {
          buildHits.push(`${rel}: references local tooling`);
        }
      }
    }
  };
  walk(nextDir);
  check('web build output excludes local tooling', buildHits);
} else {
  passes.push('web build output excludes local tooling (skipped: no build present)');
}

// 6. Container build context exclusions exist.
const dockerignore = existsSync(join(root, '.dockerignore')) ? readFileSync(join(root, '.dockerignore'), 'utf8') : '';
check(
  '.dockerignore excludes local tooling and env files',
  ['.agents', '.claude', '.env'].filter((p) => !lines(dockerignore).some((l) => l.trim() === p)).map((p) => `missing "${p}"`),
);

for (const p of passes) console.log(`ok   ${p}`);
for (const f of failures) console.error(`FAIL ${f}`);
if (failures.length > 0) process.exit(1);
console.log(`\n${passes.length} artifact checks passed.`);
