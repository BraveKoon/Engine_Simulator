import './style.css';
import { ENGINES, peakPower } from './engines.js';
import { Simulator } from './physics.js';
import { EngineView } from './engine3d.js';
import { EngineAudio } from './audio.js';
import { RpmBar } from './ui/gauge.js';
import { Pedal, HShifter } from './ui/controls.js';
import { CHASSIS, WHEELS, PAINT_SWATCHES, buildCar, tyreFor, carsFor } from './car/catalog.js';
import { makeCarModel, CAR_MODELS, GlbCarModel } from './car/glbCar.js';
import { wheelImage } from './car/wheelArt.js';

const $ = (id) => document.getElementById(id);

// ───────── Settings (persisted per browser) ─────────
const settings = { volume: 0.7, mute: false, slow: false, autoRotate: false, unit: 'kmh', engine: 'i6' };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem('engine-sim') || '{}'));
} catch {
  /* storage unavailable */
}
const save = () => {
  try {
    localStorage.setItem('engine-sim', JSON.stringify(settings));
  } catch {
    /* ignore */
  }
};

// ───────── Shared objects ─────────
const view = new EngineView();
const audio = new EngineAudio();
audio.volume = settings.volume;
audio.muted = settings.mute;
const tacho = new RpmBar($('tacho'));
let sim = null;
let screen = 'home';
let mode = 'engine'; // 'engine' = plain simulator, 'build' = car builder
const build = { chassis: 'mono', inch: 18 };
let car = null; // finished car from the builder
let wheelAngle = 0;
let showCar = false; // simulator viewport: car or engine
let selected = ENGINES.find((e) => e.id === settings.engine) || ENGINES[0];
let visTheta = 0;
let lastCrank = 0;
let outTheta = 0;

// ───────── Selection screen ─────────
function layoutIcon(e) {
  // End-on view: crank circle with cylinders radiating at each bank angle.
  const banks = [...new Set(e.cylinders.map((c) => c.bank))].sort((a, b) => a - b);
  const parts = banks
    .map((b) => {
      return `<g transform="rotate(${b} 23 30)"><rect x="18" y="5" width="10" height="16" class="li-bore"/><path d="M23 21v4" class="li-rod"/></g>`;
    })
    .join('');
  return `<svg viewBox="0 0 46 46" class="layout-icon" aria-hidden="true">${parts}<circle cx="23" cy="30" r="5.5" class="li-crank"/></svg>`;
}

function specLine(e) {
  const p = peakPower(e);
  const asp = e.turbo ? (e.turbo === 1 ? '터보' : `${['', '', '트윈', '', '쿼드'][e.turbo]}터보`) : '자연흡기';
  return { p, asp, text: `${e.displacement.toFixed(1)}L · ${p.ps}마력 · ${e.maxTorque}Nm` };
}

function buildList() {
  const list = $('engineList');
  list.innerHTML = '';
  for (const e of ENGINES) {
    const b = document.createElement('button');
    b.className = 'engine-card';
    b.setAttribute('role', 'option');
    b.dataset.id = e.id;
    const s = specLine(e);
    b.innerHTML = `${layoutIcon(e)}<span class="ec-id"><b>${e.code}</b><small>${e.short} · ${s.asp}</small></span><span class="ec-n">${e.displacement.toFixed(1)}<small>L</small></span><span class="ec-n">${s.p.ps}<small>ps</small></span><span class="ec-n">${(e.redline / 1000).toFixed(1)}<small>k</small></span>`;
    b.addEventListener('click', () => selectEngine(e));
    b.addEventListener('dblclick', () => startSim());
    list.appendChild(b);
  }
}

function selectEngine(e) {
  selected = e;
  settings.engine = e.id;
  save();
  for (const el of document.querySelectorAll('.engine-card')) el.classList.toggle('selected', el.dataset.id === e.id);
  $('pvCode').textContent = e.code;
  $('pvName').textContent = e.name;
  $('pvSpec').textContent = `${specLine(e).text} · ${e.count}기통`;
  view.setEngine(e);
}

// ───────── Screen switching ─────────
const SCREENS = ['home', 'select', 'chassis', 'wheel', 'result', 'sim'];
function show(id) {
  screen = id;
  for (const s of SCREENS) $(s).classList.toggle('active', s === id);
}

