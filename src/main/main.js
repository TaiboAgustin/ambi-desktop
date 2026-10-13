// Raíz de composición de Ambi: el único lugar que conoce todas las piezas. Crea los adaptadores,
// se los inyecta a los servicios de aplicación y conecta el estado con la ventana y la bandeja.
const path = require('path');
const fs = require('fs');
const { app, globalShortcut } = require('electron');

const { createLogger } = require('./adapters/logging/logger');
const { ConfigStore } = require('./adapters/storage/config-store');
const { SamsungRemote } = require('./adapters/samsung/remote-ws');
const { SamsungRest } = require('./adapters/samsung/rest');
const { UpnpVolume } = require('./adapters/samsung/upnp-volume');
const { wake } = require('./adapters/samsung/wake-on-lan');
const { discoverSamsungTv } = require('./adapters/samsung/discovery');
const { SmartThingsClient, REDIRECT_URI } = require('./adapters/smartthings/client');
const { WizUdp } = require('./adapters/wiz/wiz-udp');
const { CastClient } = require('./adapters/cast/castv2');
const { SignalingServer, newToken } = require('./adapters/mirror/signaling-server');
const { localIpFor } = require('./adapters/net/local-ip');
const { safeStorageCipher } = require('./adapters/electron/safe-storage-cipher');
const { ElectronCapture } = require('./adapters/electron/capture-windows');
const { authorizeInWindow } = require('./adapters/electron/auth-window');
const { MainWindow } = require('./adapters/electron/main-window');
const { AppTray } = require('./adapters/electron/tray');
const { Autostart } = require('./adapters/electron/autostart');
const { registerIpc } = require('./adapters/electron/ipc');

const { AppState } = require('./application/app-state');
const { StatusPoller } = require('./application/status-poller');
const { TvService } = require('./application/tv-service');
const { LightService } = require('./application/light-service');
const { AmbientService } = require('./application/ambient-service');
const { MirrorService } = require('./application/mirror-service');
const { SettingsService } = require('./application/settings-service');

const APP_NAME = 'Ambi';
const LEGACY_DATA_DIR = 'control-tv-samsung'; // carpeta de datos antes del cambio de nombre

// ---------- Identidad y proceso (antes de que la app esté lista)
app.setName(APP_NAME);
const userData = path.join(app.getPath('appData'), APP_NAME);
app.setPath('userData', userData);
app.setAppUserModelId('ar.local.ambi');
// WebRTC: anunciar la IP real de la PC (no un nombre .local de mDNS) para que el visor de la TV la alcance.
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

const startHidden = process.argv.includes('--hidden');
let quitting = false;
let ctx = null; // piezas armadas en boot()

if (!app.requestSingleInstanceLock()) {
  app.quit(); // otra instancia ya corre: ella muestra su ventana (evento second-instance)
} else {
  app.on('second-instance', () => ctx?.window.show());
  app.whenReady().then(boot);
}

// La versión previa guardaba los datos en %APPDATA%\control-tv-samsung. Se copian una vez y se borra
// el original, que tenía los secretos en texto plano (el ConfigStore los vuelve a guardar cifrados).
function migrateLegacyData(configFile, logger) {
  const legacy = path.join(app.getPath('appData'), LEGACY_DATA_DIR, 'config.json');
  if (fs.existsSync(configFile) || !fs.existsSync(legacy)) return () => {};
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.copyFileSync(legacy, configFile);
  logger.info('configuración migrada desde la versión anterior');
  return () => { try { fs.rmSync(legacy); } catch (e) { logger.warn('no se pudo borrar la config anterior', e.message); } };
}

