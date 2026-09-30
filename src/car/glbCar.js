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

function loadGltf(file) {
  if (!cache.has(file)) {
    const embedded = window.__EMBEDDED_MODELS?.[file];
    const buf = embedded ? Promise.resolve(base64ToBuffer(embedded)) : fetch(file).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))));
    const p = buf.then(parseWithImageElements);
    cache.set(file, p);
    p.catch(() => cache.delete(file));
  }
  return cache.get(file);
}

function base64ToBuffer(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/**
 * Shows the simplified procedural car at once, then swaps in the real model
 * when it has loaded. Same interface as CarModel.
 */
export class GlbCarModel {
  constructor(car, spec, onReady) {
    this.car = car;
    this.spec = spec;
    this.root = new THREE.Group();
    this.floor = 0;
    this.fallback = new CarModel(car);
    this.views = this.fallback.views;
    this.root.add(this.fallback.root);
    this.paintMats = [];
    this.trimMats = [];
    this.disposed = false;
    this.pendingPaint = car.paint || null; // keep a colour picked earlier
    loadGltf(spec.file)
      .then((gltf) => {
        if (this.disposed) return;
        this.install(gltf.scene.clone(true));
        onReady?.(this);
      })
      .catch((err) => console.warn('model load failed, keeping simplified car', err));
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
    holder.updateMatrixWorld(true);
    // models are pre-scaled and grounded by tools/prep-model.mjs; just centre them
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder);
    const c = box.getCenter(new THREE.Vector3());
    holder.position.set(-c.x, 0, -c.z);
    this.root.remove(this.fallback.root);
    this.fallback.dispose();
    this.root.add(holder);
    this.model = holder;
    this.spinners = [];
    holder.traverse((o) => /^wheel_(FL|FR|RL|RR)$/.test(o.name) && this.spinners.push(o));
    if (this.pendingPaint) this.setPaint(this.pendingPaint);
  }

  setPaint(hex) {
    if (!this.model) {
      this.pendingPaint = hex;
      if (hex) this.fallback.setPaint(hex);
      return;
    }
    if (!hex) {
      for (const m of [...this.paintMats, ...this.trimMats]) m.color.copy(m.userData.original);
      return;
    }
    const col = new THREE.Color(hex);
    for (const m of this.paintMats) m.color.copy(col);
    for (const m of this.trimMats) m.color.copy(col).multiplyScalar(0.35);
  }

  update(theta, rpm, state) {
    if (!this.model) this.fallback.update(theta, rpm, state);
    else for (const p of this.spinners) p.rotation.z = -(state.wheelAngle || 0);
  }

  dispose() {
    this.disposed = true;
    if (!this.model) this.fallback.dispose();
    for (const m of [...this.paintMats, ...this.trimMats]) m.dispose();
  }
}

/** The model to show for a built car: the real 3D model when we have one. */
export function makeCarModel(car, onReady) {
  const spec = CAR_MODELS[car.real?.name];
  return spec ? new GlbCarModel(car, spec, onReady) : new CarModel(car);
}
