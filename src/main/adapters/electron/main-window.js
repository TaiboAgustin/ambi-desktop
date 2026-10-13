// Ventana principal: sin marco, siempre visible opcional, cerrar = ocultar a la bandeja.
const path = require('path');
const { BrowserWindow, screen } = require('electron');
const { hardenWebContents } = require('./hardening');

const SIZE = { width: 392, height: 760 };
const SRC = path.join(__dirname, '..', '..', '..');

// Posición guardada solo si sigue dentro de algún monitor (al cambiar de monitores podía quedar
// fuera de la pantalla).
function validPosition(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return {};
  const visible = screen.getAllDisplays().some(({ workArea: a }) =>
    x + 60 > a.x && x + 60 < a.x + a.width && y + 20 > a.y && y + 20 < a.y + a.height);
  return visible ? { x, y } : {};
}

class MainWindow {
  constructor({ ui, save, startHidden, isQuitting, onVisibilityChange }) {
    Object.assign(this, { ui, save, isQuitting, onVisibilityChange });
    this.lastBlur = 0;
    this.win = new BrowserWindow({
      ...SIZE,
      ...validPosition(ui.x, ui.y),
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: !!ui.alwaysOnTop,
      show: !startHidden,
      title: 'Ambi',
      icon: path.join(SRC, 'assets', 'icon.png'),
      webPreferences: { preload: path.join(SRC, 'preload', 'main.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    hardenWebContents(this.win.webContents);
    this.win.loadFile(path.join(SRC, 'renderer', 'index.html'));

    this.win.on('moved', () => {
      const [x, y] = this.win.getPosition();
      Object.assign(this.ui, { x, y });
      this.save(); // con debounce en el ConfigStore
    });
    this.win.on('blur', () => { this.lastBlur = Date.now(); });
    this.win.on('show', () => this.onVisibilityChange(true));
    this.win.on('hide', () => this.onVisibilityChange(false));
    this.win.on('close', (e) => {
      if (this.isQuitting()) return;
      e.preventDefault();
      this.win.hide();
    });
  }

  get visible() { return this.win.isVisible() && !this.win.isMinimized(); }

  send(channel, payload) {
    if (!this.win.isDestroyed()) this.win.webContents.send(channel, payload);
  }

  show() {
    if (this.win.isMinimized()) this.win.restore();
    this.win.show();
    this.win.focus();
  }

  // Desde la bandeja: al hacer clic el foco ya se perdió, así que se considera un blur reciente.
  toggle() {
    const focusedRecently = this.win.isFocused() || Date.now() - this.lastBlur < 300;
    if (this.win.isVisible() && focusedRecently) this.win.hide();
    else this.show();
  }

  hide() { this.win.hide(); }
  minimize() { this.win.minimize(); }
  setAlwaysOnTop(on) { this.win.setAlwaysOnTop(!!on); }
}

module.exports = { MainWindow };
