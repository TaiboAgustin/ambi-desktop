// Driver Philips WiZ (luces Wi-Fi) — protocolo local UDP, sin nube.
const { CAP } = require('../../domain/capabilities');
const { WizUdp, discoverWiz } = require('./wiz-udp');

// Escenas WiZ (sceneId del protocolo) que expone la UI.
const SCENES = Object.freeze([
  { id: 18, name: 'TV' }, { id: 4, name: 'Fiesta' }, { id: 3, name: 'Atardecer' }, { id: 16, name: 'Relax' },
  { id: 29, name: 'Velas' }, { id: 14, name: 'Noche' }, { id: 1, name: 'Océano' }, { id: 5, name: 'Chimenea' },
  { id: 15, name: 'Foco' }, { id: 11, name: 'Blanco cálido' }, { id: 12, name: 'Luz de día' }, { id: 13, name: 'Blanco frío' },
]);

// `getPilot` de WiZ → estado normalizado de luz (ver domain/light.js). Null si la forma no es la esperada.
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

// El comando normalizado de Ambi coincide con `setPilot` de WiZ (state, dimming, temp, r/g/b, sceneId).
const toPilot = (cmd) => ({ ...cmd });

module.exports = {
  id: 'wiz',
  name: 'Philips WiZ (Wi-Fi)',
  kind: 'light',
  capabilities: [CAP.POWER, CAP.BRIGHTNESS, CAP.COLOR, CAP.COLOR_TEMP, CAP.SCENES, CAP.COLOR_STREAM],
  scenes: SCENES,

  async discover({ subnets = [] } = {}) {
    return (await discoverWiz({ subnets })).map((b) => ({ address: b.address, mac: b.mac, name: 'Luz WiZ' }));
  },

  create({ settings, save, getSubnets, logger }) {
    const udp = new WizUdp({ settings, save, getSubnets, logger });
    return {
      get address() { return settings.address; },
      connect() {},
      close() { udp.close(); },
      async status() { return normalizePilot(await udp.getPilot()); },
      set: (cmd) => udp.set(toPilot(cmd)),
      stream: (cmd) => udp.fire(toPilot(cmd)),
    };
  },
};

module.exports.normalizePilot = normalizePilot;
