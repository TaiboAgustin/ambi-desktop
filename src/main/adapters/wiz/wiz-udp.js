// Lámpara Philips WiZ por la red local (implementa LightPort): JSON sobre UDP al puerto 38899.
// Requiere "Permitir comunicación local" en la app WiZ. Se identifica por MAC y se redescubre si
// cambia de IP (broadcast y, si el router no lo reenvía, barrido de la /24).
const dgram = require('dgram');
const { nullLogger } = require('../logging/logger');

const PORT = 38899;
const REDISCOVER_MS = 30000;

class WizUdp {
  // state: objeto vivo { mac, ip }; save(): persiste cambios de IP.
  constructor({ getState, save, getSubnetHint = () => '', port = PORT, logger = nullLogger }) {
    Object.assign(this, { getState, persist: save, getSubnetHint, port, log: logger });
    this.lastDiscovery = 0;
    this.pending = new Map();
    this.nextId = 1;
    this.onDiscovery = null;
    this.socket = dgram.createSocket('udp4');
    // Sin este handler, un envío fallido (red caída, suspensión) tiraba abajo la app.
    this.socket.on('error', (e) => this.log.warn('socket UDP', e.message));
    this.socket.on('message', (msg, rinfo) => this.onMessage(msg, rinfo));
    this.ready = new Promise((resolve) => this.socket.bind(() => { this.socket.setBroadcast(true); resolve(); }));
  }

  get light() { return this.getState(); }

  onMessage(msg, rinfo) {
    let data;
    try { data = JSON.parse(msg.toString()); } catch { return; }
    if (!data || typeof data !== 'object') return;
    const waiter = this.pending.get(data.id);
    if (waiter && rinfo.address === waiter.ip) { this.pending.delete(data.id); waiter.resolve(data); }
    this.onDiscovery?.(data, rinfo.address);
  }

  send(payload, ip) {
    if (!ip) return;
    this.socket.send(JSON.stringify(payload), this.port, ip, (e) => { if (e) this.log.debug(`envío a ${ip}`, e.message); });
  }

  async call(method, params = {}, timeoutMs = 1200) {
    await this.ready;
    const ip = this.light.ip;
    if (!ip) return null;
    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(id); resolve(null); }, timeoutMs);
      this.pending.set(id, { ip, resolve: (d) => { clearTimeout(timer); resolve(d); } });
      this.send({ id, method, params }, ip);
    });
  }

  // Busca la lámpara por su MAC (o la primera que responda, si todavía no hay MAC guardada).
  async discover() {
    await this.ready;
    if (this.onDiscovery) return null; // ya hay una búsqueda en curso
    this.lastDiscovery = Date.now();
    const mac = this.light.mac;
    const prefix = (this.light.ip || this.getSubnetHint() || '').split('.').slice(0, 3).join('.');
    if (!/^\d+\.\d+\.\d+$/.test(prefix)) return null;
    return new Promise((resolve) => {
      let sweep = null;
      const finish = (found) => {
        this.onDiscovery = null;
        clearInterval(sweep);
        clearTimeout(timer);
        if (found) {
          const changed = found.ip !== this.light.ip || found.mac !== this.light.mac;
          Object.assign(this.light, found);
          if (changed) { this.persist(); this.log.info(`lámpara en ${found.ip}`); }
        }
        resolve(found?.ip || null);
      };
      this.onDiscovery = (data, ip) => {
        const foundMac = data.result?.mac;
        if (foundMac && (!mac || foundMac === mac)) finish({ ip, mac: foundMac });
      };
      const probe = (ip) => this.send({ method: 'getPilot', params: {} }, ip);
      probe(`${prefix}.255`);
      let i = 1;
      sweep = setInterval(() => {
        for (let k = 0; k < 25 && i < 255; k++, i++) probe(`${prefix}.${i}`);
        if (i >= 255) clearInterval(sweep);
      }, 40);
      const timer = setTimeout(() => finish(null), 4000);
    });
  }

  // Respuesta cruda de getPilot o null; redescubre como mucho cada 30 s.
  async getPilot() {
    let res = this.light.ip ? await this.call('getPilot') : null;
    if (!res?.result && Date.now() - this.lastDiscovery > REDISCOVER_MS) {
      if (await this.discover()) res = await this.call('getPilot');
    }
    return res?.result || null;
  }

  async set(params) {
    const res = await this.call('setPilot', params);
    return !!res?.result?.success;
  }

  // Sin esperar respuesta, para el modo ambiente: cada color reemplaza al anterior.
  fire(params) {
    this.send({ method: 'setPilot', params }, this.light.ip);
  }

  close() {
    try { this.socket.close(); } catch {}
  }
}

module.exports = { WizUdp };
