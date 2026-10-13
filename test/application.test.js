// Tests de la capa de aplicación con dobles de los puertos.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { AppState } = require('../src/main/application/app-state');
const { StatusPoller } = require('../src/main/application/status-poller');
const { TvService } = require('../src/main/application/tv-service');
const { AmbientService } = require('../src/main/application/ambient-service');
const { MirrorService } = require('../src/main/application/mirror-service');
const { LightService } = require('../src/main/application/light-service');
const { defaults } = require('../src/main/adapters/storage/config-store');

const tick = () => new Promise((r) => setImmediate(r));

function fakeRemote() {
  const r = new EventEmitter();
  r.keys = [];
  r.key = (code) => { r.keys.push(code); return true; };
  r.launchApp = () => true;
  r.reconnect = () => {};
  return r;
}

function tvService({ smartthings = { connected: false, st: {} }, info = null } = {}) {
  const config = defaults();
  config.tv.ip = '192.168.1.50';
  const remote = fakeRemote();
  const state = new AppState();
  const svc = new TvService({
    remote, state, config, save: () => {},
    rest: { info: async () => info, appStatus: async () => ({ installed: true, visible: false }), launchApp: async () => true },
    volume: { getVolume: async () => ({ volume: 15, muted: false }) },
    wake: async () => true, smartthings, authorize: async () => '', discover: async () => null,
  });
  return { svc, remote, state, config };
}

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

test('TvService.poll: TV apagada y respuestas incompletas no rompen', async () => {
  const { svc, state } = tvService({ info: null });
  await svc.poll('full');
  assert.equal(state.get().tv.power, 'off');
});

test('TvService.poll: estado completo con la TV encendida', async () => {
  const info = { device: { PowerState: 'on', name: 'TV', modelName: 'QN55Q65DAGCZB', wifiMac: 'AA:BB:CC:DD:EE:01' } };
  const { svc, state, config } = tvService({ info });
  await svc.poll('full');
  assert.equal(state.get().tv.power, 'on');
  assert.equal(state.get().tv.volume, 15);
  assert.equal(config.tv.mac, 'AA:BB:CC:DD:EE:01'); // MAC tomada de la TV
});

test('TvService.selectInput: con SmartThings elige el HDMI exacto y no usa KEY_HDMI', async () => {
  const sent = [];
  const st = { connected: true, st: {}, needsReauth: false, setInput: async (s) => { sent.push(s); } };
  const { svc, remote, state } = tvService({ smartthings: st });
  await svc.selectInput('ps5');
  assert.deepEqual(sent, ['HDMI2']);
  assert.deepEqual(remote.keys, []);
  assert.equal(state.get().tv.input, 'ps5');
});

test('TvService.selectInput: si SmartThings falla, informa el error en vez de adivinar con KEY_HDMI', async () => {
  const st = { connected: true, st: {}, needsReauth: false, setInput: async () => { throw new Error('nube caída'); } };
  const { svc, remote, state } = tvService({ smartthings: st });
  await assert.rejects(svc.selectInput('switch'), /nube caída/);
  assert.deepEqual(remote.keys, []);
  assert.equal(state.get().smartthings.error, 'nube caída');
});

test('TvService.selectInput: sin SmartThings alterna con KEY_HDMI', async () => {
  const { svc, remote } = tvService();
  await svc.selectInput('ps5');
  assert.deepEqual(remote.keys, ['KEY_HDMI']);
});

test('TvService.launchApp rechaza apps desconocidas', async () => {
  const { svc } = tvService();
  await assert.rejects(svc.launchApp('__proto__'));
  assert.equal(await svc.launchApp('netflix'), true);
});

function fakeLight(pilot = { state: true, sceneId: 11, dimming: 100 }) {
  return { fired: [], sets: [], getPilot: async () => pilot, fire(p) { this.fired.push(p); }, async set(p) { this.sets.push(p); return true; } };
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
  const amb = new AmbientService({ light, capture, config: { sourceId: null, maxDim: 60 }, save: () => {}, state });
  await amb.start({});
  await amb.start({ sourceId: 'screen:1:0' }); // cambio de pantalla con el modo activo
  assert.equal(capture.sessions[0].stopped, true);
  capture.sessions[0].onColor({ r: 1, g: 2, b: 3, level: 1 }); // sesión vieja: se ignora
  capture.sessions[1].onColor({ r: 255, g: 0, b: 0, level: 1 });
  assert.deepEqual(light.fired, [{ state: true, r: 255, g: 0, b: 0, dimming: 60 }]);
  assert.equal(state.get().ambient.on, true);
  await amb.stop();
  assert.deepEqual(light.sets, [{ state: true, sceneId: 11, dimming: 100 }]);
  assert.equal(state.get().ambient.on, false);
});

test('AmbientService: un error de captura apaga el modo y deja el mensaje visible', async () => {
  const light = fakeLight({ state: false });
  const capture = fakeCapture();
  const state = new AppState();
  const amb = new AmbientService({ light, capture, config: { sourceId: null, maxDim: 100 }, save: () => {}, state });
  await amb.start({});
  capture.sessions[0].onError('se cortó la captura');
  await tick(); await tick();
  assert.equal(state.get().ambient.on, false);
  assert.equal(state.get().ambient.error, 'se cortó la captura');
});

test('LightService: un cambio manual apaga primero el modo ambiente', async () => {
  const order = [];
  const light = { getPilot: async () => ({ state: true, dimming: 40 }), set: async () => { order.push('set'); return true; } };
  const svc = new LightService({ light, state: new AppState(), beforeManualChange: async () => { order.push('stop-ambient'); } });
  await svc.set({ state: true, r: 255, g: 0, b: 0 });
  assert.deepEqual(order, ['stop-ambient', 'set']);
  await assert.rejects(svc.set({ r: 999, g: 0, b: 0 }));
});

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
