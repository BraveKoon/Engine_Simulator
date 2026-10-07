#!/usr/bin/env node
// Prepare a downloaded car model (.glb / .gltf) for the app:
//  1. bake every node transform into the vertices (one flat scene)
//  2. turn it so the nose points +X, Y up, scale to the real length, sit it on the ground
//  3. cut the wheels out into four nodes wheel_FL / wheel_FR / wheel_RL / wheel_RR whose
//     origin is the axle centre, so the app only has to rotate them about Z
//  4. write an uncompressed .glb (run `gltf-transform optimize` afterwards to compress)
//
// usage: node tools/prep-model.mjs in.glb out.glb --length 4.54 [--yaw auto|0|90|180|270]
//          [--exclude "caliper"]   (parts never treated as wheel even if inside one)
//          [--drop "Glow"]         (parts to delete)   [--up z]  (model exported Z-up)
//          [--outliers 0.01]       (share of extreme vertices ignored when finding the car)
// Wheels are found from geometry, not names: connected pieces shaped like a tyre
// (round in side view, touching the ground, one per corner); then every piece lying
// completely inside a wheel's cylinder moves with it.
import { NodeIO, Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import draco3d from 'draco3dgltf';

const args = process.argv.slice(2);
const [input, output] = args;
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i > 0 ? args[i + 1] : def;
};
const yawArg = opt('yaw', 'auto');
const targetLength = Number(opt('length', 0));
const excludeRe = new RegExp(opt('exclude', 'caliper|spare|steering.?wheel'), 'i');
const dropRe = opt('drop') ? new RegExp(opt('drop'), 'i') : null; // parts to delete (glow planes…)
const upAxis = opt('up', 'y'); // 'z' for models exported Z-up
// --colors '{"body":"#c00000","glass":"glass","chrome":"metal"}' for models shipped without materials
const colors = opt('colors') ? JSON.parse(opt('colors')) : null;

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'draco3d.decoder': await draco3d.createDecoderModule() });
const doc = await io.read(input);
const root = doc.getRoot();
const scene = root.getDefaultScene() || root.listScenes()[0];
if (colors) {
  for (const m of root.listMaterials()) {
    const c = colors[m.getName()];
    if (!c) continue;
    if (c === 'glass') {
      m.setBaseColorFactor([0.05, 0.07, 0.09, 0.35]).setAlphaMode('BLEND').setMetallicFactor(0).setRoughnessFactor(0.05);
    } else if (c === 'metal') {
      m.setBaseColorFactor([0.85, 0.86, 0.88, 1]).setMetallicFactor(1).setRoughnessFactor(0.2);
    } else {
      const h = parseInt(c.slice(1), 16);
      const lin = (v) => Math.pow(v / 255, 2.2);
      m.setBaseColorFactor([lin(h >> 16), lin((h >> 8) & 255), lin(h & 255), 1]).setMetallicFactor(0.2).setRoughnessFactor(0.45);
    }
  }
}
const buffer = root.listBuffers()[0] || doc.createBuffer();

// ---- small matrix helpers (column-major 4x4) -------------------------------
const apply = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
const applyDir = (n, x, y, z) => {
  const v = [n[0] * x + n[3] * y + n[6] * z, n[1] * x + n[4] * y + n[7] * z, n[2] * x + n[5] * y + n[8] * z];
  const l = Math.hypot(...v) || 1;
  return v.map((c) => c / l);
};
function normalMatrix(m) {
  // inverse-transpose of the upper 3x3
  const a = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  const [a00, a01, a02, a10, a11, a12, a20, a21, a22] = a;
  const b01 = a22 * a11 - a12 * a21;
  const b11 = -a22 * a10 + a12 * a20;
  const b21 = a21 * a10 - a11 * a20;
  const det = a00 * b01 + a01 * b11 + a02 * b21;
  const id = 1 / det;
  const inv = [b01 * id, (-a22 * a01 + a02 * a21) * id, (a12 * a01 - a02 * a11) * id, b11 * id, (a22 * a00 - a02 * a20) * id, (-a12 * a00 + a02 * a10) * id, b21 * id, (-a21 * a00 + a01 * a20) * id, (a11 * a00 - a01 * a10) * id];
  // transpose
  return { n: [inv[0], inv[3], inv[6], inv[1], inv[4], inv[7], inv[2], inv[5], inv[8]], det };
}

