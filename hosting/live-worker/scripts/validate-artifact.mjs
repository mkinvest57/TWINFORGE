import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(resolve(project, 'dist/server/index.js'), 'utf8');
const manifest = JSON.parse(await readFile(resolve(project, 'dist/.openai/hosting.json'), 'utf8'));
assert.equal(manifest.project_id, 'appgprj_6aeb201bbbb88191b56d8dd45accb560', 'Preserve the existing private Site identity.');
assert.ok(manifest.d1, 'A verified Sites D1 binding declaration is required before publication.');
const worker = (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).default;
assert.equal(typeof worker?.fetch, 'function');
for (const path of ['/', '/web/vision/world.html', '/web/vision/world.mjs', '/assets/vendor/three/build/three.module.js', '/scan.html']) {
  const response = await worker.fetch(new Request('https://private.example' + path), {});
  assert.equal(response.status, 200, path);
}
for (const path of ['/.env', '/.twinforge/credits.jsonl', '/src/index.mjs', '/api/evidence']) {
  const response = await worker.fetch(new Request('https://private.example' + path), {});
  assert.equal(response.status, 404, path);
}
const status = await (await worker.fetch(new Request('https://private.example/api/sam/status'), {})).json();
assert.equal(status.available, false, 'No secret or persistent DB must mean no paid calls.');
console.log('Artifact is self-contained ESM; public assets resolve; missing configuration fails closed.');
