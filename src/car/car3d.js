import * as THREE from 'three';
import { rimCanvas } from './wheelArt.js';

// Side silhouettes: x as a fraction of body length (+0.5 = front bumper),
// y in metres for a car on 0.33 m tyres. `glass` is the side window, and
// `wind` / `rear` index the outline segments that carry the windscreens.
const PROFILES = {
  hatch: {
    top: [[0.5, 0.32], [0.5, 0.56], [0.46, 0.72], [0.3, 0.84], [0.12, 1.4], [-0.26, 1.47], [-0.45, 1.32], [-0.5, 1.02], [-0.5, 0.32]],
    glass: [[0.265, 0.93], [0.118, 1.35], [-0.25, 1.41], [-0.42, 1.27], [-0.45, 1.0]],
    wind: 3,
    rear: 6,
  },
  sedan: {
    top: [[0.5, 0.32], [0.5, 0.56], [0.46, 0.7], [0.24, 0.84], [0.06, 1.4], [-0.17, 1.45], [-0.36, 1.02], [-0.48, 1.0], [-0.5, 0.85], [-0.5, 0.32]],
    glass: [[0.215, 0.93], [0.06, 1.35], [-0.16, 1.4], [-0.3, 1.02]],
    wind: 3,
    rear: 5,
  },
  coupe: {
    top: [[0.5, 0.3], [0.5, 0.5], [0.45, 0.63], [0.2, 0.78], [0.0, 1.25], [-0.15, 1.3], [-0.4, 0.98], [-0.49, 0.95], [-0.5, 0.78], [-0.5, 0.3]],
    glass: [[0.175, 0.87], [0.0, 1.21], [-0.14, 1.25], [-0.32, 0.98]],
    wind: 3,
    rear: 5,
  },
  super: {
    top: [[0.5, 0.26], [0.5, 0.42], [0.44, 0.55], [0.24, 0.7], [0.05, 1.12], [-0.12, 1.18], [-0.42, 0.98], [-0.5, 0.95], [-0.5, 0.3]],
    glass: [[0.215, 0.77], [0.05, 1.08], [-0.1, 1.13], [-0.21, 0.9]],
    wind: 3,
    rear: 5,
  },
  fastback: {
    top: [[0.5, 0.3], [0.5, 0.5], [0.44, 0.62], [0.2, 0.76], [0.02, 1.22], [-0.12, 1.3], [-0.3, 1.14], [-0.46, 0.86], [-0.5, 0.72], [-0.5, 0.3]],
    glass: [[0.18, 0.84], [0.02, 1.18], [-0.11, 1.25], [-0.27, 1.1], [-0.3, 0.98]],
    wind: 3,
    rear: 5,
  },
  suv: {
    top: [[0.5, 0.4], [0.5, 0.76], [0.46, 0.95], [0.3, 1.05], [0.15, 1.62], [-0.4, 1.72], [-0.49, 1.62], [-0.5, 1.1], [-0.5, 0.4]],
    glass: [[0.28, 1.13], [0.147, 1.57], [-0.39, 1.66], [-0.47, 1.58], [-0.48, 1.14]],
    wind: 3,
    rear: 6,
  },
  offroad: {
    top: [[0.5, 0.5], [0.5, 1.05], [0.47, 1.12], [0.28, 1.16], [0.22, 1.9], [-0.48, 1.95], [-0.5, 1.9], [-0.5, 0.5]],
    glass: [[0.26, 1.23], [0.215, 1.84], [-0.47, 1.88], [-0.485, 1.25]],
    wind: 3,
    rear: -1,
  },
  pickup: {
    top: [[0.5, 0.5], [0.5, 1.05], [0.46, 1.12], [0.26, 1.18], [0.16, 1.85], [-0.1, 1.9], [-0.13, 1.22], [-0.5, 1.22], [-0.5, 0.5]],
    glass: [[0.24, 1.25], [0.155, 1.8], [-0.09, 1.84], [-0.11, 1.27]],
    wind: 3,
    rear: -1,
  },
};

// Rebuild a shape from its sampled outline without repeated or near-collinear points;
// those make the triangulator fill in the wheel arches.
function cleanShape(shape) {
  const src = shape.getPoints(28);
  const pts = [];
  for (const p of src) {
    const q = pts[pts.length - 1];
    if (!q || q.distanceTo(p) > 0.003) pts.push(p);
  }
  while (pts.length > 3 && pts[0].distanceTo(pts[pts.length - 1]) < 0.003) pts.pop();
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (Math.abs(cross) < 1e-6) {
        pts.splice(i, 1);
        changed = true;
        i--;
      }
    }
  }
  return new THREE.Shape(pts);
}

