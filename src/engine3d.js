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

// Spur gear lying in the YZ plane (axis = X), centred on the origin.
// Tooth k points along dirAt(k * 360/N - 90) before any rotation.
function gearGeometry(r, teeth, width, bore = 0) {
  const m = (2 * r) / teeth;
  const ra = r + m * 0.9;
  const rd = r - m * 1.1;
  const shape = new THREE.Shape();
  const step = (Math.PI * 2) / teeth;
  for (let k = 0; k < teeth; k++) {
    const a = k * step;
    const pts = [
      [rd, a - step * 0.5],
      [rd, a - step * 0.27],
      [ra, a - step * 0.15],
      [ra, a + step * 0.15],
      [rd, a + step * 0.27],
    ];
    pts.forEach(([rr, aa], i) => {
      const x = Math.cos(aa) * rr;
      const y = Math.sin(aa) * rr;
      if (k === 0 && i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
  }
  shape.closePath();
  if (bore > 0) {
    const hole = new THREE.Path();
    hole.absarc(0, 0, bore, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -width / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

// Phase offset (rad) for gear B driven by gear A so their teeth interleave.
// psiA = direction from A's centre to the contact point (dirAt convention).
// B's angle is then  -phiA * NA / NB + offset.
function meshOffset(NA, psiA, NB) {
  const psiB = psiA + Math.PI;
  return Math.PI / 2 + psiB + (0.5 + ((Math.PI / 2 + psiA) * NA) / (Math.PI * 2)) * ((Math.PI * 2) / NB);
}

// Side of a bank the exhaust leaves from.
function exhaustSide(bankAng, side) {
  if (Math.abs(bankAng) <= 5) return new THREE.Vector3(0, 0, 1);
  if (Math.abs(bankAng) >= 85) return new THREE.Vector3(0, -1, 0);
  const o = side.clone();
  if (o.z * Math.sign(bankAng) < 0) o.multiplyScalar(-1);
  return o;
}

const BELT_PITCH = (Math.PI * 2 * 0.24) / 16; // crank sprocket r=0.24, 16 teeth

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
    main.scale.x = xMax - xMin + 2.6;
    main.position.x = (xMin + xMax) / 2 - 0.2;
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
    damper.position.x = front - 0.2;
    crank.add(damper);
    const hubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.3, 20);
    hubGeo.rotateZ(Math.PI / 2);
    const hub = new THREE.Mesh(hubGeo, mats.chrome);
    hub.position.x = front - 0.24;
    crank.add(hub);
    // damper marks so its rotation is visible
    for (let i = 0; i < 3; i++) {
      const mk = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.06), mats.chrome);
      const a = (i / 3) * Math.PI * 2;
      mk.position.set(front - 0.32, Math.cos(a) * 0.34, Math.sin(a) * 0.34);
      mk.rotation.x = a;
      crank.add(mk);
    }
    // toothed timing sprocket (drives the belt)
    this.beltX = front + 0.08;
    const crankSprocket = shadowed(new THREE.Mesh(gearGeometry(0.24, 16, 0.12), mats.steel));
    crankSprocket.position.x = this.beltX;
    crank.add(crankSprocket);
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
    this.buildGearbox(rear);

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
      const camStart = this.beltX - (cx - 0.45);
      const camEnd = bx1 + 0.1 - (cx - 0.45);
      const camGeo = new THREE.CylinderGeometry(0.06, 0.06, camEnd - camStart, 12);
      camGeo.rotateZ(Math.PI / 2);
      camGeo.translate((camStart + camEnd) / 2, 0, 0);
      const lobeGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.1, 16);
      lobeGeo.rotateZ(Math.PI / 2);
      lobeGeo.scale(1, 1.55, 1);
      lobeGeo.translate(0, 0.05, 0);
      const outSide = exhaustSide(bankAng, side);
      const camGap = bore * 0.9;
      const camGearR = camGap / 2;
      const camGearN = Math.max(12, Math.round((Math.PI * 2 * camGearR) / BELT_PITCH / 0.8));
      for (const s of [-1, 1]) {
        const isExhaust = side.clone().multiplyScalar(s).dot(outSide) > 0;
        // intake cam is driven by the exhaust cam's gear: angle = -theta/2 + camOff
        const camOff = isExhaust ? 0 : meshOffset(camGearN, s > 0 ? Math.PI / 2 : -Math.PI / 2, camGearN);
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
          // exhaust cam turns with the crank, intake cam is gear-driven the other way
          const openMid = isExhaust ? 260 : 460; // cycle deg
          lobe.rotation.x = (isExhaust ? -1 : 1) * ((e.spec.fire + openMid) / 2) * DEG - camOff;
          inner.add(lobe);
        }
        const localX = this.beltX - (cx - 0.45);
        if (isExhaust) {
          // 32-tooth sprocket: half crank speed
          const sp = shadowed(new THREE.Mesh(gearGeometry(0.48, 32, 0.1, 0.07), mats.darkSteel));
          sp.position.x = localX;
          inner.add(sp);
          for (let k = 0; k < 4; k++) {
            const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.62, 0.07), mats.steel);
            spoke.rotation.x = (k * Math.PI) / 4;
            spoke.position.x = localX - 0.05;
            inner.add(spoke);
          }
        }
        // cam-to-cam drive gears
        const cg = shadowed(new THREE.Mesh(gearGeometry(camGearR, camGearN, 0.09, 0.05), mats.steel));
        cg.position.x = localX + 0.17;
        inner.add(cg);
        this.root.add(camG);
        // contact direction from this cam toward its partner, in camG's frame
        this.cams.push({ inner, isExhaust, camOff });
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

      this.banks.push({ list, d, side, bankAng, bx0, bx1, cx, width, q, outSide });
    }

    this.buildBelt();
    this.buildExhaust();
    this.buildIntake();
    this.buildTurbos();
    this.buildStand(front, rear);
  }

  buildBelt() {
    const { mats } = this;
    const x = this.beltX;
    const pts = [];
    const pulleys = [{ y: 0, z: 0, r: 0.24 }];
    for (const b of this.banks) {
      for (const s of [-1, 1]) {
        if (b.side.clone().multiplyScalar(s).dot(b.outSide) <= 0) continue; // exhaust cam only
        const p = new THREE.Vector3().copy(b.d).multiplyScalar(this.deckDist + 0.72).addScaledVector(b.side, s * this.bore * 0.45);
        pulleys.push({ y: p.y, z: p.z, r: 0.48 });
      }
    }
    // alternator + tensioner
    const alt = { y: -0.25, z: 1.25, r: 0.24 };
    if (this.spec.id === 'h6') {
      alt.y = 1.25;
      alt.z = 0;
    }
    pulleys.push(alt);
    for (const p of pulleys) {
      for (let i = 0; i < 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        pts.push([p.y + Math.cos(a) * (p.r + 0.06), p.z + Math.sin(a) * (p.r + 0.06)]);
      }
    }
    const h = hull(pts);
    const curve = new THREE.CatmullRomCurve3(h.map(([y, z]) => new THREE.Vector3(x, y, z)), true, 'catmullrom', 0.1);
    const beltGeo = new THREE.TubeGeometry(curve, 400, 0.03, 6, true);
    const belt = new THREE.Mesh(beltGeo, mats.rubber);
    this.root.add(belt);
    // Belt teeth / printed marks move along the curve
    this.beltCurve = curve;
    this.beltLen = curve.getLength();
    const n = Math.floor(this.beltLen / BELT_PITCH);
    this.beltSpacing = this.beltLen / n;
    const toothGeo = new THREE.BoxGeometry(0.16, 0.05, 0.045);
    const toothMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0 });
    const teeth = new THREE.InstancedMesh(toothGeo, toothMat, n);
    const dark = new THREE.Color(0x26282b);
    const mark = new THREE.Color(0xf2c94c);
    for (let i = 0; i < n; i++) teeth.setColorAt(i, i % 8 === 0 ? mark : dark);
    teeth.frustumCulled = false;
    this.root.add(teeth);
    this.beltTeeth = teeth;

    const altBody = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.55, 24).rotateZ(Math.PI / 2), mats.alu));
    altBody.position.set(x + 0.4, alt.y, alt.z);
    this.root.add(altBody);
    const altPulley = shadowed(new THREE.Mesh(gearGeometry(alt.r, 16, 0.12, 0.05), mats.black));
    altPulley.position.set(x, alt.y, alt.z);
    this.root.add(altPulley);
    this.spinners.push({ mesh: altPulley, ratio: 0.24 / alt.r });
  }

  buildGearbox(rear) {
    const { mats } = this;
    const C = 0.62; // shaft centre distance
    const Ntot = 34;
    const mod = (2 * C) / Ntot;
    const R = (N) => (N * mod) / 2;
    const gx0 = rear + 0.45;
    const W = 0.13;
    this.gb = { pairs: [], collars: [] };
    const gb = this.gb;
    const counterY = -C;

    // clutch housing (open bell)
    const bellMat = mats.liner;
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.15, 0.45, 40, 1, true), bellMat);
    bell.rotation.z = -Math.PI / 2;
    bell.position.x = rear + 0.22;
    bell.renderOrder = 2;
    this.root.add(bell);
    // clutch disc spins with the input shaft
    const disc = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.06, 36).rotateZ(Math.PI / 2), mats.copper));
    disc.position.x = rear + 0.14;
    const input = new THREE.Group();
    input.add(disc);
    this.root.add(input);
    gb.input = input;

    const gears = this.spec.gears;
    // head (constant-mesh) pair: input -> countershaft
    const Nin = 13;
    const Ncin = Ntot - Nin;
    const head = { x: gx0 + 0.2, Nm: Nin, Nc: Ncin, head: true };
    const list = [head];
    const order = [6, 5, 4, 3, 2, 1];
    order.forEach((g, i) => {
      const want = (Nin / Ncin) * gears[g - 1]; // Nm/Nc
      const Nc = Math.max(9, Math.round(Ntot / (1 + want)));
      list.push({ g, x: gx0 + 0.55 + i * 0.3, Nm: Ntot - Nc, Nc });
    });
    const rev = { g: -1, x: gx0 + 0.55 + 6 * 0.3 + 0.1, Nm: 26, Nc: 11, reverse: true };
    list.push(rev);
    const gbEnd = rev.x + 0.35;
    this.gbEnd = gbEnd;

    const mainMat = mats.steel;
    const selMat = new THREE.MeshStandardMaterial({ color: 0xff7a45, metalness: 0.6, roughness: 0.35 });
    this.gb.selMat = selMat;
    for (const p of list) {
      const mg = shadowed(new THREE.Mesh(gearGeometry(R(p.Nm), p.Nm, W, 0.07), mainMat));
      mg.position.x = p.x;
      const cg = shadowed(new THREE.Mesh(gearGeometry(R(p.Nc), p.Nc, W, 0.06), mats.darkSteel));
      cg.position.set(p.x, counterY, 0);
      this.root.add(mg, cg);
      p.main = mg;
      p.counter = cg;
      if (p.reverse) {
        // idler sits beside the pair and reverses the direction
        const Ni = 11;
        const ri = R(Ni);
        const rm = R(p.Nm);
        const rc = R(p.Nc);
        // place idler touching both gears, off to +z
        const a = rc + ri;
        const b2 = rm + ri;
        const yI = (a * a - b2 * b2 + C * C) / (2 * C); // distance above counter
        const zI = Math.sqrt(Math.max(0.01, a * a - yI * yI));
        const idler = shadowed(new THREE.Mesh(gearGeometry(ri, Ni, W, 0.05), mats.steel));
        idler.position.set(p.x, counterY + yI, zI);
        this.root.add(idler);
        p.idler = { mesh: idler, N: Ni, psiFromCounter: Math.atan2(zI, yI), psiToMain: Math.atan2(-zI, C - yI) };
      }
    }
    gb.pairs = list;
    gb.headRatio = Nin / Ncin;

    // shafts
    const shaft = (x0, x1, y, r, mat) => {
      const m = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(r, r, x1 - x0, 14).rotateZ(Math.PI / 2), mat));
      m.position.set((x0 + x1) / 2, y, 0);
      this.root.add(m);
      return m;
    };
    shaft(rear + 0.1, gx0 + 0.3, 0, 0.065, mats.chrome); // input shaft
    const outShaft = new THREE.Group();
    this.root.add(outShaft);
    const os = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, gbEnd + 0.6 - (gx0 + 0.35), 14).rotateZ(Math.PI / 2), mats.chrome));
    os.position.x = (gx0 + 0.35 + gbEnd + 0.6) / 2;
    outShaft.add(os);
    // output flange
    const flange = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 6).rotateZ(Math.PI / 2), mats.darkSteel));
    flange.position.x = gbEnd + 0.6;
    outShaft.add(flange);
    gb.output = outShaft;
    shaft(gx0 + 0.1, gbEnd - 0.1, counterY, 0.06, mats.darkSteel);

    // selector collars (dog clutches) on the output shaft
    const collarDefs = [
      { gears: [5, 6], a: list.find((p) => p.g === 6), b: list.find((p) => p.g === 5) },
      { gears: [3, 4], a: list.find((p) => p.g === 4), b: list.find((p) => p.g === 3) },
      { gears: [1, 2], a: list.find((p) => p.g === 2), b: list.find((p) => p.g === 1) },
      { gears: [-1], a: list.find((p) => p.g === 1), b: rev },
    ];
    for (const c of collarDefs) {
      const x = (c.a.x + c.b.x) / 2;
      const g = new THREE.Group();
      const ring = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.09, 24).rotateZ(Math.PI / 2), mats.alu));
      const groove = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.02, 6, 24).rotateY(Math.PI / 2), mats.darkSteel);
      g.add(ring, groove);
      g.position.x = x;
      outShaft.add(g);
      // shift fork above the collar
      const fork = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.45, 0.4), mats.alu));
      fork.position.set(x, 0.33, 0);
      this.root.add(fork);
      gb.collars.push({ ...c, x, group: g, ring, fork, shift: 0 });
    }
    // fork rail
    const rail = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, gbEnd - gx0, 10).rotateZ(Math.PI / 2), mats.chrome));
    rail.position.set((gx0 + gbEnd) / 2, 0.58, 0);
    this.root.add(rail);

    // see-through case
    const caseLen = gbEnd - gx0 + 0.1;
    const caseGeo = new THREE.BoxGeometry(caseLen, 1.95, 1.2);
    const gcase = new THREE.Mesh(caseGeo, mats.liner);
    gcase.position.set(gx0 - 0.05 + caseLen / 2, -0.33, 0);
    gcase.renderOrder = 2;
    this.root.add(gcase);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(caseGeo), new THREE.LineBasicMaterial({ color: 0x8d9398, transparent: true, opacity: 0.6 }));
    edges.position.copy(gcase.position);
    this.root.add(edges);

    // shift lever with a knob that follows the H pattern
    const turret = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.12, 20), mats.black));
    const lx = gx0 + caseLen * 0.55;
    turret.position.set(lx, 0.7, 0);
    this.root.add(turret);
    const lever = new THREE.Group();
    lever.position.set(lx, 0.72, 0);
    const stick = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.8, 10), mats.chrome));
    stick.position.y = 0.4;
    const knob = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 14), mats.black));
    knob.position.y = 0.82;
    lever.add(stick, knob);
    this.root.add(lever);
    gb.lever = lever;
  }

  buildExhaust() {
    const { mats } = this;
    this.collectors = [];
    for (const b of this.banks) {
      // exhaust exits on the outside of each bank (away from the V centre)
      const outSide = b.outSide;
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

  buildStand(front, rearIn) {
    const rear = Math.max(rearIn, (this.gbEnd || rearIn) - 0.4);
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

  updateBelt(theta) {
    const t = this.beltTeeth;
    if (!t) return;
    const L = this.beltLen;
    const shift = (((theta * 0.24) % L) + L) % L; // belt speed = crank sprocket surface speed
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const tan = new THREE.Vector3();
    const out = new THREE.Vector3();
    for (let i = 0; i < t.count; i++) {
      const u = ((i * this.beltSpacing + shift) % L) / L;
      this.beltCurve.getPointAt(u, p);
      this.beltCurve.getTangentAt(u, tan);
      out.set(0, tan.z, -tan.y).normalize();
      tan.set(0, tan.y, tan.z).normalize();
      p.addScaledVector(out, 0.025);
      m.set(1, 0, 0, p.x, 0, out.y, tan.y, p.y, 0, out.z, tan.z, p.z, 0, 0, 0, 1);
      t.setMatrixAt(i, m);
    }
    t.instanceMatrix.needsUpdate = true;
  }

  updateGearbox(theta, state) {
    const gb = this.gb;
    if (!gb) return;
    gb.input.rotation.x = theta;
    const head = gb.pairs[0];
    head.main.rotation.x = theta;
    const phiC = -theta * (head.Nm / head.Nc) + meshOffset(head.Nm, Math.PI, head.Nc);
    for (const p of gb.pairs) {
      p.counter.rotation.x = phiC;
      if (p.head) continue;
      if (p.reverse) {
        const I = p.idler;
        const phiI = -phiC * (p.Nc / I.N) + meshOffset(p.Nc, I.psiFromCounter, I.N);
        I.mesh.rotation.x = phiI;
        p.main.rotation.x = -phiI * (I.N / p.Nm) + meshOffset(I.N, I.psiToMain, p.Nm);
      } else {
        p.main.rotation.x = -phiC * (p.Nc / p.Nm) + meshOffset(p.Nc, 0, p.Nm);
      }
    }
    gb.output.rotation.x = state.outTheta || 0;
    const g = state.gear || 0;
    for (const c of gb.collars) {
      let target = 0;
      if (c.gears.includes(g)) {
        const pair = gb.pairs.find((p) => p.g === g);
        target = Math.sign(pair.x - c.x) * 0.07;
      }
      c.shift += (target - c.shift) * 0.25;
      c.group.position.x = c.x + c.shift;
      c.fork.position.x = c.x + c.shift;
      const on = c.gears.includes(g);
      c.ring.material = on ? gb.selMat : this.mats.alu;
    }
    for (const p of gb.pairs) if (!p.head) p.main.material = p.g === g ? gb.selMat : this.mats.steel;
    // H-pattern lever
    const H = { '-1': [-1.5, -1], 1: [-0.5, -1], 2: [-0.5, 1], 3: [0.5, -1], 4: [0.5, 1], 5: [1.5, -1], 6: [1.5, 1] };
    const [col, dir] = H[g] || [0, 0];
    const lv = gb.lever;
    lv.rotation.z += (-dir * 0.32 - lv.rotation.z) * 0.25;
    lv.rotation.x += (col * 0.14 - lv.rotation.x) * 0.25;
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
    // cams run at half crank speed; the intake cam is turned the other way by the cam gears
    for (const c of this.cams) c.inner.rotation.x = c.isExhaust ? theta / 2 : -theta / 2 + c.camOff;
    this.updateBelt(theta);
    this.updateGearbox(theta, state);
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

// Electric drive unit(s): stator in a see-through housing, spinning rotor with
// magnets, two-stage reduction gears to the half shafts, inverter, orange HV
// cables and the battery pack underneath. Same interface as EngineModel.
class MotorModel {
  constructor(spec, mats) {
    this.spec = spec;
    this.mats = mats;
    this.root = new THREE.Group();
    this.rotors = [];
    this.stages = [];
    this.shafts = [];
    this.own = [];
    this.build();
  }

  mat(m) {
    this.own.push(m);
    return m;
  }

  build() {
    const { spec, mats } = this;
    const n = spec.units;
    // 1 unit; 2 = front + rear axle; 4 = one per wheel (two per axle, mirrored)
    const layout = n === 1 ? [[0, 0, 1]] : n === 2 ? [[0, -1.6, 1], [0, 1.6, 1]] : [[-1.25, -1.6, -1], [1.25, -1.6, 1], [-1.25, 1.6, -1], [1.25, 1.6, 1]];
    this.winding = this.mat(new THREE.MeshStandardMaterial({ color: 0xb4744f, metalness: 0.8, roughness: 0.35, emissive: 0xff5a1a, emissiveIntensity: 0 }));
    this.hv = this.mat(new THREE.MeshStandardMaterial({ color: 0xff7a1a, metalness: 0.1, roughness: 0.55 }));
    const magnetN = this.mat(new THREE.MeshStandardMaterial({ color: 0xc8372d, metalness: 0.5, roughness: 0.4 }));
    const magnetS = this.mat(new THREE.MeshStandardMaterial({ color: 0x3f6fbf, metalness: 0.5, roughness: 0.4 }));
    const housing = this.mat(new THREE.MeshStandardMaterial({ color: 0xdfe6ea, metalness: 0.2, roughness: 0.2, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }));
    const small = n === 4;
    const R = small ? 0.7 : 0.95; // stator outer radius
    const Lm = small ? 1.5 : 2.0; // stator length
    for (const [x0, z0, side] of layout) {
      const u = new THREE.Group();
      u.position.set(x0, 0, z0);
      u.scale.x = side; // mirrored units put their gears outboard
      this.root.add(u);
      // housing + cooling ribs
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.12, R + 0.12, Lm + 0.3, 40, 1, true).rotateZ(Math.PI / 2), housing);
      shell.renderOrder = 2;
      u.add(shell);
      for (let i = 0; i <= 6; i++) {
        const rib = shadowed(new THREE.Mesh(new THREE.TorusGeometry(R + 0.13, 0.035, 8, 40).rotateY(Math.PI / 2), mats.alu));
        rib.position.x = -Lm / 2 - 0.15 + (i / 6) * (Lm + 0.3);
        u.add(rib);
      }
      const capGeo = new THREE.CylinderGeometry(R + 0.16, R + 0.16, 0.12, 40).rotateZ(Math.PI / 2);
      const capBack = shadowed(new THREE.Mesh(capGeo, mats.alu));
      capBack.position.x = -Lm / 2 - 0.2;
      u.add(capBack);
      // stator core (laminated ring) and copper end windings
      const core = shadowed(new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(R * 0.66, -Lm / 2), new THREE.Vector2(R, -Lm / 2), new THREE.Vector2(R, Lm / 2), new THREE.Vector2(R * 0.66, Lm / 2), new THREE.Vector2(R * 0.66, -Lm / 2)], 40).rotateZ(-Math.PI / 2), mats.darkSteel));
      u.add(core);
      for (const e of [-1, 1]) {
        const coil = shadowed(new THREE.Mesh(new THREE.TorusGeometry(R * 0.83, R * 0.13, 10, 36).rotateY(Math.PI / 2), this.winding));
        coil.position.x = e * (Lm / 2 + 0.06);
        u.add(coil);
      }
      // rotor + magnets + shaft (spins)
      const rotor = new THREE.Group();
      const drum = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(R * 0.6, R * 0.6, Lm * 0.94, 32).rotateZ(Math.PI / 2), mats.steel));
      rotor.add(drum);
      for (let k = 0; k < 8; k++) {
        const mag = new THREE.Mesh(new THREE.BoxGeometry(Lm * 0.9, 0.05, R * 0.34), k % 2 ? magnetS : magnetN);
        const a = (k / 8) * Math.PI * 2;
        mag.position.set(0, Math.cos(a) * R * 0.61, Math.sin(a) * R * 0.61);
        mag.rotation.x = -a;
        rotor.add(mag);
      }
      const shaftLen = Lm + 1.2;
      const shaft = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, shaftLen, 16).rotateZ(Math.PI / 2), mats.chrome));
      shaft.position.x = 0.35;
      rotor.add(shaft);
      u.add(rotor);
      this.rotors.push({ g: rotor, side });
      // reduction: pinion (13) -> idler big (40) / small (15) -> ring gear (42)
      const gx = Lm / 2 + 0.55;
      const mod = small ? 0.75 : 1;
      const N = [13, 40, 15, 42];
      const r = N.map((t) => t * 0.018 * mod);
      const pinion = shadowed(new THREE.Mesh(gearGeometry(r[0], N[0], 0.22, 0), mats.steel));
      pinion.position.x = gx;
      rotor.add(pinion); // turns with the rotor
      const idlerY = -(r[0] + r[1]);
      const idler = new THREE.Group();
      idler.position.set(gx, idlerY, 0);
      const big = shadowed(new THREE.Mesh(gearGeometry(r[1], N[1], 0.2, 0.06), mats.steel));
      const sm = shadowed(new THREE.Mesh(gearGeometry(r[2], N[2], 0.24, 0), mats.steel));
      sm.position.x = 0.32;
      idler.add(big, sm);
      u.add(idler);
      // the ring gear sits forward of the idler (toward +z for this unit)
      const psi2 = Math.PI / 2;
      const ring = new THREE.Group();
      const d2 = r[2] + r[3];
      ring.position.set(gx + 0.32, idlerY + Math.cos(psi2) * d2, Math.sin(psi2) * d2);
      const ringGear = shadowed(new THREE.Mesh(gearGeometry(r[3], N[3], 0.22, 0.1), mats.steel));
      ring.add(ringGear);
      u.add(ring);
      this.stages.push({ idler, ring, N, psi2 });
      // gear case around the reduction
      const caseBox = new THREE.Mesh(new THREE.BoxGeometry(0.75, d2 + r[1] + r[3] + 0.4, d2 + r[1] + r[3] + 0.3), housing);
      caseBox.position.set(gx + 0.16, idlerY + 0.1, d2 / 2);
      caseBox.renderOrder = 2;
      u.add(caseBox);
      // half shafts with CV boots out of the ring gear (along the axle)
      const half = new THREE.Group();
      half.position.copy(ring.position);
      const hs = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.6, 12).rotateZ(Math.PI / 2), mats.steel));
      hs.position.x = 0.9;
      const boot = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.17, 0.28, 12, 3).rotateZ(Math.PI / 2), mats.rubber));
      boot.position.x = 1.75;
      const hub = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.08, 6).rotateZ(Math.PI / 2), mats.darkSteel));
      hub.position.x = 1.95;
      half.add(hs, boot, hub);
      u.add(half);
      this.shafts.push(half);
      // inverter on top, HV cables down to the battery
      const inv = shadowed(new THREE.Mesh(new THREE.BoxGeometry(Lm * 0.8, 0.32, R * 1.3), mats.alu));
      inv.position.set(-0.1, R + 0.32, 0);
      u.add(inv);
      const fins = new THREE.Mesh(new THREE.BoxGeometry(Lm * 0.7, 0.06, R * 1.1), mats.darkSteel);
      fins.position.set(-0.1, R + 0.51, 0);
      u.add(fins);
      for (const dz of [-0.18, 0.18]) {
        u.add(tube([new THREE.Vector3(-Lm * 0.4, R + 0.3, dz), new THREE.Vector3(-Lm / 2 - 0.5, R + 0.1, dz * 1.4), new THREE.Vector3(-Lm / 2 - 0.6, -R - 0.4, dz * 1.6), new THREE.Vector3(-Lm / 2 - 0.4, -R - 0.75, dz * 2)], 0.055, this.hv));
      }
    }
    // battery pack: tray with modules
    this.root.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(this.root);
    const top = bb.min.y - 0.12;
    const w = bb.max.x - bb.min.x + 0.8;
    const d = bb.max.z - bb.min.z + 0.6;
    const tray = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, 0.32, d), mats.black));
    tray.position.set((bb.min.x + bb.max.x) / 2, top - 0.16, (bb.min.z + bb.max.z) / 2);
    this.root.add(tray);
    const cols = Math.max(2, Math.round(w / 0.9));
    const rows = Math.max(2, Math.round(d / 0.9));
    const modGeo = new THREE.BoxGeometry((w / cols) * 0.86, 0.1, (d / rows) * 0.86);
    const mods = new THREE.InstancedMesh(modGeo, mats.accent, cols * rows);
    const m4 = new THREE.Matrix4();
    let i = 0;
    for (let a = 0; a < cols; a++) {
      for (let b = 0; b < rows; b++) {
        m4.makeTranslation(tray.position.x - w / 2 + (a + 0.5) * (w / cols), top + 0.05, tray.position.z - d / 2 + (b + 0.5) * (d / rows));
        mods.setMatrixAt(i++, m4);
      }
    }
    this.root.add(mods);
    this.floor = top - 0.32;
  }

  update(theta, rpm, state) {
    for (const { g, side } of this.rotors) g.rotation.x = theta * side;
    for (const [i, st] of this.stages.entries()) {
      const side = this.rotors[i].side;
      const [Np, Nb, Ns, Nr] = st.N;
      const th = theta * side;
      const phiI = -th * (Np / Nb) + meshOffset(Np, Math.PI, Nb);
      st.idler.rotation.x = phiI;
      st.ring.rotation.x = -phiI * (Ns / Nr) + meshOffset(Ns, st.psi2, Nr);
      this.shafts[i].rotation.x = st.ring.rotation.x;
    }
    // windings glow with the current through them
    this.winding.emissiveIntensity = state.running ? 0.05 + (state.load || 0) * 0.9 : 0;
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
    this.bg = new THREE.Color(0xdde2e8);
    this.scene.background = this.bg;
    // drafting-table floor grid that fades into the background
    this.grid = new THREE.GridHelper(60, 120, 0xffffff, 0xffffff);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.55;
    this.grid.material.depthWrite = false;
    this.grid.position.y = 0.001;
    this.scene.add(this.grid);
    this.scene.fog = new THREE.Fog(0xdde2e8, 14, 34);
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
    this.applyTheme();
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => this.applyTheme());
    new MutationObserver(() => this.applyTheme()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

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

  /** Take the stage colours from the page's CSS tokens (light / dark theme). */
  applyTheme() {
    const css = getComputedStyle(document.documentElement);
    const get = (n, d) => css.getPropertyValue(n).trim() || d;
    const stage = new THREE.Color(get('--stage', '#dde2e8'));
    this.bg.copy(stage);
    this.scene.fog.color.copy(stage);
    const dark = stage.getHSL({}).l < 0.4;
    const mats = Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material];
    const line = new THREE.Color(get('--rule', '#c3cbd6'));
    for (const m of mats) {
      m.color.copy(line);
      m.opacity = dark ? 0.8 : 0.9;
    }
    this.ground.material.opacity = dark ? 0.4 : 0.18;
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
  }

  setEngine(spec) {
    this.setModel(spec.electric ? new MotorModel(spec, this.mats) : new EngineModel(spec, this.mats));
  }

  /** Show any model exposing { root, floor, update(theta, rpm, state), dispose() }. */
  setModel(model) {
    if (this.model) {
      this.scene.remove(this.model.root);
      this.model.dispose();
    }
    this.model = model;
    this.model.update(0, 0, { running: false, load: 0, boost: 0 });
    this.scene.add(this.model.root);
    this.model.root.position.y = -this.model.floor;
    this.ground.position.y = 0;
    this.refit();
  }

  /** Recompute framing (e.g. after a model finished loading) and reset the camera. */
  refit() {
    this.model.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model.root);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    this.center = box.getCenter(new THREE.Vector3());
    this.bbox = box;
    this.radius = sphere.radius;
    this.controls.target.copy(this.center);
    this.controls.minDistance = this.radius * 0.6;
    this.controls.maxDistance = this.radius * 6;
    this.setView(this.viewIndex, true);
  }

  // Distance along dir at which the model's bounding box fills ~88% of the view.
  fitDistance(dir) {
    if (!this.radius || !dir) return this.radius ? this.radius * 2.5 : 12;
    const cam = this.camera.clone();
    const b = this.bbox;
    const corners = [];
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) corners.push(new THREE.Vector3(x, y, z));
    let d = this.radius * 2.5;
    const v = new THREE.Vector3();
    for (let it = 0; it < 6; it++) {
      cam.position.copy(this.center).addScaledVector(dir, d);
      cam.lookAt(this.center);
      cam.updateMatrixWorld(true);
      let m = 0;
      for (const c of corners) {
        v.copy(c).project(cam);
        m = Math.max(m, Math.abs(v.x), Math.abs(v.y));
      }
      d *= Math.max(0.5, Math.min(2, m / 0.88));
    }
    return d;
  }

  setView(i, instant = false) {
    const views = this.model?.views || VIEWS;
    this.viewIndex = ((i % views.length) + views.length) % views.length;
    const v = views[this.viewIndex];
    const dir = new THREE.Vector3(...v.dir).normalize();
    const to = this.center.clone().addScaledVector(dir, this.fitDistance(dir));
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
    return (this.model?.views || VIEWS)[this.viewIndex].name;
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
    // fade the floor grid out beyond the subject, whatever the zoom
    const d = this.camera.position.distanceTo(this.controls.target);
    this.scene.fog.near = d * 1.35;
    this.scene.fog.far = d * 3;
    this.renderer.render(this.scene, this.camera);
  }
}
