import { peakPower } from '../engines.js';
import { Simulator } from '../physics.js';
import { carsFor } from './realCars.js';

export { REAL_CARS, carsFor } from './realCars.js';

export const CHASSIS = [
  {
    id: 'mono',
    name: '모노코크',
    en: 'Monocoque · Unibody',
    desc: '차체와 뼈대가 한 덩어리인 구조예요. 가볍고 단단해서 승차감과 핸들링이 좋아요.',
    pros: ['가벼워서 가속·연비 유리', '비틀림 강성이 높아 코너링 안정', '충돌 에너지를 차체 전체로 분산'],
    cons: ['험로·견인에는 불리', '큰 사고 시 수리비가 큼'],
    examples: ['현대 쏘나타', '기아 쏘렌토', '포르쉐 911', '제네시스 GV80'],
  },
  {
    id: 'frame',
    name: '프레임바디',
    en: 'Body-on-frame · Ladder',
    desc: '사다리 모양의 강철 프레임 위에 차체를 얹는 구조예요. 튼튼해서 오프로드와 견인에 강해요.',
    pros: ['험로 내구성과 견인력이 뛰어남', '지상고가 높고 서스펜션 스트로크가 김', '수리·개조가 쉬움'],
    cons: ['무거워서 가속·연비 불리', '무게중심이 높아 코너링이 둔함'],
    examples: ['기아 모하비', '쉐보레 콜로라도', '벤츠 G클래스', '토요타 랜드크루저'],
  },
];

// Representative cars per rim size (typical OEM fitments; varies by trim).
export const WHEELS = [
  { inch: 15, design: 'steel', cars: ['현대 캐스퍼', '기아 모닝', '기아 레이'] },
  { inch: 16, design: 'ten', cars: ['현대 아반떼', '기아 K3', '현대 코나'] },
  { inch: 17, design: 'double5', cars: ['현대 쏘나타', '기아 K5', '기아 셀토스'] },
  { inch: 18, design: 'multi', cars: ['현대 그랜저', '기아 스포티지', '테슬라 모델 3'] },
  { inch: 19, design: 'y5', cars: ['기아 쏘렌토', '제네시스 G80', 'BMW 5시리즈'] },
  { inch: 20, design: 'mesh', cars: ['현대 팰리세이드', '제네시스 GV80', '기아 EV9'] },
  { inch: 21, design: 'turbine', cars: ['포르쉐 카이엔', '아우디 Q8', '벤츠 GLE'] },
  { inch: 22, design: 'forged6', cars: ['레인지로버', '벤츠 G클래스 (AMG)', '롤스로이스 컬리넌'] },
];

// Tyre fitted for each rim size: passenger (monocoque) vs. truck/SUV (frame).
const TYRES = {
  mono: { 15: [185, 65], 16: [205, 60], 17: [225, 50], 18: [235, 45], 19: [245, 40], 20: [255, 35], 21: [275, 35], 22: [285, 30] },
  frame: { 15: [235, 75], 16: [245, 75], 17: [265, 70], 18: [265, 65], 19: [275, 55], 20: [275, 55], 21: [285, 45], 22: [285, 45] },
};

export function tyreFor(chassis, inch) {
  const [w, a] = TYRES[chassis][inch];
  const radius = (inch * 25.4) / 2000 + (w * a) / 100000; // m
  return { width: w, aspect: a, inch, label: `${w}/${a} R${inch}`, radius, widthM: w / 1000 };
}

