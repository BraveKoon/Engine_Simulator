// Procedural wheel artwork on a 2D canvas. Used both for the wheel-size
// picker images and as the rim texture on the 3D car.

const TAU = Math.PI * 2;

/**
 * Draw a wheel centred in a square canvas.
 * @param {CanvasRenderingContext2D} c
 * @param {number} S canvas size (px)
 * @param {{design:string, inch:number, tyre?:{inch:number,radius:number}, withTyre?:boolean, dark?:boolean}} o
 */
export function drawWheel(c, S, o) {
  const cx = S / 2;
  const cy = S / 2;
  c.clearRect(0, 0, S, S);
  let rimR;
  if (o.withTyre) {
    const R = S * 0.48;
    const rimFrac = o.tyre ? (o.tyre.inch * 0.0254) / 2 / o.tyre.radius : 0.7;
    rimR = R * rimFrac;
    // tyre
    const g = c.createRadialGradient(cx, cy, rimR, cx, cy, R);
    g.addColorStop(0, '#2b2d30');
    g.addColorStop(0.55, '#1a1b1d');
    g.addColorStop(1, '#0d0e0f');
    c.fillStyle = g;
    circle(c, cx, cy, R);
    c.fill();
    // tread blocks
    c.strokeStyle = 'rgba(255,255,255,0.05)';
    c.lineWidth = S * 0.006;
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * TAU;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * R * 0.94, cy + Math.sin(a) * R * 0.94);
      c.lineTo(cx + Math.cos(a) * R * 0.995, cy + Math.sin(a) * R * 0.995);
      c.stroke();
    }
    // sidewall lettering ring
    c.strokeStyle = 'rgba(255,255,255,0.08)';
    c.lineWidth = S * 0.004;
    circle(c, cx, cy, (R + rimR) / 2);
    c.stroke();
    c.save();
    c.fillStyle = 'rgba(235,235,235,0.35)';
    c.font = `700 ${Math.max(8, (R - rimR) * 0.24)}px system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const label = o.tyre ? `${o.tyre.label ?? ''}` : '';
    drawArcText(c, label, cx, cy, (R + rimR) / 2, -Math.PI / 2);
    c.restore();
  } else {
    rimR = S * 0.49;
  }

  // brake disc + caliper visible through the spokes
  if (o.withTyre) {
    c.fillStyle = '#6d7277';
    circle(c, cx, cy, rimR * 0.86);
    c.fill();
    c.strokeStyle = '#555a5f';
    c.lineWidth = rimR * 0.02;
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * TAU;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * rimR * 0.5, cy + Math.sin(a) * rimR * 0.5);
      c.lineTo(cx + Math.cos(a) * rimR * 0.82, cy + Math.sin(a) * rimR * 0.82);
      c.stroke();
    }
    c.fillStyle = '#c63a2c';
    c.save();
    c.translate(cx, cy);
    c.rotate(-0.9);
    roundRect(c, rimR * 0.52, -rimR * 0.22, rimR * 0.3, rimR * 0.44, rimR * 0.08);
    c.fill();
    c.restore();
  }

  const metal = c.createLinearGradient(cx - rimR, cy - rimR, cx + rimR, cy + rimR);
  if (o.dark) {
    metal.addColorStop(0, '#6c7177');
    metal.addColorStop(0.5, '#3d4146');
    metal.addColorStop(1, '#25282b');
  } else {
    metal.addColorStop(0, '#f4f5f6');
    metal.addColorStop(0.45, '#c3c7cb');
    metal.addColorStop(1, '#8c9196');
  }

  // outer lip
  c.fillStyle = metal;
  circle(c, cx, cy, rimR);
  circle(c, cx, cy, rimR * 0.9, true);
  c.fill('evenodd');
  c.strokeStyle = 'rgba(0,0,0,0.35)';
  c.lineWidth = rimR * 0.012;
  circle(c, cx, cy, rimR * 0.9);
  c.stroke();

  c.fillStyle = metal;
  const spokes = DESIGNS[o.design] || DESIGNS.y5;
  spokes(c, cx, cy, rimR, metal);

  // hub, lug nuts, centre cap
  c.fillStyle = metal;
  circle(c, cx, cy, rimR * 0.24);
  c.fill();
  c.strokeStyle = 'rgba(0,0,0,0.3)';
  c.lineWidth = rimR * 0.012;
  c.stroke();
  c.fillStyle = '#4b4f54';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU - Math.PI / 2;
    circle(c, cx + Math.cos(a) * rimR * 0.155, cy + Math.sin(a) * rimR * 0.155, rimR * 0.03);
    c.fill();
  }
  c.fillStyle = '#1d1f22';
  circle(c, cx, cy, rimR * 0.085);
  c.fill();
  c.fillStyle = '#d8dadc';
  circle(c, cx, cy, rimR * 0.04);
  c.fill();
}

const DESIGNS = {
  // plain wheel cover with vents
  steel(c, cx, cy, r) {
    circle(c, cx, cy, r * 0.9);
    c.fill();
    c.fillStyle = 'rgba(30,32,35,0.85)';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      c.save();
      c.translate(cx + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6);
      c.rotate(a);
      roundRect(c, -r * 0.14, -r * 0.05, r * 0.28, r * 0.1, r * 0.05);
      c.fill();
      c.restore();
    }
    c.strokeStyle = 'rgba(0,0,0,0.2)';
    c.lineWidth = r * 0.015;
    circle(c, cx, cy, r * 0.4);
    c.stroke();
  },
  ten(c, cx, cy, r) {
    for (let i = 0; i < 10; i++) spoke(c, cx, cy, r, (i / 10) * TAU, 0.07, 0.045);
  },
  double5(c, cx, cy, r) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      spoke(c, cx, cy, r, a - 0.09, 0.075, 0.05);
      spoke(c, cx, cy, r, a + 0.09, 0.075, 0.05);
    }
  },
  multi(c, cx, cy, r) {
    for (let i = 0; i < 15; i++) spoke(c, cx, cy, r, (i / 15) * TAU, 0.05, 0.03);
  },
  y5(c, cx, cy, r) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      spoke(c, cx, cy, r, a, 0.1, 0.06, 0.55);
      forkSpoke(c, cx, cy, r, a, 0.22);
      forkSpoke(c, cx, cy, r, a, -0.22);
    }
  },
  mesh(c, cx, cy, r) {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      spoke(c, cx, cy, r, a, 0.06, 0.035);
    }
    c.save();
    c.lineWidth = r * 0.035;
    c.strokeStyle = c.fillStyle;
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * TAU;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r * 0.4, cy + Math.sin(a) * r * 0.4);
      c.lineTo(cx + Math.cos(a + 0.33) * r * 0.88, cy + Math.sin(a + 0.33) * r * 0.88);
      c.moveTo(cx + Math.cos(a) * r * 0.4, cy + Math.sin(a) * r * 0.4);
      c.lineTo(cx + Math.cos(a - 0.33) * r * 0.88, cy + Math.sin(a - 0.33) * r * 0.88);
      c.stroke();
    }
    c.restore();
  },
  turbine(c, cx, cy, r) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * r * 0.22, cy + Math.sin(a) * r * 0.22);
      c.quadraticCurveTo(
        cx + Math.cos(a + 0.35) * r * 0.55,
        cy + Math.sin(a + 0.35) * r * 0.55,
        cx + Math.cos(a + 0.55) * r * 0.9,
        cy + Math.sin(a + 0.55) * r * 0.9,
      );
      c.lineTo(cx + Math.cos(a + 0.8) * r * 0.9, cy + Math.sin(a + 0.8) * r * 0.9);
      c.quadraticCurveTo(
        cx + Math.cos(a + 0.55) * r * 0.5,
        cy + Math.sin(a + 0.55) * r * 0.5,
        cx + Math.cos(a + 0.4) * r * 0.22,
        cy + Math.sin(a + 0.4) * r * 0.22,
      );
      c.closePath();
      c.fill();
    }
  },
  forged6(c, cx, cy, r) {
    for (let i = 0; i < 6; i++) spoke(c, cx, cy, r, (i / 6) * TAU, 0.16, 0.1);
  },
};

// Tapered spoke from hub to rim at angle a (half widths as fraction of r).
function spoke(c, cx, cy, r, a, wHub, wRim, reach = 0.9) {
  const p = (rad, off) => [cx + Math.cos(a) * rad * r - Math.sin(a) * off * r, cy + Math.sin(a) * rad * r + Math.cos(a) * off * r];
  const pts = [p(0.2, -wHub), p(reach, -wRim), p(reach, wRim), p(0.2, wHub)];
  c.beginPath();
  c.moveTo(...pts[0]);
  pts.slice(1).forEach((q) => c.lineTo(...q));
  c.closePath();
  c.fill();
}

function forkSpoke(c, cx, cy, r, a, spread) {
  const s = [cx + Math.cos(a) * r * 0.52, cy + Math.sin(a) * r * 0.52];
  const e = [cx + Math.cos(a + spread) * r * 0.9, cy + Math.sin(a + spread) * r * 0.9];
  c.save();
  c.strokeStyle = c.fillStyle;
  c.lineWidth = r * 0.08;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(...s);
  c.lineTo(...e);
  c.stroke();
  c.restore();
}

function circle(c, x, y, r, ccw = false) {
  if (!ccw) c.beginPath();
  c.moveTo(x + r, y);
  c.arc(x, y, r, 0, TAU, ccw);
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

function drawArcText(c, text, cx, cy, radius, start) {
  if (!text) return;
  const chars = [...text];
  const step = 0.07;
  let a = start - (step * (chars.length - 1)) / 2;
  for (const ch of chars) {
    c.save();
    c.translate(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    c.rotate(a + Math.PI / 2);
    c.fillText(ch, 0, 0);
    c.restore();
    a += step;
  }
}

/** Render to a data URL (for <img>). */
export function wheelImage(opts, size = 240) {
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  drawWheel(cv.getContext('2d'), size, { ...opts, withTyre: true });
  return cv.toDataURL('image/png');
}

/** Canvas holding only the rim face (transparent between spokes). */
export function rimCanvas(design, dark = false, size = 512) {
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  drawWheel(cv.getContext('2d'), size, { design, dark, withTyre: false });
  return cv;
}