$('modeEngine').addEventListener('click', () => openSelect('engine'));
$('modeBuild').addEventListener('click', () => openSelect('build'));
$('selBack').addEventListener('click', () => show('home'));
for (const b of document.querySelectorAll('[data-back]')) {
  b.addEventListener('click', () => {
    const to = b.dataset.back;
    if (to === 'select') openSelect(mode, false);
    else show(to);
  });
}

function openSelect(m, reset = true) {
  mode = m;
  const b = m === 'build';
  $('selStep').hidden = !b;
  $('selTitle').textContent = b ? '엔진' : '엔진 다이노';
  $('selSub').textContent = b ? '차에 얹을 엔진부터 정해요' : '엔진을 고르고 시동을 걸어 보세요';
  $('goBtn').textContent = b ? '다음: 차체 구조' : '이 엔진으로 시작';
  show('select');
  view.mount($('preview'));
  view.controls.autoRotate = true;
  if (reset || !(view.model && view.model.spec === selected)) view.setEngine(selected);
  view.setView(0, true);
}

$('goBtn').addEventListener('click', () => {
  if (mode === 'build') openChassis();
  else startSim();
});

// ───────── Car builder: chassis ─────────
const CHASSIS_ART = {
  mono: `<svg viewBox="0 0 320 134" class="ch-art"><path d="M30 86 L42 64 L96 58 L128 34 L214 32 L250 58 L292 66 L296 86 Z" class="a-body"/><path d="M96 58 L250 58 M128 34 L118 86 M170 33 L170 86 M214 32 L226 86 M42 70 L292 72" class="a-cage"/><circle cx="78" cy="88" r="16" class="a-tyre"/><circle cx="248" cy="88" r="16" class="a-tyre"/><text x="160" y="128" class="a-cap">차체가 곧 뼈대 · 한 덩어리 구조</text></svg>`,
  frame: `<svg viewBox="0 0 320 134" class="ch-art"><path d="M34 70 L40 44 L100 40 L118 18 L208 18 L220 40 L290 44 L294 70 Z" class="a-ghost"/><rect x="26" y="77" width="276" height="9" class="a-frame"/><path d="M48 75 v13 M96 75 v13 M146 75 v13 M196 75 v13 M246 75 v13 M286 75 v13" class="a-rung"/><circle cx="76" cy="90" r="18" class="a-tyre"/><circle cx="250" cy="90" r="18" class="a-tyre"/><text x="160" y="130" class="a-cap">사다리 프레임 위에 차체를 볼트로 얹음</text></svg>`,
};

function openChassis() {
  $('chassisSub').textContent = `엔진: ${selected.name}`;
  const list = $('chassisList');
  list.innerHTML = '';
  const avail = (id) => carsFor(selected.id, id).length > 0;
  if (!avail(build.chassis)) build.chassis = CHASSIS.find((c) => avail(c.id)).id;
  for (const c of CHASSIS) {
    const b = document.createElement('button');
    b.className = 'chassis-card';
    b.dataset.id = c.id;
    const matches = carsFor(selected.id, c.id);
    b.disabled = matches.length === 0;
    b.innerHTML = `${CHASSIS_ART[c.id]}
      <h3>${c.name}<small>${c.en}</small></h3>
      <p>${c.desc}</p>
      <div class="pc"><div class="pro"><b>장점</b><ul>${c.pros.map((x) => `<li>${x}</li>`).join('')}</ul></div>
      <div class="con"><b>단점</b><ul>${c.cons.map((x) => `<li>${x}</li>`).join('')}</ul></div></div>
      ${
        matches.length
          ? `<div class="ex"><span>실제 차</span><em>${matches.slice(0, 4).map((m) => m.name).join(' · ')}${matches.length > 4 ? ` 외 ${matches.length - 4}대` : ''}</em></div>`
          : `<div class="ex none">${selected.code} 엔진을 얹은 ${c.name} 양산차가 없어 고를 수 없어요</div>`
      }`;
    b.addEventListener('click', () => {
      build.chassis = c.id;
      markSelected(list, c.id);
    });
    list.appendChild(b);
  }
  markSelected(list, build.chassis);
  show('chassis');
}

function markSelected(list, id) {
  for (const el of list.children) {
    const on = el.dataset.id === String(id);
    el.classList.toggle('selected', on);
    el.setAttribute('aria-selected', String(on));
  }
}

$('chassisNext').addEventListener('click', () => openWheels());

