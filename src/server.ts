import fs from 'node:fs/promises';
import { createApp } from './app.js';
import { config, describeDbTarget, UPLOADS_DIR } from './config.js';
import { closeDb, DbSetupError, getDb } from './db/index.js';
import { getSetupState, runBootstrap } from './db/bootstrap.js';

const line = (label: string, value: string) => console.log(`  ${label.padEnd(12)}: ${value}`);

async function checkUploads(): Promise<string | null> {
  try {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    await fs.access(UPLOADS_DIR, fs.constants.W_OK);
    return null;
  } catch {
    return `public/uploads is not writable (chmod 755 or 775 it) — media uploads will fail`;
  }
}

function printSetupFailure(error: unknown): void {
  const setupError = error instanceof DbSetupError ? error : null;
  console.error('\n  ✖ Could not start Azure Gravy CMS\n');
  console.error(`  ${setupError?.message ?? (error instanceof Error ? error.message : String(error))}`);
  if (setupError?.hint) {
    console.error('');
    for (const hintLine of setupError.hint.split('\n')) console.error(`  ${hintLine}`);
  }
  if (!config.isProd && setupError?.cause) {
    console.error(`\n  cause: ${(setupError.cause as Error)?.message ?? setupError.cause}`);
  }
  console.error('\n  Connection attempted:');
  console.error(`    driver   ${config.db.driver}`);
  console.error(`    target   ${describeDbTarget()}`);
  console.error(`    env      ${config.isProd ? '.env' : `${process.cwd()}/.env`}`);
  console.error('\n  Nothing was written to the database.');
  console.error('  Fix the values in .env and run `npm start` again.\n');
}

async function bootstrap() {
  console.log('\n  Azure Gravy CMS');
  line('environment', config.env);
  line('database', describeDbTarget());

  if (config.isProd && config.sessionSecret === 'azure-gravy-development-secret-change-me') {
    console.warn('  ⚠ SESSION_SECRET is the development fallback — set a long random value in .env.');
  }
  if (!config.siteUrl) {
    console.log('  · SITE_URL not set — canonical links will follow the request host.');
  }

  // 1. Connect. Throws DbSetupError with an actionable hint when it cannot.
  const db = await getDb();

  // 2. Create tables, settings and starter content; create the super admin if
  //    ADMIN_EMAIL / ADMIN_PASSWORD are provided.
  const report = await runBootstrap(db);
  line('tables', `${report.tables} ready`);
  if (report.demoSeeded) console.log('  · demo publication seeded (SEED_DEMO=1)');
  if (report.createdContent) console.log('  · starter pages, menu and welcome story created');
  if (report.createdAdmin) console.log(`  · super admin created: ${report.createdAdmin}`);

  const state = await getSetupState(db);
  const uploadsWarning = await checkUploads();
  if (uploadsWarning) console.warn(`  ⚠ ${uploadsWarning}`);

  // 3. Serve.
  const app = await createApp();
  const server = config.socketPath
    ? app.listen(config.socketPath)
    : app.listen(config.port, config.host);

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`\n  ✖ Port ${config.port} is already in use. Stop the other process or set PORT in .env.\n`);
      process.exit(1);
    }
    throw error;
  });

  server.on('listening', () => {
    const where = config.socketPath ? `socket ${config.socketPath}` : `http://localhost:${config.port}`;
    console.log(`\n  ✔ Listening on ${where}`);
    console.log('    Site    /');
    console.log('    Studio  /admin');
    if (!state.ready) {
      console.log('\n  First run — open /admin/setup to create your administrator account.');
      console.log(`  Then sign in at /admin.\n`);
    } else {
      console.log(
        `    ${state.admins} admin account${state.admins === 1 ? '' : 's'} · ` +
          `${state.posts} stor${state.posts === 1 ? 'y' : 'ies'} · ${state.pages} page${state.pages === 1 ? '' : 's'}`,
      );
      console.log('    Ready. Press Ctrl+C to stop.\n');
    }
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
  if (error instanceof DbSetupError) {
    printSetupFailure(error);
  } else {
    console.error('\n  ✖ Failed to start:', error);
  }
  void closeDb().finally(() => process.exit(1));
});
