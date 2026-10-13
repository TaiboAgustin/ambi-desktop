// Teclas normalizadas de Ambi → códigos del control remoto de Samsung Tizen.
const { REMOTE_KEYS } = require('../../domain/capabilities');

const KEYMAP = Object.freeze({
  up: 'KEY_UP', down: 'KEY_DOWN', left: 'KEY_LEFT', right: 'KEY_RIGHT', ok: 'KEY_ENTER',
  back: 'KEY_RETURN', home: 'KEY_HOME', source: 'KEY_SOURCE', menu: 'KEY_MENU', info: 'KEY_INFO', exit: 'KEY_EXIT',
  play: 'KEY_PLAY', pause: 'KEY_PAUSE', stop: 'KEY_STOP', rewind: 'KEY_REWIND', 'fast-forward': 'KEY_FF',
  'channel-up': 'KEY_CHUP', 'channel-down': 'KEY_CHDOWN', 'volume-up': 'KEY_VOLUP', 'volume-down': 'KEY_VOLDOWN',
  mute: 'KEY_MUTE', power: 'KEY_POWER',
  ...Object.fromEntries(Array.from({ length: 10 }, (_, n) => [String(n), `KEY_${n}`])),
});

// Pulsación normalizada → Cmd del protocolo.
const ACTIONS = Object.freeze({ click: 'Click', press: 'Press', release: 'Release' });

// En este modelo la única tecla de entrada que funciona por red es la genérica (pasa a la siguiente HDMI).
const INPUT_NEXT = 'KEY_HDMI';

// Toda tecla normalizada debe tener traducción (lo verifica un test).
const missing = REMOTE_KEYS.filter((k) => !KEYMAP[k]);
if (missing.length) throw new Error(`Teclas sin mapear en Samsung: ${missing.join(', ')}`);

module.exports = { KEYMAP, ACTIONS, INPUT_NEXT };
