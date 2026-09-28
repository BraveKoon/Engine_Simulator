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
    credit: '“Bugatti chiron” by kevin (ケビン), CC BY 4.0',
    source: 'https://sketchfab.com/3d-models/bugatti-chiron-b28585c3e5bc4fc78db39d80fcd6b604',
  },
  '포르쉐 911 카레라': {
    file: 'models/porsche_911.glb',
    yaw: Math.PI / 2,
    paint: ['carpaint'],
    trim: [],
    // separate wheel nodes: spin everything under wheelXX except the brake calipers
    wheels: { match: /wheel(FR|FL|RR|RL)/, exclude: /caliper/ },
    credit: '“2018 Porsche 911” by Outlaw Games™, CC BY-NC 4.0',
    source: 'https://sketchfab.com/3d-models/2018-porsche-911-04f556e0a2aa425185dcee7f7f1e2ff1',
  },
};

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();

function loadGltf(file) {
  if (!cache.has(file)) {
    const embedded = typeof window !== 'undefined' && window.__EMBEDDED_MODELS?.[file];
    const p = embedded
      ? fetch(`data:model/gltf-binary;base64,${embedded}`)
          .then((r) => r.arrayBuffer())
          .then((buf) => loader.parseAsync(buf, ''))
      : loader.loadAsync(file);
    cache.set(file, p);
    p.catch(() => cache.delete(file));
  }
  return cache.get(file);
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
    this.spinners = this.spec.wheels ? this.makeSpinners(holder, this.spec.wheels) : [];
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
