import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { CarModel } from './car3d.js';

// Real 3D models for specific cars (see CREDITS.md). Keyed by REAL_CARS name.
export const CAR_MODELS = {
  '부가티 시론': {
    file: 'models/bugatti_chiron.glb',
    yaw: Math.PI / 2, // model's nose points +z after the glTF up-axis fix; turn it to +x
    paint: ['body'], // materials recoloured by the paint swatches
    trim: ['body2'], // second tone, recoloured darker
    // wheel parts are merged across all four corners: split them per wheel by position
    wheels: { tyre: 'Tyre', parts: ['Tyre', 'blur_rim', 'material', 'rim_screws', 'disc_hub_metal', 'Brake_Disk', 'Brake_Disk_rear'] },
    credit: '“Bugatti chiron” by kevin (ケビン), CC BY 4.0',
    source: 'https://sketchfab.com/3d-models/bugatti-chiron-b28585c3e5bc4fc78db39d80fcd6b604',
  },
  '포르쉐 911 카레라': {
    file: 'models/porsche_911.glb',
    yaw: Math.PI / 2,
    paint: ['carpaint'],
    trim: [],
    // separate wheel nodes: spin everything under wheelXX except the brake calipers
    wheels: { match: /wheel(FR|FL|BR|BL|RR|RL)/, exclude: /caliper/ },
    credit: '“2018 Porsche 911” by Outlaw Games™, CC BY-NC 4.0',
    source: 'https://sketchfab.com/3d-models/2018-porsche-911-04f556e0a2aa425185dcee7f7f1e2ff1',
  },
};

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
    holder.rotation.y = this.spec.yaw || 0;
    holder.updateMatrixWorld(true);
    // scale to the real car's length and sit it on the ground, centred
    let box = new THREE.Box3().setFromObject(holder);
    const size = box.getSize(new THREE.Vector3());
    const k = this.car.real.L / Math.max(size.x, size.z);
    holder.scale.setScalar(k);
    holder.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(holder);
    const c = box.getCenter(new THREE.Vector3());
    holder.position.set(-c.x, -box.min.y, -c.z);
    this.root.remove(this.fallback.root);
    this.fallback.dispose();
    this.root.add(holder);
    this.model = holder;
    this.root.updateMatrixWorld(true);
    const w = this.spec.wheels;
    this.spinners = !w ? [] : w.match ? this.makeSpinners(holder, w) : this.splitWheels(holder, w);
    if (this.pendingPaint) this.setPaint(this.pendingPaint);
  }

  // Re-parent each wheel's rotating parts under a pivot at the wheel centre.
  makeSpinners(holder, { match, exclude }) {
    const groups = new Map();
    holder.traverse((o) => {
      if (!o.isMesh) return;
      let id = null;
      let skip = false;
      for (let p = o; p && p !== holder; p = p.parent) {
        const m = match.exec(p.name);
        if (m && !id) id = m[1];
        if (exclude.test(p.name)) skip = true;
      }
      if (id && !skip) {
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id).push(o);
      }
    });
    const pivots = [];
    for (const meshes of groups.values()) {
      const box = new THREE.Box3();
      for (const m of meshes) box.expandByObject(m);
      const pivot = new THREE.Group();
      box.getCenter(pivot.position);
      this.root.add(pivot);
      pivot.updateMatrixWorld(true);
      for (const m of meshes) pivot.attach(m);
      pivots.push(pivot);
    }
    return pivots;
  }

  // For models whose four wheels share meshes: cut the wheel triangles out per
  // corner and put each corner under its own pivot.
  splitWheels(holder, { tyre, parts }) {
    const toRoot = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const meshes = [];
    holder.traverse((o) => o.isMesh && parts.includes(o.material?.name) && meshes.push(o));
    const v = new THREE.Vector3();
    // wheel centres from the tyres, one per quadrant (x: front/rear, z: left/right)
    const quad = (p) => (p.x > 0 ? 1 : 0) + (p.z > 0 ? 2 : 0);
    const boxes = [0, 1, 2, 3].map(() => new THREE.Box3());
    for (const m of meshes.filter((o) => o.material.name === tyre)) {
      const mat = new THREE.Matrix4().multiplyMatrices(toRoot, m.matrixWorld);
      const pos = m.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mat);
        boxes[quad(v)].expandByPoint(v);
      }
    }
    const wheels = boxes
      .filter((b) => !b.isEmpty())
      .map((b) => ({ center: b.getCenter(new THREE.Vector3()), r: (b.max.y - b.min.y) / 2, tris: new Map() }));
    if (!wheels.length) return [];

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (const m of meshes) {
      const mat = new THREE.Matrix4().multiplyMatrices(toRoot, m.matrixWorld);
      const g = m.geometry;
      const pos = g.attributes.position;
      const idx = g.index;
      const triCount = (idx ? idx.count : pos.count) / 3;
      const vid = (t, k) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);
      const keep = [];
      for (let t = 0; t < triCount; t++) {
        a.fromBufferAttribute(pos, vid(t, 0)).applyMatrix4(mat);
        b.fromBufferAttribute(pos, vid(t, 1)).applyMatrix4(mat);
        c.fromBufferAttribute(pos, vid(t, 2)).applyMatrix4(mat);
        a.add(b).add(c).multiplyScalar(1 / 3);
        let best = null;
        let bestD = Infinity;
        for (const w of wheels) {
          const d = a.distanceTo(w.center);
          if (d < bestD) (bestD = d), (best = w);
        }
        if (bestD < best.r * 1.1) {
          if (!best.tris.has(m)) best.tris.set(m, []);
          best.tris.get(m).push(t);
        } else keep.push(t);
      }
      m.userData.keep = keep;
    }
    const pivots = [];
    for (const w of wheels) {
      const pivot = new THREE.Group();
      pivot.position.copy(w.center);
      this.root.add(pivot);
      pivot.updateMatrixWorld(true);
      for (const [m, tris] of w.tris) {
        const part = new THREE.Mesh(subGeometry(m.geometry, tris), m.material);
        part.castShadow = true;
        this.root.add(part);
        part.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, m.matrixWorld));
        pivot.attach(part);
      }
      pivots.push(pivot);
    }
    // leave only the non-wheel triangles in the original meshes
    for (const m of meshes) {
      const keep = m.userData.keep;
      if (keep.length === (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3) continue;
      if (keep.length) m.geometry = subGeometry(m.geometry, keep);
      else m.visible = false;
    }
    return pivots;
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

// Copy the listed triangles of a geometry into a new non-indexed geometry.
function subGeometry(g, tris) {
  const out = new THREE.BufferGeometry();
  const idx = g.index;
  for (const [name, attr] of Object.entries(g.attributes)) {
    const size = attr.itemSize;
    const arr = new Float32Array(tris.length * 3 * size);
    let o = 0;
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        const i = idx ? idx.getX(t * 3 + k) : t * 3 + k;
        for (let s = 0; s < size; s++) arr[o++] = attr.getComponent(i, s);
      }
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

/** The model to show for a built car: the real 3D model when we have one. */
export function makeCarModel(car, onReady) {
  const spec = CAR_MODELS[car.real?.name];
  return spec ? new GlbCarModel(car, spec, onReady) : new CarModel(car);
}
