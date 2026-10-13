// Control remoto de Samsung Tizen por WebSocket (implementa TvRemotePort).
//   wss://IP:8002/api/v2/channels/samsung.remote.control?name=<b64>&token=<t>
// La TV muestra un aviso la primera vez; al aceptar responde {event:"ms.channel.connect", data:{token}}
// y ese token evita el aviso después.
const WebSocket = require('ws');
const { EventEmitter } = require('events');
const { nullLogger } = require('../logging/logger');

// Nombre con el que la PC aparece en la TV (Ajustes → Conexión → Administrador de dispositivos).
const APP_NAME = Buffer.from('Ambi').toString('base64');
const RETRY_MS = 5000;

class SamsungRemote extends EventEmitter {
  // getIp(): IP actual; getToken()/setToken(t): token de emparejamiento.
  constructor({ getIp, getToken, setToken, logger = nullLogger }) {
    super();
    Object.assign(this, { getIp, getToken, setToken, log: logger });
    this.ws = null;
    this.state = 'idle';
    this.retryTimer = null;
  }

  setState(state, detail = '') {
    if (state === this.state && !detail) return;
    this.state = state;
    this.emit('state', { state, detail });
  }

  connect() {
    clearTimeout(this.retryTimer);
    if (this.ws) return;
    const ip = this.getIp();
    if (!ip) { this.setState('idle', 'Buscando la TV en la red…'); this.scheduleRetry(); return; }

    const token = this.getToken();
    const url = `wss://${ip}:8002/api/v2/channels/samsung.remote.control?name=${APP_NAME}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
    this.setState('connecting');
    // Certificado autofirmado de la TV.
    const ws = new WebSocket(url, { rejectUnauthorized: false, handshakeTimeout: 4000 });
    this.ws = ws;

    ws.on('open', () => {
      // Sin token, la TV deja el socket abierto hasta que el usuario acepta el aviso en pantalla.
      if (!token && this.ws === ws) this.setState('pairing', 'Aceptá el aviso en la TV');
    });
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.event === 'ms.channel.connect') {
        const newToken = msg.data?.token;
        if (newToken && newToken !== this.getToken()) this.setToken(String(newToken));
        this.setState('connected');
      } else if (msg.event === 'ms.channel.unauthorized') {
        this.setState('denied', 'La TV rechazó la conexión');
      } else if (msg.event === 'ms.channel.timeOut') {
        this.setState('denied', 'No se aceptó a tiempo en la TV');
      }
    });
    ws.on('close', () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.state === 'denied') return; // no reintentar: hay que volver a emparejar a mano
      this.setState('offline');
      this.scheduleRetry();
    });
    ws.on('error', (e) => this.log.debug('ws', e.message)); // 'close' se dispara a continuación
  }

  scheduleRetry() {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(), RETRY_MS);
  }

  reconnect() {
    clearTimeout(this.retryTimer);
    const old = this.ws;
    this.ws = null;
    if (old) { old.removeAllListeners('close'); old.terminate(); }
    this.state = 'idle';
    this.connect();
  }

  close() {
    clearTimeout(this.retryTimer);
    const old = this.ws;
    this.ws = null;
    old?.terminate();
  }

  send(obj) {
    if (this.state !== 'connected' || this.ws?.readyState !== WebSocket.OPEN) return false;
    try { this.ws.send(JSON.stringify(obj)); return true; } catch { return false; }
  }

  key(code, cmd = 'Click') {
    return this.send({ method: 'ms.remote.control', params: { Cmd: cmd, DataOfCmd: code, Option: 'false', TypeOfRemote: 'SendRemoteKey' } });
  }

  // Respaldo para abrir apps si el POST por REST falla (en este modelo la TV lo ignora).
  launchApp(appId) {
    return this.send({ method: 'ms.channel.emit', params: { event: 'ed.apps.launch', to: 'host', data: { appId, action_type: 'DEEP_LINK' } } });
  }
}

module.exports = { SamsungRemote };
