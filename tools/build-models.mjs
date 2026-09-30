#!/usr/bin/env node
// Build every car model listed in tools/models.json:
//   source (glb/gltf) → simplify + WebP textures → prep-model (orient, scale, wheels)
//   → meshopt compression → public/models/<out>.glb
// and write src/car/models.json (file, paint materials, author/licence credit).
//
// usage: node tools/build-models.mjs <dir with the downloaded sources> [only-out-name ...]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { REAL_CARS } from '../src/car/realCars.js';

const [srcDir, ...only] = process.argv.slice(2);
if (!srcDir) throw new Error('usage: node tools/build-models.mjs <source dir> [out ...]');
const cfg = JSON.parse(fs.readFileSync('tools/models.json', 'utf8'));
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'models-'));
const cli = path.resolve('node_modules/.bin/gltf-transform');
const MAX_TRIS = 180000;

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const manifestPath = 'src/car/models.json';
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};

for (const m of cfg.models) {
  if (only.length && !only.includes(m.out)) continue;
  if (m.hold) {
    console.log(`skip ${m.out}: ${m.hold}`);
    continue;
  }
  const src = path.join(srcDir, m.src);
  const doc = await io.read(src);
  const extras = doc.getRoot().getAsset().extras || {};
  if (!/^CC/.test(extras.license || '')) {
    console.log(`skip ${m.out}: no CC licence in the file`);
    continue;
  }
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  const ratio = Math.min(1, MAX_TRIS / tris);
  const car = REAL_CARS.find((c) => c.name === m.cars[0]);
  const s1 = path.join(tmp, `${m.out}.1.glb`);
  const s2 = path.join(tmp, `${m.out}.2.glb`);
  const out = path.join('public/models', `${m.out}.glb`);
  console.log(`\n== ${m.out}  (${Math.round(tris / 1000)}k tris → ×${ratio.toFixed(2)})`);
  const run = (args) => execFileSync(process.execPath, args, { stdio: ['ignore', 'pipe', 'inherit'] }).toString();
  execFileSync(cli, ['optimize', src, s1, '--compress', 'false', '--texture-compress', 'webp', '--texture-size', '1024',
    '--simplify', ratio < 1 ? 'true' : 'false', '--simplify-ratio', String(ratio), '--simplify-error', '0.002',
    '--flatten', 'false', '--join', 'false', '--palette', 'false', '--instance', 'false'], { stdio: 'ignore' });
  const prepArgs = ['tools/prep-model.mjs', s1, s2, '--length', String(car.L)];
  if (m.yaw !== undefined) prepArgs.push('--yaw', String(m.yaw));
  if (m.exclude) prepArgs.push('--exclude', m.exclude);
  if (m.drop) prepArgs.push('--drop', m.drop);
  if (m.up) prepArgs.push('--up', m.up);
  process.stdout.write(run(prepArgs));
  execFileSync(cli, ['optimize', s2, out, '--compress', 'meshopt', '--texture-compress', 'false', '--simplify', 'false',
    '--palette', 'false', '--instance', 'false', '--join-named', 'false'], { stdio: 'ignore' });
  console.log(`→ ${out} ${(fs.statSync(out).size / 1e6).toFixed(2)} MB`);
  const entry = {
    file: `models/${m.out}.glb`,
    paint: m.paint || [],
    trim: m.trim || [],
    title: extras.title,
    author: extras.author,
    license: extras.license,
    source: extras.source,
  };
  for (const name of m.cars) manifest[name] = entry;
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nwrote ${manifestPath} (${Object.keys(manifest).length} cars)`);
