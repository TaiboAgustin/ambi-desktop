// Servidor del espejo (implementa SignalingPort): sirve el visor a la TV y hace de señalización
// WebRTC entre el emisor (ventana oculta de la PC) y el visor (navegador Cast de la TV).
//
// Seguridad (antes escuchaba en toda la red sin autenticación y quedaba abierto para siempre):
//   - token aleatorio por sesión, obligatorio en la página y en el WebSocket;
//   - el emisor solo se acepta desde loopback y el visor solo desde la IP de la TV;
//   - el servidor existe solo mientras dura la sesión.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const { EventEmitter } = require('events');
const { WebSocketServer } = require('ws');
const { nullLogger } = require('../logging/logger');

const PREFERRED_PORT = 8765;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const MAX_MESSAGE = 256 * 1024;

const sameToken = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const plainIp = (addr = '') => addr.replace(/^::ffff:/, '');

class SignalingServer extends EventEmitter {
  constructor({ viewerHtmlPath, logger = nullLogger }) {
    super();
    this.viewerHtmlPath = viewerHtmlPath;
    this.log = logger;
    this.server = null;
    this.wss = null;
    this.sender = null;
    this.viewer = null;
  }

  // Abre el servidor para una sesión. localIp: IP de la PC en la red de la TV.
  async open({ token, viewerIp, localIp }) {
    await this.close();
    this.token = token;
    this.viewerIp = viewerIp;
    const viewerHtml = fs.readFileSync(this.viewerHtmlPath);

    this.server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      const ip = plainIp(req.socket.remoteAddress);
      if (url.pathname === '/viewer' && ip === this.viewerIp && sameToken(url.searchParams.get('t'), this.token)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        res.end(viewerHtml);
        return;
      }
      this.log.warn(`pedido rechazado de ${ip} a ${url.pathname}`);
      res.writeHead(404);
      res.end();
    });
    this.wss = new WebSocketServer({ server: this.server, path: '/signal', maxPayload: MAX_MESSAGE });
    this.wss.on('connection', (ws, req) => this.onConnection(ws, req));

    const port = await listen(this.server, PREFERRED_PORT);
    return {
      viewerUrl: `http://${localIp}:${port}/viewer?t=${token}`,
      senderUrl: `ws://127.0.0.1:${port}/signal?role=sender&t=${token}`,
    };
  }

  onConnection(ws, req) {
    const url = new URL(req.url, 'http://x');
    const role = url.searchParams.get('role');
    const ip = plainIp(req.socket.remoteAddress);
    const allowed = sameToken(url.searchParams.get('t'), this.token)
      && ((role === 'sender' && LOOPBACK.has(req.socket.remoteAddress)) || (role === 'viewer' && ip === this.viewerIp));
    if (!allowed) {
      this.log.warn(`conexión de señalización rechazada (${role || '?'} desde ${ip})`);
      ws.close(1008, 'no autorizado');
      return;
    }
    const relay = (to, msg) => { if (to?.readyState === 1) to.send(JSON.stringify(msg)); };
    if (role === 'sender') {
      this.sender?.close();
      this.sender = ws;
      if (this.viewer) relay(ws, { type: 'viewer-ready' });
    } else {
      this.viewer?.close();
      this.viewer = ws;
      this.emit('viewer-connected');
      relay(this.sender, { type: 'viewer-ready' });
    }

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!msg || typeof msg.type !== 'string') return;
      if (role === 'sender') {
        if (msg.type === 'state') return this.emit('sender-state', String(msg.state));
        if (msg.type === 'error') return this.emit('sender-error', String(msg.message || 'Error de captura'));
        if (msg.type === 'info') return this.emit('info', msg);
        if (msg.type === 'offer' && typeof msg.sdp === 'string') return relay(this.viewer, { type: 'offer', sdp: msg.sdp });
      } else {
        if (msg.type === 'stats') return this.emit('stats', msg);
        if (msg.type === 'answer' && typeof msg.sdp === 'string') return relay(this.sender, { type: 'answer', sdp: msg.sdp });
      }
    });
    ws.on('close', () => {
      if (role === 'viewer' && this.viewer === ws) {
        this.viewer = null;
        relay(this.sender, { type: 'viewer-gone' });
        this.emit('viewer-gone');
      }
      if (role === 'sender' && this.sender === ws) this.sender = null;
    });
  }

  async close() {
    this.token = null;
    for (const ws of [this.sender, this.viewer]) ws?.terminate();
    this.sender = this.viewer = null;
    const server = this.server, wss = this.wss;
    this.server = this.wss = null;
    wss?.close();
    if (server) await new Promise((r) => server.close(() => r()));
  }
}

// Escucha en el puerto preferido o, si está ocupado, en uno libre.
function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (e) => {
      if (e.code === 'EADDRINUSE' && port !== 0) { server.listen(0, '0.0.0.0'); return; }
      reject(e);
    };
    server.on('error', onError);
    server.once('listening', () => { server.off('error', onError); resolve(server.address().port); });
    server.listen(port, '0.0.0.0');
  });
}

const newToken = () => crypto.randomBytes(24).toString('base64url');

module.exports = { SignalingServer, newToken };
