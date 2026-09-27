import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const DEG = Math.PI / 180;
const CRANK_R = 0.42; // crank throw radius (half stroke)
const ROD_L = 1.45; // connecting rod length
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);

// Unit vector in the plane perpendicular to the crank (x) axis.
const dirAt = (angDeg, out = new THREE.Vector3()) =>
  out.set(0, Math.cos(angDeg * DEG), Math.sin(angDeg * DEG));

function makeMaterials() {
  return {
    steel: new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.92, roughness: 0.28 }),
    darkSteel: new THREE.MeshStandardMaterial({ color: 0x3a3e45, metalness: 0.8, roughness: 0.4 }),
    crank: new THREE.MeshStandardMaterial({ color: 0x2c2f35, metalness: 0.85, roughness: 0.35 }),
    piston: new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.8, roughness: 0.3 }),
    rod: new THREE.MeshStandardMaterial({ color: 0xc5c8cc, metalness: 0.9, roughness: 0.25 }),
    alu: new THREE.MeshStandardMaterial({ color: 0xa9adb0, metalness: 0.55, roughness: 0.45 }),
    black: new THREE.MeshStandardMaterial({ color: 0x1b1c1f, metalness: 0.2, roughness: 0.6 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x18191b, metalness: 0.0, roughness: 0.85 }),
    copper: new THREE.MeshStandardMaterial({ color: 0xb4744f, metalness: 0.85, roughness: 0.32 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xd9dcdf, metalness: 1.0, roughness: 0.16 }),
    liner: new THREE.MeshStandardMaterial({
      color: 0xdfe6ea, metalness: 0.1, roughness: 0.15, transparent: true, opacity: 0.22,
      depthWrite: false, side: THREE.DoubleSide,
    }),
    accent: new THREE.MeshStandardMaterial({ color: 0x3fb8c9, metalness: 0.4, roughness: 0.35 }),
    spring: new THREE.MeshStandardMaterial({ color: 0xa6adb5, metalness: 0.9, roughness: 0.3 }),
  };
}

function tube(points, radius, mat, closed = false, segs = 48) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'catmullrom', 0.5);
  const g = new THREE.TubeGeometry(curve, segs, radius, 12, closed);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

function shadowed(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Align a mesh whose long axis is +Y to run from a to b.
function alignBetween(mesh, a, b) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.quaternion.setFromUnitVectors(Y, d.normalize());
  return len;
}

