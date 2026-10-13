/**
 * Entrada del jugador: teclado (WASD / flechas), mando (Gamepad API) y
 * controles táctiles. Produce un estado normalizado que consume el vehículo.
 */
export class InputController {
  constructor(target = window) {
    this.keys = new Set();
    this.touch = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    this.actions = new Set();
    this.smoothedSteer = 0;
    this.onKeyDown = (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.code;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(k)) e.preventDefault();
      if (!this.keys.has(k)) {
        if (k === 'KeyR') this.actions.add('reset');
        if (k === 'KeyC') this.actions.add('camera');
        if (k === 'KeyM') this.actions.add('mute');
      }
      this.keys.add(k);
    };
    this.onKeyUp = (e) => this.keys.delete(e.code);
    this.onBlur = () => this.keys.clear();
    this.target = target;
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  /** Acciones de un solo disparo (reset, cámara, silencio) desde el último frame. */
  consumeActions() {
    const a = [...this.actions];
    this.actions.clear();
    return a;
  }

  read(dt) {
    const k = this.keys;
    let throttle = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    let brake = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    let steerTarget = (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0);
    let handbrake = k.has('Space');

    const pad = navigator.getGamepads?.().find((g) => g && g.connected);
    if (pad) {
      const axis = pad.axes[0] ?? 0;
      if (Math.abs(axis) > 0.12) steerTarget = -axis;
      throttle = Math.max(throttle, pad.buttons[7]?.value ?? 0);
      brake = Math.max(brake, pad.buttons[6]?.value ?? 0);
      handbrake = handbrake || Boolean(pad.buttons[0]?.pressed);
    }
    throttle = Math.max(throttle, this.touch.throttle);
    brake = Math.max(brake, this.touch.brake);
    handbrake = handbrake || this.touch.handbrake > 0;
    if (this.touch.steer) steerTarget = this.touch.steer;

    // El teclado es digital: suavizar para que la dirección no sea brusca.
    const rate = dt * (steerTarget === 0 ? 7 : 5);
    this.smoothedSteer += Math.max(-rate, Math.min(rate, steerTarget - this.smoothedSteer));
    return { throttle, brake, steer: this.smoothedSteer, handbrake };
  }

  dispose() {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
