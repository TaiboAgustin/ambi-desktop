// Cliente mínimo de Google Cast (CASTV2), implementa CastPort.
// TLS en :8009 con mensajes protobuf `CastMessage` precedidos por su longitud. La TV es receptora
// Cast (anuncia _googlecast por mDNS). Se usa para abrir DashCast (receptor público que muestra
// cualquier URL) con el visor del espejo.
//
// Los fallos se informan SOLO por promesas rechazadas: antes se emitía un evento 'error' sin
// listener, lo que tiraba abajo el proceso al espejar con la TV apagada.
const tls = require('tls');

const DASHCAST_APP = '84912283';
const DASHCAST_NS = 'urn:x-cast:com.madmod.dashcast';
const NS = {
  conn: 'urn:x-cast:com.google.cast.tp.connection',
  heartbeat: 'urn:x-cast:com.google.cast.tp.heartbeat',
  receiver: 'urn:x-cast:com.google.cast.receiver',
};
const MAX_FRAME = 64 * 1024;

// ---------- Codec protobuf mínimo de CastMessage
const varint = (n) => { const b = []; while (n > 127) { b.push((n & 127) | 128); n >>>= 7; } b.push(n); return Buffer.from(b); };
const field = (num, wire, val) => Buffer.concat([varint((num << 3) | wire), val]);
const str = (num, s) => { const b = Buffer.from(s, 'utf8'); return field(num, 2, Buffer.concat([varint(b.length), b])); };