// ---- 1. collect every primitive with its world matrix ----------------------
const parts = []; // { prim, M, path }
scene.traverse((node) => {
  const mesh = node.getMesh();
  if (!mesh) return;
  const names = [];
  for (let n = node; n; n = n.getParentNode()) names.push(n.getName());
  for (const prim of mesh.listPrimitives()) {
    if (prim.getMode() !== Primitive.Mode.TRIANGLES) continue;
    parts.push({ prim, M: node.getWorldMatrix(), path: `${names.join('/')}|${mesh.getName()}|${prim.getMaterial()?.getName() || ''}` });
  }
});

// Read one primitive into flat world-space arrays.
function readPart({ prim, M }) {
  const pos = prim.getAttribute('POSITION');
  const nor = prim.getAttribute('NORMAL');
  const idxA = prim.getIndices();
  const count = pos.getCount();
  const { n: N, det } = normalMatrix(M);
  const P = new Float32Array(count * 3);
  const Nn = nor ? new Float32Array(count * 3) : null;
  const v = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    pos.getElement(i, v);
    P.set(apply(M, ...v), i * 3);
    if (Nn) {
      nor.getElement(i, v);
      Nn.set(applyDir(N, ...v), i * 3);
    }
  }
  let I = idxA ? Array.from(idxA.getArray()) : Array.from({ length: count }, (_, i) => i);
  if (det < 0) for (let t = 0; t < I.length; t += 3) [I[t + 1], I[t + 2]] = [I[t + 2], I[t + 1]]; // mirrored node
  const other = {};
  for (const sem of prim.listSemantics()) {
    if (sem === 'POSITION' || sem === 'NORMAL') continue;
    if (sem.startsWith('JOINTS') || sem.startsWith('WEIGHTS') || sem === 'TANGENT') continue;
    const a = prim.getAttribute(sem);
    const size = a.getElementSize();
    const arr = new Float32Array(count * size);
    const e = new Array(size);
    for (let i = 0; i < count; i++) {
      a.getElement(i, e);
      arr.set(e, i * size);
    }
    other[sem] = { arr, size };
  }
  return { P, N: Nn, I, other, material: prim.getMaterial(), count };
}
const geo = parts.filter((p) => !(dropRe && dropRe.test(p.path))).map((p) => ({ ...readPart(p), path: p.path }));
if (upAxis === 'z') {
  // (x, y, z) -> (x, z, -y)
  for (const g of geo) for (const A of [g.P, g.N]) if (A) for (let i = 0; i < A.length; i += 3) [A[i + 1], A[i + 2]] = [A[i + 2], -A[i + 1]];
} else if (upAxis === '-y') {
  // upside-down export: turn 180° about X
  for (const g of geo) for (const A of [g.P, g.N]) if (A) for (let i = 0; i < A.length; i += 3) [A[i + 1], A[i + 2]] = [-A[i + 1], -A[i + 2]];
}

