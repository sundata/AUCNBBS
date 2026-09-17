import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const cwd = resolve(import.meta.dirname, '..');
const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test'))
  throw new Error('Set TEST_DATABASE_URL to a separate database ending in _test');
const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  API_PORT: '4100',
  TEST_API_URL: 'http://localhost:4100',
  TEST_WEB_URL: 'http://localhost:3100',
  NEXT_PUBLIC_API_URL: 'http://localhost:4100',
  API_INTERNAL_URL: 'http://localhost:4100',
  NEXT_DIST_DIR: '.next-e2e',
  CORS_ORIGINS: 'http://localhost:3100',
  JWT_ACCESS_SECRET: 'test-system-access-secret-never-for-production',
  NODE_ENV: 'development',
  STRIPE_SECRET_KEY: 'sk_test_fixture',
  STRIPE_WEBHOOK_SECRET: 'whsec_integration_fixture',
  STRIPE_PROMOTION_PRICE_ID: 'price_fixture',
  MEDIA_LOCAL_DIR: resolve(cwd, 'apps/api/uploads-test'),
  OTP_DELIVERY: 'log',
  // Integration + browser tests share one server and would exhaust OTP throttle quotas.
  THROTTLER_DISABLED: 'true',
};
const servers = [];
function command(args) {
  return new Promise((done, fail) => {
    const p = spawn('pnpm', args, { cwd, env, stdio: 'inherit' });
    p.on('error', fail);
    p.on('exit', (code) =>
      code === 0 ? done() : fail(new Error(`pnpm ${args.join(' ')} exited ${code}`)),
    );
  });
}
function server(command, args, directory = cwd) {
  const p = spawn(command, args, { cwd: directory, env, stdio: 'ignore', detached: true });
  servers.push(p);
  p.on('error', (error) => {
    throw error;
  });
  return p;
}
async function ready(url, p) {
  for (let i = 0; i < 90; i++) {
    if (p.exitCode !== null) throw new Error(`Server exited before readiness: ${url}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Server did not become ready: ${url}`);
}
function stop() {
  for (const p of servers)
    if (p.pid) {
      try {
        process.kill(-p.pid, 'SIGTERM');
      } catch {}
    }
}
process.on('SIGINT', () => {
  stop();
  process.exit(130);
});
process.on('SIGTERM', () => {
  stop();
  process.exit(143);
});
try {
  for (const port of [4100, 3100]) {
    let occupied = false;
    try {
      await fetch(`http://localhost:${port}`);
      occupied = true;
    } catch {}
    if (occupied) throw new Error(`Port ${port} is occupied; stop the test server before running`);
  }
  await command(['--filter', '@aucn/api', 'prisma:migrate:deploy']);
  await command(['--filter', '@aucn/domain', 'build']);
  await command(['--filter', '@aucn/api', 'build']);
  const api = server(process.execPath, ['dist/main.js'], resolve(cwd, 'apps/api'));
  await ready('http://localhost:4100/api/v1/health', api);
  await command(['--filter', '@aucn/api', 'test:integration']);
  const web = server('pnpm', ['--filter', '@aucn/web', 'exec', 'next', 'dev', '-p', '3100']);
  await ready('http://localhost:3100/en/login', web);
  await command(['--filter', '@aucn/web', 'test:e2e']);
} finally {
  stop();
}
