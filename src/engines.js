// Engine catalogue + cylinder geometry generation.
// Each cylinder: { x, bank (deg), pin (deg) } — x along the crank axis,
// bank = cylinder axis angle around the crank, pin = crank-pin angle.

const inline = (n, pins, pitch = 1.25) =>
  pins.map((pin, j) => ({ x: (j - (n - 1) / 2) * pitch, bank: 0, pin }));

// V engine: one crank pin per row shared by both banks (split pins via splitPin).
const vee = (rows, angle, pins, { pitch = 1.3, splitPin = 0 } = {}) => {
  const cyl = [];
  pins.forEach((pin, j) => {
    const x = (j - (rows - 1) / 2) * pitch;
    cyl.push({ x: x - pitch * 0.2, bank: -angle / 2, pin });
    cyl.push({ x: x + pitch * 0.2, bank: angle / 2, pin: pin + splitPin });
  });
  return cyl;
};

const boxer = (rows, pins, pitch = 1.3) => {
  const cyl = [];
  pins.forEach((pin, j) => {
    const x = (j - (rows - 1) / 2) * pitch;
    cyl.push({ x: x - pitch * 0.22, bank: -90, pin });
    cyl.push({ x: x + pitch * 0.22, bank: 90, pin: pin + 180 });
  });
  return cyl;
};

// W16: two VR8 banks 90° apart, each VR8 zig-zags ±7.5°.
const w16 = () => {
  const pins = [0, 90, 270, 180, 180, 270, 90, 0];
  const pitch = 0.82;
  const cyl = [];
  pins.forEach((pin, j) => {
    const x = (j - 3.5) * pitch;
    const zig = j % 2 === 0 ? -7.5 : 7.5;
    cyl.push({ x: x - 0.14, bank: -45 + zig, pin: pin + zig });
    cyl.push({ x: x + 0.14, bank: 45 + zig, pin: pin + zig + 45 });
  });
  return cyl;
};

// Assign 4-stroke firing offsets (deg, 0..720) so that cylinders reach
// compression TDC in an evenly interleaved order.
function assignFiring(cyls) {
  const n = cyls.length;
  const step = 720 / n;
  const tdc = cyls.map((c) => (((c.bank - c.pin) % 360) + 360) % 360);
  const base = Math.min(...tdc);
  const free = new Array(n).fill(true);
  const slotErr = (a) => {
    let best = { k: -1, err: Infinity };
    for (let k = 0; k < n; k++) {
      if (!free[k]) continue;
      const d = Math.abs(((a - base - k * step + 1080) % 720) - 360);
      const err = 360 - d;
      if (err < best.err) best = { k, err };
    }
    return best;
  };
  const order = cyls.map((_, i) => i).sort((i, j) => tdc[i] - tdc[j] || i - j);
  for (const i of order) {
    const o1 = slotErr(tdc[i]);
    const o2 = slotErr(tdc[i] + 360);
    const pick = o2.err < o1.err ? { ...o2, a: tdc[i] + 360 } : { ...o1, a: tdc[i] };
    free[pick.k] = false;
    cyls[i].fire = pick.a;
  }
  return cyls;
}

const GEARS6 = [3.64, 2.18, 1.54, 1.18, 0.95, 0.79];

