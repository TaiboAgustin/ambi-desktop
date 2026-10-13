// Adaptador de entrada IPC: traduce pedidos de la ventana a casos de uso.
//  - Solo acepta mensajes de la página principal (no de otras ventanas o frames).
//  - Valida cada argumento; nada llega sin chequear a la capa de aplicación.
//  - Respuesta uniforme { ok, value } | { ok: false, error }.
const { ipcMain, shell } = require('electron');
const V = require('../../domain/validation');

const ST_TOKEN_PAGE = 'https://account.smartthings.com/tokens';

function registerIpc({ services, state, settings, windowApi, autostart, isTrustedSender, logger }) {
  const { tv, light, ambient, mirror, capture } = services;

  const handle = (channel, fn) => ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedSender(event)) {
      logger.warn(`IPC rechazado de un origen no confiable: ${channel}`);
      return { ok: false, error: 'Origen no autorizado' };
    }
    try {
      return { ok: true, value: await fn(...args) };
    } catch (e) {
      if (!(e instanceof V.ValidationError)) logger.warn(`IPC ${channel}`, e.message);
      return { ok: false, error: e.message };
    }
  });
  const check = (cond, msg = 'Parámetro inválido') => { if (!cond) throw new V.ValidationError(msg); };

  handle('state:get', () => state.get());
  handle('settings:get', () => settings.publicView());
  handle('settings:set', (patch) => settings.update(V.settingsPatch(patch)));

  handle('tv:key', (code, cmd = 'Click') => {
    check(V.isKeyCode(code) && V.KEY_COMMANDS.includes(cmd), 'Tecla inválida');
    return tv.key(code, cmd);
  });
  handle('tv:app', (name) => { check(V.isAppName(name), 'App desconocida'); return tv.launchApp(name); });
  handle('tv:input', (target) => { check(V.isInputTarget(target), 'Entrada desconocida'); return tv.selectInput(target); });
  handle('tv:power', () => tv.power());
  handle('tv:volume', (level) => { check(Number.isFinite(level) && level >= 0 && level <= 100, 'Volumen inválido'); return tv.setVolume(level); });
  handle('tv:mute', (muted) => { check(typeof muted === 'boolean'); return tv.setMute(muted); });
  handle('tv:forget', () => tv.forgetPairing());

  handle('st:tokenPage', () => shell.openExternal(ST_TOKEN_PAGE));
  handle('st:connect', (pat) => { check(typeof pat === 'string' && pat.length < 200, 'Token inválido'); return tv.connectSmartThings(pat); });
  handle('st:disconnect', () => tv.disconnectSmartThings());

  handle('light:set', (params) => light.set(params)); // lo valida el dominio (lightCommand)
  handle('light:toggle', () => light.toggle());

  handle('screens:list', () => capture.listScreens());
  handle('ambient:start', (opts = {}) => {
    check(!opts.sourceId || V.isScreenId(opts.sourceId), 'Pantalla inválida');
    check(opts.maxDim === undefined || (Number.isFinite(opts.maxDim) && opts.maxDim >= 10 && opts.maxDim <= 100), 'Brillo inválido');
    return ambient.start(opts);
  });
  handle('ambient:stop', () => ambient.stop());
  handle('ambient:max', (v) => { check(Number.isFinite(v) && v >= 10 && v <= 100, 'Brillo inválido'); ambient.setMaxDim(v); });
  handle('mirror:start', (opts = {}) => {
    check(V.isScreenId(opts.sourceId), 'Pantalla inválida');
    mirror.start({ sourceId: opts.sourceId, audio: !!opts.audio }); // el progreso llega por el estado
  });
  handle('mirror:stop', () => mirror.stop());

  handle('autostart:get', () => autostart.enabled);
  handle('autostart:set', (on) => { check(typeof on === 'boolean'); return windowApi.setAutostart(on); });
  handle('win:hide', () => windowApi.hide());
  handle('win:minimize', () => windowApi.minimize());
  handle('app:quit', () => windowApi.quit());
}

module.exports = { registerIpc };
