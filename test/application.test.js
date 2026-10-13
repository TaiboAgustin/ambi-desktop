// Tests de la capa de aplicación con dobles de los puertos y de los dispositivos.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { AppState } = require('../src/main/application/app-state');
const { StatusPoller } = require('../src/main/application/status-poller');
const { TvService } = require('../src/main/application/tv-service');
const { AmbientService } = require('../src/main/application/ambient-service');
const { MirrorService } = require('../src/main/application/mirror-service');
const { LightService } = require('../src/main/application/light-service');
const { DeviceManager } = require('../src/main/application/device-manager');
const { DriverRegistry } = require('../src/main/drivers');
const { CAP } = require('../src/main/domain/capabilities');
const { defaults } = require('../src/main/adapters/storage/config-store');

const tick = () => new Promise((r) => setImmediate(r));

// ---------- Dobles
const TV_CAPS = [CAP.POWER, CAP.VOLUME, CAP.REMOTE_KEYS, CAP.APPS, CAP.INPUT_CYCLE, CAP.CAST_TARGET];
const LIGHT_CAPS = [CAP.POWER, CAP.BRIGHTNESS, CAP.COLOR, CAP.COLOR_TEMP, CAP.SCENES, CAP.COLOR_STREAM];

function fakeTv({ status = null } = {}) {
  const connection = new EventEmitter();
  connection.state = 'connected';
  const tv = {
    keys: [], cycles: 0, launched: [],
    connection,
    status: async () => status,
    volume: { get: async () => ({ volume: 15, muted: false }), set: async () => true, mute: async () => true },
    apps: { supported: ['netflix', 'youtube'], status: async () => ({ installed: true, visible: false }), launch: async (n) => { tv.launched.push(n); return true; } },
    inputs: { next: () => { tv.cycles++; return true; } },
    power: { toggle: async () => 'on' },
    cast: { host: '192.168.1.50' },
  };
  tv.keys.send = (k) => { tv.keys.push(k); return true; };
  return tv;
}

// DeviceManager mínimo: un dispositivo por tipo con sus capacidades.
function fakeDevices(map = {}) {
  const em = new EventEmitter();
  em.map = map;
  em.get = (kind) => map[kind]?.device || null;
  em.has = (kind, cap) => !!map[kind]?.caps.includes(cap);
  em.capabilities = (kind) => map[kind]?.caps || [];
  em.ensure = async () => null;
  return em;
}

function tvService({ smartthings = { connected: false, st: {} }, status = null } = {}) {
  const tv = fakeTv({ status });
  const devices = fakeDevices({ tv: { device: tv, caps: TV_CAPS } });
  const state = new AppState();
  const inputs = { ...defaults().inputs };
  const svc = new TvService({ devices, smartthings, inputs, save: () => {}, state, authorize: async () => '' });
  return { svc, tv, state, inputs };
}

// ---------- Sondeo
test('StatusPoller: un error no corta el ciclo y no hay ejecuciones superpuestas', async () => {
  const timers = [];
  let runs = 0, concurrent = 0, maxConcurrent = 0;
  const poller = new StatusPoller({
    task: async () => {
      runs++; concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
      await tick();
      concurrent--;
      if (runs === 1) throw new Error('falla de red');
    },
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimer: () => {},
  });
  poller.start();
  poller.runNow();
  poller.runNow(); // se encola una sola vez
  await tick(); await tick(); await tick(); await tick();
  assert.equal(maxConcurrent, 1);
  assert.equal(runs, 2);
  assert.ok(timers.length > 0, 'se reprogramó pese al error');
  poller.setVisible(false);
  assert.equal(timers.at(-1).ms, 3000);
});

// ---------- TV
test('TvService.poll: TV apagada y respuestas incompletas no rompen', async () => {
  const { svc, state } = tvService({ status: null });
  await svc.poll('full');
  assert.equal(state.get().tv.power, 'off');
});

test('TvService.poll: estado completo y apps no soportadas por el driver ocultas', async () => {
  const { svc, state } = tvService({ status: { power: 'on', device: { name: 'TV', chips: [] } } });
  await svc.poll('full');
  const tv = state.get().tv;
  assert.equal(tv.power, 'on');
  assert.equal(tv.volume, 15);
  assert.equal(tv.installed.netflix, true);
  assert.equal(tv.installed.spotify, false); // el driver de prueba no la soporta
  assert.deepEqual(tv.capabilities, TV_CAPS);
});

test('TvService: sin TV configurada busca una y avisa', async () => {
  const devices = fakeDevices({});
  let searched = false;
  devices.ensure = async () => { searched = true; return null; };
  const state = new AppState();
  const svc = new TvService({ devices, smartthings: { connected: false, st: {} }, inputs: defaults().inputs, save: () => {}, state });
  await svc.poll('full');
  assert.ok(searched);
  assert.match(state.get().remote.detail, /Buscando/);
  assert.throws(() => svc.key('up'), /no se encontró la TV/);
});

