// Puente de la ventana oculta del modo ambiente: solo puede informar colores y errores.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ambient', {
  color: (c) => ipcRenderer.send('ambient:color', c),
  error: (message) => ipcRenderer.send('ambient:error', String(message)),
});