// ---- 2. orientation, scale, ground ------------------------------------------
// bounding box ignoring the most extreme 0.1% of vertices (stray glow planes, ground bits);
// --outliers 0.01 ignores more for models with bigger stray pieces
function trimmedBox() {
  const f = Number(opt('outliers', 0.001));
  const xs = [[], [], []];
  for (const g of geo) {
    const step = Math.max(1, Math.floor(g.P.length / 3 / 20000));
    for (let i = 0; i < g.P.length; i += 3 * step) for (let k2 = 0; k2 < 3; k2++) xs[k2].push(g.P[i + k2]);
  }
  const q = (a, f) => a[Math.min(a.length - 1, Math.max(0, Math.round(f * (a.length - 1))))];
  for (const a of xs) a.sort((u, v) => u - v);
  return { mn: xs.map((a) => q(a, f)), mx: xs.map((a) => q(a, 1 - f)) };
}
const bbox = (list = geo) => {
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (const g of list) for (const vi of g.I) for (let k = 0; k < 3; k++) {
    mn[k] = Math.min(mn[k], g.P[vi * 3 + k]);
    mx[k] = Math.max(mx[k], g.P[vi * 3 + k]);
  }
  return { mn, mx };
};
function rotateY(a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  for (const g of geo) {
    for (let i = 0; i < g.P.length; i += 3) {
      const [x, z] = [g.P[i], g.P[i + 2]];
      g.P[i] = c * x + s * z;
      g.P[i + 2] = -s * x + c * z;
      if (g.N) {
        const [nx, nz] = [g.N[i], g.N[i + 2]];
        g.N[i] = c * nx + s * nz;
        g.N[i + 2] = -s * nx + c * nz;
      }
    }
  }
}
let yaw;
if (yawArg === 'auto') {
  // length along X; then find the rear from small red (tail-light) materials
  let { mn, mx } = trimmedBox();
  yaw = mx[2] - mn[2] > mx[0] - mn[0] ? Math.PI / 2 : 0; // +z -> +x
  rotateY(yaw);
  ({ mn, mx } = trimmedBox());
  const total = geo.reduce((s, g) => s + g.I.length, 0);
  const byMat = new Map();
  for (const g of geo) {
    const m = g.material;
    if (!m) continue;
    const [r, gg, b] = m.getBaseColorFactor();
    const e = m.getEmissiveFactor();
    const red = (r > 0.35 && gg < 0.2 && b < 0.2) || (e[0] > 0.4 && e[1] < 0.2) || /tail|rear.?l|brake.?l|redglass|stop/i.test(m.getName());
    if (!red) continue;
    const a = byMat.get(m) || { n: 0, sx: 0 };
    for (const vi of g.I) (a.n++, (a.sx += g.P[vi * 3]));
    byMat.set(m, a);
  }
  let n = 0;
  let sx = 0;
  for (const a of byMat.values()) if (a.n < total * 0.06) (n += a.n), (sx += a.sx);
  const cx = (mn[0] + mx[0]) / 2;
  if (n && sx / n > cx) {
    rotateY(Math.PI); // tail lights were at +x: turn around
    yaw += Math.PI;
  }
  console.log(`auto yaw ${Math.round((yaw * 180) / Math.PI)}° (red parts: ${n ? (sx / n - cx).toFixed(2) : 'none found'})`);
} else {
  yaw = (Number(yawArg) * Math.PI) / 180;
  rotateY(yaw);
}
let { mn, mx } = trimmedBox();
// drop stray pieces that sit mostly outside the car (glow cones, ground planes)
{
  const pad = [(mx[0] - mn[0]) * 0.04, (mx[1] - mn[1]) * 0.1, (mx[2] - mn[2]) * 0.15];
  let dropped = 0;
  for (const g of geo) {
    const keep = [];
    for (let t = 0; t < g.I.length; t += 3) {
      let out = false;
      for (let k2 = 0; k2 < 3 && !out; k2++) {
        const c = (g.P[g.I[t] * 3 + k2] + g.P[g.I[t + 1] * 3 + k2] + g.P[g.I[t + 2] * 3 + k2]) / 3;
        out = c < mn[k2] - pad[k2] || c > mx[k2] + pad[k2];
      }
      if (out) dropped++;
      else keep.push(g.I[t], g.I[t + 1], g.I[t + 2]);
    }
    g.I = keep;
  }
  if (dropped) console.log(`dropped ${dropped} stray triangles outside the car`);
}
({ mn, mx } = bbox());
const k = targetLength ? targetLength / (mx[0] - mn[0]) : 1;
const off = [-(mn[0] + mx[0]) / 2, -mn[1], -(mn[2] + mx[2]) / 2];
for (const g of geo) for (let i = 0; i < g.P.length; i += 3) for (let c = 0; c < 3; c++) g.P[i + c] = (g.P[i + c] + off[c]) * k;
({ mn, mx } = bbox());
const L = mx[0] - mn[0];
const H = mx[1] - mn[1];
console.log(`size L×W×H = ${L.toFixed(2)} × ${(mx[2] - mn[2]).toFixed(2)} × ${H.toFixed(2)} m (scale ${k.toFixed(3)})`);

