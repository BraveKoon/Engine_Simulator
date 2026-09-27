import './style.css';
import { ENGINES, peakPower } from './engines.js';
import { Simulator } from './physics.js';
import { EngineView } from './engine3d.js';
import { EngineAudio } from './audio.js';
import { Tachometer } from './ui/gauge.js';
import { Pedal, HShifter } from './ui/controls.js';

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
const tacho = new Tachometer($('tacho'));
let sim = null;
let screen = 'select';
let selected = ENGINES.find((e) => e.id === settings.engine) || ENGINES[0];
let visTheta = 0;
let lastCrank = 0;

// ───────── Selection screen ─────────
function layoutIcon(e) {
  // End-on view: crank circle with cylinders radiating at each bank angle.
  const banks = [...new Set(e.cylinders.map((c) => c.bank))].sort((a, b) => a - b);
  const parts = banks
    .map((b) => {
      return `<g transform="rotate(${b} 23 30)"><rect x="17.5" y="4" width="11" height="17" rx="2.5" fill="currentColor" opacity="0.9"/><rect x="19" y="9" width="8" height="4" rx="1" fill="#1f2522"/></g>`;
    })
    .join('');
  return `<svg viewBox="0 0 46 46" style="color:${e.accent}">${parts}<circle cx="23" cy="30" r="6" fill="none" stroke="#c9ccc8" stroke-width="2.4"/><circle cx="23" cy="30" r="1.8" fill="#c9ccc8"/></svg>`;
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
    b.innerHTML = `${layoutIcon(e)}<div><b>${e.code} <span style="font-weight:500;color:#aeb5b0;font-size:13px">${e.short}</span></b><small>${e.displacement.toFixed(1)}L ${s.asp}<br>${s.p.ps}마력 · ${(e.redline / 1000).toFixed(1)}k rpm</small></div>`;
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

$('goBtn').addEventListener('click', () => startSim());

// ───────── Simulator screen ─────────
const GEAR_NAME = { '-1': '후진', 0: '중립' };
const gearLetter = (g) => (g === -1 ? 'R' : g === 0 ? 'N' : String(g));

const shifter = new HShifter($('shifter'), (g) => (sim ? sim.setGear(g) : false));
const brake = new Pedal($('brakePedal'), (v) => sim && (sim.brakeIn = v));
const accel = new Pedal($('accelPedal'), (v) => sim && (sim.throttleIn = v));

async function startSim() {
  const e = selected;
  sim = new Simulator(e);
  screen = 'sim';
  $('select').classList.remove('active');
  $('sim').classList.add('active');
  view.mount($('viewport'));
  view.controls.autoRotate = settings.autoRotate;
  $('viewBtn').textContent = view.setView(0, true);
  tacho.configure(e.redline);
  shifter.reset();
  $('engName').textContent = e.name.replace(/\s/g, ' ');
  $('engSub').textContent = `${e.displacement.toFixed(1)}L · ${specLine(e).p.ps}마력 · 6단 수동`;
  lastCrank = 0;
  // Audio must be unlocked from a user gesture.
  audio.init().then(() => audio.setEngine(e));
  audio.setEngine(e);
}

function backToSelect() {
  if (sim) sim.stop();
  sim = null;
  audio.silence();
  screen = 'select';
  exitFullscreen();
  $('sim').classList.remove('active');
  $('select').classList.add('active');
  view.mount($('preview'));
  view.controls.autoRotate = true;
  view.setView(0, true);
}

$('backBtn').addEventListener('click', backToSelect);
$('powerBtn').addEventListener('click', async () => {
  await audio.init();
  audio.setEngine(selected);
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
  } else {
    // idle turning preview on the selection screen
    visTheta += dt * 2.2;
    view.render(dt, visTheta, 20, { running: false, load: 0, boost: 0, limiter: false });
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
    text = '크랭킹…';
  } else if (sim.running && sim.limiter) {
    cls = 'limit';
    text = '레브 리미터';
  } else if (sim.running) {
    cls = 'on';
    text = sim.rpm < sim.e.idle * 1.15 && sim.throttle < 0.02 ? '공회전' : '작동 중';
  }
  statusDot.className = cls;
  $('statusText').textContent = text;
  const on = sim.running || sim.starting;
  $('powerBtn').classList.toggle('on', on);
  $('powerLabel').textContent = on ? '정지' : '시동';
  $('hud').textContent = `${gearLetter(g)}  ·  ${Math.round(sim.rpm).toLocaleString('en-US')} rpm  ·  ${Math.round(spd)} ${settings.unit === 'mph' ? 'mph' : 'km/h'}`;
}

// ───────── Boot ─────────
buildList();
view.mount($('preview'));
view.controls.autoRotate = true;
selectEngine(selected);
setSlow(settings.slow);
setUnit(settings.unit);
requestAnimationFrame(frame);

// Stop the audio when the page is hidden.
document.addEventListener('visibilitychange', () => {
  if (!audio.ctx) return;
  if (document.hidden) audio.ctx.suspend();
  else if (screen === 'sim') audio.ctx.resume();
});