export const BODY_TYPES = {
  hatch: { name: '해치백', L: 4.1, W: 1.78, wb: 2.6, fo: 0.82, clr: 0.14, mass: 1180, cda: 0.64, drive: 'FF 전륜구동' },
  sedan: { name: '세단', L: 4.85, W: 1.86, wb: 2.88, fo: 0.95, clr: 0.14, mass: 1480, cda: 0.6, drive: 'FR 후륜구동' },
  fastback: { name: '리어엔진 스포츠카', L: 4.5, W: 1.85, wb: 2.45, fo: 0.95, clr: 0.12, mass: 1450, cda: 0.6, drive: 'RR 후륜구동' },
  coupe: { name: '스포츠 쿠페', L: 4.5, W: 1.9, wb: 2.65, fo: 0.95, clr: 0.12, mass: 1420, cda: 0.58, drive: 'FR 후륜구동' },
  super: { name: '슈퍼카', L: 4.55, W: 2.0, wb: 2.7, fo: 1.05, clr: 0.1, mass: 1350, cda: 0.56, drive: '미드십 AWD' },
  suv: { name: 'SUV', L: 4.8, W: 1.95, wb: 2.9, fo: 0.95, clr: 0.2, mass: 1850, cda: 0.82, drive: 'AWD 사륜구동' },
  offroad: { name: '정통 오프로더', L: 4.8, W: 1.98, wb: 2.85, fo: 0.8, clr: 0.26, mass: 2150, cda: 1.02, drive: '파트타임 4WD' },
  pickup: { name: '픽업트럭', L: 5.4, W: 1.9, wb: 3.25, fo: 0.95, clr: 0.25, mass: 1950, cda: 0.98, drive: '파트타임 4WD' },
};

const PAINTS = {
  fastback: '#dcdad4',
  hatch: '#3f7fbf',
  sedan: '#2f3a44',
  coupe: '#c8372d',
  super: '#e8a41a',
  suv: '#dcdad4',
  offroad: '#4b5a3c',
  pickup: '#8a2a24',
};
export const PAINT_SWATCHES = ['#c8372d', '#e8a41a', '#3f7fbf', '#2f3a44', '#dcdad4', '#4b5a3c', '#111214'];

/** Build the car description from the choices and the matching production car. */
export function buildCar(engine, chassis, inch, real = carsFor(engine.id, chassis, inch)[0]) {
  const type = real.type;
  const base = BODY_TYPES[type];
  // real proportions; overhangs split by layout (mid/rear engines carry less up front)
  const frontShare = type === 'super' || type === 'fastback' ? 0.44 : 0.5;
  const body = { ...base, L: real.L, W: real.W, H: real.H, wb: real.wb, fo: (real.L - real.wb) * frontShare };
  const tyre = tyreFor(chassis, inch);
  // Keep overall gearing similar across tyre sizes; trucks get shorter gearing.
  const final = engine.final * (tyre.radius / 0.33) * (chassis === 'frame' ? 1.12 : 1);
  const clearance = base.clr + (tyre.radius - 0.33) * 0.8;
  let drive = base.drive;
  if (type === 'sedan' && engine.count >= 8) drive = 'AWD 사륜구동';
  if (type === 'hatch' && engine.count >= 4) drive = 'FF 전륜구동';
  const car = {
    type,
    typeName: engine.id === 'w16' ? '하이퍼카' : base.name,
    name: real.name,
    real,
    engine,
    chassis,
    chassisName: CHASSIS.find((c) => c.id === chassis).name,
    inch,
    design: WHEELS.find((w) => w.inch === inch).design,
    tyre,
    body,
    mass: real.kg,
    wheelR: tyre.radius,
    cda: base.cda,
    final,
    drive,
    clearance,
    paint: real.paint || PAINTS[type],
    power: peakPower(engine),
  };
  car.perf = estimatePerformance(car);
  return car;
}

/** Full-throttle run in the simulator: 0-100 km/h and top speed. */
export function estimatePerformance(car) {
  const s = new Simulator(car.engine, car);
  s.start();
  const dt = 1 / 60;
  for (let t = 0; t < 1.5; t += dt) s.update(dt);
  s.setGear(1);
  s.throttleIn = 1;
  let t100 = null;
  let vmax = 0;
  let lastShift = 0;
  for (let t = 0; t < 70; t += dt) {
    s.update(dt);
    if (s.locked && s.gear < 6 && s.rpm > car.engine.redline - 120 && t - lastShift > 0.4) {
      s.setGear(s.gear + 1);
      lastShift = t;
    }
    if (t100 === null && s.speedKmh >= 100) t100 = t;
    vmax = Math.max(vmax, s.speedKmh);
  }
  return { t100, vmax: Math.round(vmax), psPerTon: Math.round((car.power.ps / car.mass) * 1000) };
}
