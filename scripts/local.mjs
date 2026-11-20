// npm run local: build with a root base path, serve it on 127.0.0.1 and open it in the default browser.
import { spawn, spawnSync } from 'node:child_process';
import { platform } from 'node:os';

const port = process.env.PORT ?? '4180';
const env = { ...process.env, MA_BASE: '/' };
const npx = platform() === 'win32' ? 'npx.cmd' : 'npx';
const shell = platform() === 'win32';
console.log('Building (one minute or so)...');
const build = spawnSync(npx, ['vite', 'build', '--outDir', 'dist-local'], { stdio: 'inherit', env, shell });
if (build.status !== 0) process.exit(build.status ?? 1);
const url = `http://127.0.0.1:${port}/`;
const server = spawn(npx, ['vite', 'preview', '--outDir', 'dist-local', '--port', port, '--strictPort', '--host', '127.0.0.1'], { stdio: 'inherit', env, shell });
setTimeout(() => {
  const open = platform() === 'darwin' ? ['open', [url]] : platform() === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try { spawn(open[0], open[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* open the URL by hand */ }
  console.log(`\nMeridian Afterglow is running at ${url}  (Ctrl+C to stop)`);
}, 2500);
server.on('exit', code => process.exit(code ?? 0));
