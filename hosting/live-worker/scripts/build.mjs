import {build} from 'esbuild';
import {readFile, writeFile, mkdir, rm, lstat} from 'node:fs/promises';
import {resolve, dirname, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const types = {'.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml', '.txt':'text/plain; charset=utf-8'};
const files = JSON.parse(await readFile(resolve(project, 'public-assets.json'), 'utf8'));
const assets = {};
for (const path of files) {
  if (typeof path !== 'string' || path.startsWith('/') || path.split('/').some(p => !p || p === '..' || p.startsWith('.')) || !types[extname(path)]) throw new Error('Invalid staged public asset: ' + path);
  const full = resolve(project, 'public', path);
  if (!(await lstat(full)).isFile()) throw new Error('Public assets must be regular files.');
  const bytes = await readFile(full);
  assets['/' + path] = {type:types[extname(path)], base64:bytes.toString('base64'), sha256:createHash('sha256').update(bytes).digest('hex')};
}
await rm(resolve(project, 'dist'), {recursive:true, force:true});
await mkdir(resolve(project, 'dist/server'), {recursive:true});
await mkdir(resolve(project, 'dist/.openai'), {recursive:true});
await build({entryPoints:[resolve(project, 'src/index.mjs')], outfile:resolve(project, 'dist/server/index.js'),
  bundle:true, format:'esm', platform:'browser', target:'es2022', minify:true, legalComments:'inline',
  plugins:[{name:'public-assets', setup(builder) {
    builder.onResolve({filter:/^virtual:public-assets$/}, () => ({path:'public-assets', namespace:'embed'}));
    builder.onLoad({filter:/.*/, namespace:'embed'}, () => ({contents:'export default ' + JSON.stringify(assets), loader:'js'}));
  }}]});
const manifestPath = resolve(project, '.openai/hosting.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
await writeFile(resolve(project, 'dist/.openai/hosting.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Built self-contained Worker with ' + files.length + ' embedded public assets.');
