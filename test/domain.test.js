// Tests del dominio (código puro).
const test = require('node:test');
const assert = require('node:assert/strict');
const { describeModel, parseDeviceInfo } = require('../src/main/drivers/samsung-tizen/model');
const { HdmiCycle } = require('../src/main/domain/input-policy');
const { lightCommand, dimmingFor, restoreCommands } = require('../src/main/domain/light');
const { normalizePilot } = require('../src/main/drivers/wiz');
const V = require('../src/main/domain/validation');
const { dominant } = require('../src/shared/color');

test('describeModel decodifica tamaño, serie y año de Samsung', () => {
  assert.deepEqual(describeModel('QN55Q65DAGCZB'), { short: 'QN55Q65D', size: 55, year: 2024, qled: true });
  assert.equal(describeModel('raro').qled, false);
});

test('parseDeviceInfo tolera respuestas incompletas (antes cortaba el sondeo)', () => {
  assert.equal(parseDeviceInfo(null), null);
  assert.equal(parseDeviceInfo({}), null);
  assert.equal(parseDeviceInfo({ device: 'x' }), null);
  const p = parseDeviceInfo({ version: '2.0.25', device: { PowerState: 'on', name: '55&quot; QLED', modelName: 'QN55Q65DAGCZB', resolution: '3840x2160', OS: 'Tizen', networkType: 'wireless', wifiMac: 'AA:BB:CC:DD:EE:01' } });
  assert.equal(p.power, 'on');
  assert.equal(p.device.name, '55" QLED');
  assert.deepEqual(p.device.chips.map((c) => c.text), ['QLED', '4K UHD', '2024', 'Tizen OS', 'Wi-Fi']);
  assert.equal(parseDeviceInfo({ device: { PowerState: 'standby' } }).power, 'standby');
});

test('HdmiCycle: pulsaciones de KEY_HDMI según lo que se cree que muestra la TV', () => {
  const c = new HdmiCycle({ lastHdmi: 'ps5', onHdmi: false });
  assert.equal(c.select('ps5'), 1);      // desde una app vuelve a la última HDMI
  assert.equal(c.current, 'ps5');
  assert.equal(c.select('switch'), 1);   // ya en HDMI: una pulsación cambia
  c.leftHdmi();
  assert.equal(c.current, null);
  assert.equal(c.select('ps5'), 2);      // desde una app a la otra consola: dos
  assert.equal(c.next(), 1);
  assert.equal(c.current, 'switch');
  c.confirm(null);
  assert.equal(c.current, null);
  assert.throws(() => c.select('xbox'));
});

test('normalizePilot rechaza respuestas con forma inesperada', () => {
  assert.equal(normalizePilot(null), null);
  assert.equal(normalizePilot({ state: 'si' }), null);
  assert.deepEqual(normalizePilot({ state: true, sceneId: 11, temp: 2700, dimming: 100 }), { on: true, dimming: 100, temp: 2700, sceneId: 11, rgb: null });
  assert.deepEqual(normalizePilot({ state: true, r: 1, g: 2, b: 3, dimming: '<b>' }).dimming, null);
});

test('lightCommand valida y acota comandos de la UI', () => {
  assert.deepEqual(lightCommand({ state: true, dimming: 3 }), { state: true, dimming: 10 });
  assert.deepEqual(lightCommand({ temp: 9000 }), { temp: 6500 });
  assert.deepEqual(lightCommand({ r: 0, g: 128, b: 255 }), { r: 0, g: 128, b: 255 });
  assert.throws(() => lightCommand({ r: 300, g: 0, b: 0 }));
  assert.throws(() => lightCommand({ sceneId: 1.5 }));
  assert.throws(() => lightCommand({}));
  assert.throws(() => lightCommand({ dimming: 'mucho' }));
});

test('dimmingFor respeta el mínimo y el máximo elegido', () => {
  assert.equal(dimmingFor(0, 100), 10);
  assert.equal(dimmingFor(1, 100), 100);
  assert.equal(dimmingFor(1, 40), 40);
  assert.equal(dimmingFor(5, 40), 40);
});

test('restoreCommands devuelve la lámpara a su estado previo', () => {
  assert.deepEqual(restoreCommands(null), []);
  assert.deepEqual(restoreCommands({ on: false }), [{ state: false }]);
  // Apagada: recupera también su tono sin encenderse.
  assert.deepEqual(restoreCommands({ on: false, temp: 2700, dimming: 100 }), [{ state: false, temp: 2700, dimming: 100 }]);
  assert.deepEqual(restoreCommands({ on: true, sceneId: 11, dimming: 100 }), [{ state: true, sceneId: 11, dimming: 100 }]);
  assert.deepEqual(restoreCommands({ on: true, temp: 2700, dimming: 50 }), [{ state: true, temp: 2700, dimming: 50 }]);
  assert.deepEqual(restoreCommands({ on: true, rgb: [1, 2, 3], dimming: 20 }), [{ state: true, r: 1, g: 2, b: 3, dimming: 20 }]);
});

test('validaciones de ajustes: lista blanca y formatos', () => {
  assert.deepEqual(V.settingsPatch({ ip: ' 192.168.1.50 ', mac: 'aabbccddee01', alwaysOnTop: 1, ps5Hdmi: '2', token: 'robado' }),
    { ip: '192.168.1.50', mac: 'AA:BB:CC:DD:EE:01', alwaysOnTop: true, ps5Hdmi: 2 });
  assert.throws(() => V.settingsPatch({ ip: 'evil.com' }), V.ValidationError);
  assert.throws(() => V.settingsPatch({ ip: '300.1.1.1' }), V.ValidationError);
  assert.throws(() => V.settingsPatch({ mac: 'zz' }), V.ValidationError);
  assert.throws(() => V.settingsPatch({ ps5Hdmi: 9 }), V.ValidationError);
  assert.ok(V.isRemoteKey('volume-up') && V.isRemoteKey('7'));
  assert.ok(!V.isRemoteKey('KEY_VOLUP') && !V.isRemoteKey('__proto__'));
  assert.ok(V.isKeyAction('press') && !V.isKeyAction('Click'));
  assert.ok(V.isAppName('netflix') && !V.isAppName('__proto__'));
  assert.ok(V.isScreenId('screen:0:0') && !V.isScreenId('window:1'));
});

test('color dominante: intensifica colores y deja blanco lo gris', () => {
  const img = (rgb, n = 64) => { const d = new Uint8ClampedArray(n * 4); for (let i = 0; i < n; i++) d.set([...rgb, 255], i * 4); return d; };
  const red = dominant(img([150, 60, 60]));
  assert.deepEqual([red.r, red.g, red.b].map(Math.round), [255, 0, 0]);
  const gray = dominant(img([200, 200, 205]));
  assert.ok(gray.r > 240 && gray.g > 240 && gray.b > 240);
  const black = dominant(img([0, 0, 0]));
  assert.equal(black.level, 0);
});
