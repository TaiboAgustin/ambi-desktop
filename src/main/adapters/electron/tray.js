// Ícono de la bandeja con menú. El menú solo se reconstruye si cambió algo que muestra (antes se
// rehacía cada 3 s y podía cerrarse mientras estaba abierto).
const path = require('path');
const { Tray, Menu, nativeImage } = require('electron');

class AppTray {
  constructor({ actions }) {
    this.actions = actions;
    this.signature = '';
    this.tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', '..', '..', 'assets', 'tray.png')));
    this.tray.on('click', () => actions.toggleWindow());
    this.tray.on('double-click', () => actions.showWindow());
  }

  update({ tv, light, ambient, autostart }) {
    const tvOn = tv.power === 'on';
    const tvText = tvOn ? 'encendida' : tv.power === 'off' ? 'apagada' : tv.power === 'standby' ? 'en reposo' : 'buscando…';
    const lightText = !light ? 'sin respuesta' : !light.on ? 'apagada' : ambient.on ? 'modo ambiente' : `${light.dimming ?? 100}%`;
    const signature = JSON.stringify([tvText, lightText, !!light, !!light?.on, ambient.on, autostart]);
    if (signature === this.signature) return;
    this.signature = signature;

    const a = this.actions;
    this.tray.setToolTip(`Ambi\nTV: ${tvText}\nLuz: ${lightText}`);
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Abrir Ambi', click: a.showWindow },
      { type: 'separator' },
      { label: tvOn ? 'Apagar la TV' : 'Encender la TV', click: a.togglePower },
      { label: light?.on ? 'Apagar la luz' : 'Encender la luz', enabled: !!light, click: a.toggleLight },
      { label: 'Modo ambiente', type: 'checkbox', checked: ambient.on, enabled: !!light, click: a.toggleAmbient },
      { type: 'separator' },
      { label: 'Iniciar con Windows', type: 'checkbox', checked: autostart, click: (item) => a.setAutostart(item.checked) },
      { type: 'separator' },
      { label: 'Salir', click: a.quit },
    ]));
  }

  destroy() { this.tray.destroy(); }
}

module.exports = { AppTray };