function boot() {
  const logger = createLogger({ file: path.join(userData, 'logs', 'ambi.log') });
  process.on('uncaughtException', (e) => logger.error('excepción no capturada', e));
  process.on('unhandledRejection', (e) => logger.error('promesa rechazada sin manejar', e));
  logger.info(`Ambi ${app.getVersion()} iniciando (Electron ${process.versions.electron})`);

  // ---------- Configuración
  const configFile = path.join(userData, 'config.json');
  const removeLegacy = migrateLegacyData(configFile, logger);
  const store = new ConfigStore({ file: configFile, cipher: safeStorageCipher, logger: logger.child('config') });
  const config = store.load();
  removeLegacy();
  const save = () => store.save();
  const state = new AppState();

  // ---------- Adaptadores de salida
  const getTvIp = () => config.tv.ip;
  const remote = new SamsungRemote({
    getIp: getTvIp, getToken: () => config.tv.token,
    setToken: (t) => { config.tv.token = t; save(); },
    logger: logger.child('remoto'),
  });
  const rest = new SamsungRest({ getIp: getTvIp });
  const volume = new UpnpVolume({ getIp: getTvIp });
  const smartthings = new SmartThingsClient({
    getState: () => config.smartthings, save,
    getModelHint: () => state.get().tv.device?.model || '',
  });
  const wiz = new WizUdp({ getState: () => config.light, save, getSubnetHint: getTvIp, logger: logger.child('wiz') });
  const capture = new ElectronCapture({ logger: logger.child('captura') });
  const signaling = new SignalingServer({ viewerHtmlPath: path.join(__dirname, '..', 'capture', 'viewer.html'), logger: logger.child('señalización') });
  const autostart = new Autostart();

  // ---------- Ventana (adaptador de entrada)
  let poller = null;
  const window = new MainWindow({
    ui: config.ui, save, startHidden,
    isQuitting: () => quitting,
    onVisibilityChange: (visible) => poller?.setVisible(visible),
  });

  // ---------- Servicios de aplicación
  const tv = new TvService({
    remote, rest, volume, wake, smartthings, config, save, state,
    authorize: (url) => authorizeInWindow({ url, redirectUri: REDIRECT_URI, parent: window.win }),
    discover: discoverSamsungTv,
    logger: logger.child('tv'),
  });
  const ambient = new AmbientService({ light: wiz, capture, config: config.ambient, save, state, logger: logger.child('ambiente') });
  const light = new LightService({
    light: wiz, state,
    beforeManualChange: () => (ambient.active ? ambient.stop({ restore: false }) : Promise.resolve()),
  });
  const mirror = new MirrorService({
    signaling, capture, getTvIp, getLocalIp: localIpFor, newToken, config: config.mirror, save, state,
    createCast: (host) => new CastClient({ host }),
    logger: logger.child('espejo'),
  });
  const settings = new SettingsService({ config, save, tv, onWindowPrefs: ({ alwaysOnTop }) => window.setAlwaysOnTop(alwaysOnTop) });

  // Un fallo en una parte (TV o luz) no impide actualizar la otra.
  poller = new StatusPoller({
    logger: logger.child('sondeo'),
    task: async (mode) => {
      const results = await Promise.allSettled([tv.poll(mode), light.poll()]);
      for (const r of results) if (r.status === 'rejected') logger.warn('sondeo parcial', r.reason?.message || r.reason);
    },
  });
  poller.visible = !startHidden;

  // ---------- Bandeja
  const windowApi = {
    showWindow: () => window.show(),
    toggleWindow: () => window.toggle(),
    hide: () => window.hide(),
    minimize: () => window.minimize(),
    quit: () => app.quit(),
    togglePower: () => tv.power().then(() => poller.runNow(900)),
    toggleLight: () => light.toggle(),
    toggleAmbient: () => (ambient.active ? ambient.stop() : ambient.start()),
    setAutostart: (on) => { const v = autostart.set(on); refreshTray(); return v; },
  };
  const tray = new AppTray({ actions: windowApi });
  const refreshTray = () => {
    const s = state.get();
    tray.update({ tv: s.tv, light: s.light, ambient: s.ambient, autostart: autostart.enabled });
  };

  // Estado → ventana y bandeja.
  state.on('change', (_section, value) => {
    window.send('state', value);
    refreshTray();
  });

  registerIpc({
    services: { tv, light, ambient, mirror, capture },
    state, settings, windowApi, autostart,
    // Solo la página principal de la ventana principal puede usar la API.
    isTrustedSender: (event) => event.sender === window.win.webContents && event.senderFrame === window.win.webContents.mainFrame,
    logger: logger.child('ipc'),
  });

  // Tras una acción del usuario, refrescar el estado pronto.
  const refreshSoon = () => poller.runNow(900);
  state.on('change', (section) => { if (section === 'remote' && state.get().remote.state === 'connected') refreshSoon(); });

  globalShortcut.register('Control+Alt+T', () => window.toggle());
  remote.connect();
  poller.start();
  refreshTray();

  ctx = { window, ambient, mirror, poller, remote, wiz, store, logger };
}

// Al salir con el modo ambiente activo, devolver la luz a como estaba.
app.on('before-quit', (e) => {
  quitting = true;
  if (!ctx?.ambient.active) return;
  e.preventDefault();
  ctx.ambient.stop().finally(() => app.quit());
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (!ctx) return;
  ctx.poller.stop();
  ctx.mirror.stop();
  ctx.remote.close();
  ctx.wiz.close();
  ctx.store.flush();
  ctx.logger.info('Ambi cerrado');
});

// Vive en la bandeja: cerrar la ventana no termina la app (se sale desde el menú del ícono).
app.on('window-all-closed', () => {});
