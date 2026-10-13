// Casos de uso de la TV: estado, teclas, apps, encendido, volumen y entradas.
const { APPS, CONSOLES } = require('../domain/catalog');
const { parseDeviceInfo } = require('../domain/tv-model');
const { HdmiCycle } = require('../domain/input-policy');
const { nullLogger } = require('../adapters/logging/logger');

const HDMI_SWITCH_MS = 3000;
const SMARTTHINGS_POLL_MS = 6000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class TvService {
  /**
   * @param {object} deps
   * @param {import('./ports').TvRemotePort} deps.remote
   * @param {import('./ports').TvRestPort} deps.rest
   * @param {import('./ports').TvVolumePort} deps.volume
   * @param {(mac: string, ip: string) => Promise<boolean>} deps.wake
   * @param {object} deps.smartthings   InputSourcePort + alta (createApp/finishAuth/disconnect)
   * @param {(url: string) => Promise<string>} deps.authorize   abre el login y devuelve el redirect
   * @param {() => Promise<object|null>} deps.discover   busca la TV en la red
   * @param {object} deps.config   configuración viva (secciones tv, inputs)
   * @param {() => void} deps.save
   * @param {import('./app-state').AppState} deps.state
   */
  constructor({ remote, rest, volume, wake, smartthings, authorize, discover, config, save, state, logger = nullLogger }) {
    Object.assign(this, { remote, rest, volume, wake, smartthings, authorize, discover, config, save, state, log: logger });
    this.hdmi = new HdmiCycle(config.inputs);
    this.switching = false;
    this.stLastPoll = 0;
    this.discovering = null;
    remote.on('state', (s) => state.set('remote', s));
    this.publishSmartThings();
  }

  get ip() { return this.config.tv.ip; }

  // ---------- Estado
  async poll(mode) {
    if (!this.ip) { await this.findTv(); return; }
    const parsed = parseDeviceInfo(await this.rest.info());
    if (!parsed) {
      this.state.set('tv', { power: 'off', foreground: null, volume: null });
      return;
    }
    const tv = { power: parsed.power, device: parsed.device };
    // La MAC para Wake-on-LAN se toma de la propia TV si no estaba configurada.
    if (parsed.device.mac && !this.config.tv.mac) { this.config.tv.mac = parsed.device.mac; this.save(); }

    if (parsed.power === 'on' && mode === 'full') {
      const names = Object.keys(APPS);
      const [vol, ...apps] = await Promise.all([this.volume.getVolume(), ...names.map((n) => this.rest.appStatus(APPS[n].id))]);
      if (vol) Object.assign(tv, vol);
      const installed = { ...this.state.get().tv.installed };
      tv.foreground = null;
      apps.forEach((a, i) => {
        if (!a) return;
        installed[names[i]] = a.installed;
        if (a.visible) tv.foreground = names[i];
      });
      tv.installed = installed;
      if (tv.foreground) this.hdmi.leftHdmi();
      await this.pollSmartThings();
    } else if (parsed.power !== 'on') {
      tv.foreground = null;
    }
    tv.input = tv.foreground ? null : this.hdmi.current;
    this.persistInputs();
    this.state.set('tv', tv);
  }

  async findTv() {
    this.discovering ??= this.discover()
      .then((found) => {
        if (!found) return;
        this.log.info(`TV encontrada en ${found.ip}`);
        Object.assign(this.config.tv, { ip: found.ip, mac: this.config.tv.mac || found.mac });
        this.save();
        this.remote.reconnect();
      })
      .catch((e) => this.log.warn('descubrimiento de la TV', e.message))
      .finally(() => { this.discovering = null; });
    await this.discovering;
  }

  // ---------- Acciones
  key(code, cmd) { return this.remote.key(code, cmd); }

  async launchApp(name) {
    // hasOwn: `APPS['__proto__']` devolvería el prototipo de Object.
    if (!Object.hasOwn(APPS, name)) throw new Error(`App desconocida: ${name}`);
    const app = APPS[name];
    this.hdmi.leftHdmi();
    if (await this.rest.launchApp(app.id)) return true;
    return this.remote.launchApp(app.id);
  }

  async power() {
    const parsed = parseDeviceInfo(await this.rest.info());
    if (parsed?.power === 'on' && this.remote.key('KEY_POWER')) return 'off';
    await this.wake(this.config.tv.mac, this.ip);
    // En reposo la TV a veces sigue respondiendo por red: probar también la tecla.
    if (parsed) this.remote.key('KEY_POWER');
    setTimeout(() => this.remote.reconnect(), 4000);
    return 'on';
  }

  setVolume(level) { return this.volume.setVolume(level); }
  setMute(muted) { return this.volume.setMute(muted); }

  // ---------- Entradas
  portOf(console) { return `HDMI${this.config.inputs[`${console}Hdmi`]}`; }

  async selectInput(target) {
    if (target !== 'next' && this.smartthings.connected) {
      // Entrada exacta por SmartThings. Si falla, se informa: la tecla HDMI de respaldo es impredecible.
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
    if (this.switching) return;
    this.switching = true;
    try {
      const presses = target === 'next' ? this.hdmi.next() : this.hdmi.select(target);
      for (let i = 0; i < presses; i++) {
        if (i) await sleep(HDMI_SWITCH_MS);
        this.remote.key('KEY_HDMI');
      }
    } finally {
      this.switching = false;
    }
  }

  persistInputs() {
    const { lastHdmi, onHdmi } = this.hdmi.toJSON();
    if (this.config.inputs.lastHdmi !== lastHdmi || this.config.inputs.onHdmi !== onHdmi) {
      Object.assign(this.config.inputs, { lastHdmi, onHdmi });
      this.save();
    }
  }

  // ---------- SmartThings
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

  // ---------- Ajustes
  forgetPairing() {
    this.config.tv.token = '';
    this.save();
    this.remote.reconnect();
  }

  onSettingsChanged({ ipChanged }) {
    if (ipChanged) {
      this.config.tv.token = '';
      this.save();
      this.remote.reconnect();
    }
  }
}

module.exports = { TvService };
