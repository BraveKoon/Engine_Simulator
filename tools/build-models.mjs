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
import { uninstance } from '@gltf-transform/functions';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import { REAL_CARS } from '../src/car/realCars.js';

const [srcDir, ...only] = process.argv.slice(2);
if (!srcDir) throw new Error('usage: node tools/build-models.mjs <source dir> [out ...]');
const cfg = JSON.parse(fs.readFileSync('tools/models.json', 'utf8'));
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'models-'));
const cli = path.resolve('node_modules/.bin/gltf-transform');
const MAX_TRIS = 180000;

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'draco3d.decoder': await draco3d.createDecoderModule(), 'draco3d.encoder': await draco3d.createEncoderModule() });
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
  // models shipped with identical placeholder materials: colour them before optimize
  // (its dedup step would otherwise merge them all into one)
  let input = src;
  // GPU-instanced parts (EXT_mesh_gpu_instancing) would lose their instance transforms
  // further down the pipeline: expand them into ordinary nodes first
  if (doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'EXT_mesh_gpu_instancing')) {
    await doc.transform(uninstance());
    input = path.join(tmp, `${m.out}.u.glb`);
    await io.write(input, doc);
  }
  if (m.colors) {
    const colorIn = input;
    input = path.join(tmp, `${m.out}.0.glb`);
    run(['tools/prep-model.mjs', colorIn, input, '--colors', JSON.stringify(m.colors), '--up', m.up || 'y', '--yaw', '0', '--no-wheels']);
  }
  execFileSync(cli, ['optimize', input, s1, '--compress', 'false', '--texture-compress', 'webp', '--texture-size', String(m.tex || 1024),
    '--simplify', ratio < 1 ? 'true' : 'false', '--simplify-ratio', String(ratio), '--simplify-error', String(m.simplifyError ?? (tris > 3 * MAX_TRIS ? 0.012 : 0.004)),
    '--flatten', 'false', '--join', 'false', '--palette', 'false', '--instance', 'false'], { stdio: 'ignore' });
  const prepArgs = ['tools/prep-model.mjs', s1, s2, '--length', String(car.L)];
  if (m.yaw !== undefined) prepArgs.push('--yaw', String(m.yaw));
  if (m.exclude) prepArgs.push('--exclude', m.exclude);
  if (m.drop) prepArgs.push('--drop', m.drop);
  if (m.outliers) prepArgs.push('--outliers', String(m.outliers));
  if (m.wheels === false) prepArgs.push('--no-wheels'); // wheels fused into the body (scans, merged meshes)
  if (m.up && !m.colors) prepArgs.push('--up', m.up); // colour pre-pass already turned it Y-up
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
// CREDITS.md: one row per model file (CC licences require attribution)
const byFile = new Map();
for (const [car, e] of Object.entries(manifest)) {
  if (!byFile.has(e.file)) byFile.set(e.file, { ...e, cars: [] });
  byFile.get(e.file).cars.push(car);
}
const lic = (l = '') => {
  const [name, url] = l.split(' (');
  return url ? `[${name}](${url.replace(/\)$/, '')})` : name;
};
const rows = [...byFile.values()]
  .sort((a, b) => a.file.localeCompare(b.file))
  .map((e) => `| \`public/${e.file}\` | ${e.cars.join(', ')} | "${(e.title || '').replace(/\|/g, '\\|')}" | ${e.author} | ${lic(e.license)} | ${e.source} |`);
fs.writeFileSync(
  'CREDITS.md',
  `# 3D 모델 출처\n\n앱에 들어간 차량 3D 모델은 모두 Sketchfab에서 Creative Commons 라이선스로 공개된 모델이에요.\n` +
    `모든 모델은 \`tools/build-models.mjs\`로 변경했어요: 폴리곤 단순화, 방향·크기 정규화, 바퀴 분리, meshopt 압축, 텍스처 WebP 변환.\n` +
    `CC BY-NC(비상업) 라이선스 모델이 포함되어 있으니 상업적으로 쓰지 마세요. CC BY-NC-SA 모델의 변경본은 같은 라이선스로 배포돼요.\n\n` +
    `| 파일 | 차량 | 모델 제목 | 제작자 | 라이선스 | 원본 |\n| --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}\n\n` +
    `모델을 추가하려면 원본을 받아 \`tools/models.json\`에 등록하고 \`node tools/build-models.mjs <원본 폴더> <out 이름>\`을 실행하세요.\n`,
);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nwrote ${manifestPath} (${Object.keys(manifest).length} cars)`);
