// Gestión de dispositivos: instancia cada uno con su driver a partir de `config.devices`, descubre
// equipos nuevos cuando falta alguno de un tipo y los recrea cuando cambia su configuración.
// En esta etapa la app usa un dispositivo por tipo (una TV y una luz); el modelo ya admite varios.
const { EventEmitter } = require('events');
const { nullLogger } = require('../adapters/logging/logger');

const DISCOVERY_INTERVAL_MS = 30000;

class DeviceManager extends EventEmitter {
  /**
   * @param {object} deps
   * @param {object} deps.config     configuración viva (usa `config.devices`)
   * @param {() => void} deps.save
   * @param {import('../drivers').DriverRegistry} deps.registry
   * @param {() => string[]} deps.getSubnets   IPs locales, para que los drivers sepan dónde buscar
   */
  constructor({ config, save, registry, getSubnets = () => [], logger = nullLogger }) {
    super();
    Object.assign(this, { config, save, registry, getSubnets, log: logger });
    this.instances = new Map(); // id de dispositivo → instancia del driver
    this.discovering = new Map(); // kind → promesa en curso
    this.lastDiscovery = new Map(); // kind → timestamp
  }

  entries(kind) { return this.config.devices.filter((d) => d.kind === kind); }
  entry(kind) { return this.entries(kind)[0] || null; }

  // Instancia del primer dispositivo del tipo (o null si no hay o su driver no existe).
  get(kind) {
    const e = this.entry(kind);
    return e ? this.instance(e) : null;
  }

  capabilities(kind) {
    const e = this.entry(kind);
    return e ? this.registry.get(e.driver)?.capabilities || [] : [];
  }

  has(kind, capability) { return this.capabilities(kind).includes(capability); }

  // Resumen para la UI: qué dispositivos hay y qué saben hacer.
  summary() {
    return this.config.devices.map((d) => {
      const driver = this.registry.get(d.driver);
      return { id: d.id, kind: d.kind, name: d.name, driver: d.driver, driverName: driver?.name || null, capabilities: driver?.capabilities || [] };
    });
  }

  instance(e) {
    if (this.instances.has(e.id)) return this.instances.get(e.id);
    const driver = this.registry.get(e.driver);
    if (!driver) {
      this.log.warn(`no hay driver "${e.driver}" para ${e.id}`);
      return null;
    }
    const device = driver.create({
      settings: e.settings, secrets: e.secrets, save: this.save,
      getSubnets: this.getSubnets, logger: this.log.child(e.id),
    });
    this.instances.set(e.id, device);
    this.emit('device', { id: e.id, kind: e.kind, device });
    try { device.connect(); } catch (err) { this.log.warn(`no se pudo conectar ${e.id}`, err.message); }
    return device;
  }

  // Si no hay dispositivo de este tipo, busca con los drivers del tipo y agrega el primero que aparezca.
  async ensure(kind) {
    if (this.entry(kind)) return this.get(kind);
    if (this.discovering.has(kind)) return this.discovering.get(kind);
    if (Date.now() - (this.lastDiscovery.get(kind) || 0) < DISCOVERY_INTERVAL_MS) return null;
    this.lastDiscovery.set(kind, Date.now());
    const run = (async () => {
      for (const driver of this.registry.ofKind(kind)) {
        let found = [];
        try { found = await driver.discover({ subnets: this.getSubnets() }); } catch (e) { this.log.warn(`descubrimiento ${driver.id}`, e.message); }
        if (found.length && !this.entry(kind)) {
          const f = found[0];
          this.add({ kind, driver: driver.id, name: f.name || driver.name, settings: { address: f.address, mac: f.mac || '' } });
          this.log.info(`${driver.name} encontrado en ${f.address}`);
          return this.get(kind);
        }
      }
      return null;
    })().finally(() => this.discovering.delete(kind));
    this.discovering.set(kind, run);
    return run;
  }

  add({ kind, driver, name, settings = {}, secrets = {} }) {
    const base = kind;
    let id = base;
    for (let n = 2; this.config.devices.some((d) => d.id === id); n++) id = `${base}-${n}`;
    const entry = { id, kind, driver, name, settings: { ...settings }, secrets: { ...secrets } };
    this.config.devices.push(entry);
    this.save();
    this.emit('changed');
    return entry;
  }

  // Cambia la configuración del dispositivo de un tipo (lo crea con el primer driver del tipo si no
  // existía) y lo vuelve a instanciar. `resetSecrets` borra credenciales (p. ej. al cambiar de IP).
  upsert(kind, settingsPatch, { resetSecrets = false } = {}) {
    let e = this.entry(kind);
    if (!e) {
      const driver = this.registry.ofKind(kind)[0];
      if (!driver) throw new Error(`No hay drivers para ${kind}`);
      e = this.add({ kind, driver: driver.id, name: driver.name, settings: settingsPatch });
    } else {
      Object.assign(e.settings, settingsPatch);
    }
    if (resetSecrets) for (const k of Object.keys(e.secrets)) e.secrets[k] = '';
    this.save();
    this.recreate(e);
    return e;
  }

  recreate(e) {
    const old = this.instances.get(e.id);
    this.instances.delete(e.id);
    try { old?.close(); } catch {}
    return this.instance(e);
  }

  close() {
    for (const d of this.instances.values()) { try { d.close(); } catch {} }
    this.instances.clear();
  }
}

module.exports = { DeviceManager };
