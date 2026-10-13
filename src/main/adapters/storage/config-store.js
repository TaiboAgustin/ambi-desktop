// Configuración persistente en JSON.
//  - Escritura atómica (archivo temporal + rename) y con debounce: un corte no deja el JSON a medias.
//  - Si el archivo está corrupto se respalda (config.corrupt-<fecha>.json) en vez de descartarlo.
//  - Los secretos se guardan cifrados con el `cipher` inyectado (safeStorage/DPAPI en la app):
//    todo lo que esté en `devices[].secrets` y las credenciales de `smartthings`.
//  - Migra formatos anteriores: v0 (plano, Hub TV) → v1 (secciones tv/light) → v2 (lista de dispositivos).
const fs = require('fs');
const path = require('path');
const { nullLogger } = require('../logging/logger');

const SCHEMA_VERSION = 2;
const SMARTTHINGS_SECRETS = ['clientSecret', 'accessToken', 'refreshToken'];

const defaults = () => ({
  schemaVersion: SCHEMA_VERSION,
  // Cada dispositivo: { id, kind, driver, name, settings: { address, mac, … }, secrets: { … } }
  devices: [],
  ui: { alwaysOnTop: true, x: null, y: null },
  inputs: { ps5Hdmi: 2, switchHdmi: 1, lastHdmi: 'ps5', onHdmi: false },
  smartthings: {},
  ambient: { sourceId: null, maxDim: 100 },
  mirror: { sourceId: null, audio: true, quality: 'nitido60' },
});

// v0: formato plano de Hub TV → v1.
function migrateV0(raw) {
  return {
    schemaVersion: 1,
    tv: { ip: raw.ip || '', mac: raw.mac || '', token: raw.token || '' },
    ui: { alwaysOnTop: raw.alwaysOnTop ?? true, x: raw.x ?? null, y: raw.y ?? null },
    inputs: {
      ps5Hdmi: raw.ps5Hdmi ?? 2,
      switchHdmi: raw.switchHdmi ?? 1,
      lastHdmi: raw.lastHdmi || 'ps5',
      onHdmi: ['ps5', 'switch'].includes(raw.lastInput),
    },
    smartthings: raw.st || {},
    light: raw.light || {},
    ambient: raw.ambient || {},
    mirror: { ...(raw.mirror || {}), ...(raw.mirrorQuality ? { quality: raw.mirrorQuality } : {}) },
  };
}

// v1: secciones fijas `tv` y `light` → v2: lista de dispositivos con su driver.
function migrateV1(v1) {
  const { tv = {}, light = {}, ...rest } = v1;
  const devices = [];
  if (tv.ip || tv.token) {
    devices.push({ id: 'tv', kind: 'tv', driver: 'samsung-tizen', name: 'TV', settings: { address: tv.ip || '', mac: tv.mac || '' }, secrets: { token: tv.token || '' } });
  }
  if (light.ip || light.mac) {
    devices.push({ id: 'light', kind: 'light', driver: 'wiz', name: 'Lámpara', settings: { address: light.ip || '', mac: light.mac || '' }, secrets: {} });
  }
  return { ...rest, schemaVersion: 2, devices };
}

function migrate(raw) {
  let data = raw;
  if (!data.schemaVersion) data = migrateV0(data);
  if (data.schemaVersion === 1) data = migrateV1(data);
  return data;
}

function mergeDefaults(data) {
  const d = defaults();
  const out = { ...d, ...data };
  for (const k of Object.keys(d)) {
    if (Array.isArray(d[k])) out[k] = Array.isArray(data[k]) ? data[k] : d[k];
    else if (d[k] && typeof d[k] === 'object') out[k] = { ...d[k], ...(data[k] || {}) };
  }
  out.devices = out.devices
    .filter((dev) => dev && typeof dev === 'object' && typeof dev.driver === 'string')
    .map((dev) => ({ ...dev, settings: { ...(dev.settings || {}) }, secrets: { ...(dev.secrets || {}) } }));
  return out;
}

// Ubicaciones de secretos dentro de la configuración: [{ obj, key, label }].
function secretRefs(data) {
  const refs = SMARTTHINGS_SECRETS.map((key) => ({ obj: data.smartthings, key, label: `smartthings.${key}` }));
  for (const dev of data.devices || []) {
    for (const key of Object.keys(dev.secrets || {})) refs.push({ obj: dev.secrets, key, label: `${dev.id}.${key}` });
  }
  return refs.filter((r) => r.obj);
}

class ConfigStore {
  // cipher: { available(): boolean, encrypt(str): string, decrypt(str): string }
  constructor({ file, cipher = null, logger = nullLogger, debounceMs = 400 }) {
    this.file = file;
    this.cipher = cipher;
    this.log = logger;
    this.debounceMs = debounceMs;
    this.timer = null;
    this.data = null;
  }

  load() {
    let raw = null;
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') this.backupCorrupt(e);
    }
    const migrated = raw && typeof raw === 'object' ? migrate(raw) : defaults();
    this.data = mergeDefaults(migrated);
    const hadPlain = this.canEncrypt() && secretRefs(this.data).some((r) => typeof r.obj[r.key] === 'string' && r.obj[r.key]);
    this.decryptSecrets();
    // Persistir migración y cifrado de secretos que estaban en texto plano.
    if (raw && (raw.schemaVersion !== SCHEMA_VERSION || hadPlain)) this.flush();
    return this.data;
  }

  backupCorrupt(err) {
    const backup = this.file.replace(/\.json$/, `.corrupt-${Date.now()}.json`);
    try { fs.copyFileSync(this.file, backup); } catch {}
    this.log.warn(`config.json ilegible; se respaldó en ${path.basename(backup)}`, err.message);
  }

  canEncrypt() {
    try { return !!this.cipher?.available(); } catch { return false; }
  }

  decryptSecrets() {
    for (const { obj, key, label } of secretRefs(this.data)) {
      const v = obj[key];
      if (v && typeof v === 'object' && typeof v.$enc === 'string') {
        try {
          obj[key] = this.cipher.decrypt(v.$enc);
        } catch (e) {
          this.log.warn(`No se pudo descifrar ${label}; habrá que volver a configurarlo`, e.message);
          obj[key] = '';
        }
      }
    }
  }

  serialize() {
    const copy = JSON.parse(JSON.stringify(this.data));
    if (this.canEncrypt()) {
      for (const { obj, key } of secretRefs(copy)) {
        if (typeof obj[key] === 'string' && obj[key]) obj[key] = { $enc: this.cipher.encrypt(obj[key]) };
      }
    }
    return JSON.stringify(copy, null, 2);
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.data) return;
    const tmp = `${this.file}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, this.serialize());
      try {
        fs.renameSync(tmp, this.file);
      } catch (e) {
        // Algunos sistemas de archivos virtualizados (redirección de AppData, antivirus) rechazan el
        // rename con EXDEV/EPERM/EBUSY: se copia el temporal ya completo sobre el destino.
        if (!['EXDEV', 'EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
        fs.copyFileSync(tmp, this.file);
        fs.rmSync(tmp, { force: true });
      }
    } catch (e) {
      this.log.error('No se pudo guardar la configuración', e);
    }
  }
}

module.exports = { ConfigStore, SCHEMA_VERSION, migrate, defaults };
