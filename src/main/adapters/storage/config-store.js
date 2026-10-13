// Configuración persistente en JSON.
//  - Escritura atómica (archivo temporal + rename) y con debounce: un corte no deja el JSON a medias.
//  - Si el archivo está corrupto se respalda (config.corrupt-<fecha>.json) en vez de descartarlo.
//  - Los secretos se guardan cifrados con el `cipher` inyectado (safeStorage/DPAPI en la app).
//  - Migra el formato plano anterior a v1.
const fs = require('fs');
const path = require('path');
const { nullLogger } = require('../logging/logger');

const SCHEMA_VERSION = 1;
const SECRET_PATHS = [['tv', 'token'], ['smartthings', 'clientSecret'], ['smartthings', 'accessToken'], ['smartthings', 'refreshToken']];

const defaults = () => ({
  schemaVersion: SCHEMA_VERSION,
  tv: { ip: '', mac: '', token: '' },
  ui: { alwaysOnTop: true, x: null, y: null },
  inputs: { ps5Hdmi: 2, switchHdmi: 1, lastHdmi: 'ps5', onHdmi: false },
  smartthings: {},
  light: { mac: '', ip: '' },
  ambient: { sourceId: null, maxDim: 100 },
  mirror: { sourceId: null, audio: true, quality: 'nitido60' },
});

// Formato plano previo a v1 → secciones.
function migrate(raw) {
  if (raw.schemaVersion === SCHEMA_VERSION) return raw;
  const d = defaults();
  return {
    ...d,
    tv: { ip: raw.ip || '', mac: raw.mac || '', token: raw.token || '' },
    ui: { alwaysOnTop: raw.alwaysOnTop ?? true, x: raw.x ?? null, y: raw.y ?? null },
    inputs: {
      ps5Hdmi: raw.ps5Hdmi ?? d.inputs.ps5Hdmi,
      switchHdmi: raw.switchHdmi ?? d.inputs.switchHdmi,
      lastHdmi: raw.lastHdmi || d.inputs.lastHdmi,
      onHdmi: ['ps5', 'switch'].includes(raw.lastInput),
    },
    smartthings: raw.st || {},
    light: raw.light || d.light,
    ambient: { ...d.ambient, ...(raw.ambient || {}) },
    mirror: { ...d.mirror, ...(raw.mirror || {}), quality: raw.mirrorQuality || d.mirror.quality },
  };
}

function mergeDefaults(data) {
  const d = defaults();
  const out = { ...d, ...data };
  for (const k of Object.keys(d)) if (d[k] && typeof d[k] === 'object') out[k] = { ...d[k], ...(data[k] || {}) };
  return out;
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
    const migrated = raw ? migrate(raw) : defaults();
    this.data = mergeDefaults(migrated);
    this.decryptSecrets();
    // Persistir migración y cifrado de secretos que estaban en texto plano.
    if (raw && (raw.schemaVersion !== SCHEMA_VERSION || this.hasPlainSecrets(raw))) this.flush();
    return this.data;
  }

  backupCorrupt(err) {
    const backup = this.file.replace(/\.json$/, `.corrupt-${Date.now()}.json`);
    try { fs.copyFileSync(this.file, backup); } catch {}
    this.log.warn(`config.json ilegible; se respaldó en ${path.basename(backup)}`, err.message);
  }

  hasPlainSecrets(raw) {
    const m = migrate(raw);
    return this.canEncrypt() && SECRET_PATHS.some(([s, k]) => typeof m[s]?.[k] === 'string' && m[s][k]);
  }

  canEncrypt() {
    try { return !!this.cipher?.available(); } catch { return false; }
  }

  decryptSecrets() {
    for (const [s, k] of SECRET_PATHS) {
      const v = this.data[s]?.[k];
      if (v && typeof v === 'object' && typeof v.$enc === 'string') {
        try {
          this.data[s][k] = this.cipher.decrypt(v.$enc);
        } catch (e) {
          this.log.warn(`No se pudo descifrar ${s}.${k}; habrá que volver a configurarlo`, e.message);
          this.data[s][k] = '';
        }
      }
    }
  }

  serialize() {
    const copy = JSON.parse(JSON.stringify(this.data));
    if (this.canEncrypt()) {
      for (const [s, k] of SECRET_PATHS) {
        const v = copy[s]?.[k];
        if (typeof v === 'string' && v) copy[s][k] = { $enc: this.cipher.encrypt(v) };
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
