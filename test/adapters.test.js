// Tests de adaptadores contra servidores locales reales (HTTP, TLS, UDP, WebSocket) y regresiones
// de los bugs que tiraban abajo la app.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const dgram = require('dgram');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const { request } = require('../src/main/adapters/net/http-client');
const { localIpFor } = require('../src/main/adapters/net/local-ip');
const { ConfigStore } = require('../src/main/adapters/storage/config-store');
const { CastClient, encode, decode, splitFrames } = require('../src/main/adapters/cast/castv2');
const { WizUdp, discoverWiz } = require('../src/main/drivers/wiz/wiz-udp');
const { SignalingServer, newToken } = require('../src/main/adapters/mirror/signaling-server');
const { magicPacket } = require('../src/main/drivers/samsung-tizen/wake-on-lan');
const { SmartThingsClient } = require('../src/main/adapters/smartthings/client');

const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ambi-test-'));

// ---------- HTTP
test('http-client: una respuesta cortada a mitad del cuerpo resuelve null (antes quedaba colgada)', async () => {
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Length': 1000 });
    res.write('{"parcial":');
    setTimeout(() => req.socket.destroy(), 50);
  });
  const port = await listen(srv);
  const t0 = Date.now();
  assert.equal(await request({ host: '127.0.0.1', port, timeoutMs: 2000 }), null);
  assert.ok(Date.now() - t0 < 1900);
  srv.close();
});

test('http-client: timeout total aunque el servidor no responda nunca', async () => {
  const srv = http.createServer(() => {});
  const port = await listen(srv);
  assert.equal(await request({ host: '127.0.0.1', port, timeoutMs: 300 }), null);
  srv.closeAllConnections();
  srv.close();
});

test('http-client: respuesta normal y host inexistente', async () => {
  const srv = http.createServer((req, res) => res.end('{"ok":true}'));
  const port = await listen(srv);
  assert.deepEqual(await request({ host: '127.0.0.1', port }), { status: 200, body: '{"ok":true}' });
  srv.close();
  assert.equal(await request({ host: '127.0.0.1', port: 1, timeoutMs: 500 }), null);
});

test('localIpFor elige la interfaz de la misma red', () => {
  const ifaces = { eth: [{ family: 'IPv4', address: '10.0.0.5', internal: false }, { family: 'IPv4', address: '192.168.1.20', internal: false }] };
  assert.equal(localIpFor('192.168.1.50', ifaces), '192.168.1.20');
  assert.equal(localIpFor('172.16.0.1', ifaces), null);
});

// ---------- Configuración
test('ConfigStore: migra el formato anterior y cifra los secretos', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ ip: '192.168.1.50', mac: 'AA:BB', token: 'secreto-tv', ps5Hdmi: 2, switchHdmi: 1, lastInput: 'ps5', st: { refreshToken: 'rt', clientSecret: 'cs', deviceId: 'd1' }, light: { mac: 'aa', ip: '192.168.1.60' } }));
  const cipher = { available: () => true, encrypt: (s) => Buffer.from(`x:${s}`).toString('base64'), decrypt: (b) => Buffer.from(b, 'base64').toString().slice(2) };
  const store = new ConfigStore({ file, cipher });
  const cfg = store.load();
  // v0 (Hub TV) → v2: la TV y la luz pasan a ser dispositivos con su driver.
  const tv = cfg.devices.find((d) => d.kind === 'tv');
  const light = cfg.devices.find((d) => d.kind === 'light');
  assert.deepEqual({ driver: tv.driver, address: tv.settings.address, token: tv.secrets.token }, { driver: 'samsung-tizen', address: '192.168.1.50', token: 'secreto-tv' });
  assert.deepEqual({ driver: light.driver, address: light.settings.address }, { driver: 'wiz', address: '192.168.1.60' });
  assert.equal(cfg.inputs.onHdmi, true);
  assert.equal(cfg.smartthings.refreshToken, 'rt');
  const onDisk = fs.readFileSync(file, 'utf8');
  assert.ok(!onDisk.includes('secreto-tv') && !onDisk.includes('"rt"'), 'los secretos no quedan en texto plano');
  assert.equal(JSON.parse(onDisk).schemaVersion, 2);
  // Y se vuelven a leer bien.
  assert.equal(new ConfigStore({ file, cipher }).load().smartthings.clientSecret, 'cs');
});

test('ConfigStore: un archivo corrupto se respalda en vez de perderse', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, '{"tv": {"ip": "1.2.3');
  const cfg = new ConfigStore({ file }).load();
  assert.deepEqual(cfg.devices, []);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('config.corrupt-')));
});

test('ConfigStore: escritura atómica sin archivo temporal residual', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'config.json');
  const store = new ConfigStore({ file });
  store.load();
  store.data.ui.x = 120;
  store.flush();
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).ui.x, 120);
  assert.ok(!fs.existsSync(`${file}.tmp`));
});

test('ConfigStore: si el rename falla con EXDEV (AppData virtualizado) igual guarda', (t) => {
  const dir = tmpDir();
  const file = path.join(dir, 'config.json');
  const store = new ConfigStore({ file });
  store.load();
  t.mock.method(fs, 'renameSync', () => { const e = new Error('cross-device'); e.code = 'EXDEV'; throw e; });
  store.data.ui.x = 99;
  store.flush();
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).ui.x, 99);
  assert.ok(!fs.existsSync(`${file}.tmp`));
});

