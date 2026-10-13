// Reglas de las luces, independientes de la marca.
//
// Estado normalizado de una luz (lo que devuelve `status()` de cualquier driver de luz):
//   { on: boolean, dimming: 10..100|null, temp: K|null, sceneId: number (0 = ninguna), rgb: [r,g,b]|null }
// Comando normalizado (lo que acepta `set()`/`stream()`):
//   { state?, dimming?, temp?, sceneId?, r?, g?, b? }

const MIN_DIM = 10; // brillo mínimo que se envía a una luz
const TEMP_RANGE = [2200, 6500];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isByte = (v) => Number.isInteger(v) && v >= 0 && v <= 255;

// Valida y normaliza un comando que llega desde la UI. Lanza si es inválido.
function lightCommand(params) {
  if (!params || typeof params !== 'object') throw new Error('Comando de luz inválido');
  const out = {};
  if ('state' in params) out.state = !!params.state;
  if ('dimming' in params) out.dimming = clamp(Math.round(Number(params.dimming)), MIN_DIM, 100);
  if ('temp' in params) out.temp = clamp(Math.round(Number(params.temp)), ...TEMP_RANGE);
  if ('sceneId' in params) {
    if (!Number.isInteger(params.sceneId) || params.sceneId < 1 || params.sceneId > 999) throw new Error('Escena inválida');
    out.sceneId = params.sceneId;
  }
  if ('r' in params || 'g' in params || 'b' in params) {
    if (![params.r, params.g, params.b].every(isByte)) throw new Error('Color inválido');
    Object.assign(out, { r: params.r, g: params.g, b: params.b });
  }
  if (Object.values(out).some((v) => Number.isNaN(v))) throw new Error('Comando de luz inválido');
  if (!Object.keys(out).length) throw new Error('Comando de luz vacío');
  return out;
}

// Brillo para un nivel de imagen (0..1) en modo ambiente, sin pasar de `maxDim`.
function dimmingFor(level, maxDim = 100) {
  const max = clamp(Number(maxDim) || 100, MIN_DIM, 100);
  return clamp(Math.round(MIN_DIM + (max - MIN_DIM) * clamp(level, 0, 1)), MIN_DIM, 100);
}

// Comandos para devolver una luz a un estado normalizado guardado. El tono se envía también si estaba
// apagada: los drivers que lo soportan lo aplican sin encenderla (WiZ lo hace).
function restoreCommands(saved) {
  if (!saved || typeof saved.on !== 'boolean') return [];
  const tone = {};
  if (saved.sceneId) tone.sceneId = saved.sceneId;
  else if (saved.temp) tone.temp = saved.temp;
  else if (Array.isArray(saved.rgb)) Object.assign(tone, { r: saved.rgb[0], g: saved.rgb[1], b: saved.rgb[2] });
  if (Number.isFinite(saved.dimming)) tone.dimming = saved.dimming;
  return [{ state: saved.on, ...tone }];
}

module.exports = { MIN_DIM, lightCommand, dimmingFor, restoreCommands };
