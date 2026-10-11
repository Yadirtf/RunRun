// Entrada unificada: teclado, mando (Gamepad API) y controles táctiles.
// Devuelve valores analógicos suavizados: throttle/brake 0..1, steer -1..1 (positivo = derecha).

const KEYS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
  reset: ['KeyR'],
  camera: ['KeyC'],
  mute: ['KeyM'],
};

export class Input {
  constructor() {
    this.pressed = new Set();
    this.touch = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.onceHandlers = { reset: [], camera: [], mute: [] };
    this.prevPadButtons = [];

    this.onKeyDown = (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (Object.values(KEYS).flat().includes(e.code)) e.preventDefault();
      if (!e.repeat) {
        for (const action of ['reset', 'camera', 'mute']) {
          if (KEYS[action].includes(e.code)) this.onceHandlers[action].forEach((fn) => fn());
        }
      }
      this.pressed.add(e.code);
    };
    this.onKeyUp = (e) => this.pressed.delete(e.code);
    this.onBlur = () => this.pressed.clear();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  on(action, fn) { this.onceHandlers[action].push(fn); }

  #key(action) { return KEYS[action].some((k) => this.pressed.has(k)); }

  #gamepad() {
    const pads = navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const dead = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
      const btn = (i) => pad.buttons[i]?.value ?? 0;
      const pressedNow = pad.buttons.map((b) => b.pressed);
      const edge = (i) => pressedNow[i] && !this.prevPadButtons[i];
      if (edge(3)) this.onceHandlers.reset.forEach((fn) => fn()); // Y / Triángulo
      if (edge(4) || edge(5)) this.onceHandlers.camera.forEach((fn) => fn()); // LB/RB
      this.prevPadButtons = pressedNow;
      return {
        throttle: Math.max(btn(7), btn(0)), // RT o A
        brake: Math.max(btn(6), btn(2)), // LT o X
        steer: dead(pad.axes[0] ?? 0),
        handbrake: btn(1) > 0.5, // B / Círculo
      };
    }
    return null;
  }

  /** Lee la entrada del frame. Las teclas se suavizan para simular un pedal/volante. */
  read(dt) {
    const pad = this.#gamepad();
    const kThrottle = this.#key('up') ? 1 : 0;
    const kBrake = this.#key('down') ? 1 : 0;
    const kSteer = (this.#key('right') ? 1 : 0) - (this.#key('left') ? 1 : 0);

    const s = this.state;
    const approach = (cur, target, up, down) => {
      const rate = (target > cur ? up : down) * dt;
      return cur + Math.max(-rate, Math.min(rate, target - cur));
    };
    s.throttle = approach(s.throttle, kThrottle, 4, 7);
    s.brake = approach(s.brake, kBrake, 6, 9);
    const steerTarget = kSteer;
    const returning = Math.sign(steerTarget) !== Math.sign(s.steer) || steerTarget === 0;
    s.steer = approach(s.steer, steerTarget, returning ? 6 : 3, returning ? 6 : 3);
    s.handbrake = this.#key('handbrake');

    const out = { throttle: s.throttle, brake: s.brake, steer: s.steer, handbrake: s.handbrake };
    if (pad) {
      out.throttle = Math.max(out.throttle, pad.throttle);
      out.brake = Math.max(out.brake, pad.brake);
      if (Math.abs(pad.steer) > Math.abs(out.steer)) out.steer = pad.steer;
      out.handbrake ||= pad.handbrake;
    }
    const t = this.touch;
    out.throttle = Math.max(out.throttle, t.throttle);
    out.brake = Math.max(out.brake, t.brake);
    if (Math.abs(t.steer) > Math.abs(out.steer)) out.steer = t.steer;
    out.handbrake ||= t.handbrake;
    return out;
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
