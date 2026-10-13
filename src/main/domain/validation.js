// Validaciones de datos que llegan de la UI o del usuario.
const { CONSOLES, HDMI_PORTS, MIRROR_QUALITIES, APPS } = require('./catalog');

const isIPv4 = (s) => typeof s === 'string'
  && /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(s.trim());

function normalizeMac(s) {
  if (typeof s !== 'string') return null;
  const hex = s.replace(/[^0-9a-f]/gi, '');
  if (hex.length !== 12) return null;
  return hex.toUpperCase().match(/../g).join(':');
}

// Teclas del control: solo códigos con el formato de Samsung.
const isKeyCode = (s) => typeof s === 'string' && /^KEY_[A-Z0-9_]{1,24}$/.test(s);
const KEY_COMMANDS = ['Click', 'Press', 'Release'];

class ValidationError extends Error {}

// Lista blanca de ajustes editables desde la UI. Devuelve el parche limpio o lanza ValidationError.
function settingsPatch(patch) {
  if (!patch || typeof patch !== 'object') throw new ValidationError('Ajustes inválidos');
  const out = {};
  if ('ip' in patch) {
    if (!isIPv4(patch.ip)) throw new ValidationError('La IP de la TV no es válida (ej.: 192.168.1.50)');
    out.ip = patch.ip.trim();
  }
  if ('mac' in patch) {
    const mac = normalizeMac(patch.mac);
    if (patch.mac && !mac) throw new ValidationError('La MAC no es válida (ej.: AA:BB:CC:DD:EE:01)');
    out.mac = mac || '';
  }
  if ('alwaysOnTop' in patch) out.alwaysOnTop = !!patch.alwaysOnTop;
  for (const key of ['ps5Hdmi', 'switchHdmi']) {
    if (key in patch) {
      const n = Number(patch[key]);
      if (!HDMI_PORTS.includes(n)) throw new ValidationError('Puerto HDMI inválido');
      out[key] = n;
    }
  }
  if ('mirrorQuality' in patch) {
    if (!MIRROR_QUALITIES.includes(patch.mirrorQuality)) throw new ValidationError('Calidad inválida');
    out.mirrorQuality = patch.mirrorQuality;
  }
  return out;
}

const isAppName = (s) => typeof s === 'string' && Object.hasOwn(APPS, s);
const isInputTarget = (s) => s === 'next' || CONSOLES.includes(s);
const isScreenId = (s) => typeof s === 'string' && /^screen:[\w:-]{1,64}$/.test(s);

module.exports = { isIPv4, normalizeMac, isKeyCode, KEY_COMMANDS, settingsPatch, isAppName, isInputTarget, isScreenId, ValidationError };
