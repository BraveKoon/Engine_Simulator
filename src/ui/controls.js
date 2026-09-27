const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Touch/mouse pedal: pressing higher on the pedal = more input. */
export class Pedal {
  constructor(root, onChange) {
    this.root = root;
    this.pad = root.querySelector('.pedal');
    this.valueEl = root.querySelector('.pedal-value');
    this.bar = root.querySelector('.pedal-bar i');
    this.onChange = onChange;
    this.value = 0;
    this.touch = 0;
    this.key = 0;
    this.pointer = null;

    const area = root.querySelector('.pedal-area');
    const fromEvent = (ev) => {
      const r = area.getBoundingClientRect();
      const t = (r.bottom - ev.clientY) / r.height;
      return clamp(0.1 + t * 1.05, 0.1, 1);
    };
    area.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      this.pointer = ev.pointerId;
      area.setPointerCapture(ev.pointerId);
      this.touch = fromEvent(ev);
      this.root.classList.add('pressed');
      this.emit();
    });
    area.addEventListener('pointermove', (ev) => {
      if (ev.pointerId !== this.pointer) return;
      this.touch = fromEvent(ev);
      this.emit();
    });
    const up = (ev) => {
      if (ev.pointerId !== this.pointer) return;
      this.pointer = null;
      this.touch = 0;
      this.root.classList.remove('pressed');
      this.emit();
    };
    area.addEventListener('pointerup', up);
    area.addEventListener('pointercancel', up);
    area.addEventListener('lostpointercapture', up);
  }

  setKey(v) {
    this.key = v;
    this.root.classList.toggle('pressed', v > 0 || this.touch > 0);
    this.emit();
  }

  emit() {
    this.value = Math.max(this.touch, this.key);
    this.onChange(this.value);
  }

  /** Visuals follow the simulated (rate-limited) value. */
  render(v) {
    const pct = Math.round(v * 100);
    this.valueEl.textContent = `${pct}%`;
    this.bar.style.transform = `scaleY(${v})`;
    this.pad.style.transform = `perspective(420px) rotateX(${v * 24}deg) translateY(${v * 5}px)`;
  }
}

// H-pattern gate: 4 planes (R | 1-2 | 3-4 | 5-6)
const COLS = [-1.5, -0.5, 0.5, 1.5];
const SLOTS = [
  { col: 0, dir: -1, gear: -1, label: 'R' },
  { col: 1, dir: -1, gear: 1, label: '1' },
  { col: 1, dir: 1, gear: 2, label: '2' },
  { col: 2, dir: -1, gear: 3, label: '3' },
  { col: 2, dir: 1, gear: 4, label: '4' },
  { col: 3, dir: -1, gear: 5, label: '5' },
  { col: 3, dir: 1, gear: 6, label: '6' },
];
const ENGAGE = 0.72;

