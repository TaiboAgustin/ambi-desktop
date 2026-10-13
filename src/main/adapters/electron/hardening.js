// Endurecimiento de ventanas: sin ventanas emergentes ni navegación fuera de la página cargada.
function hardenWebContents(wc, { allowNavigation = () => false } = {}) {
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e, url) => { if (!allowNavigation(url)) e.preventDefault(); });
  wc.on('will-attach-webview', (e) => e.preventDefault());
}

module.exports = { hardenWebContents };
