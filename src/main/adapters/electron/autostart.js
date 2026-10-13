// Inicio con Windows. Arranca oculto en la bandeja (--hidden). En desarrollo hay que pasarle la
// carpeta de la app a electron.exe. El estado se cachea: leerlo consulta el registro.
const { app } = require('electron');

class Autostart {
  constructor() { this.cached = null; }

  args() { return app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden']; }

  get enabled() {
    if (this.cached === null) this.cached = app.getLoginItemSettings({ args: this.args() }).openAtLogin;
    return this.cached;
  }

  set(on) {
    app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath, args: this.args() });
    this.cached = null;
    return this.enabled;
  }
}

module.exports = { Autostart };
