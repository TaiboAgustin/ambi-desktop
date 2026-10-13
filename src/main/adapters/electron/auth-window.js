// Ventana de login de SmartThings (OAuth). Usa una sesión propia y cancela a nivel de red cualquier
// pedido al redirect URI: el código de autorización nunca sale de la PC (antes podía llegar a
// httpbin.org si fallaba la intercepción de navegación).
const { BrowserWindow, session } = require('electron');

let seq = 0;

function authorizeInWindow({ url, redirectUri, parent }) {
  return new Promise((resolve, reject) => {
    const partition = `ambi-oauth-${Date.now()}-${++seq}`; // sin "persist:": nada queda en disco
    const ses = session.fromPartition(partition);
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      ses.webRequest.onBeforeRequest(null);
      if (!win.isDestroyed()) win.close();
      fn(value);
    };

    ses.webRequest.onBeforeRequest({ urls: [`${redirectUri}*`] }, (details, callback) => {
      callback({ cancel: true });
      finish(resolve, details.url);
    });

    const win = new BrowserWindow({
      width: 480, height: 720, parent, alwaysOnTop: true, autoHideMenuBar: true, title: 'Conectar SmartThings',
      webPreferences: { partition, contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.on('closed', () => finish(reject, new Error('Se cerró la ventana sin autorizar')));
    win.loadURL(url);
  });
}

module.exports = { authorizeInWindow };
