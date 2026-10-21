import { config, describeDbTarget } from '../config.js';
import { closeDb, DbSetupError } from './index.js';
import { getSetupState, runBootstrap } from './bootstrap.js';

/**
 * `npm run db:setup`
 *
 * Connects, creates the database (when permitted), creates every table, seeds the
 * settings, menus and starter pages, and creates the super admin from
 * `ADMIN_EMAIL` / `ADMIN_PASSWORD` when those are set. Use this when you would
 * rather prepare the site from the terminal than open the browser wizard; the
 * normal `npm start` does exactly the same work on boot.
 */
async function main() {
  console.log('\n  Azure Gravy — database setup');
  console.log(`  target       : ${describeDbTarget()}`);
  console.log(`  driver       : ${config.db.driver}\n`);

  const report = await runBootstrap();
  const state = await getSetupState();

  console.log(`  ✔ ${report.tables} tables ready`);
  if (report.demoSeeded) console.log('  ✔ demo publication seeded (SEED_DEMO=1)');
  if (report.createdContent) console.log('  ✔ starter pages, menu and welcome story created');
  if (report.createdAdmin) console.log(`  ✔ super admin created: ${report.createdAdmin}`);

  if (state.ready) {
    const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
    console.log(`\n  The site is installed: ${plural(state.admins, 'admin account')}, ${plural(state.posts, 'story', 'stories')}, ${plural(state.pages, 'page')}.`);
    console.log('  Start it with `npm start` and sign in at /admin.\n');
  } else {
    console.log('\n  Tables and starter content are ready, but there is no administrator yet.');
    console.log('  Either run the app (`npm start`) and open /admin/setup,');
    console.log('  or set ADMIN_EMAIL and ADMIN_PASSWORD in .env and run this command again.\n');
  }
}

main()
  .catch((error) => {
    if (error instanceof DbSetupError) {
      console.error(`\n  ✖ ${error.message}`);
      if (error.hint) {
        console.error('');
        for (const line of error.hint.split('\n')) console.error(`  ${line}`);
      }
      console.error(`\n  Target: ${describeDbTarget()}\n`);
    } else {
      console.error('\n  ✖ Setup failed:', error);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
