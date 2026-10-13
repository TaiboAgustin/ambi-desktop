// Protocolo local de Philips WiZ: JSON sobre UDP al puerto 38899 (requiere "Permitir comunicación
// local" en la app WiZ). Una lámpara se identifica por MAC y se redescubre si cambia de IP (broadcast y,
// si el router no lo reenvía, barrido de la /24).
const dgram = require('dgram');
const { nullLogger } = require('../../adapters/logging/logger');

const PORT = 38899;
const REDISCOVER_MS = 30000;
const isPrefix = (p) => /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(p);
const prefixOf = (ip) => String(ip || '').split('.').slice(0, 3).join('.');

// Barre las /24 dadas con getPilot (broadcast + unicast). Devuelve una función para cortar el barrido.
function sweep(socket, prefixes, port, onDone, durationMs) {
  const probe = (ip) => socket.send(JSON.stringify({ method: 'getPilot', params: {} }), port, ip, () => {});
  for (const p of prefixes) probe(`${p}.255`);
  let i = 1;
  const timer = setInterval(() => {
    for (let k = 0; k < 25 && i < 255; k++, i++) for (const p of prefixes) probe(`${p}.${i}`);
    if (i >= 255) clearInterval(timer);
  }, 40);
  const end = setTimeout(() => { clearInterval(timer); onDone(); }, durationMs);
  return () => { clearInterval(timer); clearTimeout(end); };
}

// Descubre todas las lámparas WiZ que respondan en las subredes dadas: [{ address, mac }].
function discoverWiz({ subnets = [], port = PORT, timeoutMs = 4000 } = {}) {
  const prefixes = [...new Set(subnets.map(prefixOf))].filter(isPrefix);
  if (!prefixes.length) return Promise.resolve([]);
  return new Promise((resolve) => {
    const found = new Map();
    const socket = dgram.createSocket('udp4');
    let stop = () => {};
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      stop();
      try { socket.close(); } catch {}
      resolve([...found.values()]);
    };
    socket.on('error', finish);
    socket.on('message', (msg, rinfo) => {
      try {
        const mac = JSON.parse(msg.toString())?.result?.mac;
        if (typeof mac === 'string' && !found.has(mac)) found.set(mac, { address: rinfo.address, mac });
      } catch {}
    });
    socket.bind(() => {
      socket.setBroadcast(true);
      stop = sweep(socket, prefixes, port, finish, timeoutMs);
    });
  });
}

class WizUdp {
  // settings: objeto vivo { address, mac }; save(): persiste cambios de IP; getSubnets(): subredes locales.
  constructor({ settings, save, getSubnets = () => [], port = PORT, logger = nullLogger }) {
    Object.assign(this, { settings, persist: save, getSubnets, port, log: logger });
    this.lastDiscovery = 0;
    this.pending = new Map();
    this.nextId = 1;
    this.searching = null;
    this.socket = dgram.createSocket('udp4');
    // Sin este handler, un envío fallido (red caída, suspensión) tiraba abajo la app.
    this.socket.on('error', (e) => this.log.warn('socket UDP', e.message));
    this.socket.on('message', (msg, rinfo) => this.onMessage(msg, rinfo));
    this.ready = new Promise((resolve) => this.socket.bind(() => { this.socket.setBroadcast(true); resolve(); }));
  }

  onMessage(msg, rinfo) {
    let data;
    try { data = JSON.parse(msg.toString()); } catch { return; }
    if (!data || typeof data !== 'object') return;
    const waiter = this.pending.get(data.id);
    if (waiter && rinfo.address === waiter.address) { this.pending.delete(data.id); waiter.resolve(data); }
  }

  send(payload, address) {
    if (!address) return;
    this.socket.send(JSON.stringify(payload), this.port, address, (e) => { if (e) this.log.debug(`envío a ${address}`, e.message); });
  }

  async call(method, params = {}, timeoutMs = 1200) {
    await this.ready;
    const address = this.settings.address;
    if (!address) return null;
    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(id); resolve(null); }, timeoutMs);
      this.pending.set(id, { address, resolve: (d) => { clearTimeout(timer); resolve(d); } });
      this.send({ id, method, params }, address);
    });
  }

  // Vuelve a ubicar esta lámpara (por su MAC) si dejó de responder en la IP guardada.
  relocate() {
    this.searching ??= (async () => {
      this.lastDiscovery = Date.now();
      const subnets = [this.settings.address, ...this.getSubnets()].filter(Boolean);
      const bulbs = await discoverWiz({ subnets, port: this.port });
      const match = bulbs.find((b) => !this.settings.mac || b.mac === this.settings.mac);
      if (match && (match.address !== this.settings.address || match.mac !== this.settings.mac)) {
        Object.assign(this.settings, match);
        this.persist();
        this.log.info(`lámpara en ${match.address}`);
      }
      return match?.address || null;
    })().finally(() => { this.searching = null; });
    return this.searching;
  }

  // Respuesta cruda de getPilot o null; redescubre como mucho cada 30 s.
  async getPilot() {
    let res = this.settings.address ? await this.call('getPilot') : null;
    if (!res?.result && Date.now() - this.lastDiscovery > REDISCOVER_MS) {
      if (await this.relocate()) res = await this.call('getPilot');
    }
    return res?.result || null;
  }

  async set(params) {
    const res = await this.call('setPilot', params);
    return !!res?.result?.success;
  }

  // Sin esperar respuesta, para el modo ambiente: cada color reemplaza al anterior.
  fire(params) {
    this.send({ method: 'setPilot', params }, this.settings.address);
  }

  close() {
    try { this.socket.close(); } catch {}
  }
}

module.exports = { WizUdp, discoverWiz, PORT };
