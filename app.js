/**
 * Azure Gravy CMS — entry point.
 *
 * `npm install && npm start` runs this file directly (`node app.js`), and so does
 * cPanel's "Setup Node.js App" / Phusion Passenger, which expects a startup file
 * at the application root.
 *
 * It loads the TypeScript server through tsx, so there is no build step and no
 * compiled `dist/` folder to keep in sync on the host. If you prefer a compiled
 * build, run `npm run build && npm run start:prod` instead.
 */
async function main() {
  try {
    const { tsImport } = await import('tsx/esm/api');
    await tsImport(new URL('./src/server.ts', import.meta.url).href, import.meta.url);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
    if (code === 'ERR_MODULE_NOT_FOUND') {
      console.error('\n  ✖ Dependencies are missing. Run `npm install` in this folder first.\n');
      console.error(error);
      process.exit(1);
    }
    console.error(error);
    process.exit(1);
  }
}

void main();