// ───────── Car builder: wheels ─────────
function openWheels() {
  const ch = CHASSIS.find((c) => c.id === build.chassis);
  $('wheelSub').textContent = `${selected.code} · ${ch.name} · 빗금 친 지름은 맞는 실제 차가 없어요`;
  const list = $('wheelList');
  list.innerHTML = '';
  const okInch = (inch) => carsFor(selected.id, build.chassis, inch).length > 0;
  if (!okInch(build.inch)) build.inch = WHEELS.map((w) => w.inch).find(okInch);
  WHEELS.forEach((w, i) => {
    const tyre = tyreFor(build.chassis, w.inch);
    const matches = carsFor(selected.id, build.chassis, w.inch);
    const b = document.createElement('button');
    b.className = 'wheel-card';
    b.dataset.id = String(w.inch);
    b.setAttribute('role', 'option');
    b.disabled = matches.length === 0;
    b.innerHTML = `<div class="wheel-img"><img alt="${w.inch}인치 휠" /></div>
      <div class="w-inch">${w.inch}<span>″</span><small>${tyre.label}</small></div>
      ${
        matches.length
          ? `<ul>${matches.slice(0, 3).map((c) => `<li>${c.name}</li>`).join('')}</ul>`
          : '<p class="none">맞는 양산차 없음</p>'
      }`;
    b.addEventListener('click', () => {
      build.inch = w.inch;
      markSelected(list, w.inch);
    });
    list.appendChild(b);
    // draw each wheel image a moment apart so they load in one by one
    const box = b.querySelector('.wheel-img');
    const img = box.querySelector('img');
    setTimeout(() => {
      img.onload = () => box.classList.add('loaded');
      img.src = wheelImage({ design: w.design, inch: w.inch, tyre: { ...tyre }, dark: w.inch >= 22 }, 280);
    }, 120 + i * 110);
  });
  markSelected(list, build.inch);
  show('wheel');
}

$('buildBtn').addEventListener('click', () => makeCar());

// ───────── Car builder: result ─────────
let carModel = null;

// Put the built car into the 3D view. Cars with a real 3D model show a loading panel
// while it downloads, with a small button to use the simplified model instead.
function showCarModel(container) {
  const model = makeCarModel(car, {
    onChange: (m, what) => {
      if (view.model !== m) return;
      if (what === 'ready') view.refit();
      renderModelUI(container, m);
    },
  });
  carModel = model;
  view.setModel(model);
  view.setView(0, true);
  renderModelUI(container, model);
}

function renderModelUI(container, m) {
  let ui = container.querySelector('.model-ui');
  if (!(m instanceof GlbCarModel)) {
    if (ui) ui.hidden = true;
    return;
  }
  if (!ui) {
    ui = document.createElement('div');
    ui.className = 'model-ui';
    ui.innerHTML = `
      <div class="model-loading" role="status">
        <div class="spinner" aria-hidden="true"></div>
        <b>실제 3D 모델 불러오는 중</b>
        <div class="bar"><i></i></div>
        <span class="pct">0%</span>
      </div>
      <button class="model-switch"></button>
      <p class="model-error">3D 모델을 불러오지 못해 단순화 모델로 보여 드려요</p>`;
    ui.querySelector('.model-switch').addEventListener('click', () => {
      const cur = view.model;
      if (cur instanceof GlbCarModel) cur.setSimplified(!cur.simplified);
    });
    container.appendChild(ui);
  }
  ui.hidden = false;
  const pct = Math.round(m.progress * 100);
  const loading = m.state === 'loading';
  ui.querySelector('.model-loading').hidden = !(loading && !m.simplified);
  ui.querySelector('.bar i').style.transform = `scaleX(${m.progress})`;
  ui.querySelector('.pct').textContent = `${pct}%`;
  ui.querySelector('.model-error').hidden = m.state !== 'error';
  const btn = ui.querySelector('.model-switch');
  btn.hidden = m.state === 'error';
  btn.textContent = m.simplified
    ? loading
      ? `실제 3D 모델 보기 (불러오는 중 ${pct}%)`
      : '실제 3D 모델 보기'
    : '단순화 모델로 보기';
}

