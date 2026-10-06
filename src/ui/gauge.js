// RPM bar graph: a strip of segments like a dyno-cell readout, with a scale underneath
// and a peak-hold marker. Colours come from the page's CSS tokens so it follows the theme.
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export class RpmBar {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.max = 8;
    this.red = 7;
    this.shown = 0;
    this.peak = 0;
    this.peakT = 0;
    this.w = 0;
    this.h = 0;
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    mq?.addEventListener?.('change', () => (this.w = 0));
    new MutationObserver(() => (this.w = 0)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  configure(redline) {
    this.red = redline / 1000;
    this.max = Math.ceil(redline / 1000 + 0.6);
    this.peak = 0;
    this.w = 0; // force a redraw of the static parts
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(r.width * dpr);
    const h = Math.round(r.height * dpr);
    if (!w || !h || (w === this.w && h === this.h)) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = w;
    this.canvas.height = h;
    this.col = { ink: css('--ink'), dim: css('--rule'), sig: css('--signal'), hot: css('--hot'), muted: css('--ink-2') };
    // segment layout: one segment per 250 rpm (500 rpm for electric motors)
    this.per = this.max > 10 ? 2 : 4; // segments per 1000 rpm
    this.n = this.max * this.per;
    const labelEvery = this.max > 10 ? 2 : 1;
    this.pad = 2 * dpr;
    this.barH = Math.round(h * 0.6);
    this.gap = Math.max(1, Math.round(2 * dpr));
    this.segW = (w - this.pad * 2 - this.gap * (this.n - 1)) / this.n;
    // static scale
    this.bg = document.createElement('canvas');
    this.bg.width = w;
    this.bg.height = h;
    const c = this.bg.getContext('2d');
    c.font = `500 ${Math.round(10 * dpr)}px 'IBM Plex Mono', ui-monospace, monospace`;
    c.textBaseline = 'bottom';
    for (let k = 0; k <= this.max; k += labelEvery) {
      const x = this.pad + k * this.per * (this.segW + this.gap) - this.gap / 2;
      c.fillStyle = k >= this.red ? this.col.hot : this.col.muted;
      c.textAlign = k === 0 ? 'left' : k === this.max ? 'right' : 'center';
      c.fillText(String(k), Math.min(w - this.pad, Math.max(this.pad, x)), h);
      c.fillRect(Math.min(w - dpr, Math.max(0, x - dpr / 2)), this.barH + 2 * dpr, dpr, 4 * dpr);
    }
  }

  segColor(i) {
    const v = (i + 1) / this.per; // top of this segment in krpm
    if (v > this.red) return this.col.hot;
    if (v > this.red - 1) return this.col.sig;
    return this.col.ink;
  }

  draw(rpm, dt, limiter) {
    this.resize();
    if (!this.w) return;
    const c = this.ctx;
    const k = rpm / 1000;
    this.shown += (k - this.shown) * Math.min(1, dt * 25);
    if (this.shown >= this.peak) {
      this.peak = this.shown;
      this.peakT = 0;
    } else if ((this.peakT += dt) > 1.2) this.peak = Math.max(this.shown, this.peak - dt * 3);

    c.clearRect(0, 0, this.w, this.h);
    c.drawImage(this.bg, 0, 0);
    const lit = this.shown * this.per;
    // near the redline the whole strip flashes; on the limiter it strobes
    const shift = k > this.red - 0.3;
    const strobe = limiter && performance.now() % 140 < 70;
    for (let i = 0; i < this.n; i++) {
      const x = this.pad + i * (this.segW + this.gap);
      const f = Math.max(0, Math.min(1, lit - i));
      c.fillStyle = this.col.dim;
      c.fillRect(x, 0, this.segW, this.barH);
      if (f > 0 && !strobe) {
        c.fillStyle = shift ? this.col.hot : this.segColor(i);
        const hh = this.barH * (0.35 + 0.65 * f);
        c.fillRect(x, this.barH - hh, this.segW, hh);
      }
    }
    // peak hold
    const pi = Math.min(this.n - 1, Math.floor(this.peak * this.per - 0.001));
    if (pi > 0) {
      c.fillStyle = this.segColor(pi);
      c.fillRect(this.pad + pi * (this.segW + this.gap), 0, this.segW, 3 * this.dpr);
    }
  }
}