// ---- 3. wheels (from geometry) -------------------------------------------------
// connected pieces of every primitive (vertices welded by position)
function components(g) {
  const nv = g.P.length / 3;
  const parent = new Int32Array(nv).map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const unite = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[a] = b;
  };
  const weld = new Map();
  for (let i = 0; i < (args.includes('--no-weld') ? 0 : nv); i++) {
    const key = `${Math.round(g.P[i * 3] * 1000)},${Math.round(g.P[i * 3 + 1] * 1000)},${Math.round(g.P[i * 3 + 2] * 1000)}`;
    const w = weld.get(key);
    if (w === undefined) weld.set(key, i);
    else unite(i, w);
  }
  for (let t = 0; t < g.I.length; t += 3) {
    unite(g.I[t], g.I[t + 1]);
    unite(g.I[t], g.I[t + 2]);
  }
  const comps = new Map();
  for (let t = 0; t < g.I.length; t += 3) {
    const r = find(g.I[t]);
    let c = comps.get(r);
    if (!c) comps.set(r, (c = { tris: [], mn: [Infinity, Infinity, Infinity], mx: [-Infinity, -Infinity, -Infinity] }));
    c.tris.push(t);
    for (let j = 0; j < 3; j++) for (let k2 = 0; k2 < 3; k2++) {
      const v = g.P[g.I[t + j] * 3 + k2];
      if (v < c.mn[k2]) c.mn[k2] = v;
      if (v > c.mx[k2]) c.mx[k2] = v;
    }
  }
  return [...comps.values()];
}
for (const g of geo) g.comps = components(g);

// tyre-like pieces: round from the side, sitting on the ground, near a corner
const quad = (x, z) => (x > 0 ? 'F' : 'R') + (z > 0 ? 'R' : 'L'); // nose +x, +z is the right side
const cands = {};
for (const g of geo) {
  if (excludeRe.test(g.path)) continue;
  for (const c of g.comps) {
    const dx = c.mx[0] - c.mn[0];
    const dy = c.mx[1] - c.mn[1];
    const dz = c.mx[2] - c.mn[2];
    const cxp = (c.mx[0] + c.mn[0]) / 2;
    const czp = (c.mx[2] + c.mn[2]) / 2;
    const round = dx / dy > 0.85 && dx / dy < 1.18;
    const size = dy > 0.45 && dy < Math.min(1.25, H * 0.75);
    const grounded = c.mn[1] < 0.06 * H + 0.02;
    const corner = Math.abs(cxp) > L * 0.18 && Math.abs(czp) > 0.35 && dz < 0.6;
    if (process.env.DEBUG_WHEELS && dy > 0.3 && c.mn[1] < 0.25 * H) {
      console.log(`  piece ${g.path.slice(0, 40)} d=${dx.toFixed(2)},${dy.toFixed(2)},${dz.toFixed(2)} at ${cxp.toFixed(2)},${czp.toFixed(2)} bottom ${c.mn[1].toFixed(2)} ${round ? '' : 'NOT-ROUND '}${size ? '' : 'SIZE '}${grounded ? '' : 'NOT-GROUNDED '}${corner ? '' : 'NOT-CORNER'}`);
    }
    if (round && size && grounded && corner) {
      const q = quad(cxp, czp);
      const b = (cands[q] ||= { mn: [Infinity, Infinity, Infinity], mx: [-Infinity, -Infinity, -Infinity], n: 0 });
      b.n++;
      for (let k2 = 0; k2 < 3; k2++) {
        b.mn[k2] = Math.min(b.mn[k2], c.mn[k2]);
        b.mx[k2] = Math.max(b.mx[k2], c.mx[k2]);
      }
    }
  }
}
const wheels = (args.includes('--no-wheels') ? [] : Object.entries(cands)).map(([q, b]) => ({
  name: `wheel_${q}`,
  c: [(b.mn[0] + b.mx[0]) / 2, (b.mn[1] + b.mx[1]) / 2, (b.mn[2] + b.mx[2]) / 2],
  r: (b.mx[1] - b.mn[1]) / 2,
  w: (b.mx[2] - b.mn[2]) / 2,
  prims: [],
}));
for (const w of wheels) console.log(`${w.name}: centre ${w.c.map((v) => v.toFixed(2)).join(', ')}  r ${w.r.toFixed(3)}  half-width ${w.w.toFixed(3)}`);
if (wheels.length !== 4) console.warn(`WARNING: found ${wheels.length} wheels (expected 4)`);