function makeCar(real) {
  const matches = carsFor(selected.id, build.chassis, build.inch);
  car = buildCar(selected, build.chassis, build.inch, real || matches[0]);
  if (CAR_MODELS[car.name]) car.paint = null; // real 3D models start in their own paint
  show('result');
  // other production cars that fit the same choices
  const alt = $('carAlts');
  alt.innerHTML = '';
  alt.hidden = matches.length < 2;
  for (const m of matches) {
    const b = document.createElement('button');
    b.textContent = m.name;
    b.classList.toggle('on', m === car.real);
    b.addEventListener('click', () => makeCar(m));
    alt.appendChild(b);
  }
  view.mount($('carStage'));
  view.controls.autoRotate = true;
  showCarModel($('carStage'));
  const credit = CAR_MODELS[car.name];
  $('modelCredit').hidden = !credit;
  // models without a known body-paint material keep their own colours
  $('paintRow').hidden = !!credit && !credit.paint.length;
  $('carStage').classList.toggle('has-credit', !!credit);
  $('specNote').textContent = credit
    ? '3D 모델은 아래 제작자의 모델을 실제 크기에 맞춰 표시한 거예요. 성능은 선택한 엔진을 이 차의 무게와 타이어로 시뮬레이션한 추정치예요.'
    : '외형은 실제 차의 치수와 차체 형태를 따라 단순화한 모델이에요. 성능은 선택한 엔진을 이 차의 무게와 타이어로 시뮬레이션한 추정치예요.';
  if (credit) {
    $('modelCredit').innerHTML = `3D 모델: <a href="${credit.source}" target="_blank" rel="noopener">${credit.credit}</a>`;
  }
  $('carType').textContent = car.typeName;
  $('carName').textContent = car.name;
  $('carSub').textContent = `${car.engine.code} · ${car.chassisName} · ${car.inch}인치 휠 · ${car.drive}`;
  const e = car.engine;
  const p = car.perf;
  const rows = [
    ['0→100 km/h', p.t100 ? `${p.t100.toFixed(1)}초` : '—', true],
    ['최고속도', `${p.vmax} km/h`, true],
    ['최고출력', `${car.power.ps}마력`, true],
    ['엔진', `${e.displacement.toFixed(1)}L ${e.code}`],
    ['최대토크', `${e.maxTorque} Nm`],
    ['공차중량', `${car.mass.toLocaleString('en-US')} kg`],
    ['마력/톤', `${p.psPerTon} ps/t`],
    ['길이×폭×높이 (m)', `${car.real.L.toFixed(2)}×${car.real.W.toFixed(2)}×${car.real.H.toFixed(2)}`],
    ['타이어', car.tyre.label],
    ['휠베이스', `${car.real.wb.toFixed(2)} m`],
    ['구동', car.drive.split(' ')[0]],
    ['지상고', `${Math.round(car.clearance * 1000)} mm`],
  ];
  $('carSpecs').innerHTML = rows.map(([k, v, big]) => `<div><dt>${k}</dt><dd${big ? ' class="big"' : ''}>${v}</dd></div>`).join('');
  const sw = $('swatches');
  sw.innerHTML = '';
  // real 3D models offer their original paint ("원본", null) as the first swatch
  const first = credit ? null : car.paint;
  for (const hex of [first, ...PAINT_SWATCHES.filter((h) => h !== first)].slice(0, 7)) {
    const b = document.createElement('button');
    b.style.background = hex ?? 'conic-gradient(#8fd3ff, #1e3c78, #ff8a3d, #8fd3ff)';
    b.setAttribute('aria-label', hex ? `색상 ${hex}` : '원래 색상');
    b.classList.toggle('on', hex === car.paint);
    b.addEventListener('click', () => {
      car.paint = hex;
      carModel.setPaint(hex);
      for (const x of sw.children) x.classList.toggle('on', x === b);
    });
    sw.appendChild(b);
  }
}

$('restartBtn').addEventListener('click', () => {
  car = null;
  show('home');
});
$('driveBtn').addEventListener('click', () => startSim(car));

// ───────── Simulator screen ─────────
const GEAR_NAME = { '-1': '후진', 0: '중립' };
const gearLetter = (g) => (g === -1 ? 'R' : g === 0 ? 'N' : String(g));

const shifter = new HShifter($('shifter'), (g) => (sim ? sim.setGear(g) : false));
const brake = new Pedal($('brakePedal'), (v) => sim && (sim.brakeIn = v));
const accel = new Pedal($('accelPedal'), (v) => sim && (sim.throttleIn = v));

