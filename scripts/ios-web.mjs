// Builds the web game into the iOS app's "game" folder reference (served at app://game/ by the app), keeping the placeholder README.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const out = 'ios/MeridianAfterglow/game';
const readme = readFileSync(`${out}/README.md`, 'utf8');
execSync(`npx vite build --outDir ${out} --emptyOutDir`, { stdio: 'inherit', env: { ...process.env, MA_BASE: '/' } });
writeFileSync(`${out}/README.md`, readme);
