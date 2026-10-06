// Procedural engine sound: an AudioWorklet fires a combustion pulse for every
// cylinder event (from the real firing offsets), then runs it through exhaust
// resonators, saturation and an rpm/load-dependent low-pass.

const WORKLET = /* js */ `
class Biquad {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0; }
  bandpass(f, q, sr) {
    const w = 2 * Math.PI * Math.min(f, sr * 0.45) / sr, al = Math.sin(w) / (2 * q), a0 = 1 + al;
    this.b0 = al / a0; this.b1 = 0; this.b2 = -al / a0; this.a1 = -2 * Math.cos(w) / a0; this.a2 = (1 - al) / a0;
  }
  lowpass(f, q, sr) {
    const w = 2 * Math.PI * Math.min(f, sr * 0.45) / sr, al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al;
    this.b0 = (1 - c) / 2 / a0; this.b1 = (1 - c) / a0; this.b2 = this.b0; this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y;
  }
}

class EngineProc extends AudioWorkletProcessor {
  constructor() {
    super();
    this.rpm = 0; this.tRpm = 0; this.load = 0; this.tLoad = 0; this.fire = false;
    this.starter = false; this.boost = 0; this.tBoost = 0; this.vol = 0.8;
    this.phase = 0; this.events = [0]; this.amp = [1]; this.pulses = [];
    this.res = []; this.resGain = []; this.lp = new Biquad(); this.lp2 = new Biquad();
    this.dc = 0; this.bov = 0; this.bovLp = new Biquad(); this.rasp = 0.4; this.gain = 1;
    this.whine = 0; this.starterPh = 0; this.noiseLp = 0; this.counter = 0; this.lastIdx = 0;
    this.port.onmessage = (ev) => {
      const d = ev.data;
      if (d.type === 'engine' && d.electric) {
        this.electric = true; this.pulses = []; this.events = [];
        this.evLp = new Biquad(); this.evLp.lowpass(2400, 0.7, sampleRate);
        this.ph1 = 0; this.ph2 = 0; this.ph3 = 0; this.ph4 = 0;
      } else if (d.type === 'engine') {
        this.electric = false;
        const order = d.fire.map((f, i) => ({ f, i })).sort((a, b) => a.f - b.f);
        this.events = order.map((o) => o.f);
        this.amp = order.map((o) => 1 - (d.imbalance[o.i] || 0));
        this.res = d.formants.map(() => new Biquad());
        d.formants.forEach((f, i) => this.res[i].bandpass(f, i === 0 ? 1.6 : 2.4, sampleRate));
        this.resGain = d.formants.map((_, i) => [1.4, 0.9, 0.45][i] || 0.3);
        this.rasp = d.rasp; this.gain = d.gain; this.phase = 0; this.lastIdx = 0;
        this.bovLp.bandpass(2600, 0.8, sampleRate);
      } else if (d.type === 'state') {
        this.tRpm = d.rpm; this.tLoad = d.load; this.fire = d.fire; this.starter = d.starter;
        this.tBoost = d.boost; this.vol = d.vol;
      } else if (d.type === 'bov') {
        this.bov = 1;
      }
    };
  }
  process(_in, outputs) {
    const out = outputs[0][0];
    if (!out) return true;
    const sr = sampleRate;
    const n = this.events.length;
    if (this.electric) {
      for (let s = 0; s < out.length; s++) {
        this.rpm += (this.tRpm - this.rpm) * 0.004;
        this.load += (this.tLoad - this.load) * 0.003;
        const f = this.rpm / 60;
        const moving = Math.min(1, this.rpm / 400);
        const on = this.fire ? 1 : 0;
        // motor: pole-pass whine, reduction-gear mesh, inverter switching, soft ready hum
        this.ph1 += 2 * Math.PI * f * 4 / sr;
        this.ph2 += 2 * Math.PI * f * 13 / sr;
        this.ph3 += 2 * Math.PI * (f * 1.5 + 40) / sr;
        this.ph4 += 2 * Math.PI * (2600 + this.load * 900) / sr;
        if (this.ph1 > 1e4) { this.ph1 %= 2 * Math.PI; this.ph2 %= 2 * Math.PI; this.ph3 %= 2 * Math.PI; this.ph4 %= 2 * Math.PI; }
        let y = Math.sin(this.ph1) * 0.11 * (0.25 + 0.75 * this.load) * moving * on;
        y += Math.sin(this.ph2) * 0.035 * (0.3 + this.load) * moving;
        y += Math.sin(this.ph3) * 0.05 * (0.4 + 0.6 * this.load) * on;
        y += Math.sin(this.ph4) * 0.012 * this.load * on;
        // tyre / wind roar grows with speed
        const noise = Math.random() * 2 - 1;
        this.noiseLp += (noise - this.noiseLp) * 0.04;
        y += this.evLp.run(this.noiseLp) * Math.min(1, f / 220) * 0.6;
        y = Math.tanh(y * 2) * 0.7;
        out[s] = y * this.vol;
      }
      for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
      return true;
    }
    for (let s = 0; s < out.length; s++) {
      this.rpm += (this.tRpm - this.rpm) * 0.002;
      this.load += (this.tLoad - this.load) * 0.0015;
      this.boost += (this.tBoost - this.boost) * 0.0008;
      if ((this.counter++ & 63) === 0) {
        const cut = 500 + this.rpm * 0.45 + this.load * 2600;
        this.lp.lowpass(cut, 0.8, sr); this.lp2.lowpass(cut * 1.6, 0.6, sr);
      }
      // crank phase in degrees of a 720° cycle
      const dPh = (this.rpm / 60) * 720 / sr;
      const prev = this.phase;
      this.phase += dPh;
      if (this.phase >= 720) this.phase -= 720;
      // trigger pulses whose firing angle we crossed
      if (dPh > 0) {
        for (let k = 0; k < n; k++) {
          const f = this.events[k];
          const crossed = prev <= this.phase ? (f > prev && f <= this.phase) : (f > prev || f <= this.phase);
          if (crossed) {
            const jitter = 0.9 + Math.random() * 0.2;
            const a = this.fire ? (0.18 + 0.82 * this.load) * this.amp[k] * jitter : 0.05 * this.amp[k];
            const period = 60 / Math.max(this.rpm, 200) * 2 / n;
            this.pulses.push({ t: 0, a, tau: Math.min(0.006, period * 0.45) + 0.0006, noise: this.fire ? this.rasp * (0.3 + this.load) : 0.1 });
          }
        }
      }
      let x = 0;
      for (let p = this.pulses.length - 1; p >= 0; p--) {
        const pu = this.pulses[p];
        const t = pu.t;
        const env = Math.exp(-t / pu.tau) - Math.exp(-t / (pu.tau * 0.18));
        x += pu.a * env * (1 + pu.noise * (Math.random() * 2 - 1));
        pu.t += 1 / sr;
        if (pu.t > pu.tau * 8) this.pulses.splice(p, 1);
      }
      // exhaust resonators
      let y = x * 0.35;
      for (let r = 0; r < this.res.length; r++) y += this.res[r].run(x) * this.resGain[r];
      y = this.lp2.run(this.lp.run(y));
      // intake roar
      const noise = Math.random() * 2 - 1;
      this.noiseLp += (noise - this.noiseLp) * (0.05 + this.load * 0.1);
      y += this.noiseLp * this.load * (this.rpm / 9000) * 0.5;
      // turbo whistle
      if (this.boost > 0.01) {
        this.whine += 2 * Math.PI * (1800 + this.boost * 5200 + this.rpm * 0.2) / sr;
        y += Math.sin(this.whine) * this.boost * 0.035;
      }
      // blow-off valve
      if (this.bov > 0.001) {
        y += this.bovLp.run(noise) * this.bov * 0.9;
        this.bov *= 0.99985;
      }
      // starter motor
      if (this.starter) {
        this.starterPh += 2 * Math.PI * 38 / sr;
        y += (Math.sin(this.starterPh) > 0 ? 0.12 : -0.12) * (0.6 + 0.4 * Math.sin(this.starterPh * 0.13)) + noise * 0.02;
      }
      // saturation + DC block
      y = Math.tanh(y * 2.2 * this.gain) * 0.7;
      this.dc += (y - this.dc) * 0.001;
      out[s] = (y - this.dc) * this.vol;
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    return true;
  }
}
registerProcessor('engine-proc', EngineProc);
`;