export class CarModel {
  constructor(car) {
    this.car = car;
    this.root = new THREE.Group();
    this.body = new THREE.Group(); // nose toward +x
    this.root.add(this.body);
    // camera presets for the car (the engine model uses the defaults)
    this.views = [
      { name: '사선', dir: [0.95, 0.42, 1.0] },
      { name: '정면', dir: [1, 0.22, 0.0001] },
      { name: '측면', dir: [0.0001, 0.18, 1] },
      { name: '위', dir: [0.0001, 1, 0.12] },
      { name: '뒤', dir: [-0.9, 0.35, 0.7] },
    ];
    this.floor = 0;
    this.wheels = [];
    this.disposables = [];
    this.build();
  }

  mat(m) {
    this.disposables.push(m);
    return m;
  }

  build() {
    const { car } = this;
    const b = car.body;
    const P = PROFILES[car.type];
    const wr = car.wheelR;
    const lift = (wr - 0.33) * 1.1 + (car.chassis === 'frame' ? 0.06 : 0);
    const L = b.L;
    const W = b.W;
    const clr = b.clr + lift;
    const frontAxle = L / 2 - b.fo;
    const rearAxle = frontAxle - b.wb;
    this.axles = [frontAxle, rearAxle];

    const paint = this.mat(new THREE.MeshPhysicalMaterial({ color: car.paint || car.real?.paint || '#8a8f94', metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 }));
    this.paint = paint;
    const trim = this.mat(new THREE.MeshStandardMaterial({ color: 0x17181a, metalness: 0.3, roughness: 0.6 }));
    const chrome = this.mat(new THREE.MeshStandardMaterial({ color: 0xdadde0, metalness: 1, roughness: 0.15 }));
    const glass = this.mat(new THREE.MeshPhysicalMaterial({ color: 0x1b2530, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.88 }));

    // ---- body shell from the side silhouette -----------------------------
    // scale the silhouette to the real car's height
    const sy = b.H ? b.H / Math.max(...P.top.map((p) => p[1])) : 1;
    const pts = P.top.map(([x, y]) => [x * L, y * sy + lift]);
    const glassPts = P.glass.map(([x, y]) => [x * L, y * sy + lift]);
    const belt = Math.min(...glassPts.map((p) => p[1])) - 0.03;
    // smooth the upper outline (keeps the bumper corners)
    const curve = new THREE.CatmullRomCurve3(pts.slice(1, -1).map(([x, y]) => new THREE.Vector3(x, y, 0)), false, 'centripetal');
    const smooth = curve.getSpacedPoints(120).map((v) => [v.x, v.y]);
    // The lower body's rounded edge grows outward from the outline (an inward offset
    // can fold the cap over a thin fender and cover the wheel), so cut the arches and
    // the floor that much bigger.
    const BEVEL = 0.05;
    const archR = wr + 0.06;
    const cutR = archR + BEVEL;
    // Fenders: wherever a wheel arch would reach above the bonnet / rear deck, raise the
    // outline into a fender with a smooth shoulder so the tyre never shows through.
    const fenderTop = wr + archR + 0.1;
    const fender = (x) => {
      let need = 0;
      for (const [ax, dir, end] of [[frontAxle, 1, L / 2], [rearAxle, -1, -L / 2]]) {
        const d = (x - ax) * dir; // > 0 toward that bumper
        const flat = -archR * 0.8;
        const fall = 0.4;
        if (d < flat - fall) continue;
        // flat fender line out to the bumper, easing down toward the cabin
        const t = d >= flat ? 1 : Math.cos(((flat - d) / fall) * (Math.PI / 2)) ** 2;
        // and a rounded nose / tail over the last 40 cm
        const toEnd = Math.abs(end - x);
        const nose = Math.min(1, toEnd / 0.4);
        need = Math.max(need, (fenderTop - 0.14 * (1 - Math.sqrt(nose))) * t);
      }
      return need;
    };
    const cabinLine = smooth.map((p) => [...p]); // the cabin follows the unraised roofline
    for (const p of smooth) p[1] = Math.max(p[1], fender(p[0]));
    const bottom = clr + BEVEL;
    const rb = pts[pts.length - 1];
    const fb = pts[0];
    const extrude = (shape, width, bevel, outward = false) => {
      const g = new THREE.ExtrudeGeometry(shape, {
        depth: width - bevel * 2,
        bevelEnabled: true,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelOffset: outward ? 0 : -bevel,
        bevelSegments: 5,
        curveSegments: 28,
      });
      g.translate(0, 0, -(width - bevel * 2) / 2);
      const m = new THREE.Mesh(g, paint);
      m.castShadow = true;
      m.receiveShadow = true;
      this.body.add(m);
      return m;
    };

    // lower body: silhouette clipped at the belt line
    const lower = new THREE.Shape();
    lower.moveTo(rb[0] + BEVEL, Math.max(rb[1], bottom + 0.1));
    lower.lineTo(rb[0] + BEVEL + 0.1, bottom);
    for (const ax of [rearAxle, frontAxle]) {
      const sn = Math.max(-1, Math.min(1, (bottom - wr) / cutR));
      const phi = Math.asin(sn);
      lower.lineTo(ax - cutR * Math.cos(phi), bottom);
      lower.absarc(ax, wr, cutR, Math.PI - phi, phi, true);
    }
    lower.lineTo(fb[0] - BEVEL - 0.1, bottom);
    lower.lineTo(fb[0] - BEVEL, Math.max(fb[1], bottom + 0.1));
    // top edge front -> rear; keep it strictly inside the bumpers and moving rearward,
    // otherwise the triangulator can fill in a wheel arch
    let px = fb[0] - BEVEL;
    for (const [x0, y] of smooth) {
      const x = Math.min(px - 0.004, Math.max(rb[0] + BEVEL + 0.004, x0));
      if (x >= px) continue;
      lower.lineTo(x, Math.min(y, Math.max(belt + 0.04, fender(x))));
      px = x;
    }
    lower.closePath();
    extrude(cleanShape(lower), W, BEVEL, true);
    // height of the body's top surface (bonnet / deck) at x
    const topAt = (x) => {
      for (let i = 1; i < smooth.length; i++) {
        const [x0, y0] = smooth[i - 1];
        const [x1, y1] = smooth[i];
        if ((x0 - x) * (x1 - x) <= 0) {
          const y = x0 === x1 ? y0 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
          return Math.min(y, Math.max(belt + 0.04, fender(x))) + BEVEL;
        }
      }
      return belt;
    };

    // cabin: the part of the outline above the belt, narrower than the body
    const above = [];
    for (let i = 0; i < cabinLine.length - 1; i++) {
      const [x0, y0] = cabinLine[i];
      const [x1, y1] = cabinLine[i + 1];
      if (y0 >= belt) above.push([x0, y0]);
      if ((y0 - belt) * (y1 - belt) < 0) {
        const t = (belt - y0) / (y1 - y0);
        above.push([x0 + (x1 - x0) * t, belt]);
      }
    }
    const Wc = W - (car.chassis === 'frame' ? 0.18 : 0.3);
    if (above.length > 2) {
      const cab = new THREE.Shape();
      cab.moveTo(above[0][0], belt - 0.06);
      for (const [x, y] of above) cab.lineTo(x, y);
      cab.lineTo(above[above.length - 1][0], belt - 0.06);
      cab.closePath();
      extrude(cab, Wc, 0.1);
    }

    // ---- glass -----------------------------------------------------------
    const gShape = new THREE.Shape();
    glassPts.forEach(([x, y], i) => (i ? gShape.lineTo(x, y) : gShape.moveTo(x, y)));
    gShape.closePath();
    const gGeo = new THREE.ExtrudeGeometry(gShape, { depth: Wc + 0.012, bevelEnabled: false });
    gGeo.translate(0, 0, -(Wc + 0.012) / 2);
    this.body.add(new THREE.Mesh(gGeo, glass));
    const pane = (i) => {
      if (i < 0) return;
      let a = pts[i];
      let c = pts[i + 1];
      // keep only the part above the belt line
      const clip = (p, q) => (p[1] >= belt ? p : [p[0] + ((q[0] - p[0]) * (belt - p[1])) / (q[1] - p[1]), belt]);
      a = clip(a, c);
      c = clip(c, a);
      const dx = c[0] - a[0];
      const dy = c[1] - a[1];
      const len = Math.hypot(dx, dy);
      const nx = dy / len; // outward normal (the top outline runs front -> rear)
      const ny = -dx / len;
      // after lookAt the plane's local x runs across the car and local y up the glass
      const g = new THREE.PlaneGeometry(Wc - 0.2, len * 0.86);
      const m = new THREE.Mesh(g, glass);
      m.position.set((a[0] + c[0]) / 2 + nx * 0.012, (a[1] + c[1]) / 2 + ny * 0.012, 0);
      m.lookAt(m.position.x + nx, m.position.y + ny, 0);
      this.body.add(m);
    };
    pane(P.wind);
    pane(P.rear);

    // dark wheel wells behind the tyres
    const wellMat = this.mat(new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 1, side: THREE.DoubleSide }));
    for (const ax of [rearAxle, frontAxle]) {
      for (const sz of [-1, 1]) {
        const well = new THREE.Mesh(new THREE.CircleGeometry(archR, 32), wellMat);
        well.position.set(ax, wr, sz * (W / 2 - 0.42));
        this.body.add(well);
      }
    }

    // ---- lights, grille, mirrors, bumpers --------------------------------
    const front = pts[0][0];
    const rear = rb[0];
    const headY = pts[1][1] - 0.04;
    const headMat = this.mat(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 0.9 }));
    const tailMat = this.mat(new THREE.MeshStandardMaterial({ color: 0x7a0c0c, emissive: 0xff2a1a, emissiveIntensity: 0.7 }));
    for (const s of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.36), headMat);
      hl.position.set(front + 0.045, headY, s * (W / 2 - 0.3));
      this.body.add(hl);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.42), tailMat);
      tl.position.set(rear - 0.04, car.type === 'pickup' ? 1.05 * sy + lift : pts[pts.length - 2][1] - 0.12, s * (W / 2 - 0.28));
      this.body.add(tl);
      // mirror
      const mirrorAt = glassPts[0];
      const mir = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.09, 0.14), paint);
      mir.position.set(mirrorAt[0] - 0.08, belt + 0.1, s * (Wc / 2 + 0.07));
      mir.castShadow = true;
      this.body.add(mir);
    }
    const grilleH = car.chassis === 'frame' ? 0.34 : 0.16;
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.06, grilleH, W * (car.chassis === 'frame' ? 0.62 : 0.5)), trim);
    grille.position.set(front + 0.04, headY - grilleH / 2 - 0.04, 0);
    this.body.add(grille);
    for (const x of [front + 0.02, rear - 0.02]) {
      const bump = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, W - 0.1), trim);
      bump.position.set(x, bottom + 0.12, 0);
      this.body.add(bump);
    }

    // exhaust tips
    const tips = car.engine.count >= 8 ? 4 : 2;
    const tipGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.14, 16).rotateZ(Math.PI / 2);
    for (let i = 0; i < tips; i++) {
      const side = i % 2 ? 1 : -1;
      const pair = Math.floor(i / 2);
      const t = new THREE.Mesh(tipGeo, chrome);
      t.position.set(rear - 0.02, bottom + 0.1, side * (W / 2 - 0.35 - pair * 0.12));
      this.body.add(t);
    }

    // type-specific details
    if (car.type === 'super') {
      // low rear wing standing on the deck
      const wx = rear + 0.2;
      const wingY = topAt(wx) + 0.14;
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.03, W - 0.24), trim);
      wing.position.set(wx, wingY, 0);
      wing.rotation.z = 0.06;
      this.body.add(wing);
      for (const s of [-1, 1]) {
        const st = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.025), trim);
        st.position.set(wx + 0.02, wingY - 0.08, s * (W / 2 - 0.45));
        this.body.add(st);
      }
    }
    if (car.engine.id === 'v8' && car.type === 'coupe') {
      // hood scoop for the big engines
      const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.5), trim);
      const sx = (pts[2][0] + pts[3][0]) / 2;
      scoop.position.set(sx, topAt(sx) + 0.01, 0);
      scoop.rotation.z = Math.atan2(topAt(sx + 0.25) - topAt(sx - 0.25), 0.5);
      this.body.add(scoop);
    }
    if (car.type === 'offroad') {
      // roof rack + rear spare
      const roofY = pts[4][1] + 0.08;
      const rack = new THREE.Mesh(new THREE.BoxGeometry(L * 0.55, 0.05, W - 0.3), trim);
      rack.position.set(-L * 0.15, roofY, 0);
      this.body.add(rack);
      const spare = this.makeWheel();
      spare.group.rotation.y = -Math.PI / 2;
      spare.group.position.set(rear - car.tyre.widthM / 2 - 0.03, 1.1 * sy + lift, 0);
      this.body.add(spare.group);
    }
    if (car.type === 'pickup') {
      const bed = new THREE.Mesh(new THREE.BoxGeometry(L * 0.33, 0.05, W - 0.3), trim);
      bed.position.set(-L * 0.33, 1.22 * sy + lift, 0);
      this.body.add(bed);
    }

    // ---- ladder frame (frame body) or subframes --------------------------
    if (car.chassis === 'frame') {
      const frameMat = this.mat(new THREE.MeshStandardMaterial({ color: 0x2d3033, metalness: 0.6, roughness: 0.5 }));
      const fy = Math.max(clr - 0.08, wr - 0.02);
      for (const s of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(L * 0.9, 0.14, 0.09), frameMat);
        rail.position.set(0, fy, s * 0.5);
        rail.castShadow = true;
        this.body.add(rail);
      }
      for (let i = 0; i < 6; i++) {
        const cm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 1.0), frameMat);
        cm.position.set(-L * 0.42 + (i * L * 0.84) / 5, fy, 0);
        this.body.add(cm);
      }
    }
    // axles
    const axleMat = this.mat(new THREE.MeshStandardMaterial({ color: 0x3a3d41, metalness: 0.6, roughness: 0.5 }));
    for (const ax of this.axles) {
      const a = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, W - 0.3, 10).rotateX(Math.PI / 2), axleMat);
      a.position.set(ax, wr, 0);
      this.body.add(a);
    }

    // ---- wheels ----------------------------------------------------------
    const track = W / 2 - car.tyre.widthM / 2 - 0.02;
    for (const ax of this.axles) {
      for (const s of [-1, 1]) {
        const w = this.makeWheel();
        w.group.position.set(ax, wr, s * track);
        if (s < 0) w.group.rotation.y = Math.PI; // rim face outward on both sides
        w.side = s;
        this.body.add(w.group);
        this.wheels.push(w);
      }
    }
  }

  makeWheel() {
    const { car } = this;
    const wr = car.wheelR;
    const tw = car.tyre.widthM;
    const rimR = (car.inch * 0.0254) / 2;
    const group = new THREE.Group();
    const spin = new THREE.Group();
    group.add(spin);
    if (!this.tyreMat) {
      this.tyreMat = this.mat(new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }));
      const tex = new THREE.CanvasTexture(rimCanvas(car.design, car.inch >= 22));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      this.disposables.push(tex);
      this.rimMat = this.mat(new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.5, metalness: 0.85, roughness: 0.3, side: THREE.DoubleSide }));
      this.discMat = this.mat(new THREE.MeshStandardMaterial({ color: 0x80858a, metalness: 0.9, roughness: 0.4 }));
      this.caliperMat = this.mat(new THREE.MeshStandardMaterial({ color: 0xc63a2c, metalness: 0.3, roughness: 0.5 }));
      this.barrelMat = this.mat(new THREE.MeshStandardMaterial({ color: 0x9fa4a9, metalness: 0.9, roughness: 0.35, side: THREE.BackSide }));
    }
    // tyre: lathe profile with rounded shoulders
    const prof = [];
    const n = 10;
    for (let i = 0; i <= n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI;
      prof.push(new THREE.Vector2(wr - 0.035 + Math.cos(a) * 0.035, (Math.sin(a) * tw) / 2));
    }
    prof.unshift(new THREE.Vector2(rimR, -tw / 2 + 0.01));
    prof.push(new THREE.Vector2(rimR, tw / 2 - 0.01));
    const tyreGeo = new THREE.LatheGeometry(prof, 48);
    tyreGeo.rotateX(Math.PI / 2);
    const tyre = new THREE.Mesh(tyreGeo, this.tyreMat);
    tyre.castShadow = true;
    spin.add(tyre);
    // rim barrel + face
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR, tw - 0.02, 36, 1, true).rotateX(Math.PI / 2), this.barrelMat);
    spin.add(barrel);
    const face = new THREE.Mesh(new THREE.CircleGeometry(rimR, 48), this.rimMat);
    face.position.z = tw / 2 - 0.03;
    spin.add(face);
    // brake disc + caliper (caliper does not spin)
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.82, rimR * 0.82, 0.03, 36).rotateX(Math.PI / 2), this.discMat);
    disc.position.z = tw / 2 - 0.12;
    spin.add(disc);
    const cal = new THREE.Mesh(new THREE.BoxGeometry(0.1, rimR * 0.5, 0.08), this.caliperMat);
    cal.position.set(-rimR * 0.62, rimR * 0.2, tw / 2 - 0.1);
    group.add(cal);
    return { group, spin };
  }

  setPaint(hex) {
    this.paint.color.set(hex);
  }

  update(_theta, _rpm, state) {
    const ang = state.wheelAngle || 0;
    for (const w of this.wheels) w.spin.rotation.z = w.side > 0 ? -ang : ang;
  }

  dispose() {
    this.root.traverse((o) => o.geometry && o.geometry.dispose());
    for (const d of this.disposables) d.dispose();
  }
}
