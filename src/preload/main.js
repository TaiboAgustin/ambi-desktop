// Puente seguro entre la ventana principal y el proceso principal (contextIsolation + sandbox).
// Cada llamada devuelve el valor o lanza un Error con el mensaje del proceso principal.
const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res?.ok) throw new Error(res?.error || 'Error desconocido');
  return res.value;
}

contextBridge.exposeInMainWorld('ambi', {
  state: () => call('state:get'),
  onState: (fn) => ipcRenderer.on('state', (_e, s) => fn(s)),
  settings: {
    get: () => call('settings:get'),
    set: (patch) => call('settings:set', patch),
  },
  tv: {
    key: (code, cmd) => call('tv:key', code, cmd),
    app: (name) => call('tv:app', name),
    input: (target) => call('tv:input', target),
    power: () => call('tv:power'),
    volume: (level) => call('tv:volume', level),
    mute: (muted) => call('tv:mute', muted),
    forgetPairing: () => call('tv:forget'),
  },
  smartthings: {
    openTokenPage: () => call('st:tokenPage'),
    connect: (pat) => call('st:connect', pat),
    disconnect: () => call('st:disconnect'),
  },
  light: {
    set: (params) => call('light:set', params),
    toggle: () => call('light:toggle'),
  },
  screens: () => call('screens:list'),
  ambient: {
    start: (opts) => call('ambient:start', opts),
    stop: () => call('ambient:stop'),
    setMax: (v) => call('ambient:max', v),
  },
  mirror: {
    start: (opts) => call('mirror:start', opts),
    stop: () => call('mirror:stop'),
  },
  app: {
    getAutostart: () => call('autostart:get'),
    setAutostart: (on) => call('autostart:set', on),
    hide: () => call('win:hide'),
    minimize: () => call('win:minimize'),
    quit: () => call('app:quit'),
  },
});
