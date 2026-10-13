// Color dominante de una imagen para el modo ambiente. Código puro: lo usa la ventana de captura
// (como script clásico, expone `globalThis.HubColor`) y los tests (como módulo CommonJS).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HubColor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const SAT_BOOST = 1.7;   // intensifica la saturación del color resultante
  const SAT_FLOOR = 0.12;  // por debajo de esto (imagen casi gris) se mantiene luz blanca
  const BLACK = { r: 255, g: 180, b: 110 }; // pantalla negra: tono cálido tenue

  // Promedio ponderado que favorece píxeles saturados y brillantes (un gris o negro casi no aporta),
  // más el nivel de brillo general. `data` es RGBA (Uint8ClampedArray de getImageData).
  function dominant(data) {
    let wr = 0, wg = 0, wb = 0, wsum = 0, luma = 0;
    const pixels = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const v = max / 255;
      const s = max ? (max - min) / max : 0;
      const w = v * (0.05 + s * s * 6);
      wr += r * w; wg += g * w; wb += b * w; wsum += w;
      luma += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    const level = pixels ? Math.sqrt(luma / pixels / 255) : 0; // sqrt: escenas oscuras no apagan del todo
    if (wsum < 1e-3) return { ...BLACK, level };
    return { ...saturate(normalize(wr / wsum, wg / wsum, wb / wsum)), level };
  }

  // Lleva el color a intensidad máxima: el brillo lo maneja el `dimming` de la lámpara.
  function normalize(r, g, b) {
    const m = Math.max(r, g, b) || 1;
    return { r: (r / m) * 255, g: (g / m) * 255, b: (b / m) * 255 };
  }

  // Aleja cada canal del máximo manteniendo el tono (más saturado).
  function saturate({ r, g, b }) {
    const sat = (255 - Math.min(r, g, b)) / 255;
    if (sat > SAT_FLOOR) {
      const k = Math.min(1, sat * SAT_BOOST) / sat;
      r = 255 - (255 - r) * k; g = 255 - (255 - g) * k; b = 255 - (255 - b) * k;
    }
    return { r: Math.max(0, r), g: Math.max(0, g), b: Math.max(0, b) };
  }

  // Suavizado exponencial entre el color mostrado y el nuevo.
  function smooth(prev, next, factor) {
    if (!prev) return next;
    const mix = (a, b) => a + (b - a) * factor;
    return { r: mix(prev.r, next.r), g: mix(prev.g, next.g), b: mix(prev.b, next.b), level: mix(prev.level, next.level) };
  }

  function changedEnough(a, b) {
    if (!b) return true;
    return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) > 8 || Math.abs(a.level - b.level) > 0.02;
  }

  return { dominant, smooth, changedEnough };
});