async function startSim(withCar = null) {
  const e = withCar ? withCar.engine : selected;
  sim = new Simulator(e, withCar || {});
  car = withCar;
  show('sim');
  view.mount($('viewport'));
  view.controls.autoRotate = settings.autoRotate;
  showCar = false;
  $('modelToggle').hidden = !withCar;
  $('backLabel').textContent = withCar ? '조립 결과로' : '엔진 고르기로';
  $('backBtn').setAttribute('aria-label', $('backLabel').textContent);
  setSimModel();
  wheelAngle = 0;
  tacho.configure(e.redline);
  shifter.reset();
  $('engName').textContent = withCar ? withCar.name : e.name;
  $('engSub').textContent = withCar
    ? `${withCar.typeName} · ${withCar.mass.toLocaleString('en-US')}kg · ${withCar.tyre.label}`
    : `${e.displacement.toFixed(1)}L · ${specLine(e).p.ps}마력 · 6단 수동`;
  lastCrank = 0;
  // Audio must be unlocked from a user gesture.
  audio.init().then(() => audio.setEngine(e));
  audio.setEngine(e);
}

function setSimModel() {
  if (showCar && car) {
    showCarModel($('viewport'));
  } else {
    view.setEngine(sim.e);
    renderModelUI($('viewport'), null);
  }
  $('modelToggle').textContent = showCar ? '엔진 보기' : '차량 보기';
  $('viewBtn').textContent = view.setView(0, true);
}
$('modelToggle').addEventListener('click', () => {
  showCar = !showCar;
  setSimModel();
});

function backToSelect() {
  if (sim) sim.stop();
  sim = null;
  audio.silence();
  exitFullscreen();
  if (car) {
    // back to the finished car
    show('result');
    view.mount($('carStage'));
    view.controls.autoRotate = true;
    showCarModel($('carStage'));
  } else {
    openSelect(mode, true);
  }
}

$('backBtn').addEventListener('click', backToSelect);
$('powerBtn').addEventListener('click', async () => {
  await audio.init();
  if (sim) audio.setEngine(sim.e);
  sim?.toggleEngine();
});
$('viewBtn').addEventListener('click', () => {
  $('viewBtn').textContent = view.nextView();
});

function setSlow(on) {
  settings.slow = on;
  save();
  $('slowBtn').setAttribute('aria-pressed', String(on));
  $('slowToggle').checked = on;
}
$('slowBtn').addEventListener('click', () => setSlow(!settings.slow));

function exitFullscreen() {
  $('sim').classList.remove('fs');
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}
$('fullBtn').addEventListener('click', () => {
  const on = !$('sim').classList.contains('fs');
  if (on) {
    $('sim').classList.add('fs');
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else exitFullscreen();
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) $('sim').classList.remove('fs');
});

// ───────── Settings sheet ─────────
const sheet = $('sheet');
const backdrop = $('sheetBackdrop');
const openSheet = (on) => {
  sheet.classList.toggle('open', on);
  backdrop.classList.toggle('open', on);
};
$('settingsBtn').addEventListener('click', () => openSheet(true));
$('sheetClose').addEventListener('click', () => openSheet(false));
backdrop.addEventListener('click', () => openSheet(false));

$('volume').value = settings.volume;
$('volume').addEventListener('input', (ev) => {
  settings.volume = audio.volume = Number(ev.target.value);
  save();
});
$('mute').checked = settings.mute;
$('mute').addEventListener('change', (ev) => {
  settings.mute = audio.muted = ev.target.checked;
  save();
});
$('slowToggle').addEventListener('change', (ev) => setSlow(ev.target.checked));
$('autoRotate').checked = settings.autoRotate;
$('autoRotate').addEventListener('change', (ev) => {
  settings.autoRotate = ev.target.checked;
  if (screen === 'sim') view.controls.autoRotate = settings.autoRotate;
  save();
});
function setUnit(u) {
  settings.unit = u;
  save();
  for (const b of document.querySelectorAll('#unitSeg button')) b.classList.toggle('on', b.dataset.unit === u);
  $('speedUnit').textContent = u === 'mph' ? 'mph' : 'km/h';
}
for (const b of document.querySelectorAll('#unitSeg button')) b.addEventListener('click', () => setUnit(b.dataset.unit));

// ───────── Toast ─────────
let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

