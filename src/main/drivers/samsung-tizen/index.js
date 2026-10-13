// Driver Samsung Smart TV (Tizen 2016+). Reúne los protocolos locales de la TV detrás de las
// capacidades genéricas de Ambi:
//   control remoto (WebSocket :8002) · estado y apps (REST :8001/:8002) · volumen (UPnP :9197) ·
//   encendido (Wake-on-LAN) · descubrimiento (SSDP) · espejo (receptor Google Cast integrado).
const { CAP } = require('../../domain/capabilities');
const { SamsungRemote } = require('./remote-ws');
const { SamsungRest } = require('./rest');
const { UpnpVolume } = require('./upnp-volume');
const { wake } = require('./wake-on-lan');
const { discoverSamsungTv } = require('./discovery');
const { parseDeviceInfo } = require('./model');
const { KEYMAP, ACTIONS, INPUT_NEXT } = require('./keymap');
const { TIZEN_APPS } = require('./apps');

function createSamsungTv({ settings, secrets, save, logger }) {
  const getIp = () => settings.address;
  const remote = new SamsungRemote({
    getIp,
    getToken: () => secrets.token,
    setToken: (t) => { secrets.token = t; save(); },
    logger,
  });
  const rest = new SamsungRest({ getIp });
  const upnp = new UpnpVolume({ getIp });
  const appId = (name) => (Object.hasOwn(TIZEN_APPS, name) ? TIZEN_APPS[name] : null);

  return {
    get address() { return settings.address; },
    connection: remote, // { state, on('state') }: emparejamiento y conexión del control
    connect: () => remote.connect(),
    reconnect: () => remote.reconnect(),
    close: () => remote.close(),

    // { power: 'on'|'standby', device: { name, model, title, chips, detail, mac } } o null si no responde.
    async status() {
      const parsed = parseDeviceInfo(await rest.info());
      // La MAC para Wake-on-LAN se toma de la propia TV si no estaba guardada.
      if (parsed?.device.mac && !settings.mac) { settings.mac = parsed.device.mac; save(); }
      return parsed;
    },

    power: {
      // Apagar con la tecla; encender con Wake-on-LAN (y la tecla por si sigue en red en reposo).
      async toggle() {
        const parsed = parseDeviceInfo(await rest.info());
        if (parsed?.power === 'on' && remote.key('KEY_POWER')) return 'off';
        await wake(settings.mac, settings.address);
        if (parsed) remote.key('KEY_POWER');
        setTimeout(() => remote.reconnect(), 4000);
        return 'on';
      },
    },

    volume: {
      get: () => upnp.getVolume(),
      set: (level) => upnp.setVolume(level),
      mute: (muted) => upnp.setMute(muted),
    },

    keys: {
      send(key, action = 'click') {
        const code = Object.hasOwn(KEYMAP, key) ? KEYMAP[key] : null;
        return code ? remote.key(code, ACTIONS[action] || 'Click') : false;
      },
    },

    apps: {
      supported: Object.keys(TIZEN_APPS),
      async status(name) {
        const id = appId(name);
        return id ? rest.appStatus(id) : null;
      },
      // REST por HTTPS (lo que funciona en modelos 2024); el WebSocket queda de respaldo.
      async launch(name) {
        const id = appId(name);
        if (!id) return false;
        return (await rest.launchApp(id)) || remote.launchApp(id);
      },
    },

    inputs: { next: () => remote.key(INPUT_NEXT) },

    cast: { get host() { return settings.address; } },

    pairing: {
      forget() {
        secrets.token = '';
        save();
        remote.reconnect();
      },
    },
  };
}

module.exports = {
  id: 'samsung-tizen',
  name: 'Samsung Smart TV (Tizen 2016+)',
  kind: 'tv',
  capabilities: [CAP.POWER, CAP.VOLUME, CAP.REMOTE_KEYS, CAP.APPS, CAP.INPUT_CYCLE, CAP.CAST_TARGET],

  async discover() {
    const tv = await discoverSamsungTv();
    return tv ? [{ address: tv.ip, mac: tv.mac, name: tv.name }] : [];
  },

  create: createSamsungTv,
};