// move every piece that lies completely inside a wheel cylinder
const inside = (c, w) => {
  const pad = 0.01;
  const rx = Math.max(Math.abs(c.mn[0] - w.c[0]), Math.abs(c.mx[0] - w.c[0]));
  const ry = Math.max(Math.abs(c.mn[1] - w.c[1]), Math.abs(c.mx[1] - w.c[1]));
  return Math.hypot(rx, ry) < w.r * 1.42 + pad && rx < w.r + pad && ry < w.r + pad && c.mn[2] > w.c[2] - w.w - pad && c.mx[2] < w.c[2] + w.w + pad;
};
const bodyGeo = [];
for (const g of geo) {
  const keep = [];
  const buckets = new Map();
  for (const c of g.comps) {
    const w = excludeRe.test(g.path) ? null : wheels.find((w2) => inside(c, w2));
    const target = w ? (buckets.get(w) || (buckets.set(w, []), buckets.get(w))) : keep;
    for (const t of c.tris) target.push(g.I[t], g.I[t + 1], g.I[t + 2]);
  }
  for (const [w, I] of buckets) w.prims.push({ ...g, I });
  if (keep.length) bodyGeo.push({ ...g, I: keep });
}

// ---- 4. rebuild a clean scene --------------------------------------------------
function makePrim(g, origin = [0, 0, 0]) {
  // compact the vertices this primitive uses
  const map = new Map();
  const I = new Uint32Array(g.I.length);
  const used = [];
  g.I.forEach((vi, j) => {
    if (!map.has(vi)) {
      map.set(vi, used.length);
      used.push(vi);
    }
    I[j] = map.get(vi);
  });
  const pick = (arr, size, sub) => {
    const out = new Float32Array(used.length * size);
    used.forEach((vi, j) => {
      for (let c = 0; c < size; c++) out[j * size + c] = arr[vi * size + c] - (sub ? sub[c] : 0);
    });
    return out;
  };
  const prim = doc.createPrimitive().setMaterial(g.material);
  prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pick(g.P, 3, origin)).setBuffer(buffer));
  if (g.N) prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(pick(g.N, 3)).setBuffer(buffer));
  for (const [sem, { arr, size }] of Object.entries(g.other)) {
    prim.setAttribute(sem, doc.createAccessor().setType({ 1: 'SCALAR', 2: 'VEC2', 3: 'VEC3', 4: 'VEC4' }[size]).setArray(pick(arr, size)).setBuffer(buffer));
  }
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(used.length > 65535 ? I : new Uint16Array(I)).setBuffer(buffer));
  return prim;
}
for (const child of scene.listChildren()) {
  child.traverse((n) => n.dispose());
}
const bodyMesh = doc.createMesh('body');
for (const g of bodyGeo) bodyMesh.addPrimitive(makePrim(g));
scene.addChild(doc.createNode('body').setMesh(bodyMesh));
for (const w of wheels) {
  const mesh = doc.createMesh(w.name);
  for (const g of w.prims) mesh.addPrimitive(makePrim(g, w.c));
  if (!w.prims.length) continue;
  scene.addChild(doc.createNode(w.name).setMesh(mesh).setTranslation(w.c));
}
await doc.transform(dedup(), prune());
await io.write(output, doc);
const tris = [...bodyGeo, ...wheels.flatMap((w) => w.prims)].reduce((s, g) => s + g.I.length / 3, 0);
console.log(`wrote ${output}: ${Math.round(tris)} triangles, ${wheels.reduce((s, w) => s + w.prims.length, 0)} wheel primitives`);