// ---------- Cast
test('castv2: codec ida y vuelta y separación de frames', () => {
  const frame = encode('sender-0', 'receiver-0', 'urn:x-cast:test', { type: 'PING', n: 1 });
  const { messages, rest } = splitFrames(Buffer.concat([frame, frame.subarray(0, 3)]));
  assert.equal(messages.length, 1);
  assert.equal(rest.length, 3);
  assert.deepEqual(messages[0], { source: 'sender-0', destination: 'receiver-0', namespace: 'urn:x-cast:test', payload: { type: 'PING', n: 1 } });
  assert.equal(decode(Buffer.from([0xff, 0xff, 0xff])), null); // basura no rompe
});

test('castv2: con la TV inalcanzable rechaza la promesa sin tirar el proceso (antes caía)', async () => {
  const c = new CastClient({ host: '127.0.0.1', port: 1, connectTimeoutMs: 1000 });
  await assert.rejects(c.showUrl('http://x'));
  c.close();
});

// ---------- WiZ
test('wiz-udp: getPilot/set contra una lámpara simulada', async () => {
  const bulb = dgram.createSocket('udp4');
  bulb.on('message', (msg, rinfo) => {
    const m = JSON.parse(msg);
    const result = m.method === 'getPilot' ? { mac: 'aabbccddeeff', state: true, dimming: 50, temp: 2700, sceneId: 0 } : { success: true };
    bulb.send(JSON.stringify({ id: m.id, method: m.method, result }), rinfo.port, rinfo.address);
  });
  const port = await new Promise((r) => bulb.bind(0, '127.0.0.1', () => r(bulb.address().port)));
  const settings = { mac: 'aabbccddeeff', address: '127.0.0.1' };
  const wiz = new WizUdp({ settings, save: () => {}, port });
  assert.equal((await wiz.getPilot()).dimming, 50);
  assert.equal(await wiz.set({ state: false }), true);
  wiz.close();
  bulb.close();
});

test('wiz-udp: un envío fallido no tira el proceso (antes caía por error sin manejar)', async () => {
  const settings = { mac: '', address: 'host-que-no-existe.invalid' };
  const wiz = new WizUdp({ settings, save: () => {} });
  wiz.fire({ state: true });
  assert.equal(await wiz.call('getPilot', {}, 300), null);
  await new Promise((r) => setTimeout(r, 500));
  wiz.close();
});

test('wake-on-lan: paquete mágico de 102 bytes con la MAC repetida', () => {
  const p = magicPacket('AA:BB:CC:DD:EE:01');
  assert.equal(p.length, 102);
  assert.ok(p.subarray(0, 6).every((b) => b === 0xff));
  assert.equal(p.subarray(6, 12).toString('hex'), 'aabbccddee01');
  assert.equal(magicPacket('mal'), null);
});

// ---------- Señalización del espejo
test('señalización: exige token y restringe roles (antes cualquiera veía la pantalla)', async () => {
  const dir = tmpDir();
  const viewer = path.join(dir, 'viewer.html');
  fs.writeFileSync(viewer, '<html>visor</html>');
  const srv = new SignalingServer({ viewerHtmlPath: viewer });
  const token = newToken();
  // La "TV" es 127.0.0.1 en este test.
  const { viewerUrl, senderUrl } = await srv.open({ token, viewerIp: '127.0.0.1', localIp: '127.0.0.1' });
  const port = new URL(viewerUrl).port;

  const get = (p) => new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${p}`, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(await get('/viewer?t=malo'), 404);
  assert.equal(await get(`/viewer?t=${token}`), 200);

  const closeCode = (url) => new Promise((r) => { const ws = new WebSocket(url); ws.on('close', (code) => r(code)); ws.on('error', () => {}); });
  assert.equal(await closeCode(`ws://127.0.0.1:${port}/signal?role=viewer&t=malo`), 1008);

  // Emisor y visor válidos: la oferta llega al visor y la respuesta al emisor.
  const sender = new WebSocket(senderUrl);
  await new Promise((r) => sender.on('open', r));
  const view = new WebSocket(`ws://127.0.0.1:${port}/signal?role=viewer&t=${token}`);
  const offer = new Promise((r) => view.on('message', (m) => r(JSON.parse(m))));
  await new Promise((r) => sender.on('message', (m) => { if (JSON.parse(m).type === 'viewer-ready') r(); }));
  sender.send(JSON.stringify({ type: 'offer', sdp: 'v=0' }));
  assert.deepEqual(await offer, { type: 'offer', sdp: 'v=0' });

  await srv.close();
  assert.equal(await get('/viewer').catch(() => 'cerrado'), 'cerrado'); // el servidor ya no escucha
});

// ---------- SmartThings
test('smartthings: refresh vencido marca "reconectar" y aplica backoff', async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls++;
    if (url.includes('oauth/token')) return { ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) };
    return { ok: true, status: 200, text: async () => '{}' };
  };
  const st = { clientId: 'c', clientSecret: 's', refreshToken: 'viejo', deviceId: 'd', inputCap: 'samsungvd.mediaInputSource' };
  const client = new SmartThingsClient({ getState: () => st, save: () => {}, fetchImpl });
  await assert.rejects(client.getInput());
  assert.equal(client.needsReauth, true);
  const before = calls;
  await assert.rejects(client.getInput(), /pausa/); // en backoff: ni siquiera sale a la red
  assert.equal(calls, before);
});
