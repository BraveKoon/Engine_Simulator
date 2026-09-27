// Canvas tachometer styled like a classic analogue dial.
export class Tachometer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.max = 8;
    this.red = 7;
    this.value = 0;
    this.shown = 0;
    this.flash = false;
    this.size = 0;
  }

  configure(redline) {
    this.red = redline / 1000;
    this.max = Math.ceil(redline / 1000 + 0.6);
    this.size = 0; // force background redraw
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = Math.round(Math.min(r.width, r.height) * dpr);
    if (size && size !== this.size) {
      this.size = size;
      this.canvas.width = size;
      this.canvas.height = size;
      this.bg = document.createElement('canvas');
      this.bg.width = size;
      this.bg.height = size;
      this.drawFace(this.bg.getContext('2d'), size);
    }
  }

  angle(v) {
    const t = Math.max(0, Math.min(1.04, v / this.max));
    return (135 + t * 270) * (Math.PI / 180);
  }

  drawFace(c, S) {
    const cx = S / 2;
    const cy = S / 2;
    const R = S / 2;
    c.clearRect(0, 0, S, S);
    // bezel
    const bez = c.createRadialGradient(cx, cy - R * 0.3, R * 0.2, cx, cy, R);
    bez.addColorStop(0, '#4a4f55');
    bez.addColorStop(1, '#16181b');
    c.fillStyle = bez;
    c.beginPath();
    c.arc(cx, cy, R * 0.99, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#0d0f11';
    c.beginPath();
    c.arc(cx, cy, R * 0.9, 0, Math.PI * 2);
    c.fill();
    // red zone
    c.strokeStyle = '#e8553b';
    c.lineWidth = R * 0.07;
    c.beginPath();
    c.arc(cx, cy, R * 0.8, this.angle(this.red), this.angle(this.max));
    c.stroke();
    // ticks
    for (let i = 0; i <= this.max * 5; i++) {
      const v = i / 5;
      const a = this.angle(v);
      const major = i % 5 === 0;
      const r0 = R * (major ? 0.7 : 0.76);
      const r1 = R * 0.84;
      c.strokeStyle = v >= this.red ? '#ff6a4d' : '#e9ecef';
      c.lineWidth = major ? R * 0.028 : R * 0.012;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      c.stroke();
      if (major) {
        c.fillStyle = v >= this.red ? '#ff7a5c' : '#f1f3f5';
        c.font = `600 ${Math.round(R * 0.15)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(String(v), cx + Math.cos(a) * R * 0.56, cy + Math.sin(a) * R * 0.56);
      }
    }
    c.fillStyle = '#c3c8cd';
    c.font = `500 ${Math.round(R * 0.095)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    c.fillText('RPM ×1000', cx, cy - R * 0.34);
    c.fillStyle = '#9aa1a8';
    c.fillText('rpm', cx, cy + R * 0.72);
  }

  draw(rpm, dt, limiter) {
    this.resize();
    if (!this.size) return;
    const S = this.size;
    const c = this.ctx;
    const R = S / 2;
    const cx = R;
    const cy = R;
    // needle has a little inertia
    const target = rpm / 1000;
    this.shown += (target - this.shown) * Math.min(1, dt * 22);
    c.clearRect(0, 0, S, S);
    c.drawImage(this.bg, 0, 0);

    // shift light glow
    if (rpm / 1000 > this.red - 0.35) {
      const on = limiter ? (performance.now() % 120) < 60 : true;
      if (on) {
        c.strokeStyle = 'rgba(255,90,60,0.55)';
        c.lineWidth = R * 0.05;
        c.beginPath();
        c.arc(cx, cy, R * 0.93, 0, Math.PI * 2);
        c.stroke();
      }
    }

    // digital readout
    const bw = R * 0.9;
    const bh = R * 0.3;
    c.fillStyle = '#1f2326';
    c.strokeStyle = '#3b4146';
    c.lineWidth = R * 0.02;
    roundRect(c, cx - bw / 2, cy + R * 0.3, bw, bh, R * 0.08);
    c.fill();
    c.stroke();
    c.fillStyle = '#f4f6f7';
    c.font = `600 ${Math.round(R * 0.2)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(Math.round(rpm).toLocaleString('en-US'), cx, cy + R * 0.3 + bh / 2 + R * 0.01);

    // needle
    const a = this.angle(this.shown);
    c.save();
    c.translate(cx, cy);
    c.rotate(a);
    c.shadowColor = 'rgba(0,0,0,0.5)';
    c.shadowBlur = R * 0.05;
    c.fillStyle = '#ff6b3d';
    c.beginPath();
    c.moveTo(-R * 0.14, -R * 0.025);
    c.lineTo(R * 0.8, -R * 0.008);
    c.lineTo(R * 0.8, R * 0.008);
    c.lineTo(-R * 0.14, R * 0.025);
    c.closePath();
    c.fill();
    c.restore();
    c.fillStyle = '#2b2f33';
    c.beginPath();
    c.arc(cx, cy, R * 0.085, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#6c737a';
    c.beginPath();
    c.arc(cx, cy, R * 0.04, 0, Math.PI * 2);
    c.fill();
  }
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