// 2D convex hull (Andrew monotone chain) of [y,z] points.
function hull(pts) {
  pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Procedural animated engine model. */
class EngineModel {
  constructor(spec, mats) {
    this.spec = spec;
    this.mats = mats;
    this.root = new THREE.Group();
    this.cyl = [];
    this.cams = [];
    this.spinners = [];
    this.build();
  }

  build() {
    const { spec, mats } = this;
    const cyls = spec.cylinders;
    const xs = cyls.map((c) => c.x);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    // spacing between neighbouring cylinders of the same bank
    let pitch = Infinity;
    for (const a of cyls) for (const b of cyls) if (a !== b && a.bank === b.bank) pitch = Math.min(pitch, Math.abs(a.x - b.x));
    if (!isFinite(pitch)) pitch = 1.2;
    const bore = spec.id === 'w16' ? 0.33 : Math.min(0.46, pitch * 0.36);
    this.bore = bore;
    this.xMin = xMin;
    this.xMax = xMax;

    // ---- Crankshaft ------------------------------------------------------
    const crank = new THREE.Group();
    this.crank = crank;
    this.root.add(crank);
    const throws = new Map();
    for (const c of cyls) {
      const pinDeg = ((c.pin % 360) + 360) % 360;
      // cylinders on the same pin share a throw when close in x
      let key = null;
      for (const [k, t] of throws) if (t.pin === pinDeg && Math.abs(t.x - c.x) < 0.7) key = k;
      if (key === null) {
        key = throws.size;
        throws.set(key, { pin: pinDeg, x: c.x, xs: [c.x] });
      } else {
        throws.get(key).xs.push(c.x);
      }
    }
    const journalGeo = new THREE.CylinderGeometry(0.2, 0.2, 1, 24);
    journalGeo.rotateZ(Math.PI / 2);
    const main = shadowed(new THREE.Mesh(journalGeo, mats.steel));
    main.scale.x = xMax - xMin + 2.2;
    main.position.x = (xMin + xMax) / 2;
    crank.add(main);

    const cheekShape = new THREE.Shape();
    cheekShape.moveTo(-0.22, CRANK_R + 0.18);
    cheekShape.lineTo(0.22, CRANK_R + 0.18);
    cheekShape.lineTo(0.3, 0);
    cheekShape.absarc(0, 0, 0.62, 0, -Math.PI, true);
    cheekShape.lineTo(-0.3, 0);
    cheekShape.closePath();
    const cheekGeo = new THREE.ExtrudeGeometry(cheekShape, { depth: 0.1, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 });
    cheekGeo.translate(0, 0, -0.05);
    // shape lies in XY (Y = toward pin); rotate so its normal is the crank axis
    cheekGeo.rotateY(Math.PI / 2);
    const pinGeo = new THREE.CylinderGeometry(0.16, 0.16, 1, 20);
    pinGeo.rotateZ(Math.PI / 2);

    for (const t of throws.values()) {
      const x0 = Math.min(...t.xs);
      const x1 = Math.max(...t.xs);
      const half = (x1 - x0) / 2 + 0.2;
      const cx = (x0 + x1) / 2;
      const g = new THREE.Group();
      g.position.x = cx;
      g.rotation.x = t.pin * DEG;
      for (const s of [-1, 1]) {
        const ch = shadowed(new THREE.Mesh(cheekGeo, mats.crank));
        ch.position.x = s * (half + 0.06);
        g.add(ch);
      }
      const pin = shadowed(new THREE.Mesh(pinGeo, mats.steel));
      pin.scale.x = half * 2 + 0.1;
      pin.position.y = CRANK_R;
      g.add(pin);
      crank.add(g);
    }

    // Front pulley + damper, rear flywheel
    const front = xMin - 1.1;
    const rear = xMax + 1.05;
    const pulleyGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.22, 36);
    pulleyGeo.rotateZ(Math.PI / 2);
    const damper = shadowed(new THREE.Mesh(pulleyGeo, mats.black));
    damper.position.x = front;
    crank.add(damper);
    const hubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.26, 20);
    hubGeo.rotateZ(Math.PI / 2);
    const hub = new THREE.Mesh(hubGeo, mats.chrome);
    hub.position.x = front - 0.03;
    crank.add(hub);
    const fwGeo = new THREE.CylinderGeometry(1.0, 1.0, 0.16, 48);
    fwGeo.rotateZ(Math.PI / 2);
    const flywheel = shadowed(new THREE.Mesh(fwGeo, mats.darkSteel));
    flywheel.position.x = rear;
    crank.add(flywheel);
    const ringGeo = new THREE.TorusGeometry(1.0, 0.05, 8, 64);
    ringGeo.rotateY(Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, mats.steel);
    ring.position.x = rear;
    crank.add(ring);
    // flywheel marks so rotation is visible
    for (let i = 0; i < 6; i++) {
      const mark = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.3), mats.chrome);
      const a = (i / 6) * Math.PI * 2;
      mark.position.set(rear + 0.08, Math.cos(a) * 0.72, Math.sin(a) * 0.72);
      mark.rotation.x = a;
      crank.add(mark);
    }
    // bellhousing / gearbox stub
    const bell = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 1.15, 0.9, 40, 1, true), mats.alu));
    bell.rotation.z = -Math.PI / 2;
    bell.position.x = rear + 0.6;
    bell.material = mats.alu.clone();
    bell.material.side = THREE.DoubleSide;
    this.root.add(bell);
    const box = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 1.5, 32), mats.alu));
    box.rotation.z = -Math.PI / 2;
    box.position.x = rear + 1.8;
    this.root.add(box);
    const lever = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.5), mats.black));
    lever.position.set(rear + 1.8, 0.7, 0);
    this.root.add(lever);

    // ---- Cylinders -------------------------------------------------------
    const pistonGeo = new THREE.CylinderGeometry(bore, bore, 0.46, 32);
    const pistonTopGeo = new THREE.CylinderGeometry(bore * 0.98, bore, 0.04, 32);
    const ringG = new THREE.TorusGeometry(bore * 1.002, 0.012, 6, 32);
    ringG.rotateX(Math.PI / 2);
    const wristGeo = new THREE.CylinderGeometry(0.08, 0.08, bore * 1.7, 12);
    wristGeo.rotateZ(Math.PI / 2);
    const rodGeo = new THREE.BoxGeometry(0.1, 1, 0.16);
    const bigEndGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.12, 20);
    bigEndGeo.rotateZ(Math.PI / 2);
    const smallEndGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.12, 16);
    smallEndGeo.rotateZ(Math.PI / 2);
    const linerLen = CRANK_R * 2 + 0.75;
    const linerGeo = new THREE.CylinderGeometry(bore * 1.06, bore * 1.06, linerLen, 32, 1, true);
    const flashGeo = new THREE.SphereGeometry(bore * 0.85, 16, 10);
    flashGeo.scale(1, 0.35, 1);
    const valveStemGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.5, 8);
    const valveHeadGeo = new THREE.CylinderGeometry(bore * 0.3, bore * 0.18, 0.04, 16);
    const springGeo = new THREE.TorusKnotGeometry(0.07, 0.018, 48, 6, 1, 8);
    const plugGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.45, 12);
    const coilGeo = new THREE.BoxGeometry(0.2, 0.34, 0.2);

    const deckDist = ROD_L + CRANK_R + 0.23 + 0.06; // piston top at TDC + clearance
    this.deckDist = deckDist;
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });

    for (const c of cyls) {
      const d = dirAt(c.bank);
      const q = new THREE.Quaternion().setFromUnitVectors(Y, d);
      const side = dirAt(c.bank + 90); // across the bank
      const entry = { spec: c, dir: d, side, q };

      const piston = new THREE.Group();
      piston.quaternion.copy(q);
      const body = shadowed(new THREE.Mesh(pistonGeo, mats.piston));
      piston.add(body);
      const top = new THREE.Mesh(pistonTopGeo, mats.chrome);
      top.position.y = 0.23;
      piston.add(top);
      for (let i = 0; i < 3; i++) {
        const r = new THREE.Mesh(ringG, mats.darkSteel);
        r.position.y = 0.17 - i * 0.06;
        piston.add(r);
      }
      const wrist = new THREE.Mesh(wristGeo, mats.steel);
      wrist.position.y = -0.05;
      piston.add(wrist);
      this.root.add(piston);
      entry.piston = piston;

      const rod = new THREE.Group();
      const beam = shadowed(new THREE.Mesh(rodGeo, mats.rod));
      rod.add(beam);
      const big = shadowed(new THREE.Mesh(bigEndGeo, mats.rod));
      const small = new THREE.Mesh(smallEndGeo, mats.rod);
      rod.add(big, small);
      this.root.add(rod);
      entry.rod = rod;
      entry.rodBeam = beam;
      entry.bigEnd = big;
      entry.smallEnd = small;

      const liner = new THREE.Mesh(linerGeo, mats.liner);
      liner.quaternion.copy(q);
      const linerMid = deckDist - linerLen / 2;
      liner.position.copy(d).multiplyScalar(linerMid);
      liner.position.x = c.x;
      liner.renderOrder = 2;
      this.root.add(liner);

      const flash = new THREE.Mesh(flashGeo, flashMat.clone());
      flash.quaternion.copy(q);
      flash.position.copy(d).multiplyScalar(deckDist - 0.02);
      flash.position.x = c.x;
      flash.renderOrder = 3;
      this.root.add(flash);
      entry.flash = flash;

      // Valves (intake on -side, exhaust on +side)
      entry.valves = [];
      for (const s of [-1, 1]) {
        const vg = new THREE.Group();
        vg.quaternion.copy(q);
        const stem = new THREE.Mesh(valveStemGeo, mats.steel);
        stem.position.y = 0.27;
        const head = new THREE.Mesh(valveHeadGeo, mats.steel);
        const spr = new THREE.Mesh(springGeo, mats.spring);
        spr.rotation.x = Math.PI / 2;
        spr.scale.set(1, 1, 1.7);
        spr.position.y = 0.42;
        vg.add(stem, head, spr);
        const base = new THREE.Vector3().copy(d).multiplyScalar(deckDist + 0.02).addScaledVector(side, s * bore * 0.45);
        base.x = c.x;
        vg.position.copy(base);
        this.root.add(vg);
        entry.valves.push({ g: vg, base, exhaust: s > 0 });
      }
      // Spark plug + coil pack
      const plug = new THREE.Mesh(plugGeo, mats.chrome);
      plug.quaternion.copy(q);
      plug.position.copy(d).multiplyScalar(deckDist + 0.45);
      plug.position.x = c.x;
      this.root.add(plug);
      const coil = shadowed(new THREE.Mesh(coilGeo, mats.black));
      coil.quaternion.copy(q);
      coil.position.copy(d).multiplyScalar(deckDist + 0.95);
      coil.position.x = c.x;
      this.root.add(coil);
      entry.coil = coil;

      this.cyl.push(entry);
    }

    // ---- Banks: heads, cams, rails --------------------------------------
    const banks = new Map();
    for (const e of this.cyl) {
      const key = e.spec.bank < -5 ? -1 : e.spec.bank > 5 ? 1 : 0; // VR zig-zag banks group together
      if (!banks.has(key)) banks.set(key, []);
      banks.get(key).push(e);
    }
    this.banks = [];
    for (const list of banks.values()) {
      const bankAng = list.reduce((s, e) => s + e.spec.bank, 0) / list.length;
      const d = dirAt(bankAng);
      const side = dirAt(bankAng + 90);
      const q = new THREE.Quaternion().setFromUnitVectors(Y, d);
      const bx0 = Math.min(...list.map((e) => e.spec.x)) - bore - 0.2;
      const bx1 = Math.max(...list.map((e) => e.spec.x)) + bore + 0.2;
      const len = bx1 - bx0;
      const cx = (bx0 + bx1) / 2;
      const width = bore * 2.6 + (spec.id === 'w16' ? 0.45 : 0);

      // Head deck plate (grey, open frame look)
      const plate = shadowed(new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, width), mats.alu));
      plate.quaternion.copy(q);
      plate.position.copy(d).multiplyScalar(this.deckDist + 0.08);
      plate.position.x = cx;
      this.root.add(plate);
      // cam bearing towers
      const towerGeo = new THREE.BoxGeometry(0.12, 0.34, width * 0.95);
      for (const e of list) {
        for (const off of [-bore - 0.05, bore + 0.05]) {
          const tw = shadowed(new THREE.Mesh(towerGeo, mats.alu));
          tw.quaternion.copy(q);
          tw.position.copy(d).multiplyScalar(this.deckDist + 0.62);
          tw.position.x = e.spec.x + off * 0.9;
          this.root.add(tw);
        }
      }
      // Camshafts (intake / exhaust)
      const camStart = front - (cx - 0.45);
      const camEnd = bx1 + 0.1 - (cx - 0.45);
      const camGeo = new THREE.CylinderGeometry(0.06, 0.06, camEnd - camStart, 12);
      camGeo.rotateZ(Math.PI / 2);
      camGeo.translate((camStart + camEnd) / 2, 0, 0);
      const lobeGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.1, 16);
      lobeGeo.rotateZ(Math.PI / 2);
      lobeGeo.scale(1, 1.55, 1);
      lobeGeo.translate(0, 0.05, 0);
      for (const s of [-1, 1]) {
        const camG = new THREE.Group();
        camG.position.copy(d).multiplyScalar(this.deckDist + 0.72).addScaledVector(side, s * bore * 0.45);
        camG.position.x = cx - 0.45;
        camG.quaternion.copy(q);
        const inner = new THREE.Group();
        camG.add(inner);
        const shaft = shadowed(new THREE.Mesh(camGeo, mats.darkSteel));
        inner.add(shaft);
        for (const e of list) {
          const lobe = shadowed(new THREE.Mesh(lobeGeo, mats.steel));
          lobe.position.x = e.spec.x - (cx - 0.45);
          // lobe points at the valve at the middle of its opening event
          const openMid = s > 0 ? 260 : 460; // cycle deg
          lobe.rotation.x = -((e.spec.fire + openMid) / 2) * DEG;
          inner.add(lobe);
        }
        // cam sprocket at front
        const sp = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.1, 30).rotateZ(Math.PI / 2), mats.black));
        sp.position.x = front - (cx - 0.45);
        inner.add(sp);
        const spRing = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.035, 6, 30).rotateY(Math.PI / 2), mats.chrome);
        spRing.position.x = sp.position.x - 0.03;
        inner.add(spRing);
        this.root.add(camG);
        this.cams.push({ inner, bankAng });
      }
      // Fuel rail accent along the bank
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, len, 10).rotateZ(Math.PI / 2), mats.accent);
      rail.position.copy(d).multiplyScalar(this.deckDist + 0.25).addScaledVector(side, -width * 0.5 - 0.05);
      rail.position.x = cx;
      this.root.add(rail);
      // Coil rail (black bar)
      const coilBar = shadowed(new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.12), mats.black));
      coilBar.quaternion.copy(q);
      coilBar.position.copy(d).multiplyScalar(this.deckDist + 1.14);
      coilBar.position.x = cx;
      this.root.add(coilBar);

      this.banks.push({ list, d, side, bankAng, bx0, bx1, cx, width, q });
    }

    this.buildBelt(front);
    this.buildExhaust();
    this.buildIntake();
    this.buildTurbos();
    this.buildStand(front, rear);
  }

  buildBelt(front) {
    const { mats } = this;
    const pts = [];
    const pulleys = [{ y: 0, z: 0, r: 0.44 }];
    for (const b of this.banks) {
      for (const s of [-1, 1]) {
        const p = new THREE.Vector3().copy(b.d).multiplyScalar(this.deckDist + 0.72).addScaledVector(b.side, s * this.bore * 0.45);
        pulleys.push({ y: p.y, z: p.z, r: 0.38 });
      }
    }
    // idler / alternator
    const alt = { y: -0.2, z: 1.3, r: 0.25 };
    if (this.spec.id === 'h6') {
      alt.y = 1.2;
      alt.z = 0;
    }
    pulleys.push(alt);
    for (const p of pulleys) {
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        pts.push([p.y + Math.cos(a) * p.r, p.z + Math.sin(a) * p.r]);
      }
    }
    const h = hull(pts);
    const x = front;
    const curvePts = h.map(([y, z]) => new THREE.Vector3(x, y, z));
    const belt = tube(curvePts, 0.035, mats.rubber, true, 200);
    this.root.add(belt);
    const altBody = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.55, 24).rotateZ(Math.PI / 2), mats.alu));
    altBody.position.set(x + 0.4, alt.y, alt.z);
    this.root.add(altBody);
    const altPulley = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(alt.r, alt.r, 0.12, 20).rotateZ(Math.PI / 2), mats.black));
    altPulley.position.set(x, alt.y, alt.z);
    this.root.add(altPulley);
    this.spinners.push({ mesh: altPulley, ratio: 0.44 / alt.r });
  }

  buildExhaust() {
    const { mats } = this;
    this.collectors = [];
    for (const b of this.banks) {
      // exhaust exits on the outside of each bank (away from the V centre)
      let outSide;
      if (Math.abs(b.bankAng) <= 5) outSide = new THREE.Vector3(0, 0, 1);
      else if (Math.abs(b.bankAng) >= 85) outSide = new THREE.Vector3(0, -1, 0);
      else {
        outSide = b.side.clone();
        if (outSide.z * Math.sign(b.bankAng) < 0) outSide.multiplyScalar(-1);
      }
      // exhaust valves are the ones on the outer side of the head
      for (const e of b.list) {
        const axis = e.dir.clone().multiplyScalar(this.deckDist);
        for (const v of e.valves) v.exhaust = v.base.clone().setX(0).sub(axis).dot(outSide) > 0;
      }

      const collector = new THREE.Vector3(b.bx1 + 0.4, 0, 0)
        .addScaledVector(b.d, this.deckDist * 0.35)
        .addScaledVector(outSide, 1.35);
      if (Math.abs(b.bankAng) >= 85) collector.addScaledVector(b.d, 0.6);
      collector.y -= 0.9;
      const port0 = (e) => new THREE.Vector3(e.spec.x, 0, 0).addScaledVector(e.dir, this.deckDist + 0.18).addScaledVector(outSide, this.bore * 1.25);
      for (const e of b.list) {
        const p0 = port0(e);
        const p1 = p0.clone().addScaledVector(outSide, 0.55);
        const p2 = p1.clone().addScaledVector(b.d, -0.9).addScaledVector(outSide, 0.25);
        p2.y -= 0.3;
        const p3 = collector.clone();
        p3.x = (p2.x + collector.x) / 2 + 0.2;
        const p4 = collector.clone();
        this.root.add(tube([p0, p1, p2, p3, p4], 0.085, mats.copper, false, 40));
      }
      // downpipe
      const end = collector.clone().add(new THREE.Vector3(1.4, -0.4, 0));
      this.root.add(tube([collector, collector.clone().add(new THREE.Vector3(0.6, -0.1, 0)), end], 0.16, mats.chrome, false, 20));
      this.collectors.push({ at: collector, outSide, bank: b });
    }
  }

  buildIntake() {
    const { mats } = this;
    const inline = this.banks.length === 1;
    const isBoxer = this.spec.id === 'h6';
    const x0 = Math.min(...this.banks.map((b) => b.bx0));
    const x1 = Math.max(...this.banks.map((b) => b.bx1));
    const cx = (x0 + x1) / 2;
    let plenum;
    if (inline) plenum = new THREE.Vector3(cx, this.deckDist + 0.4, -1.9);
    else if (isBoxer) plenum = new THREE.Vector3(cx, 1.6, 0);
    else plenum = new THREE.Vector3(cx, this.deckDist * 0.95 + 0.9, 0);
    const len = x1 - x0 - 0.2;
    const pl = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, len, 28).rotateZ(Math.PI / 2), mats.alu));
    pl.position.copy(plenum);
    this.root.add(pl);
    for (const cap of [-1, 1]) {
      const c = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 12), mats.alu));
      c.position.copy(plenum);
      c.position.x += (cap * len) / 2;
      this.root.add(c);
    }
    // throttle body at front
    const tb = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.5, 24).rotateZ(Math.PI / 2), mats.black));
    tb.position.copy(plenum);
    tb.position.x = x0 - 0.5;
    this.root.add(tb);
    for (const b of this.banks) {
      for (const e of b.list) {
        const inVal = e.valves.find((v) => !v.exhaust);
        const toward = inVal.base.clone().sub(e.dir.clone().multiplyScalar(this.deckDist)).setX(0).normalize();
        const p0 = new THREE.Vector3(e.spec.x, 0, 0).addScaledVector(e.dir, this.deckDist + 0.2).addScaledVector(toward, this.bore * 1.2);
        const p1 = p0.clone().addScaledVector(toward, 0.35).addScaledVector(e.dir, 0.3);
        const p3 = plenum.clone();
        p3.x = e.spec.x;
        const p2 = p1.clone().lerp(p3, 0.55);
        p2.addScaledVector(e.dir, 0.35);
        this.root.add(tube([p0, p1, p2, p3], 0.075, mats.chrome, false, 24));
      }
    }
  }

  buildTurbos() {
    const n = this.spec.turbo;
    if (!n) return;
    const { mats } = this;
    const list = [];
    for (let i = 0; i < n; i++) list.push(this.collectors[i % this.collectors.length]);
    list.forEach((col, i) => {
      const t = new THREE.Group();
      const p = col.at.clone();
      p.x += 0.35 + (i >= this.collectors.length ? 1.1 : 0);
      p.addScaledVector(col.outSide, 0.35);
      p.y += 0.25;
      t.position.copy(p);
      const snail = shadowed(new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.16, 12, 28).rotateY(Math.PI / 2), mats.darkSteel));
      snail.position.x = -0.15;
      const comp = shadowed(new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.16, 12, 28).rotateY(Math.PI / 2), mats.alu));
      comp.position.x = 0.25;
      const core = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.5, 16).rotateZ(Math.PI / 2), mats.steel));
      const inlet = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.45, 20, 1, true).rotateZ(Math.PI / 2), mats.alu));
      inlet.position.x = 0.62;
      const wheel = new THREE.Group();
      for (let k = 0; k < 6; k++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 0.05), mats.chrome);
        blade.rotation.x = (k / 6) * Math.PI;
        wheel.add(blade);
      }
      wheel.position.x = 0.62;
      t.add(snail, comp, core, inlet, wheel);
      this.root.add(t);
      this.spinners.push({ mesh: wheel, turbo: true });
    });
  }

  buildStand(front, rear) {
    const { mats } = this;
    this.root.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(this.root);
    const floor = Math.min(bb.min.y, -1.3) - 0.35;
    this.floor = floor;
    const zs = [-1.0, 1.0];
    for (const z of zs) {
      const rail = shadowed(new THREE.Mesh(new THREE.BoxGeometry(rear - front + 1.2, 0.12, 0.16), mats.black));
      rail.position.set((front + rear) / 2, floor + 0.06, z);
      this.root.add(rail);
      for (const x of [front + 0.3, rear - 0.3]) {
        const leg = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.1, -floor - 0.2, 0.1), mats.black));
        leg.position.set(x, floor / 2 - 0.1, z * 0.55);
        leg.rotation.x = z * 0.35;
        this.root.add(leg);
      }
    }
    // bearing caps to visually support the crank
    for (const x of [front + 0.55, rear - 0.55]) {
      const cap = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.55, 0.8), mats.alu));
      cap.position.set(x, -0.1, 0);
      this.root.add(cap);
      const foot = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.2, -floor - 0.3, 0.25), mats.alu));
      foot.position.set(x, floor / 2 - 0.2, 0);
      this.root.add(foot);
    }
  }

  /** theta: crank angle (rad, accumulated). */
  update(theta, rpm, state) {
    const thDeg = theta / DEG;
    this.crank.rotation.x = theta;
    const cycle = ((thDeg % 720) + 720) % 720;
    const tmpPin = new THREE.Vector3();
    const tmpWrist = new THREE.Vector3();
    const firing = state.running && !state.limiter;
    const load = state.load;
    // cams run at half crank speed
    for (const c of this.cams) c.inner.rotation.x = theta / 2;
    for (const s of this.spinners) {
      if (s.turbo) s.mesh.rotation.x += (state.boost * 0.9 + 0.02 * (rpm / 6000)) * 1.1;
      else s.mesh.rotation.x = theta * s.ratio;
    }

    for (const e of this.cyl) {
      const c = e.spec;
      const a = (thDeg + c.pin - c.bank) * DEG;
      const s = CRANK_R * Math.cos(a) + Math.sqrt(ROD_L * ROD_L - (CRANK_R * Math.sin(a)) ** 2);
      dirAt(thDeg + c.pin, tmpPin).multiplyScalar(CRANK_R);
      tmpPin.x = c.x;
      tmpWrist.copy(e.dir).multiplyScalar(s);
      tmpWrist.x = c.x;
      e.piston.position.copy(tmpWrist).addScaledVector(e.dir, 0.05);
      e.rod.position.set(0, 0, 0);
      e.bigEnd.position.copy(tmpPin);
      e.smallEnd.position.copy(tmpWrist);
      alignBetween(e.rodBeam, tmpPin, tmpWrist);
      e.rodBeam.scale.y = ROD_L;
      e.bigEnd.quaternion.copy(e.rodBeam.quaternion);
      e.smallEnd.quaternion.copy(e.rodBeam.quaternion);

      // 4-stroke cycle position (0 = compression TDC / ignition)
      const psi = (((cycle - c.fire) % 720) + 720) % 720;
      // flame
      const flame = firing && psi < 100 ? Math.exp(-psi / 28) * (0.35 + 0.65 * load) : 0;
      e.flash.material.opacity = flame * 0.9;
      e.flash.visible = flame > 0.02;
      // valves: exhaust 130..390, intake 330..590
      for (const v of e.valves) {
        const [o, cl] = v.exhaust ? [130, 390] : [330, 590];
        let lift = 0;
        if (psi > o && psi < cl) lift = Math.sin(((psi - o) / (cl - o)) * Math.PI);
        v.g.position.copy(v.base).addScaledVector(e.dir, -lift * 0.12);
      }
    }
  }

  dispose() {
    const shared = new Set(Object.values(this.mats));
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && !shared.has(o.material)) o.material.dispose();
    });
  }
}