// ───────── Keyboard ─────────
const held = new Set();
window.addEventListener('keydown', (ev) => {
  if (screen !== 'sim' || ev.repeat || ev.target.tagName === 'INPUT') return;
  const k = ev.key.toLowerCase();
  held.add(k);
  if (k === 'arrowup' || k === 'w') accel.setKey(1);
  else if (k === 'arrowdown' || k === 's' || k === ' ') brake.setKey(1);
  else if (k >= '1' && k <= '6') shifter.selectGear(Number(k));
  else if (k === 'r') shifter.selectGear(-1);
  else if (k === 'n' || k === '0') shifter.selectGear(0);
  else if (k === 'x' && sim) shifter.selectGear(Math.min(6, Math.max(1, sim.gear + 1)));
  else if (k === 'z' && sim) shifter.selectGear(sim.gear <= 1 ? 0 : sim.gear - 1);
  else if (k === 'e') $('powerBtn').click();
  else return;
  ev.preventDefault();
});
window.addEventListener('keyup', (ev) => {
  const k = ev.key.toLowerCase();
  held.delete(k);
  if (k === 'arrowup' || k === 'w') accel.setKey(held.has('arrowup') || held.has('w') ? 1 : 0);
  if (k === 'arrowdown' || k === 's' || k === ' ') brake.setKey(held.has('arrowdown') || held.has('s') || held.has(' ') ? 1 : 0);
});
window.addEventListener('blur', () => {
  held.clear();
  accel.setKey(0);
  brake.setKey(0);
});

// ───────── Main loop ─────────
let last = performance.now();
let uiT = 0;
const statusDot = $('statusDot');

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (screen === 'sim' && sim) {
    sim.update(dt);
    const dCrank = sim.crank - lastCrank;
    lastCrank = sim.crank;
    visTheta += dCrank * (settings.slow ? 0.06 : 1);
    // gearbox output shaft follows the wheels
    const slowK = settings.slow ? 0.06 : 1;
    outTheta += (sim.v / sim.wheelR) * sim.final * dt * slowK;
    sim.outTheta = outTheta;
    wheelAngle += (sim.v / sim.wheelR) * dt * slowK;
    sim.wheelAngle = wheelAngle;

    for (const ev of sim.events) {
      if (ev.type === 'warn') toast(ev.msg);
      else if (ev.type === 'bov') audio.blowOff();
    }
    sim.events.length = 0;
    audio.update(sim);

    const visRpm = settings.slow ? sim.rpm * 0.06 : sim.rpm;
    view.render(dt, visTheta, visRpm, sim);
    tacho.draw(sim.rpm, dt, sim.limiter);
    brake.render(sim.brake);
    accel.render(sim.throttle);

    uiT += dt;
    if (uiT > 0.05) {
      uiT = 0;
      updateInfo();
    }
  } else if (screen !== 'home') {
    // idle turning preview on the selection / result screens
    visTheta += dt * 2.2;
    wheelAngle += dt * 0.8;
    view.render(dt, visTheta, 20, { running: false, load: 0, boost: 0, limiter: false, wheelAngle });
  }
  requestAnimationFrame(frame);
}

function updateInfo() {
  const spd = settings.unit === 'mph' ? sim.speedKmh / 1.609 : sim.speedKmh;
  $('speedVal').textContent = Math.round(spd);
  const g = sim.gear;
  $('gearBig').textContent = gearLetter(g);
  $('gearBig').classList.toggle('rev', g === -1);
  $('gearName').textContent = GEAR_NAME[g] ?? `${g}단`;
  let cls = '';
  let text = '꺼짐';
  if (sim.starting) {
    cls = 'crank';
    text = '시동 중…';
  } else if (sim.running && sim.limiter) {
    cls = 'limit';
    text = '리미터 작동';
  } else if (sim.running) {
    cls = 'on';
    text = sim.rpm < sim.e.idle * 1.15 && sim.throttle < 0.02 ? '아이들' : '구동 중';
  }
  statusDot.className = cls;
  $('statusText').textContent = text;
  $('rpmVal').textContent = Math.round(sim.rpm).toLocaleString('en-US');
  const on = sim.running || sim.starting;
  $('powerBtn').classList.toggle('on', on);
  $('powerBtn').setAttribute('aria-checked', String(on));
  $('powerLabel').textContent = on ? '시동 끄기' : '시동 걸기';
  $('hud').textContent = `${gearLetter(g)}  ·  ${Math.round(sim.rpm).toLocaleString('en-US')} rpm  ·  ${Math.round(spd)} ${settings.unit === 'mph' ? 'mph' : 'km/h'}`;
}

// ───────── Boot ─────────
buildList();
view.mount($('preview'));
view.controls.autoRotate = true;
selectEngine(selected);
show('home');
setSlow(settings.slow);
setUnit(settings.unit);
requestAnimationFrame(frame);

// Stop the audio when the page is hidden.
document.addEventListener('visibilitychange', () => {
  if (!audio.ctx) return;
  if (document.hidden) audio.ctx.suspend();
  else if (screen === 'sim') audio.ctx.resume();
});
