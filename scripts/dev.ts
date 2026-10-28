// Development: rebuild the browser app on change and restart the server on change.
//   bun run dev
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
// Fresh checkout: build the page once first, so the server doesn't start a second build of its own.
if (!fs.existsSync(path.join(root, 'public', 'dist', 'app.js'))) {
  const first = Bun.spawn(['bun', 'scripts/build-web.ts'], { cwd: root, stdout: 'inherit', stderr: 'inherit' });
  if (await first.exited) process.exit(1);
}
const web = Bun.spawn(['bun', 'scripts/build-web.ts', '--watch'], { cwd: root, stdout: 'inherit', stderr: 'inherit' });
const server = Bun.spawn(['bun', '--watch', 'server/index.ts', '--no-open', ...process.argv.slice(2)], { cwd: root, stdout: 'inherit', stderr: 'inherit' });

// If one of them ends on its own, stop the other and pass on its exit code.
const stop = (code = 0) => {
  web.kill();
  server.kill();
  process.exit(code);
};
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
stop(await Promise.race([web.exited, server.exited]));
