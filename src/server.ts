import { createApp } from './app.js';
import { config } from './config.js';
import { closeDb, getDb, migrate } from './db/index.js';
import { runSeed } from './db/seed.js';

async function bootstrap() {
  console.log('\n  Azure Gravy CMS');
  console.log(`  environment : ${config.env}`);
  console.log(`  database    : ${config.db.driver === 'embedded' ? `embedded MariaDB (${config.db.dataDir})` : `${config.db.host}:${config.db.port}/${config.db.database}`}`);

  const db = await getDb();
  await migrate(db);

  const users = await db.query<{ total: number }>('SELECT COUNT(*) AS total FROM users');
  if (Number(users[0]?.total ?? 0) === 0) {
    console.log('  empty database — seeding demo publication…');
    await runSeed();
  }

  const app = await createApp();
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`  site        : http://localhost:${config.port}`);
    console.log(`  studio      : http://localhost:${config.port}/admin\n`);
  });

  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;

  const shutdown = async (signal: string) => {
    console.log(`\n  ${signal} received — shutting down`);
    server.close(async () => {
      await closeDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((error) => {
  console.error('Failed to start:', error);
  process.exit(1);
});
