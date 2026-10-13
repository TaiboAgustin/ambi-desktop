// Casos de uso de la TV, en términos de capacidades (sin saber de qué marca es la TV).
const { APPS, CONSOLES } = require('../domain/catalog');
const { CAP } = require('../domain/capabilities');
const { HdmiCycle } = require('../domain/input-policy');
const { nullLogger } = require('../adapters/logging/logger');

const INPUT_SWITCH_MS = 3000;
const SMARTTHINGS_POLL_MS = 6000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class NotSupported extends Error {}

class TvService {
  /**
   * @param {object} deps
   * @param {import('./device-manager').DeviceManager} deps.devices
   * @param {object} deps.smartthings   InputSourcePort + alta (createApp/finishAuth/disconnect)
   * @param {(url: string) => Promise<string>} deps.authorize   abre el login y devuelve el redirect
   * @param {object} deps.inputs   sección `inputs` viva de la configuración
   * @param {() => void} deps.save
   * @param {import('./app-state').AppState} deps.state
   */
  constructor({ devices, smartthings, authorize, inputs, save, state, logger = nullLogger }) {
    Object.assign(this, { devices, smartthings, authorize, inputs, save, state, log: logger });
    this.hdmi = new HdmiCycle(inputs);
    this.switching = false;
    this.stLastPoll = 0;
    devices.on('device', ({ kind, device }) => {
      if (kind !== 'tv' || !device.connection) return;
      device.connection.on('state', (s) => { if (this.devices.get('tv') === device) state.set('remote', s); });
      state.set('remote', { state: device.connection.state, detail: '' });
    });
    this.publishSmartThings();
  }

  get tv() { return this.devices.get('tv'); }

  // Capacidad requerida o error claro (p. ej. una TV que no informa volumen).
  require(cap) {
    const tv = this.tv;
    if (!tv) throw new NotSupported('Todavía no se encontró la TV en la red');
    if (!this.devices.has('tv', cap)) throw new NotSupported('Esta TV no soporta esa función');
    return tv;
  }

  // ---------- Estado
  async poll(mode) {
    const tv = this.tv;
    if (!tv) {
      this.state.set('remote', { state: 'idle', detail: 'Buscando la TV en la red…' });
      await this.devices.ensure('tv');
      return;
    }
    const parsed = await tv.status();
    const meta = { capabilities: this.devices.capabilities('tv') };
    if (!parsed) {
      this.state.set('tv', { ...meta, power: 'off', foreground: null, volume: null });
      return;
    }
    const next = { ...meta, power: parsed.power, device: parsed.device };

    if (parsed.power === 'on' && mode === 'full') {
      const has = (c) => this.devices.has('tv', c);
      const names = has(CAP.APPS) ? tv.apps.supported.filter((n) => Object.hasOwn(APPS, n)) : [];
      const [vol, ...apps] = await Promise.all([
        has(CAP.VOLUME) ? tv.volume.get() : null,
        ...names.map((n) => tv.apps.status(n)),
      ]);
      if (vol) Object.assign(next, vol);
      const installed = {};
      next.foreground = null;
      apps.forEach((a, i) => {
        if (!a) return;
        installed[names[i]] = a.installed;
        if (a.visible) next.foreground = names[i];
      });
      // Apps que este driver no soporta: se ocultan en la UI.
      for (const n of Object.keys(APPS)) if (!names.includes(n)) installed[n] = false;
      next.installed = installed;
      if (next.foreground) this.hdmi.leftHdmi();
      await this.pollSmartThings();
    } else if (parsed.power !== 'on') {
      next.foreground = null;
    }
    next.input = next.foreground ? null : this.hdmi.current;
    this.persistInputs();
    this.state.set('tv', next);
  }

  // ---------- Acciones
  key(key, action) {
    return this.require(CAP.REMOTE_KEYS).keys.send(key, action);
  }

  async launchApp(name) {
    // hasOwn: `APPS['__proto__']` devolvería el prototipo de Object.
    if (!Object.hasOwn(APPS, name)) throw new Error(`App desconocida: ${name}`);
    const tv = this.require(CAP.APPS);
    if (!tv.apps.supported.includes(name)) throw new NotSupported(`${APPS[name].name} no está disponible en esta TV`);
    this.hdmi.leftHdmi();
    return tv.apps.launch(name);
  }

  power() { return this.require(CAP.POWER).power.toggle(); }
  setVolume(level) { return this.require(CAP.VOLUME).volume.set(level); }
  setMute(muted) { return this.require(CAP.VOLUME).volume.mute(muted); }

  // ---------- Entradas
  portOf(console) { return `HDMI${this.inputs[`${console}Hdmi`]}`; }

  async selectInput(target) {
    if (target !== 'next' && this.smartthings.connected) {
      // Entrada exacta por SmartThings. Si falla, se informa: ciclar a ciegas es impredecible.
      try {
        await this.smartthings.setInput(this.portOf(target));
        this.hdmi.confirm(target);
        this.stLastPoll = Date.now() + 4000; // dar tiempo a que SmartThings refleje el cambio
        this.publishSmartThings(null);
      } catch (e) {
        this.publishSmartThings(e.message);
        throw e;
      }
    } else {
      await this.cycleTo(target);
    }
    this.persistInputs();
    this.state.set('tv', { input: this.hdmi.current });
  }

  async cycleTo(target) {
    const tv = this.require(CAP.INPUT_CYCLE);
    if (this.switching) return;
    this.switching = true;
    try {
      const presses = target === 'next' ? this.hdmi.next() : this.hdmi.select(target);
      for (let i = 0; i < presses; i++) {
        if (i) await sleep(INPUT_SWITCH_MS);
        tv.inputs.next();
      }
    } finally {
      this.switching = false;
    }
  }

  persistInputs() {
    const { lastHdmi, onHdmi } = this.hdmi.toJSON();
    if (this.inputs.lastHdmi !== lastHdmi || this.inputs.onHdmi !== onHdmi) {
      Object.assign(this.inputs, { lastHdmi, onHdmi });
      this.save();
    }
  }

  // ---------- SmartThings (complemento para elegir la entrada exacta)
  async pollSmartThings() {
    if (!this.smartthings.connected || Date.now() - this.stLastPoll < SMARTTHINGS_POLL_MS) return;
    this.stLastPoll = Date.now();
    try {
      const { current } = await this.smartthings.getInput();
      this.hdmi.confirm(CONSOLES.find((c) => this.portOf(c) === current) || null);
      this.publishSmartThings(null);
    } catch (e) {
      this.publishSmartThings(e.message);
    }
  }

  publishSmartThings(error) {
    const st = this.smartthings;
    this.state.set('smartthings', {
      connected: st.connected,
      label: st.st?.deviceLabel || null,
      needsReauth: st.needsReauth,
      ...(error !== undefined ? { error } : {}),
    });
  }

  async connectSmartThings(pat) {
    const url = await this.smartthings.createApp(pat);
    const redirect = await this.authorize(url);
    await this.smartthings.finishAuth(redirect);
    this.stLastPoll = 0;
    this.publishSmartThings(null);
  }

  disconnectSmartThings() {
    this.smartthings.disconnect();
    this.publishSmartThings(null);
  }

  forgetPairing() {
    const tv = this.tv;
    if (tv?.pairing) tv.pairing.forget();
  }
}

module.exports = { TvService, NotSupported };
