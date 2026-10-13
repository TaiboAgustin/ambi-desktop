// Tests del contrato de drivers y de los drivers incluidos (Samsung Tizen y WiZ).
const test = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('dgram');
const { DriverRegistry, validateDriver, BUILT_IN } = require('../src/main/drivers');
const { REMOTE_KEYS, CAP } = require('../src/main/domain/capabilities');
const { APPS } = require('../src/main/domain/catalog');
const { KEYMAP } = require('../src/main/drivers/samsung-tizen/keymap');
const { TIZEN_APPS } = require('../src/main/drivers/samsung-tizen/apps');
const wizDriver = require('../src/main/drivers/wiz');
const { discoverWiz } = require('../src/main/drivers/wiz/wiz-udp');

test('todos los drivers incluidos cumplen el contrato', () => {
  for (const d of BUILT_IN) assert.deepEqual(validateDriver(d), [], `${d.id}: ${validateDriver(d).join(', ')}`);
  const reg = new DriverRegistry();
  assert.deepEqual(reg.ofKind('tv').map((d) => d.id), ['samsung-tizen']);
  assert.deepEqual(reg.ofKind('light').map((d) => d.id), ['wiz']);
});

test('el registro rechaza drivers inválidos o duplicados', () => {
  assert.throws(() => new DriverRegistry([{ id: 'Mal ID', name: 'x', kind: 'tv', capabilities: ['power'], discover() {}, create() {} }]), /id inválido/);
  assert.throws(() => new DriverRegistry([{ id: 'x', name: 'x', kind: 'heladera', capabilities: ['power'], discover() {}, create() {} }]), /kind inválido/);
  assert.throws(() => new DriverRegistry([{ id: 'x', name: 'x', kind: 'tv', capabilities: ['teletransporte'], discover() {}, create() {} }]), /capacidad desconocida/);
  const ok = { id: 'x', name: 'x', kind: 'tv', capabilities: ['power'], discover() {}, create() {} };
  assert.throws(() => new DriverRegistry([ok, ok]), /duplicado/);
});

test('Samsung: cada tecla normalizada tiene su código y cada app del driver existe en el catálogo', () => {
  for (const k of REMOTE_KEYS) assert.match(KEYMAP[k], /^KEY_[A-Z0-9]+$/, k);
  for (const name of Object.keys(TIZEN_APPS)) assert.ok(Object.hasOwn(APPS, name), name);
});

test('Samsung: el dispositivo expone las capacidades declaradas y no conecta sin IP', () => {
  const driver = require('../src/main/drivers/samsung-tizen');
  const settings = { address: '', mac: '' };
  const dev = driver.create({ settings, secrets: {}, save: () => {} });
  for (const [cap, prop] of [[CAP.VOLUME, 'volume'], [CAP.REMOTE_KEYS, 'keys'], [CAP.APPS, 'apps'], [CAP.INPUT_CYCLE, 'inputs'], [CAP.CAST_TARGET, 'cast'], [CAP.POWER, 'power']]) {
    assert.ok(driver.capabilities.includes(cap));
    assert.ok(dev[prop], `falta ${prop}`);
  }
  assert.equal(dev.keys.send('up'), false);          // sin conexión: no envía
  assert.equal(dev.keys.send('teletransporte'), false); // tecla desconocida
  dev.close();
});

test('WiZ: el dispositivo devuelve estado normalizado contra una lámpara simulada', async () => {
  const bulb = dgram.createSocket('udp4');
  const received = [];
  bulb.on('message', (msg, rinfo) => {
    const m = JSON.parse(msg);
    received.push(m);
    const result = m.method === 'getPilot' ? { mac: 'aabbccddee02', state: true, dimming: 70, r: 255, g: 0, b: 0, sceneId: 0 } : { success: true };
    if (m.id !== undefined) bulb.send(JSON.stringify({ id: m.id, method: m.method, result }), rinfo.port, rinfo.address);
  });
  const port = await new Promise((r) => bulb.bind(0, '127.0.0.1', () => r(bulb.address().port)));
  // El driver usa el puerto estándar; para el test se crea el adaptador con el puerto del simulador.
  const { WizUdp } = require('../src/main/drivers/wiz/wiz-udp');
  const udp = new WizUdp({ settings: { address: '127.0.0.1', mac: 'aabbccddee02' }, save: () => {}, port });
  assert.deepEqual(wizDriver.normalizePilot(await udp.getPilot()), { on: true, dimming: 70, temp: null, sceneId: 0, rgb: [255, 0, 0] });
  udp.fire({ state: true, r: 0, g: 0, b: 255 });
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(received.some((m) => m.method === 'setPilot' && m.params.b === 255));
  udp.close();
  bulb.close();
});

test('WiZ: el descubrimiento encuentra lámparas por subred sin depender de la TV', async () => {
  const bulb = dgram.createSocket('udp4');
  bulb.on('message', (msg, rinfo) => bulb.send(JSON.stringify({ method: 'getPilot', result: { mac: 'aabbccddee03', state: false } }), rinfo.port, rinfo.address));
  const port = await new Promise((r) => bulb.bind(0, '127.0.0.1', () => r(bulb.address().port)));
  const found = await discoverWiz({ subnets: ['127.0.0.1'], port, timeoutMs: 1500 });
  assert.ok(found.some((b) => b.mac === 'aabbccddee03' && b.address === '127.0.0.1'));
  bulb.close();
});
