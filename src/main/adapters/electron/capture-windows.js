// Captura de pantalla con ventanas ocultas de Electron (implementa CapturePort).
//  - startAmbient: calcula el color dominante en la ventana y lo manda por IPC.
//  - startMirrorSender: captura y transmite por WebRTC al visor de la TV.
// La pantalla (y el audio) de cada ventana los decide `setDisplayMediaRequestHandler` según qué
// ventana pide la captura.
const path = require('path');
const { BrowserWindow, desktopCapturer, ipcMain, screen, session, webContents } = require('electron');
const { hardenWebContents } = require('./hardening');

const CAPTURE_DIR = path.join(__dirname, '..', '..', '..', 'capture');
const PRELOAD_DIR = path.join(__dirname, '..', '..', '..', 'preload');

class ElectronCapture {
  constructor({ logger }) {
    this.log = logger;
    this.selections = new Map(); // webContents.id → { sourceId, audio }
    this.colorHandlers = new Map(); // webContents.id → { onColor, onError }

    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      try {
        const wc = request.frame && webContents.fromFrame(request.frame);
        const sel = wc && this.selections.get(wc.id);
        if (!sel) { callback({}); return; } // solo capturan las ventanas propias de captura
        const sources = await desktopCapturer.getSources({ types: ['screen'] });
        const video = sources.find((s) => s.id === sel.sourceId) || sources[0];
        callback(sel.audio ? { video, audio: 'loopback' } : { video });
      } catch (e) {
        this.log.error('selección de pantalla', e);
        callback({});
      }
    });

    // Solo se aceptan mensajes de las ventanas de captura registradas.
    ipcMain.on('ambient:color', (e, c) => {
      const h = this.colorHandlers.get(e.sender.id);
      if (h && c && [c.r, c.g, c.b, c.level].every(Number.isFinite)) {
        h.onColor({ r: clampByte(c.r), g: clampByte(c.g), b: clampByte(c.b), level: Math.min(1, Math.max(0, c.level)) });
      }
    });
    ipcMain.on('ambient:error', (e, message) => this.colorHandlers.get(e.sender.id)?.onError(String(message)));
  }

  async listScreens() {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay().id;
    return sources.map((s, i) => {
      const d = displays.find((x) => String(x.id) === s.display_id);
      const size = d ? `${Math.round(d.size.width * d.scaleFactor)}×${Math.round(d.size.height * d.scaleFactor)}` : '';
      return { id: s.id, name: `Pantalla ${i + 1}${size ? ` · ${size}` : ''}${d?.id === primary ? ' (principal)' : ''}` };
    });
  }

  openHidden({ page, query, preload, selection }) {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: preload ? path.join(PRELOAD_DIR, preload) : undefined,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    hardenWebContents(win.webContents);
    const id = win.webContents.id;
    this.selections.set(id, selection);
    win.on('closed', () => { this.selections.delete(id); this.colorHandlers.delete(id); });
    win.loadFile(path.join(CAPTURE_DIR, page), { query });
    return { win, id, stop: () => { if (!win.isDestroyed()) win.destroy(); } };
  }

  startAmbient({ sourceId, onColor, onError }) {
    const h = this.openHidden({ page: 'ambient-capture.html', query: {}, preload: 'ambient.js', selection: { sourceId, audio: false } });
    this.colorHandlers.set(h.id, { onColor, onError });
    return { stop: h.stop };
  }

  startMirrorSender({ sourceId, audio, quality, signalUrl }) {
    const h = this.openHidden({ page: 'mirror-sender.html', query: { signal: signalUrl, quality }, selection: { sourceId, audio } });
    return { stop: h.stop };
  }
}

const clampByte = (v) => Math.min(255, Math.max(0, Math.round(v)));

module.exports = { ElectronCapture };
