// Reglas de la lámpara WiZ: normalización del estado, comandos válidos y restauración.

const MIN_DIM = 10; // brillo mínimo que acepta la lámpara
const TEMP_RANGE = [2200, 6500];

// `getPilot` → estado del hub. Null si la respuesta no tiene la forma esperada.
function normalizePilot(result) {
  if (!result || typeof result !== 'object' || typeof result.state !== 'boolean') return null;
  const num = (v) => (Number.isFinite(v) ? v : null);
  const hasRgb = [result.r, result.g, result.b].every(Number.isFinite);
  return {
    on: result.state,
    dimming: num(result.dimming),
    temp: num(result.temp),
    sceneId: num(result.sceneId) || 0,
    rgb: hasRgb ? [result.r, result.g, result.b] : null,
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isByte = (v) => Number.isInteger(v) && v >= 0 && v <= 255;

// Valida y normaliza un comando `setPilot` que llega desde la UI. Lanza si es inválido.
function lightCommand(params) {
  if (!params || typeof params !== 'object') throw new Error('Comando de luz inválido');
  const out = {};
  if ('state' in params) out.state = !!params.state;
  if ('dimming' in params) out.dimming = clamp(Math.round(Number(params.dimming)), MIN_DIM, 100);
  if ('temp' in params) out.temp = clamp(Math.round(Number(params.temp)), ...TEMP_RANGE);
  if ('sceneId' in params) {
    if (!Number.isInteger(params.sceneId) || params.sceneId < 1 || params.sceneId > 40) throw new Error('Escena inválida');
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

// Brillo de la lámpara para un nivel de imagen (0..1) en modo ambiente, sin pasar de `maxDim`.
function dimmingFor(level, maxDim = 100) {
  const max = clamp(Number(maxDim) || 100, MIN_DIM, 100);
  return clamp(Math.round(MIN_DIM + (max - MIN_DIM) * clamp(level, 0, 1)), MIN_DIM, 100);
}

// Comandos para devolver la lámpara al estado guardado (respuesta cruda de getPilot).
// WiZ acepta cambiar tono y brillo con `state: false` sin encenderse (verificado con la lámpara), así
// que una lámpara apagada también recupera su tono previo y no queda con el último color del ambiente.
function restoreCommands(saved) {
  if (!saved) return [];
  const tone = {};
  if (saved.sceneId) tone.sceneId = saved.sceneId;
  else if (saved.temp) tone.temp = saved.temp;
  else if ([saved.r, saved.g, saved.b].every(Number.isFinite)) Object.assign(tone, { r: saved.r, g: saved.g, b: saved.b });
  if (Number.isFinite(saved.dimming)) tone.dimming = saved.dimming;
  return [{ state: !!saved.state, ...tone }];
}

module.exports = { MIN_DIM, normalizePilot, lightCommand, dimmingFor, restoreCommands };