export class EngineAudio {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.volume = 0.7;
    this.muted = false;
    this.pendingEngine = null;
    this.ready = false;
  }

  async init() {
    if (this.ctx) {
      if (this.ctx.state !== 'running') await this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx({ latencyHint: 'interactive' });
    try {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      await this.ctx.audioWorklet.addModule(url);
      this.node = new AudioWorkletNode(this.ctx, 'engine-proc', { outputChannelCount: [2] });
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.ratio.value = 4;
      this.node.connect(comp).connect(this.ctx.destination);
      this.ready = true;
      if (this.pendingEngine) this.setEngine(this.pendingEngine);
    } catch (err) {
      console.warn('Audio unavailable', err);
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  setEngine(e) {
    this.pendingEngine = e;
    if (!this.ready) return;
    if (e.electric) {
      this.node.port.postMessage({ type: 'engine', electric: true });
      return;
    }
    this.node.port.postMessage({
      type: 'engine',
      fire: e.cylinders.map((c) => c.fire),
      imbalance: e.sound.imbalance,
      formants: e.sound.formants,
      rasp: e.sound.rasp,
      gain: e.sound.gain,
    });
  }

  update(sim) {
    if (!this.ready) return;
    this.node.port.postMessage({
      type: 'state',
      rpm: sim.rpm,
      load: sim.load,
      fire: sim.running && !sim.limiter,
      starter: sim.starting && !sim.e.electric,
      boost: sim.e.turbo ? sim.boost : 0,
      vol: this.muted ? 0 : this.volume,
    });
  }

  silence() {
    if (!this.ready) return;
    this.node.port.postMessage({ type: 'state', rpm: 0, load: 0, fire: false, starter: false, boost: 0, vol: 0 });
  }

  blowOff() {
    if (this.ready) this.node.port.postMessage({ type: 'bov' });
  }
}
