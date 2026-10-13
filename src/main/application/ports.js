// Puertos de la aplicación (arquitectura hexagonal).
//
// La capa de aplicación (servicios en esta carpeta) solo conoce estos contratos. Los adaptadores en
// `src/main/adapters/` los implementan contra el mundo real (red, Electron, disco) y `src/main/main.js`
// los conecta. En los tests se reemplazan por dobles. Este archivo solo documenta: no tiene código.

/**
 * @typedef {'idle'|'connecting'|'pairing'|'connected'|'denied'|'offline'} RemoteState
 *
 * @typedef {object} TvRemotePort  Control remoto por WebSocket (emparejamiento y teclas).
 * @property {() => void} connect
 * @property {() => void} reconnect
 * @property {(code: string, cmd?: 'Click'|'Press'|'Release') => boolean} key
 * @property {RemoteState} state
 * @property {(event: 'state', fn: (s: {state: RemoteState, detail: string}) => void) => void} on
 *
 * @typedef {object} TvRestPort  API REST de Tizen.
 * @property {() => Promise<object|null>} info                 GET /api/v2/
 * @property {(appId: string) => Promise<{installed: boolean, visible?: boolean}|null>} appStatus
 * @property {(appId: string) => Promise<boolean>} launchApp
 *
 * @typedef {object} TvVolumePort  UPnP RenderingControl.
 * @property {() => Promise<{volume: number, muted: boolean}|null>} getVolume
 * @property {(level: number) => Promise<boolean>} setVolume
 * @property {(muted: boolean) => Promise<boolean>} setMute
 *
 * @typedef {object} WakePort
 * @property {(mac: string, ip: string) => Promise<void>} wake
 *
 * @typedef {object} InputSourcePort  Selección exacta de entrada (SmartThings, nube).
 * @property {boolean} connected
 * @property {(source: string) => Promise<void>} setInput
 * @property {() => Promise<{current: string|null}>} getInput
 *
 * @typedef {object} LightPort  Lámpara WiZ.
 * @property {() => Promise<object|null>} getPilot        respuesta cruda de getPilot o null
 * @property {(params: object) => Promise<boolean>} set   con confirmación
 * @property {(params: object) => void} fire               sin esperar respuesta (modo ambiente)
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
 * @property {(opts: {token: string, viewerIp: string}) => Promise<{viewerUrl: string, senderUrl: string}>} open
 * @property {() => Promise<void>} close
 *
 * @typedef {object} ConfigStorePort
 * @property {object} data          configuración viva
 * @property {() => void} save      persiste (con debounce)
 * @property {() => void} flush     persiste ya (al salir)
 */

module.exports = {};
