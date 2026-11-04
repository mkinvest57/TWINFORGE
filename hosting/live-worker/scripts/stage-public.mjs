import {readFile, writeFile, mkdir, rm, lstat, readdir} from 'node:fs/promises';
import {resolve, dirname, relative, extname} from 'node:path';
import {fileURLToPath} from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(process.argv[2] || resolve(project, '../..'));
const destination = resolve(project, 'public');
if (root === destination || destination.startsWith(root + '/public/')) throw new Error('Source must be the application root.');
// Public roots and extensions are explicit. Never walk the repo, output/, the
// private ledger, .env files, evidence uploads, or node_modules.
const entryFiles = ['index.html', 'workbench.html', 'scan.html', 'decision.html', 'camera-local.html', 'legacy-workbench.html', 'manifest.webmanifest'];
const roots = [
  ['web', new Set(['.html', '.css', '.mjs', '.js'])],
  ['assets/mobile', new Set(['.svg'])],
  ['assets/vendor/three', new Set(['.js', '.json', '.txt'])],
];
const assetFiles = ['assets/causal-meta-session.json', 'assets/process-meta-session.json',
  'assets/process-meta-review.json', 'assets/example-bundle.json', 'assets/calibrated-synthetic-bundle.json',
  'assets/example-bundle-baseline-2026-11-04.json'];
const files = [];
async function inspect(path, required = false) {
  const full = resolve(root, path);
  let info;
  try { info = await lstat(full); } catch (error) { if (required || error.code !== 'ENOENT') throw error; else return; }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Only ordinary public files can be staged: ' + path);
  files.push(path);
}
async function walk(path, extensions) {
  for (const item of await readdir(resolve(root, path), {withFileTypes: true})) {
    if (item.name.startsWith('.') || item.isSymbolicLink()) continue;
    const child = path + '/' + item.name;
    if (item.isDirectory()) await walk(child, extensions);
    else if (item.isFile() && extensions.has(extname(item.name))) await inspect(child, true);
  }
}
for (const file of entryFiles) await inspect(file, ['index.html', 'workbench.html', 'scan.html'].includes(file));
for (const file of assetFiles) await inspect(file);
for (const [path, extensions] of roots) await walk(path, extensions);
await rm(destination, {recursive: true, force: true});
for (const file of files) {
  const target = resolve(destination, file);
  if (relative(destination, target).startsWith('..')) throw new Error('Invalid public asset path.');
  await mkdir(dirname(target), {recursive: true});
  await writeFile(target, await readFile(resolve(root, file)));
}
await writeFile(resolve(project, 'public-assets.json'), JSON.stringify(files.sort(), null, 2) + '\n');
console.log('Staged ' + files.length + ' explicitly allowed public files.');
