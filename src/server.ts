import fs from 'node:fs/promises';
import { createApp } from './app.js';
import { config, describeDbTarget, UPLOADS_DIR } from './config.js';
import { closeDb } from './db/index.js';

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

/**
 * Start serving.
 *
 * Deliberately database-free: the process must come up on a host where MySQL is
 * unreachable, misconfigured or not created yet. Credentials are collected by the
 * browser installer at `/admin/setup` (or read from the environment), the schema is
 * built on the first successful connection, and a bad password is a form error in
 * that wizard — never a crash here.
 */
async function bootstrap() {
  console.log('\n  Gravy CMS');
  line('environment', config.env);
  line('database', config.db.configured ? describeDbTarget() : 'not configured yet');
  if (config.db.configured) line('settings from', config.db.source === 'env+installer' ? '.env + data/install.json' : config.db.source === 'env' ? 'environment / .env' : 'data/install.json');

  if (config.isProd && config.sessionSecret === 'gravy-development-secret-change-me') {
    console.warn('  ⚠ SESSION_SECRET is the development fallback — set a long random value in .env.');
  }
  if (!config.siteUrl) {
    console.log('  · SITE_URL not set — canonical links will follow the request host.');
  }

  const uploadsWarning = await checkUploads();
  if (uploadsWarning) console.warn(`  ⚠ ${uploadsWarning}`);

  const app = await createApp();
  const server = config.socketPath ? app.listen(config.socketPath) : app.listen(config.port, config.host);

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`\n  ✖ Port ${config.port} is already in use. Stop the other process or set PORT in .env.\n`);
      process.exit(1);
    }
    throw error;
  });

  server.on('listening', () => {
    const where = config.socketPath ? `socket ${config.socketPath}` : `http://localhost:${config.port}`;
    // Passenger hides the port, so name the path rather than a URL in that case.
    const base = config.socketPath ? 'your domain' : `http://localhost:${config.port}`;
    console.log(`\n  ✔ Listening on ${where}`);
    console.log('    Site      /');
    console.log('    Studio    /admin');
    console.log('    Installer /admin/setup');

    if (!config.db.configured) {
      console.log('\n  No database has been configured — nothing was attempted.');
      console.log(`  Open ${base}/admin/setup to connect your MariaDB/MySQL database`);
      console.log('  and create your administrator account. The server stays up either way.\n');
      return;
    }

    console.log('\n  The database is connected on first use (tables and settings are created');
    console.log('  automatically). If the details are wrong, /admin/setup fixes them in the browser.\n');
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
  // Only a genuine programming/startup fault reaches here — database problems are
  // handled inside the request lifecycle and never take the process down.
  console.error('\n  ✖ Failed to start:', error);
  void closeDb().finally(() => process.exit(1));
});