test('TvService: las teclas viajan normalizadas al driver', () => {
  const { svc, tv } = tvService();
  svc.key('volume-up');
  assert.deepEqual([...tv.keys], ['volume-up']);
});

test('TvService: una capacidad que el driver no tiene da un error claro', async () => {
  const tv = fakeTv();
  const devices = fakeDevices({ tv: { device: tv, caps: [CAP.POWER] } });
  const svc = new TvService({ devices, smartthings: { connected: false, st: {} }, inputs: defaults().inputs, save: () => {}, state: new AppState() });
  assert.throws(() => svc.setVolume(10), /no soporta/);
  await assert.rejects(svc.launchApp('netflix'), /no soporta/);
});

test('TvService.selectInput: con SmartThings elige el HDMI exacto sin ciclar', async () => {
  const sent = [];
  const st = { connected: true, st: {}, needsReauth: false, setInput: async (s) => { sent.push(s); } };
  const { svc, tv, state } = tvService({ smartthings: st });
  await svc.selectInput('ps5');
  assert.deepEqual(sent, ['HDMI2']);
  assert.equal(tv.cycles, 0);
  assert.equal(state.get().tv.input, 'ps5');
});

test('TvService.selectInput: si SmartThings falla, informa el error en vez de ciclar a ciegas', async () => {
  const st = { connected: true, st: {}, needsReauth: false, setInput: async () => { throw new Error('nube caída'); } };
  const { svc, tv, state } = tvService({ smartthings: st });
  await assert.rejects(svc.selectInput('switch'), /nube caída/);
  assert.equal(tv.cycles, 0);
  assert.equal(state.get().smartthings.error, 'nube caída');
});

test('TvService.selectInput: sin SmartThings usa la capacidad input-cycle', async () => {
  const { svc, tv } = tvService();
  await svc.selectInput('ps5');
  assert.equal(tv.cycles, 1);
});

test('TvService.launchApp rechaza apps desconocidas o no soportadas', async () => {
  const { svc, tv } = tvService();
  await assert.rejects(svc.launchApp('__proto__'));
  await assert.rejects(svc.launchApp('spotify'), /no está disponible/);
  assert.equal(await svc.launchApp('netflix'), true);
  assert.deepEqual(tv.launched, ['netflix']);
});

// ---------- Luz y modo ambiente
function fakeLight(status = { on: true, sceneId: 11, dimming: 100, temp: null, rgb: null }) {
  return { streamed: [], sets: [], status: async () => status, stream(p) { this.streamed.push(p); }, async set(p) { this.sets.push(p); return true; } };
}
function fakeCapture() {
  const sessions = [];
  return {
    sessions,
    listScreens: async () => [{ id: 'screen:0:0', name: 'Pantalla 1' }],
    startAmbient(opts) { const s = { ...opts, stopped: false, stop() { this.stopped = true; } }; sessions.push(s); return s; },
  };
}

test('AmbientService: aplica colores, ignora sesiones viejas y restaura la luz', async () => {
  const light = fakeLight();
  const capture = fakeCapture();
  const state = new AppState();
  const devices = fakeDevices({ light: { device: light, caps: LIGHT_CAPS } });
  const amb = new AmbientService({ devices, capture, config: { sourceId: null, maxDim: 60 }, save: () => {}, state });
  await amb.start({});
  await amb.start({ sourceId: 'screen:1:0' }); // cambio de pantalla con el modo activo
  assert.equal(capture.sessions[0].stopped, true);
  capture.sessions[0].onColor({ r: 1, g: 2, b: 3, level: 1 }); // sesión vieja: se ignora
  capture.sessions[1].onColor({ r: 255, g: 0, b: 0, level: 1 });
  assert.deepEqual(light.streamed, [{ state: true, r: 255, g: 0, b: 0, dimming: 60 }]);
  assert.equal(state.get().ambient.on, true);
  await amb.stop();
  assert.deepEqual(light.sets, [{ state: true, sceneId: 11, dimming: 100 }]);
  assert.equal(state.get().ambient.on, false);
});

test('AmbientService: una luz sin color-stream no puede usar el modo ambiente', async () => {
  const devices = fakeDevices({ light: { device: fakeLight(), caps: [CAP.POWER] } });
  const amb = new AmbientService({ devices, capture: fakeCapture(), config: {}, save: () => {}, state: new AppState() });
  await assert.rejects(amb.start({}), /no soporta/);
});

test('AmbientService: un error de captura apaga el modo y deja el mensaje visible', async () => {
  const capture = fakeCapture();
  const state = new AppState();
  const devices = fakeDevices({ light: { device: fakeLight({ on: false }), caps: LIGHT_CAPS } });
  const amb = new AmbientService({ devices, capture, config: { sourceId: null, maxDim: 100 }, save: () => {}, state });
  await amb.start({});
  capture.sessions[0].onError('se cortó la captura');
  await tick(); await tick();
  assert.equal(state.get().ambient.on, false);
  assert.equal(state.get().ambient.error, 'se cortó la captura');
});

