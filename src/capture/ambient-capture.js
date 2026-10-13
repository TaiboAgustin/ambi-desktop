// Ventana oculta del modo ambiente: captura la pantalla en baja resolución, calcula el color
// dominante (shared/color.js) y lo informa al proceso principal ~20 veces por segundo.
// La pantalla la elige el proceso principal (setDisplayMediaRequestHandler).
const { dominant, smooth, changedEnough } = window.HubColor;
const TICK_MS = 50;   // ~20 colores por segundo
const SMOOTH = 0.6;   // fracción del color nuevo que se toma en cada tick
const W = 64, H = 36; // muestra reducida: alcanza para el color y es barata

const canvas = new OffscreenCanvas(W, H);
const ctx = canvas.getContext('2d', { willReadFrequently: true });
let current = null;
let last = null;

(async () => {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { max: 320 }, height: { max: 180 }, frameRate: { max: 30 } },
      audio: false,
    });
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    stream.getVideoTracks()[0]?.addEventListener('ended', () => window.ambient.error('Se interrumpió la captura de pantalla'));

    setInterval(() => {
      if (video.readyState < 2) return;
      ctx.drawImage(video, 0, 0, W, H);
      current = smooth(current, dominant(ctx.getImageData(0, 0, W, H).data), SMOOTH);
      const out = { r: Math.round(current.r), g: Math.round(current.g), b: Math.round(current.b), level: current.level };
      if (!changedEnough(out, last)) return;
      last = out;
      window.ambient.color(out);
    }, TICK_MS);
  } catch (e) {
    window.ambient.error(`No se pudo capturar la pantalla: ${e.message}`);
  }
})();
