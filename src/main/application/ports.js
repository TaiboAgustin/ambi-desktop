// Puertos de la aplicación (arquitectura hexagonal).
//
// La capa de aplicación (servicios en esta carpeta) solo conoce estos contratos. Los adaptadores en
// `src/main/adapters/` y los drivers en `src/main/drivers/` los implementan contra el mundo real (red,
// Electron, disco) y `src/main/main.js` los conecta. En los tests se reemplazan por dobles.
// Este archivo solo documenta: no tiene código.

/**
 * Dispositivos: los define el contrato de drivers (ver docs/drivers.md y src/main/drivers/index.js).
 * Los servicios los obtienen del DeviceManager y usan solo las capacidades que el driver declara.
 *
 * @typedef {object} TvDevice
 * @property {string} address
 * @property {() => Promise<{power: 'on'|'standby', device: object}|null>} status
 * @property {{ toggle: () => Promise<'on'|'off'> }} [power]                       capacidad power
 * @property {{ get: Function, set: Function, mute: Function }} [volume]          capacidad volume
 * @property {{ send: (key: string, action?: string) => boolean }} [keys]         capacidad remote-keys
 * @property {{ supported: string[], status: Function, launch: Function }} [apps] capacidad apps
 * @property {{ next: () => boolean }} [inputs]                                   capacidad input-cycle
 * @property {{ host: string }} [cast]                                            capacidad cast-target
 * @property {import('events').EventEmitter & {state: string}} [connection]       estado del emparejamiento
 * @property {{ forget: () => void }} [pairing]
 *
 * @typedef {object} LightDevice
 * @property {string} address
 * @property {() => Promise<{on: boolean, dimming: ?number, temp: ?number, sceneId: number, rgb: ?number[]}|null>} status
 * @property {(cmd: object) => Promise<boolean>} set      comando normalizado (domain/light.js)
 * @property {(cmd: object) => void} [stream]             capacidad color-stream (modo ambiente)
 *
 * @typedef {object} InputSourcePort  Selección exacta de entrada (SmartThings, nube; complemento de la TV).
 * @property {boolean} connected
 * @property {(source: string) => Promise<void>} setInput
 * @property {() => Promise<{current: string|null}>} getInput
 *
 * @typedef {object} CapturePort  Ventanas ocultas de captura de pantalla.
 * @property {() => Promise<Array<{id: string, name: string}>>} listScreens
 * @property {(opts: {sourceId: string, onColor: Function, onError: Function}) => {stop: Function}} startAmbient
 * @property {(opts: {sourceId: string, audio: boolean, quality: string, signalUrl: string}) => {stop: Function}} startMirrorSender
 *
 * @typedef {object} CastPort
 * @property {(url: string, hooks?: {onAuthPending?: Function}) => Promise<void>} showUrl
 * @property {() => void} close   detiene la sesión y cierra la conexión
 *
 * @typedef {object} SignalingPort  Señalización WebRTC entre emisor (PC) y visor (TV).
 * @property {(opts: {token: string, viewerIp: string, localIp: string}) => Promise<{viewerUrl: string, senderUrl: string}>} open
 * @property {() => Promise<void>} close
 *
 * @typedef {object} ConfigStorePort
 * @property {object} data          configuración viva
 * @property {() => void} save      persiste (con debounce)
 * @property {() => void} flush     persiste ya (al salir)
 */

module.exports = {};
