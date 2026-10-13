// Espejo de pantalla PC → TV.
//   1. Se abre el servidor de señalización con un token de sesión.
//   2. Una ventana oculta captura la pantalla y se conecta como emisor (WebRTC).
//   3. Por Google Cast se abre DashCast en la TV con la URL del visor.
// Cada sesión tiene un número: resultados tardíos de una sesión ya detenida se ignoran.
const { nullLogger } = require('../adapters/logging/logger');

class MirrorService {
  /**
   * @param {object} deps
   * @param {import('./ports').SignalingPort & import('events').EventEmitter} deps.signaling
   * @param {(host: string) => import('./ports').CastPort} deps.createCast
   * @param {import('./ports').CapturePort} deps.capture
   * @param {() => string} deps.getTvIp
   * @param {(tvIp: string) => string|null} deps.getLocalIp
   * @param {() => string} deps.newToken
   * @param {object} deps.config   sección `mirror` viva ({ sourceId, audio, quality })
   */
  constructor({ signaling, createCast, capture, getTvIp, getLocalIp, newToken, config, save, state, logger = nullLogger }) {
    Object.assign(this, { signaling, createCast, capture, getTvIp, getLocalIp, newToken, config, save, state, log: logger });
    this.sessionId = 0;
    this.cast = null;
    this.sender = null;

    signaling.on('viewer-connected', () => this.update('connecting', 'Conectando con la TV…'));
    signaling.on('sender-state', (s) => {
      if (s === 'connected') this.update('live');
      else if (s === 'failed') this.fail('No se pudo conectar el video con la TV');
    });
    signaling.on('sender-error', (m) => this.fail(m));
    signaling.on('viewer-gone', () => { if (this.current === 'live') this.stop(); }); // p. ej. se apretó Inicio
    signaling.on('info', (m) => this.log.info(`video ${m.codec} ${m.size} ${m.encoder}`));
    signaling.on('stats', (m) => this.log.debug('estadísticas de la TV', m));
  }

  get current() { return this.state.get().mirror.state; }

  update(state, detail = '') { this.state.set('mirror', { state, detail }); }

  async start({ sourceId, audio }) {
    if (!['idle', 'error'].includes(this.current)) return;
    const id = ++this.sessionId;
    Object.assign(this.config, { sourceId, audio: !!audio });
    this.save();
    this.update('starting', 'Preparando la transmisión…');
    try {
      const tvIp = this.getTvIp();
      const localIp = tvIp && this.getLocalIp(tvIp);
      if (!tvIp) throw new Error('Todavía no se encontró la TV en la red');
      if (!localIp) throw new Error('No encontré la IP de esta PC en la red de la TV');

      const { viewerUrl, senderUrl } = await this.signaling.open({ token: this.newToken(), viewerIp: tvIp, localIp });
      if (id !== this.sessionId) return;
      this.sender = this.capture.startMirrorSender({ sourceId, audio: !!audio, quality: this.config.quality, signalUrl: senderUrl });
      this.cast = this.createCast(tvIp);
      await this.cast.showUrl(viewerUrl, { onAuthPending: () => { if (id === this.sessionId) this.update('starting', 'Aceptá el aviso en la TV'); } });
      if (id === this.sessionId && this.current === 'starting') this.update('connecting', 'Abriendo el visor en la TV…');
    } catch (e) {
      if (id === this.sessionId) await this.fail(e.message);
    }
  }

  async teardown() {
    this.cast?.close();
    this.cast = null;
    this.sender?.stop();
    this.sender = null;
    await this.signaling.close();
  }

  async fail(message) {
    this.sessionId++;
    this.log.warn('espejo', message);
    await this.teardown();
    this.update('error', message);
  }

  async stop() {
    this.sessionId++;
    await this.teardown();
    this.update('idle');
  }
}

module.exports = { MirrorService };
