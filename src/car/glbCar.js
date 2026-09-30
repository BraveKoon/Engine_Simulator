import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { CarModel } from './car3d.js';

import MODELS from './models.json';

// Real 3D models for specific cars, built by tools/build-models.mjs (see CREDITS.md).
// Each model is already oriented (nose +X, Y up), scaled to the real car and has its
// wheels as nodes wheel_FL / wheel_FR / wheel_RL / wheel_RR centred on the axles.
const licenceName = (l = '') => l.split(' (')[0].replace(/-/g, ' ').replace(/^CC BY/, 'CC BY').trim();
const authorName = (a = '') => a.split(' (')[0].trim();
export const CAR_MODELS = Object.fromEntries(
  Object.entries(MODELS).map(([car, m]) => [
    car,
    { ...m, credit: `“${m.title}” by ${authorName(m.author)}, ${licenceName(m.license)}` },
  ]),
);

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();

// GLTFLoader normally decodes embedded textures with fetch(blob:) + createImageBitmap,
// which a strict Content-Security-Policy (connect-src) blocks, leaving textures white.
// Hiding createImageBitmap while the parser is constructed makes it use <img> instead.
function parseWithImageElements(buffer) {
  const saved = window.createImageBitmap;
  window.createImageBitmap = undefined;
  try {
    return loader.parseAsync(buffer, '');
  } finally {
    window.createImageBitmap = saved;
  }
}

// Download with progress (0..1) so the page can show how far along it is.
async function download(url, onProgress, asText) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const total = Number(r.headers.get('content-length')) || 0;
  if (!r.body || !total) return asText ? r.text() : r.arrayBuffer();
  const reader = r.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(Math.min(1, got / total));
  }
  const all = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) (all.set(c, o), (o += c.length));
  return asText ? new TextDecoder().decode(all) : all.buffer;
}

function loadGltf(file, onProgress) {
  let entry = cache.get(file);
  if (!entry) {
    entry = { listeners: new Set(), progress: 0 };
    const report = (f) => {
      entry.progress = f;
      for (const l of entry.listeners) l(f);
    };
    const embedded = window.__EMBEDDED_MODELS?.[file];
    // some hosts only serve web file types: the page can ship models as base64 text
    const buf = embedded
      ? Promise.resolve(base64ToBuffer(embedded))
      : window.__MODELS_AS_TEXT
        ? download(`${file}.txt`, report, true).then(base64ToBuffer)
        : download(file, report, false);
    entry.promise = buf.then(parseWithImageElements);
    entry.promise.catch(() => cache.delete(file));
    cache.set(file, entry);
  }
  if (onProgress) {
    entry.listeners.add(onProgress);
    onProgress(entry.progress);
    entry.promise.finally(() => entry.listeners.delete(onProgress)).catch(() => {});
  }
  return entry.promise;
}

function base64ToBuffer(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

// Remember "show the simplified car" across screens for this visit.
export const modelPrefs = { simple: false };

/**
 * A car with a real 3D model. While the model downloads nothing is shown (the page
 * displays a loading panel); the simplified procedural car can be shown instead at
 * any time with setSimplified(true). Same interface as CarModel.
 * state: 'loading' | 'ready' | 'error'
 */
export class GlbCarModel {
  constructor(car, spec, { onChange } = {}) {
    this.car = car;
    this.spec = spec;
    this.onChange = onChange;
    this.root = new THREE.Group();
    this.floor = 0;
    this.fallback = new CarModel(car);
    this.views = this.fallback.views;
    this.root.add(this.fallback.root); // also frames the camera while loading
    this.paintMats = [];
    this.trimMats = [];
    this.disposed = false;
    this.state = 'loading';
    this.progress = 0;
    this.pendingPaint = car.paint || null; // keep a colour picked earlier
    this.applyVisibility();
    loadGltf(spec.file, (f) => {
      this.progress = f;
      this.onChange?.(this, 'progress');
    })
      .then((gltf) => {
        if (this.disposed) return;
        this.install(gltf.scene.clone(true));
        this.state = 'ready';
        this.applyVisibility();
        this.onChange?.(this, 'ready');
      })
      .catch((err) => {
        console.warn('model load failed, showing the simplified car', err);
        if (this.disposed) return;
        this.state = 'error';
        this.applyVisibility();
        this.onChange?.(this, 'error');
      });
  }

  get simplified() {
    return this.state === 'error' || modelPrefs.simple;
  }

  setSimplified(on) {
    modelPrefs.simple = on;
    this.applyVisibility();
    this.onChange?.(this, 'mode');
  }

  applyVisibility() {
    const simple = this.simplified;
    // while loading and not in simplified mode: keep the fallback for framing but hide it
    this.fallback.root.visible = simple;
    if (this.model) this.model.visible = !simple;
  }

  install(scene) {
    // own copies of the paint materials so recolouring does not leak between instances
    scene.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      const name = o.material?.name;
      if (this.spec.paint.includes(name) || this.spec.trim.includes(name)) {
        o.material = o.material.clone();
        o.material.userData.original = o.material.color.clone();
        (this.spec.paint.includes(name) ? this.paintMats : this.trimMats).push(o.material);
      }
    });
    const holder = new THREE.Group();
    holder.add(scene);
    // models are pre-scaled and grounded by tools/prep-model.mjs; just centre them
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder);
    const c = box.getCenter(new THREE.Vector3());
    holder.position.set(-c.x, 0, -c.z);
    this.root.add(holder);
    this.model = holder;
    this.spinners = [];
    holder.traverse((o) => /^wheel_(FL|FR|RL|RR)$/.test(o.name) && this.spinners.push(o));
    if (this.pendingPaint) this.setPaint(this.pendingPaint);
  }

  setPaint(hex) {
    this.pendingPaint = hex;
    this.fallback.setPaint(hex || this.car.real?.paint || '#8a8f94');
    if (!this.model) return;
    if (!hex) {
      for (const m of [...this.paintMats, ...this.trimMats]) m.color.copy(m.userData.original);
      return;
    }
    const col = new THREE.Color(hex);
    for (const m of this.paintMats) m.color.copy(col);
    for (const m of this.trimMats) m.color.copy(col).multiplyScalar(0.35);
  }

  update(theta, rpm, state) {
    this.fallback.update(theta, rpm, state);
    if (this.spinners) for (const p of this.spinners) p.rotation.z = -(state.wheelAngle || 0);
  }

  dispose() {
    this.disposed = true;
    this.fallback.dispose();
    for (const m of [...this.paintMats, ...this.trimMats]) m.dispose();
  }
}

/** The model to show for a built car: the real 3D model when we have one. */
export function makeCarModel(car, opts) {
  const spec = CAR_MODELS[car.real?.name];
  return spec ? new GlbCarModel(car, spec, opts) : new CarModel(car);
}
