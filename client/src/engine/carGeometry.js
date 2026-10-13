/** Medidas comunes al modelo visual y a las físicas de un coche. */
export function carDimensions(def) {
  const { length, width, height } = def.body;
  return {
    length,
    width,
    height,
    wheelBase: length * 0.62,
    halfTrack: width * 0.43,
    wheelRadius: def.body.wheelRadius ?? 0.36,
    suspensionRest: 0.32,
    connectionY: -0.05,
    /** Altura del suelo respecto al origen del chasis con el coche en reposo. */
    visualOffsetY: -0.68,
  };
}
