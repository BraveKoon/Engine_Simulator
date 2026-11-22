// Exhaust character per car, layered on top of the engine's own sound (engines.js).
//   pitch  : exhaust resonances ×  (lower = deeper)
//   rasp   : roughness added to the engine's own
//   gain   : loudness ×
//   imb    : firing-pulse unevenness × (burble)
//   muffle : brightness × of the exhaust filter (lower = more muffled)
//   pops   : 0..1 crackle when you lift off at high rpm
const NEUTRAL = { pitch: 1, rasp: 0, gain: 1, imb: 1, muffle: 1, pops: 0 };

const BY_TYPE = {
  sedan: { pitch: 1, rasp: -0.1, gain: 0.85, muffle: 0.85, label: '부드럽고 조용한 배기' },
  hatch: { pitch: 1.08, gain: 0.95, pops: 0.2, label: '가볍고 경쾌한 배기' },
  fastback: { pitch: 1.06, rasp: 0.1, pops: 0.3, label: '날카로운 스포츠 배기' },
  coupe: { pitch: 0.95, rasp: 0.1, gain: 1.05, pops: 0.4, label: '굵은 스포츠 배기' },
  super: { pitch: 1.05, rasp: 0.05, gain: 1.1, muffle: 1.15, pops: 0.5, label: '크고 날카로운 슈퍼카 배기' },
  suv: { pitch: 0.95, rasp: -0.1, gain: 0.85, muffle: 0.8, label: '묵직하고 차분한 배기' },
  offroad: { pitch: 0.9, gain: 0.95, muffle: 0.85, label: '낮게 깔리는 배기' },
  pickup: { pitch: 0.86, rasp: 0.15, muffle: 0.9, label: '거칠고 낮은 트럭 배기' },
};

// Cars with a sound of their own. Keys are matched against the car's name.
const BY_CAR = [
  ['아반떼 N', { pitch: 1.1, rasp: 0.2, gain: 1.05, muffle: 1.1, pops: 0.9, label: '팝콘이 터지는 N 배기' }],
  ['아반떼', { gain: 0.7, muffle: 0.75, label: '조용한 일상용 배기' }],
  ['쏘나타', { gain: 0.72, muffle: 0.75, label: '조용한 일상용 배기' }],
  ['골프 GTI', { pitch: 1.05, rasp: 0.1, pops: 0.45, label: '경쾌한 핫해치 배기' }],
  ['시빅 타입 R', { pitch: 1.12, rasp: 0.1, muffle: 1.1, pops: 0.3, label: '고회전형 핫해치 배기' }],
  ['BMW M', { pitch: 1.05, rasp: 0.12, gain: 1.05, pops: 0.45, label: '금속성의 M 배기' }],
  ['수프라', { pitch: 1.02, rasp: 0.1, pops: 0.5, label: '직렬 6기통 스포츠 배기' }],
  ['GT-R', { pitch: 1, rasp: 0.12, muffle: 1.05, pops: 0.3, label: '터보 V6 스포츠 배기' }],
  ['NSX', { pitch: 1.08, muffle: 1.1, pops: 0.3, label: '하이브리드 슈퍼카 배기' }],
  ['머스탱', { pitch: 0.85, rasp: 0.25, gain: 1.1, imb: 1.3, pops: 0.5, label: '낮고 거친 머슬카 V8' }],
  ['AMG G 63', { pitch: 0.88, rasp: 0.25, gain: 1.1, imb: 1.2, pops: 0.6, label: '사이드 머플러의 굵은 V8' }],
  ['AMG G 65', { pitch: 0.95, gain: 0.9, muffle: 0.85, label: '부드러운 V12' }],
  ['AMG GT', { pitch: 0.9, rasp: 0.3, gain: 1.15, imb: 1.2, pops: 0.9, label: '탁하고 큰 AMG 배기, 팝콘 배기' }],
  ['콜벳', { pitch: 1, rasp: 0.15, gain: 1.1, imb: 1.15, pops: 0.4, label: '미드십 V8의 날카로운 배기' }],
  ['우루스', { pitch: 0.95, rasp: 0.2, gain: 1.05, pops: 0.6, label: '슈퍼 SUV의 굵은 배기' }],
  ['F8', { pitch: 1.12, muffle: 1.2, gain: 1.05, pops: 0.3, label: '고음의 페라리 V8' }],
  ['우라칸', { pitch: 1.1, rasp: 0.2, gain: 1.15, pops: 0.8, label: '비명 같은 V10, 팝콘 배기' }],
  ['R8', { pitch: 1.05, rasp: 0.1, gain: 1.1, pops: 0.4, label: '자연흡기 V10의 고음' }],
  ['LFA', { pitch: 1.2, rasp: -0.05, gain: 1.1, muffle: 1.3, pops: 0.1, label: 'F1 같은 고음의 V10' }],
  ['812', { pitch: 1.15, gain: 1.1, muffle: 1.25, pops: 0.2, label: '하늘로 치솟는 V12' }],
  ['DBS', { pitch: 0.95, rasp: 0.1, gain: 1.05, pops: 0.5, label: '굵은 그랜드투어러 V12' }],
  ['아벤타도르', { pitch: 1.05, rasp: 0.25, gain: 1.2, pops: 0.7, label: '거친 람보르기니 V12' }],
  ['롤스로이스', { gain: 0.4, rasp: -0.3, muffle: 0.55, label: '거의 들리지 않는 정숙함' }],
  ['부가티', { pitch: 0.95, muffle: 0.9, gain: 1.05, label: '터보 바람 소리가 섞인 W16' }],
  ['911', { pitch: 1.08, rasp: 0.15, pops: 0.4, label: '박서 6기통의 날카로운 배기' }],
  ['카이맨 GT4', { pitch: 1.12, rasp: 0.1, muffle: 1.2, pops: 0.3, label: '고회전 자연흡기 박서' }],
  ['아웃백', { pitch: 0.92, gain: 0.8, imb: 1.2, label: '박서 특유의 둥둥거림' }],
  ['SRT-10', { pitch: 0.82, rasp: 0.3, gain: 1.15, imb: 1.2, label: '바이퍼 V10의 거친 배기' }],
  ['F-250', { pitch: 0.82, rasp: 0.25, gain: 1.05, label: '큰 V10 트럭 배기' }],
  ['에스컬레이드', { pitch: 0.88, gain: 0.8, muffle: 0.75, label: '차분한 V8' }],
  ['카이엔 터보', { pitch: 0.95, rasp: 0.1, gain: 1, pops: 0.3, label: '스포츠 SUV V8' }],
  ['GV80', { gain: 0.75, muffle: 0.75, label: '조용한 고급 SUV' }],
  ['G80', { gain: 0.75, muffle: 0.75, label: '조용한 고급 세단' }],
  ['스팅어', { pitch: 0.98, rasp: 0.05, gain: 0.95, pops: 0.2, label: '그랜드투어러 V6' }],
];

/** Exhaust profile for a built car (or null for the plain engine dyno). */
export function carSound(car) {
  if (!car || car.engine.electric) return null;
  const type = BY_TYPE[car.type] || {};
  const own = BY_CAR.find(([key]) => car.name.includes(key))?.[1] || {};
  return { ...NEUTRAL, ...type, ...own };
}