const VIEWS = [
  { name: '사선', dir: [0.85, 0.55, 1.0] },
  { name: '정면', dir: [-1, 0.25, 0.0001] },
  { name: '측면', dir: [0.0001, 0.2, 1] },
  { name: '위', dir: [0.0001, 1, 0.15] },
  { name: '뒤', dir: [1, 0.3, -0.6] },
];

/** Three.js renderer + camera + controls hosting one EngineModel at a time. */
export class EngineView {
  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'engine-canvas';

    this.scene = new THREE.Scene();
    this.bg = new THREE.Color(0xf1efea);
    this.scene.background = this.bg;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.75;

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
    this.camera.position.set(8, 6, 10);

    const hemi = new THREE.HemisphereLight(0xffffff, 0xd8d2c8, 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(6, 14, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1536, 1536);
    sun.shadow.camera.left = -9;
    sun.shadow.camera.right = 9;
    sun.shadow.camera.top = 9;
    sun.shadow.camera.bottom = -9;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 40;
    sun.shadow.bias = -0.0004;
    sun.shadow.radius = 5;
    this.scene.add(sun);
    this.sun = sun;
    const fill = new THREE.DirectionalLight(0xfff4e6, 0.5);
    fill.position.set(-8, 4, -6);
    this.scene.add(fill);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: 0.16 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.8;
    this.controls.zoomSpeed = 0.9;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.maxPolarAngle = Math.PI * 0.92;
    this.controls.autoRotateSpeed = 1.2;

    this.mats = makeMaterials();
    this.model = null;
    this.viewIndex = 0;
    this.container = null;
    this.ro = new ResizeObserver(() => this.resize());
    this.tween = null;
  }