export const ENGINES = [
  {
    id: 'i4',
    code: 'I4',
    name: '직렬 4기통 터보',
    short: '직렬4',
    displacement: 2.0,
    turbo: 1,
    cylinders: inline(4, [0, 180, 180, 0]),
    maxTorque: 400, torqueFrom: 1900, torqueTo: 4500,
    idle: 800, redline: 7000, lowFrac: 0.45, highFrac: 0.62,
    inertia: 0.13,
    mass: 1450, final: 4.1, gears: GEARS6,
    sound: { formants: [150, 380, 1200], rasp: 0.35, imbalance: [0, 0.02, 0.04, 0.01], gain: 1.0 },
    accent: '#5aa9e6',
  },
  {
    id: 'i6',
    code: 'I6',
    name: '직렬 6기통 트윈터보',
    short: '직렬6',
    displacement: 3.0,
    turbo: 2,
    cylinders: inline(6, [0, 120, 240, 240, 120, 0], 1.15),
    maxTorque: 600, torqueFrom: 2000, torqueTo: 5200,
    idle: 750, redline: 7300, lowFrac: 0.45, highFrac: 0.66,
    inertia: 0.17,
    mass: 1600, final: 3.46, gears: GEARS6,
    sound: { formants: [170, 460, 1500], rasp: 0.3, imbalance: [0, 0.01, 0.02, 0.01, 0, 0.02], gain: 1.0 },
    accent: '#63c5a0',
  },
  {
    id: 'v6',
    code: 'V6',
    name: 'V형 6기통 트윈터보',
    short: 'V6',
    displacement: 3.5,
    turbo: 2,
    cylinders: vee(3, 60, [0, 120, 240], { splitPin: 60 }),
    maxTorque: 620, torqueFrom: 2300, torqueTo: 5000,
    idle: 800, redline: 7200, lowFrac: 0.42, highFrac: 0.62,
    inertia: 0.16,
    mass: 1650, final: 3.55, gears: GEARS6,
    sound: { formants: [140, 360, 1100], rasp: 0.4, imbalance: [0, 0.08, 0.02, 0.1, 0.03, 0.06], gain: 1.0 },
    accent: '#e0a458',
  },
  {
    id: 'v8',
    code: 'V8',
    name: 'V형 8기통 크로스플레인',
    short: 'V8',
    displacement: 5.0,
    turbo: 0,
    cylinders: vee(4, 90, [0, 90, 270, 180]),
    maxTorque: 570, torqueFrom: 4200, torqueTo: 5400,
    idle: 700, redline: 7500, lowFrac: 0.62, highFrac: 0.78,
    inertia: 0.2,
    mass: 1700, final: 3.73, gears: GEARS6,
    // cross-plane bank-to-bank firing imbalance → burble
    sound: { formants: [110, 290, 900], rasp: 0.5, imbalance: [0, 0.22, 0.05, 0.3, 0.02, 0.25, 0.08, 0.18], gain: 1.1 },
    accent: '#e86a4b',
  },
  {
    id: 'v10',
    code: 'V10',
    name: 'V형 10기통 자연흡기',
    short: 'V10',
    displacement: 5.2,
    turbo: 0,
    cylinders: vee(5, 90, [0, 72, 144, 216, 288], { pitch: 1.2, splitPin: 18 }),
    maxTorque: 565, torqueFrom: 6000, torqueTo: 6800,
    idle: 900, redline: 8700, lowFrac: 0.55, highFrac: 0.84,
    inertia: 0.15,
    mass: 1550, final: 3.9, gears: GEARS6,
    sound: { formants: [190, 520, 1700], rasp: 0.45, imbalance: [0, 0.04, 0.08, 0.02, 0.06, 0.01, 0.05, 0.03, 0.07, 0.02], gain: 1.0 },
    accent: '#c792ea',
  },
  {
    id: 'v12',
    code: 'V12',
    name: 'V형 12기통 자연흡기',
    short: 'V12',
    displacement: 6.5,
    turbo: 0,
    cylinders: vee(6, 60, [0, 120, 240, 240, 120, 0], { pitch: 1.15 }),
    maxTorque: 720, torqueFrom: 5500, torqueTo: 7000,
    idle: 900, redline: 9000, lowFrac: 0.6, highFrac: 0.82,
    inertia: 0.19,
    mass: 1650, final: 3.6, gears: GEARS6,
    sound: { formants: [230, 640, 2100], rasp: 0.35, imbalance: new Array(12).fill(0).map((_, i) => (i % 3) * 0.02), gain: 1.0 },
    accent: '#f25f5c',
  },
  {
    id: 'w16',
    code: 'W16',
    name: 'W형 16기통 쿼드터보',
    short: 'W16',
    displacement: 8.0,
    turbo: 4,
    cylinders: w16(),
    maxTorque: 1600, torqueFrom: 2000, torqueTo: 6000,
    idle: 800, redline: 6800, lowFrac: 0.35, highFrac: 0.82,
    inertia: 0.34,
    mass: 1990, final: 3.1, gears: [3.18, 2.26, 1.68, 1.29, 1.03, 0.84],
    sound: { formants: [120, 330, 1000], rasp: 0.4, imbalance: new Array(16).fill(0).map((_, i) => ((i * 7) % 5) * 0.03), gain: 1.05 },
    accent: '#4d9de0',
  },
  {
    id: 'h6',
    code: 'F6',
    name: '수평대향 6기통 박서',
    short: '박서6',
    displacement: 4.0,
    turbo: 0,
    cylinders: boxer(3, [0, 120, 240]),
    maxTorque: 470, torqueFrom: 5500, torqueTo: 6800,
    idle: 850, redline: 9000, lowFrac: 0.6, highFrac: 0.8,
    inertia: 0.14,
    mass: 1450, final: 3.97, gears: GEARS6,
    sound: { formants: [180, 480, 1600], rasp: 0.45, imbalance: [0, 0.05, 0.02, 0.06, 0.01, 0.04], gain: 1.0 },
    accent: '#ffc857',
  },
];

for (const e of ENGINES) {
  assignFiring(e.cylinders);
  e.count = e.cylinders.length;
}

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// Normalised full-load torque curve (0..1) at a given rpm.
export function torqueCurve(e, rpm) {
  if (rpm <= 0) return e.lowFrac * 0.8;
  if (rpm < e.torqueFrom) {
    const t = rpm / e.torqueFrom;
    return e.lowFrac * 0.8 + (1 - e.lowFrac * 0.8) * smooth(Math.pow(t, 0.8));
  }
  if (rpm <= e.torqueTo) return 1;
  const t = Math.min(1.2, (rpm - e.torqueTo) / (e.redline - e.torqueTo));
  return Math.max(0, 1 - (1 - e.highFrac) * Math.pow(t, 1.4));
}

// Peak power (PS) estimated from the curve.
export function peakPower(e) {
  let best = 0;
  let bestRpm = 0;
  for (let rpm = 1000; rpm <= e.redline; rpm += 50) {
    const p = (e.maxTorque * torqueCurve(e, rpm) * rpm) / 7023;
    if (p > best) {
      best = p;
      bestRpm = rpm;
    }
  }
  return { ps: Math.round(best), rpm: bestRpm };
}
