/**
 * Copy the Mini App's static shell into dist/.
 *
 * `tsc` only emits JavaScript, so index.html would be missing from a built
 * install and the app would serve a 500 that only shows up in production. The
 * server resolves the file relative to its own module, so the copy has to land
 * beside the compiled server.
 *
 * Node rather than `cp -r` so the build behaves the same on Windows.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(root, 'src', 'miniapp', 'public');
const to = path.join(root, 'dist', 'miniapp', 'public');

if (!fs.existsSync(from)) {
  console.error(`copy-miniapp-assets: nothing at ${from}`);
  process.exit(1);
}

fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });
console.log(`copy-miniapp-assets: ${path.relative(root, to)}`);