  mount(container) {
    if (this.container) this.ro.unobserve(this.container);
    this.container = container;
    container.prepend(this.canvas);
    this.ro.observe(container);
    this.resize();
  }

  resize() {
    if (!this.container) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fitDistance();
  }

  setEngine(spec) {
    if (this.model) {
      this.scene.remove(this.model.root);
      this.model.dispose();
    }
    this.model = new EngineModel(spec, this.mats);
    this.model.update(0, 0, { running: false, load: 0, boost: 0 });
    this.scene.add(this.model.root);
    this.model.root.position.y = -this.model.floor;
    this.ground.position.y = 0;
    this.model.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model.root);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    this.center = sphere.center.clone();
    this.radius = sphere.radius;
    this.controls.target.copy(this.center);
    this.controls.minDistance = this.radius * 0.6;
    this.controls.maxDistance = this.radius * 6;
    this.setView(this.viewIndex, true);
  }

  fitDistance() {
    if (!this.radius) return 12;
    const vfov = (this.camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const fov = Math.min(vfov, hfov);
    return (this.radius / Math.sin(fov / 2)) * 0.78;
  }

  setView(i, instant = false) {
    this.viewIndex = ((i % VIEWS.length) + VIEWS.length) % VIEWS.length;
    const v = VIEWS[this.viewIndex];
    const dir = new THREE.Vector3(...v.dir).normalize();
    const to = this.center.clone().addScaledVector(dir, this.fitDistance());
    if (instant) {
      this.camera.position.copy(to);
      this.controls.target.copy(this.center);
      this.controls.update();
      this.tween = null;
    } else {
      this.tween = { from: this.camera.position.clone(), fromT: this.controls.target.clone(), to, t: 0 };
    }
    return v.name;
  }

  nextView() {
    return this.setView(this.viewIndex + 1);
  }

  get viewName() {
    return VIEWS[this.viewIndex].name;
  }

  render(dt, theta, rpm, state) {
    if (this.tween) {
      this.tween.t = Math.min(1, this.tween.t + dt * 2.2);
      const k = 1 - Math.pow(1 - this.tween.t, 3);
      // interpolate on a sphere around the target for a nicer arc
      const a = this.tween.from.clone().sub(this.center);
      const b = this.tween.to.clone().sub(this.center);
      const len = THREE.MathUtils.lerp(a.length(), b.length(), k);
      const dir = a.normalize().lerp(b.normalize(), k).normalize();
      this.camera.position.copy(this.center).addScaledVector(dir, len);
      this.controls.target.lerpVectors(this.tween.fromT, this.center, k);
      if (this.tween.t >= 1) this.tween = null;
    }
    if (this.model) this.model.update(theta, rpm, state);
    this.controls.update(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
