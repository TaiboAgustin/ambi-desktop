# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versionado [SemVer](https://semver.org/lang/es/).

## [1.0.0] — 2026-10-13

Primera versión estable. La app pasa a llamarse **Ambi** (antes "Hub TV").

### Agregado
- Arquitectura hexagonal: dominio puro, servicios de aplicación, puertos y adaptadores; raíz de composición única.
- Suite de tests con `node:test` (dominio, adaptadores contra servidores locales reales y servicios con dobles).
- Descubrimiento automático de la TV (SSDP) y de la lámpara; la MAC de la TV se toma de su API.
- Cifrado de secretos con `safeStorage` (DPAPI) y migración automática desde la configuración de Hub TV.
- Log persistente con tamaño acotado (`%APPDATA%\Ambi\logs`), nivel de detalle con `HUB_DEBUG=1`.
- Avisos en la interfaz cuando una acción falla; estado "Reconectar" de SmartThings.
- Logo oficial de Disney+.
- Al salir del modo ambiente, una lámpara que estaba apagada recupera también su tono y brillo previos.
- Licencia MIT, guía de contribución y propuesta para soportar otras marcas (docs/device-agnostic-proposal.md).

### Corregido (ver docs/code-review.md)
- Espejar con la TV apagada tiraba abajo la app (evento `error` sin listener en Cast).
- Un error de red en el socket UDP de la lámpara tiraba abajo la app.
- Una respuesta HTTP cortada congelaba el sondeo de estado para siempre.
- Un error en el sondeo cortaba el ciclo de actualización.
- `config.json` podía corromperse y perder emparejamiento y tokens (escritura no atómica).
- Carrera al cambiar de pantalla con el modo ambiente activo; error de captura que se perdía.
- Detener el espejo mientras arrancaba podía terminar marcándolo como error.
- La repetición de teclas podía quedar enviando sin fin; atajos activos con el foco en formularios.
- Ventana que podía abrirse fuera de pantalla; clic en la bandeja que nunca la ocultaba.

### Seguridad
- El servidor del espejo exigía nada: ahora token por sesión, emisor solo local, visor solo desde la TV y
  servidor abierto solo durante la sesión.
- Código OAuth de SmartThings interceptado a nivel de red en una sesión aislada (no llega a terceros).
- IPC validado con lista blanca y solo desde la ventana principal; ventanas sin navegación ni emergentes;
  CSP estricta en todas las páginas; `sandbox` en todos los renderers.

### Cambiado
- Electron 33 → 44.7.1, `ws` 8.18 → 8.22, electron-builder 25 → 26.15.
- Sondeo adaptativo: rápido con la ventana visible, lento en la bandeja (sin nube ni apps).
- Reconectar SmartThings borra la app OAuth anterior; backoff exponencial ante fallas.
- Si SmartThings está configurado y falla, se informa en vez de cambiar de entrada a ciegas con `KEY_HDMI`.
- La PC aparece en la TV como "Ambi".
