import { torqueCurve } from './engines.js';

const TAU = Math.PI * 2;
const RPM = 60 / TAU; // rad/s -> rpm
const G = 9.81;
const DEFAULT_WHEEL_R = 0.33;
const DRIVELINE_EFF = 0.9;

export const GEAR_LABEL = { '-1': 'R', 0: 'N', 1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6' };

/**
 * Engine + clutch + gearbox + vehicle longitudinal model.
 * Fixed-step integration (call update(dt) with frame time; it substeps).
 */
export class Simulator {
  /**
   * @param engine engine spec from engines.js
   * @param car optional vehicle overrides { mass, wheelR, cda, final }
   */
  constructor(engine, car = {}) {
    this.e = engine;
    this.mass = car.mass ?? engine.mass;
    this.wheelR = car.wheelR ?? DEFAULT_WHEEL_R;
    this.cda = car.cda ?? 0.68;
    this.final = car.final ?? engine.final;
    this.reset();
  }

  reset() {
    this.omega = 0; // engine speed, rad/s
    this.crank = 0; // accumulated crank angle, rad
    this.v = 0; // vehicle speed, m/s (negative = reversing)
    this.gear = 0;
    this.running = false;
    this.starting = false;
    this.starterT = 0;
    this.throttleIn = 0; // pedal targets 0..1
    this.brakeIn = 0;
    this.throttle = 0; // actual (rate limited)
    this.brake = 0;
    this.clutch = 0; // 0 open .. 1 closed (automatic)
    this.locked = false;
    this.shiftT = 0;
    this.limiter = false;
    this.boost = 0;
    this.load = 0; // combustion load 0..1 for audio
    this.idleI = 0;
    this.distance = 0;
    this.events = []; // UI notifications
  }

  get rpm() {
    return this.omega * RPM;
  }

  get speedKmh() {
    return Math.abs(this.v) * 3.6;
  }

  emit(type, msg) {
    this.events.push({ type, msg });
  }

  toggleEngine() {
    if (this.running || this.starting) this.stop();
    else this.start();
  }

  start() {
    if (this.running || this.starting) return;
    this.starting = true;
    this.starterT = 0;
    this.emit('start');
  }

  stop() {
    this.running = false;
    this.starting = false;
    this.emit('stop');
  }

  /** Try to select gear g (-1 = R, 0 = N, 1..6). Returns true on success. */
  setGear(g) {
    if (g === this.gear) return true;
    if (g === -1 && this.v > 1.5) {
      this.emit('warn', '전진 중에는 후진 기어를 넣을 수 없어요');
      return false;
    }
    if (g > 0 && this.v < -1.5) {
      this.emit('warn', '후진 중에는 전진 기어를 넣을 수 없어요');
      return false;
    }
    this.gear = g;
    this.locked = false;
    this.clutch = 0;
    this.shiftT = g === 0 ? 0 : 0.12;
    return true;
  }

  ratio(g = this.gear) {
    if (g === 0) return 0;
    if (g === -1) return -3.3 * this.final;
    return this.e.gears[g - 1] * this.final;
  }

  update(dt) {
    dt = Math.min(dt, 0.05);
    const h = 1 / 480;
    let t = dt;
    while (t > 1e-6) {
      const s = Math.min(h, t);
      this.step(s);
      t -= s;
    }
  }

  engineTorque(dt) {
    const e = this.e;
    const rpm = this.rpm;
    const Tmax = e.maxTorque;

    // Starter motor
    let starter = 0;
    if (this.starting) {
      this.starterT += dt;
      starter = Tmax * 0.2 * Math.max(0, 1 - rpm / 420);
      if (this.starterT > 0.55 && rpm > 240) {
        this.starting = false;
        this.running = true;
        this.idleI = 0.05;
        this.emit('running');
      }
    }

    // Rev limiter (fuel cut with hysteresis)
    if (rpm > e.redline + 40) this.limiter = true;
    else if (rpm < e.redline - 180) this.limiter = false;

    // Idle speed controller
    let thr = this.throttle;
    if (this.running) {
      const err = (e.idle - rpm) / e.idle;
      this.idleI = Math.min(0.12, Math.max(0, this.idleI + err * dt * 0.8));
      const idleThr = Math.min(0.35, Math.max(0, 0.03 + err * 0.9 + this.idleI));
      thr = Math.max(thr, idleThr);
    }

    // Turbo spool
    if (e.turbo) {
      const target = this.running ? smooth((thr - 0.25) / 0.6) * smooth((rpm - 1100) / 2200) : 0;
      const tc = target > this.boost ? 0.45 + 0.1 * e.turbo : 0.12;
      const prev = this.boost;
      this.boost += (target - this.boost) * Math.min(1, dt / tc);
      if (prev > 0.55 && this.throttle < 0.1 && this.lastThrottle > 0.4) {
        this.emit('bov');
      }
    }
    this.lastThrottle = this.throttle;

    let comb = 0;
    const fire = this.running && !this.limiter;
    if (fire) {
      // part throttle needs no boost; full load is limited by boost pressure
      const avail = e.turbo ? 0.5 + 0.5 * this.boost : 1;
      comb = Math.min(thr, avail) * Tmax * torqueCurve(e, rpm);
    }
    this.load = fire ? thr * (e.turbo ? 0.6 + 0.4 * this.boost : 1) : 0;

    const x = rpm / e.redline;
    const friction = Tmax * (0.025 + 0.05 * x + 0.03 * x * x);
    const pumping = (1 - thr) * Tmax * 0.06 * x * (this.running ? 1 : 0.5);
    const drag = this.omega > 0.5 ? friction + pumping : this.omega * 20;
    return comb + starter - drag;
  }

  step(dt) {
    const e = this.e;
    // Pedals ramp (hydraulic / throttle-body response)
    this.throttle += clampAbs(this.throttleIn - this.throttle, dt * 9);
    this.brake += clampAbs(this.brakeIn - this.brake, dt * 7);

    const Te = this.engineTorque(dt);
    const Je = e.inertia;
    const m = this.mass;
    const ratio = this.ratio();

    // Automatic clutch
    let clutchTarget = 0;
    if (this.gear !== 0) {
      if (this.shiftT > 0) {
        this.shiftT -= dt;
      } else if (this.locked) {
        clutchTarget = 1;
      } else {
        const rpm = this.rpm;
        // launch control: higher throttle holds higher rpm while slipping
        const bite = e.idle + 150 + this.throttle * Math.min(2600, e.redline * 0.3);
        // slip controller: pass the engine's torque through while holding it near the bite rpm
        const maxCap = e.maxTorque * 1.8;
        const launch = Math.max(0, Math.min(1, (Te + (e.maxTorque / 600) * (rpm - bite)) / maxCap));
        const synced = Math.abs(this.omega - (this.v / this.wheelR) * ratio) < 40 && rpm > e.idle * 1.05;
        clutchTarget = synced ? 1 : this.throttle > 0.02 ? launch : 0;
        if (Math.abs(this.v) > 3) clutchTarget = Math.max(clutchTarget, 0.8 * smooth((this.rpm - e.idle * 0.9) / 400));
        // anti-stall: let the engine recover when it is being dragged down
        if (!synced && rpm < e.idle * 0.92) clutchTarget = 0;
      }
    }
    this.clutch += clampAbs(clutchTarget - this.clutch, dt * (clutchTarget > this.clutch ? 5 : 20));
    const cap = this.clutch * e.maxTorque * 1.8;

    // Road loads
    const rolling = 0.013 * m * G;
    const aero = 0.5 * 1.2 * this.cda * this.v * this.v;
    const Fres = Math.abs(this.v) > 0.01 ? Math.sign(this.v) * (rolling + aero) : 0;
    const Fbrake = this.brake * 1.05 * m * G;

    if (this.gear !== 0 && this.locked) {
      if (this.clutch < 0.95 || this.rpm < e.idle * 0.82 || !isFinite(ratio)) {
        this.locked = false;
      }
    }

    if (this.gear !== 0 && this.locked) {
      const k = ratio / this.wheelR;
      const meff = m + Je * k * k;
      const Fdrive = Te * k * DRIVELINE_EFF;
      const a = this.vehicleAccel(Fdrive - Fres, Fbrake, meff, dt);
      this.v += a * dt;
      const newOmega = this.v * k;
      // Torque the clutch must carry to stay locked
      const Tc = Te - Je * ((newOmega - this.omega) / dt);
      this.omega = newOmega;
      if (Math.abs(Tc) > cap * 1.05) this.locked = false;
    } else {
      let Tc = 0;
      if (this.gear !== 0 && cap > 0) {
        const k = ratio / this.wheelR;
        const slip = this.omega - this.v * k;
        // Damped clutch torque that cannot overshoot the slip in one step.
        const meffInv = 1 / Je + (k * k) / m;
        const Tsync = (slip / dt + Te / Je) / meffInv;
        Tc = Math.max(-cap, Math.min(cap, Tsync));
        if (Math.abs(slip) < 3 && this.clutch > 0.98 && this.rpm > e.idle * 0.9) this.locked = true;
        const Fdrive = Tc * k * DRIVELINE_EFF;
        const a = this.vehicleAccel(Fdrive - Fres, Fbrake, m, dt);
        this.v += a * dt;
      } else {
        const a = this.vehicleAccel(-Fres, Fbrake, m, dt);
        this.v += a * dt;
      }
      this.omega += ((Te - Tc) / Je) * dt;
    }

    // Engine speed bounds
    const maxOmega = (e.redline * 1.3) / RPM;
    if (this.omega > maxOmega) this.omega = maxOmega;
    if (this.omega < 0) this.omega = 0;
    if (!this.running && !this.starting && this.omega < 3) this.omega = Math.max(0, this.omega - 30 * dt);

    // Stall
    if (this.running && this.rpm < 200) {
      this.running = false;
      this.locked = false;
      this.emit('warn', '엔진이 꺼졌어요 (시동 꺼짐)');
      this.emit('stop');
    }

    this.crank += this.omega * dt;
    this.distance += Math.abs(this.v) * dt;
  }

  // Longitudinal acceleration with a brake that holds the car at standstill.
  vehicleAccel(Fnet, Fbrake, meff, dt) {
    if (Math.abs(this.v) < 0.05) {
      if (Math.abs(Fnet) <= Fbrake) {
        this.v = 0;
        return 0;
      }
      return (Fnet - Math.sign(Fnet) * Fbrake) / meff;
    }
    const a = (Fnet - Math.sign(this.v) * Fbrake) / meff;
    // prevent the brake from reversing the car
    if (Math.sign(this.v + a * dt) !== Math.sign(this.v) && Math.abs(Fnet) <= Fbrake) {
      this.v = 0;
      return 0;
    }
    return a;
  }
}

function clampAbs(x, lim) {
  return x > lim ? lim : x < -lim ? -lim : x;
}

function smooth(t) {
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
}