export class HShifter {
  constructor(root, onSelect) {
    this.root = root;
    this.onSelect = onSelect;
    this.x = 0;
    this.y = 0;
    this.gear = 0;
    this.dragging = null;
    this.anim = null;

    root.innerHTML = '';
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.classList.add('gate');
    root.appendChild(this.svg);
    this.knob = document.createElement('div');
    this.knob.className = 'knob';
    this.knob.innerHTML = '<span></span>';
    root.appendChild(this.knob);
    this.labels = [];
    for (const s of SLOTS) {
      const b = document.createElement('button');
      b.className = 'gate-label';
      b.textContent = s.label;
      b.addEventListener('click', () => this.selectGear(s.gear));
      root.appendChild(b);
      this.labels.push({ el: b, s });
    }

    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(root);

    this.knob.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.knob.setPointerCapture(ev.pointerId);
      this.anim = null;
      const p = this.toGate(ev);
      this.dragging = { id: ev.pointerId, ox: this.x - p.x, oy: this.y - p.y };
      this.root.classList.add('dragging');
    });
    this.knob.addEventListener('pointermove', (ev) => {
      if (!this.dragging || ev.pointerId !== this.dragging.id) return;
      const p = this.toGate(ev);
      this.moveToward(p.x + this.dragging.ox, p.y + this.dragging.oy);
    });
    const release = (ev) => {
      if (!this.dragging || ev.pointerId !== this.dragging.id) return;
      this.dragging = null;
      this.root.classList.remove('dragging');
      if (Math.abs(this.y) > 0.45) this.animateTo(this.x, Math.sign(this.y));
      else this.animateTo(this.x, 0, true);
    };
    this.knob.addEventListener('pointerup', release);
    this.knob.addEventListener('pointercancel', release);
  }

  layout() {
    const W = this.root.clientWidth;
    const H = this.root.clientHeight;
    if (!W || !H) return;
    this.W = W;
    this.H = H;
    this.sx = W / 4.3;
    this.sy = H * 0.36;
    const px = (x) => W / 2 + x * this.sx;
    const py = (y) => H / 2 + y * this.sy;
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    let d = `M${px(COLS[0])},${py(0)} L${px(COLS[3])},${py(0)}`;
    for (const s of SLOTS) d += ` M${px(COLS[s.col])},${py(0)} L${px(COLS[s.col])},${py(s.dir)}`;
    this.svg.innerHTML = `<path d="${d}" class="gate-slot-outer"/><path d="${d}" class="gate-slot"/>`;
    for (const { el, s } of this.labels) {
      el.style.left = `${px(COLS[s.col])}px`;
      el.style.top = `${py(s.dir * 1.02)}px`;
    }
    this.place();
  }

  toGate(ev) {
    const r = this.root.getBoundingClientRect();
    return { x: (ev.clientX - r.left - this.W / 2) / this.sx, y: (ev.clientY - r.top - this.H / 2) / this.sy };
  }

  nearestCol(x) {
    let best = 0;
    for (let i = 1; i < COLS.length; i++) if (Math.abs(COLS[i] - x) < Math.abs(COLS[best] - x)) best = i;
    return best;
  }

  slotRange(col) {
    let lo = 0;
    let hi = 0;
    for (const s of SLOTS) if (s.col === col) (s.dir < 0 ? (lo = -1) : (hi = 1));
    return [lo, hi];
  }

  // Move the knob toward a desired point while staying inside the gate.
  moveToward(tx, ty) {
    for (let iter = 0; iter < 3; iter++) {
      if (Math.abs(this.y) > 0.04) {
        // inside a slot: only vertical travel
        const col = this.nearestCol(this.x);
        const [lo, hi] = this.slotRange(col);
        this.x = COLS[col];
        this.y = clamp(ty, lo, hi);
        if (Math.abs(this.y) <= 0.04) this.y = 0;
        else break;
      } else {
        const col = this.nearestCol(this.x);
        const [lo, hi] = this.slotRange(col);
        const wantsVertical = Math.abs(ty) > 0.12 && Math.abs(tx - COLS[col]) < 0.45;
        if (wantsVertical && Math.abs(this.x - COLS[col]) < 0.2 && ((ty < 0 && lo < 0) || (ty > 0 && hi > 0))) {
          this.x = COLS[col];
          this.y = clamp(ty, lo, hi);
          continue;
        }
        const nx = clamp(tx, COLS[0], COLS[3]);
        // if heading to a column vertically, slide x to it first
        if (wantsVertical) this.x = COLS[col];
        else this.x = nx;
        this.y = 0;
        break;
      }
    }
    this.place();
    this.checkGear();
  }

  checkGear() {
    let g = 0;
    if (Math.abs(this.y) >= ENGAGE) {
      const col = this.nearestCol(this.x);
      const s = SLOTS.find((q) => q.col === col && q.dir === Math.sign(this.y));
      if (s) g = s.gear;
    }
    if (g !== this.gear) {
      const ok = this.onSelect(g);
      if (ok) {
        this.gear = g;
      } else {
        this.gear = 0;
        this.onSelect(0);
        this.dragging = null;
        this.root.classList.remove('dragging');
        this.root.classList.add('reject');
        setTimeout(() => this.root.classList.remove('reject'), 380);
        this.animateTo(this.x, 0, true);
      }
      this.highlight();
    }
  }

  highlight() {
    for (const { el, s } of this.labels) el.classList.toggle('active', s.gear === this.gear);
  }

  place() {
    if (!this.W) return;
    const px = this.W / 2 + this.x * this.sx;
    const py = this.H / 2 + this.y * this.sy;
    this.knob.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%)`;
  }

  animateTo(x, y, toNeutral = false) {
    // travel via the neutral lane when changing planes
    const path = [];
    if (Math.abs(this.x - x) > 0.01 && Math.abs(this.y) > 0.01) path.push([this.x, 0]);
    if (Math.abs(this.x - x) > 0.01) path.push([x, 0]);
    path.push([x, y]);
    if (toNeutral && Math.abs(this.x) > 0.01 && y === 0) {
      // spring back toward the centre of the neutral lane
      path.push([this.x > 0 ? 0.5 : -0.5, 0]);
    }
    const anim = { path, i: 0, last: performance.now() };
    this.anim = anim;
    const tick = (now) => {
      if (this.anim !== anim) return;
      const dt = Math.min(0.1, Math.max(0, (now - anim.last) / 1000));
      anim.last = now;
      const [tx, ty] = this.anim.path[this.anim.i];
      const dx = tx - this.x;
      const dy = ty - this.y;
      const dist = Math.hypot(dx, dy);
      const step = dt * 14;
      if (dist <= step) {
        this.x = tx;
        this.y = ty;
        this.anim.i++;
      } else {
        this.x += (dx / dist) * step;
        this.y += (dy / dist) * step;
      }
      this.place();
      this.checkGear();
      if (this.anim === anim && anim.i < anim.path.length) requestAnimationFrame(tick);
      else if (this.anim === anim) this.anim = null;
    };
    requestAnimationFrame(tick);
  }

  /** Programmatic gear selection (keyboard / label tap). */
  selectGear(g) {
    if (g === 0) {
      this.animateTo(this.x, 0, true);
      return;
    }
    const s = SLOTS.find((q) => q.gear === g);
    if (!s) return;
    this.animateTo(COLS[s.col], s.dir);
  }

  /** Reset to neutral without triggering callbacks. */
  reset() {
    this.anim = null;
    this.x = 0;
    this.y = 0;
    this.gear = 0;
    this.highlight();
    this.place();
  }
}
