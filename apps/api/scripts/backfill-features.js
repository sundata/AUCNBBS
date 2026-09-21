/**
 * Backfill illustrated feature articles for past Sydney days.
 * Usage inside the api container: node scripts/backfill-features.js [days]
 * Generates both daily feature slots for each of the last N days (skips existing).
 * Runs the compiled dist/ code so Nest DI (decorator metadata) works correctly.
 */
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { PulseService } = require('../dist/modules/pulse/pulse.service');

const days = Number(process.argv[2] ?? 14);

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const pulse = app.get(PulseService);
  for (let i = days; i >= 1; i--) {
    // Sydney is UTC+10 (AEST) in this window — pick late evening so all slots pass.
    const syd = new Date(Date.now() - i * 86400000 + 10 * 3600000);
    const day = syd.toISOString().slice(0, 10);
    const now = new Date(`${day}T23:45:00+10:00`);
    process.stdout.write(`[${day}] `);
    try {
      await pulse.maybeWriteFeature(now);
      process.stdout.write('done\n');
    } catch (e) {
      process.stdout.write(`error: ${e.message}\n`);
    }
  }
  await app.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