function encode(source, destination, namespace, payload) {
  const body = Buffer.concat([
    field(1, 0, varint(0)), // protocol_version CASTV2_1_0
    str(2, source), str(3, destination), str(4, namespace),
    field(5, 0, varint(0)), // payload_type STRING
    str(6, JSON.stringify(payload)),
  ]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  return Buffer.concat([len, body]);
}

function decode(buf) {
  const out = {};
  let i = 0;
  const readVarint = () => {
    let r = 0, s = 0, b;
    do {
      if (i >= buf.length || s > 28) throw new Error('varint inválido');
      b = buf[i++]; r |= (b & 127) << s; s += 7;
    } while (b & 128);
    return r >>> 0;
  };
  try {
    while (i < buf.length) {
      const key = readVarint();
      const num = key >> 3, wire = key & 7;
      if (wire === 0) out[num] = readVarint();
      else if (wire === 2) { const l = readVarint(); out[num] = buf.subarray(i, i + l).toString('utf8'); i += l; }
      else break;
    }
  } catch { return null; }
  let payload = null;
  try { payload = JSON.parse(out[6]); } catch {}
  return { source: out[2], destination: out[3], namespace: out[4], payload };
}

// Separa un flujo TCP en frames [len:u32][body]. Devuelve { messages, rest }.
function splitFrames(acc) {
  const messages = [];
  while (acc.length >= 4) {
    const len = acc.readUInt32BE(0);
    if (len > MAX_FRAME) throw new Error('frame Cast demasiado grande');
    if (acc.length < 4 + len) break;
    const msg = decode(acc.subarray(4, 4 + len));
    if (msg) messages.push(msg);
    acc = acc.subarray(4 + len);
  }
  return { messages, rest: acc };
}

// ---------- Cliente
class CastClient {
  constructor({ host, port = 8009, connectTimeoutMs = 6000 }) {
    Object.assign(this, { host, port, connectTimeoutMs });
    this.socket = null;
    this.requestId = 1;
    this.sessionId = null;
    this.listeners = new Set();
    this.closed = false;
  }

  connect() {
    if (this.socket) return Promise.resolve();
    if (this.closed) return Promise.reject(new Error('Conexión Cast cerrada'));
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = tls.connect({ host: this.host, port: this.port, rejectUnauthorized: false });
      const timer = setTimeout(() => socket.destroy(new Error('La TV no respondió por Cast')), this.connectTimeoutMs);
      socket.once('secureConnect', () => {
        clearTimeout(timer);
        settled = true;
        this.socket = socket;
        this.send('receiver-0', NS.conn, { type: 'CONNECT' });
        this.heartbeat = setInterval(() => this.send('receiver-0', NS.heartbeat, { type: 'PING' }), 5000);
        resolve();
      });
      let acc = Buffer.alloc(0);
      socket.on('data', (data) => {
        try {
          const { messages, rest } = splitFrames(Buffer.concat([acc, data]));
          acc = rest;
          for (const msg of messages) {
            if (msg.namespace === NS.heartbeat && msg.payload?.type === 'PING') this.send(msg.source, NS.heartbeat, { type: 'PONG' });
            else if (msg.payload) for (const fn of [...this.listeners]) fn(msg);
          }
        } catch { socket.destroy(); }
      });
      socket.on('error', (e) => {
        clearTimeout(timer);
        if (!settled) { settled = true; reject(e); }
      });
      socket.on('close', () => {
        clearTimeout(timer);
        clearInterval(this.heartbeat);
        this.socket = null;
        if (!settled) { settled = true; reject(new Error('La TV cerró la conexión Cast')); }
        for (const fn of [...this.listeners]) fn({ closed: true }); // cortar esperas pendientes
      });
    });
  }

  send(destination, namespace, payload) {
    if (this.socket?.writable) this.socket.write(encode('sender-0', destination, namespace, payload));
  }

  // Espera un mensaje del receptor que cumpla `match` (devuelve un valor no undefined).
  waitFor(match, timeoutMs, timeoutMsg) {
    return new Promise((resolve, reject) => {
      const onMsg = (msg) => {
        if (msg.closed) { cleanup(); reject(new Error('Se cortó la conexión Cast con la TV')); return; }
        let result;
        try { result = match(msg); } catch (e) { cleanup(); reject(e); return; }
        if (result !== undefined) { cleanup(); resolve(result); }
      };
      const timer = setTimeout(() => { cleanup(); reject(new Error(timeoutMsg)); }, timeoutMs);
      const cleanup = () => { clearTimeout(timer); this.listeners.delete(onMsg); };
      this.listeners.add(onMsg);
    });
  }

  async getStatus(timeoutMs = 5000) {
    const requestId = this.requestId++;
    const wait = this.waitFor((m) => (m.namespace === NS.receiver && m.payload.requestId === requestId ? m.payload.status || null : undefined), timeoutMs, 'Sin respuesta de estado Cast')
      .catch(() => null);
    this.send('receiver-0', NS.receiver, { type: 'GET_STATUS', requestId });
    return wait;
  }

  // Abre DashCast y le carga la URL. La primera vez la TV pide autorizar a esta PC (onAuthPending).
  async showUrl(url, { onAuthPending = () => {}, timeoutMs = 90000 } = {}) {
    await this.connect();
    // DashCast con `force` navega fuera de sí mismo hacia la URL: una sesión previa ya no acepta
    // URLs nuevas, así que se cierra y se lanza una limpia.
    const previous = (await this.getStatus())?.applications?.find((a) => a.appId === DASHCAST_APP);
    if (previous) {
      this.send('receiver-0', NS.receiver, { type: 'STOP', requestId: this.requestId++, sessionId: previous.sessionId });
      await new Promise((r) => setTimeout(r, 1500));
    }
    const requestId = this.requestId++;
    const ready = this.waitFor(({ namespace, payload }) => {
      if (namespace !== NS.receiver) return undefined;
      if (payload.type === 'LAUNCH_STATUS' && payload.status === 'USER_PENDING_AUTHORIZATION') onAuthPending();
      if (payload.type === 'LAUNCH_STATUS' && payload.status === 'USER_DENIED') throw new Error('La TV rechazó la transmisión');
      if (payload.type === 'LAUNCH_ERROR') throw new Error(`Cast: ${payload.reason || 'no se pudo abrir el receptor'}`);
      const app = payload.status?.applications?.find((a) => a.appId === DASHCAST_APP);
      return payload.type === 'RECEIVER_STATUS' && app?.statusText === 'Application ready' ? app : undefined;
    }, timeoutMs, 'La TV no abrió el receptor a tiempo');
    this.send('receiver-0', NS.receiver, { type: 'LAUNCH', requestId, appId: DASHCAST_APP });
    const app = await ready;
    this.sessionId = app.sessionId;
    this.send(app.transportId, NS.conn, { type: 'CONNECT' });
    this.send(app.transportId, DASHCAST_NS, { url, force: true, reload: false, reload_time: 0 });
  }

  close() {
    this.closed = true;
    if (this.sessionId) this.send('receiver-0', NS.receiver, { type: 'STOP', requestId: this.requestId++, sessionId: this.sessionId });
    this.sessionId = null;
    this.listeners.clear();
    clearInterval(this.heartbeat);
    const s = this.socket;
    this.socket = null;
    s?.end();
  }
}

module.exports = { CastClient, encode, decode, splitFrames };