test('LightService: un cambio manual apaga primero el modo ambiente', async () => {
  const order = [];
  const light = { status: async () => ({ on: true, dimming: 40 }), set: async () => { order.push('set'); return true; } };
  const devices = fakeDevices({ light: { device: light, caps: LIGHT_CAPS } });
  const svc = new LightService({ devices, state: new AppState(), beforeManualChange: async () => { order.push('stop-ambient'); } });
  await svc.set({ state: true, r: 255, g: 0, b: 0 });
  assert.deepEqual(order, ['stop-ambient', 'set']);
  await assert.rejects(svc.set({ r: 999, g: 0, b: 0 }));
});

// ---------- Gestor de dispositivos
function fakeDriver({ id, kind, found = [] }) {
  const created = [];
  return {
    id, kind, name: `Driver ${id}`, capabilities: kind === 'tv' ? [CAP.POWER] : [CAP.POWER, CAP.BRIGHTNESS],
    discoverCalls: 0, created,
    async discover() { this.discoverCalls++; return found; },
    create(opts) { const d = { opts, closed: false, connected: false, connect() { this.connected = true; }, close() { this.closed = true; } }; created.push(d); return d; },
  };
}

test('DeviceManager: descubre y agrega el primer dispositivo del tipo, una sola vez', async () => {
  const drv = fakeDriver({ id: 'tv-x', kind: 'tv', found: [{ address: '192.168.1.50', mac: 'AA', name: 'TV X' }] });
  const config = defaults();
  const mgr = new DeviceManager({ config, save: () => {}, registry: new DriverRegistry([drv]) });
  const [a, b] = await Promise.all([mgr.ensure('tv'), mgr.ensure('tv')]);
  assert.equal(a, b);
  assert.equal(drv.discoverCalls, 1);
  assert.deepEqual(config.devices.map((d) => [d.id, d.driver, d.settings.address]), [['tv', 'tv-x', '192.168.1.50']]);
  assert.equal(drv.created[0].connected, true);
});

test('DeviceManager: cambiar la IP borra credenciales y recrea la instancia', () => {
  const drv = fakeDriver({ id: 'tv-x', kind: 'tv' });
  const config = defaults();
  config.devices.push({ id: 'tv', kind: 'tv', driver: 'tv-x', name: 'TV', settings: { address: '1.1.1.1' }, secrets: { token: 'abc' } });
  const mgr = new DeviceManager({ config, save: () => {}, registry: new DriverRegistry([drv]) });
  const first = mgr.get('tv');
  mgr.upsert('tv', { address: '2.2.2.2' }, { resetSecrets: true });
  assert.equal(first.closed, true);
  assert.equal(config.devices[0].settings.address, '2.2.2.2');
  assert.equal(config.devices[0].secrets.token, '');
  assert.notEqual(mgr.get('tv'), first);
});

test('DeviceManager: un driver desconocido no rompe (dispositivo ignorado)', () => {
  const config = defaults();
  config.devices.push({ id: 'tv', kind: 'tv', driver: 'no-existe', settings: {}, secrets: {} });
  const mgr = new DeviceManager({ config, save: () => {}, registry: new DriverRegistry([]) });
  assert.equal(mgr.get('tv'), null);
});

// ---------- Espejo
test('MirrorService: detener mientras arranca ignora el resultado tardío de Cast', async () => {
  const signaling = new EventEmitter();
  signaling.open = async () => ({ viewerUrl: 'http://x/viewer?t=1', senderUrl: 'ws://127.0.0.1/signal' });
  signaling.close = async () => {};
  let rejectCast;
  const state = new AppState();
  const mirror = new MirrorService({
    signaling, state, config: { quality: 'nitido60' }, save: () => {},
    capture: { startMirrorSender: () => ({ stop() {} }) },
    createCast: () => ({ showUrl: () => new Promise((_, rej) => { rejectCast = rej; }), close() {} }),
    getTvIp: () => '192.168.1.50', getLocalIp: () => '192.168.1.20', newToken: () => 'tok',
  });
  mirror.start({ sourceId: 'screen:0:0', audio: false });
  await tick(); await tick();
  await mirror.stop();
  rejectCast(new Error('timeout de Cast'));
  await tick(); await tick();
  assert.equal(state.get().mirror.state, 'idle');
});

test('MirrorService: sin IP local en la red de la TV informa el error', async () => {
  const signaling = new EventEmitter();
  signaling.close = async () => {};
  const state = new AppState();
  const mirror = new MirrorService({
    signaling, state, config: {}, save: () => {}, capture: {}, createCast: () => null,
    getTvIp: () => '192.168.1.50', getLocalIp: () => null, newToken: () => 'tok',
  });
  await mirror.start({ sourceId: 'screen:0:0' });
  assert.equal(state.get().mirror.state, 'error');
  assert.match(state.get().mirror.detail, /IP de esta PC/);
});
