// Modelo de capacidades: qué sabe hacer un dispositivo, independiente de la marca.
// La aplicación y la UI hablan en estos términos; cada driver los traduce a su protocolo.

const KINDS = Object.freeze(['tv', 'light']);

const CAP = Object.freeze({
  // TV
  POWER: 'power',              // estado y encendido/apagado
  VOLUME: 'volume',            // nivel exacto y silencio
  REMOTE_KEYS: 'remote-keys',  // teclas normalizadas (REMOTE_KEYS)
  APPS: 'apps',                // abrir apps del catálogo y saber cuál está en pantalla
  INPUT_CYCLE: 'input-cycle',  // pasar a la siguiente entrada (sin elegir una exacta)
  CAST_TARGET: 'cast-target',  // receptor Google Cast (espejo de pantalla)
  // Luz
  BRIGHTNESS: 'brightness',
  COLOR: 'color',
  COLOR_TEMP: 'color-temp',
  SCENES: 'scenes',
  COLOR_STREAM: 'color-stream', // acepta colores a alta frecuencia (modo ambiente)
});

// Teclas normalizadas del control remoto. Cada driver de TV las mapea a sus códigos.
const REMOTE_KEYS = Object.freeze([
  'up', 'down', 'left', 'right', 'ok', 'back', 'home', 'source', 'menu', 'info', 'exit',
  'play', 'pause', 'stop', 'rewind', 'fast-forward',
  'channel-up', 'channel-down', 'volume-up', 'volume-down', 'mute', 'power',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
]);

// Modos de pulsación: un toque, o apretar y soltar por separado (mantener presionado).
const KEY_ACTIONS = Object.freeze(['click', 'press', 'release']);

const isRemoteKey = (k) => typeof k === 'string' && REMOTE_KEYS.includes(k);

module.exports = { KINDS, CAP, REMOTE_KEYS, KEY_ACTIONS, isRemoteKey };
