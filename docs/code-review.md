# Revisión de código — Hub TV (pre‑v1)

Revisión exhaustiva del código previo al refactor hexagonal (Electron 33, `src/*.js` planos).
Cada hallazgo indica severidad, evidencia y cómo se resolvió en v1.0.0.

Severidad: **Crítico** (cae la app o expone datos), **Alto** (falla funcional o de seguridad real),
**Medio** (robustez/rendimiento), **Bajo** (prácticas, UX menor).

## Críticos

| # | Hallazgo | Evidencia | Resolución v1 |
|---|---|---|---|
| C1 | `CastClient` emite `'error'` sin listener: espejar con la TV apagada tira abajo el proceso principal. | Reproducido: `Unhandled 'error' event`, proceso cae. | El cliente Cast no emite `'error'`; los fallos se propagan solo por promesas rechazadas. Test de regresión. |
| C2 | El socket UDP de WiZ (y el de Wake‑on‑LAN) no maneja `'error'`: un envío fallido (red caída, volver de suspensión) cae la app. | Reproducido: `Unhandled 'error' event`. | Handler de error en todos los sockets; envíos con callback. Test. |
| C3 | Respuesta HTTP cortada a mitad del cuerpo deja la promesa colgada para siempre → el sondeo de estado se congela sin aviso. | Reproducido: la promesa nunca resuelve. | Cliente HTTP con timeout total, `res.on('error'/'aborted'/'close')`. Test. |
| C4 | El servidor del espejo escucha en `0.0.0.0:8765` sin autenticación: cualquier equipo de la red podía conectarse como visor y ver la pantalla de la PC, o hacerse pasar por emisor. Además quedaba abierto para siempre. | Lectura de código (`mirror.js`). | Token aleatorio por sesión (viewer debe presentarlo), emisor solo desde loopback, visor solo desde la IP de la TV, el servidor se cierra al terminar. Test. |

## Altos

| # | Hallazgo | Resolución v1 |
|---|---|---|
| A1 | `poll()` no era a prueba de excepciones: cualquier error (p. ej. JSON de la TV sin `device`) cortaba el ciclo de sondeo para siempre. | `StatusPoller` con aislamiento de errores, una sola ejecución a la vez y reprogramación garantizada. Test. |
| A2 | `config.json` se escribía con `writeFileSync` no atómico y muy seguido (cada evento `moved` al arrastrar). Un corte a mitad dejaba el JSON corrupto y al cargar se reemplazaba en silencio por los valores por defecto, perdiendo emparejamiento y tokens. | `ConfigStore`: escritura atómica (temp + rename), con debounce, y respaldo del archivo corrupto en vez de descartarlo. Test. |
| A3 | Secretos en texto plano en `%APPDATA%` (token de la TV, client secret y refresh token de SmartThings). | Cifrados con `safeStorage` (DPAPI de Windows); migración automática de los existentes. |
| A4 | El código de autorización OAuth de SmartThings viaja a `httpbin.org` (tercero) si la intercepción de navegación falla. | La ventana de login usa una sesión propia y cancela a nivel de red cualquier pedido al redirect URI; el código nunca sale de la PC. |
| A5 | Carrera en `Ambient.start()`/`Mirror`: el evento `closed` de la ventana anterior podía anular la referencia a la nueva (al cambiar de pantalla con el modo ambiente activo). | Cada ventana solo limpia su propia referencia (comparación de identidad). |
| A6 | Reconectar SmartThings creaba una app OAuth nueva en la cuenta cada vez, dejando apps huérfanas. | Se borra la app anterior con el PAT antes de crear una nueva. |
| A7 | Si el refresh token de SmartThings vencía, el sondeo reintentaba cada 6 s contra la nube indefinidamente. | Backoff exponencial y estado "requiere reconexión" visible en Ajustes. |
| A8 | Con SmartThings conectado, un fallo puntual de la nube caía al cambio por `KEY_HDMI`, que es impredecible. | Si SmartThings está configurado, el error se informa en vez de adivinar. |
| A9 | Electron 33 fuera de soporte (sin parches de seguridad de Chromium). | Actualizado a Electron 44; `ws` y electron-builder actualizados. |

## Medios

| # | Hallazgo | Resolución v1 |
|---|---|---|
| M1 | Sondeo a máxima frecuencia (≈10 pedidos cada 3 s a la TV y consultas a la nube cada 6 s) aun con la ventana oculta en la bandeja, 24/7. | Modo lento con la ventana oculta: solo estado básico cada 15 s; apps, volumen y SmartThings solo con la ventana visible. |
| M2 | La bandeja reconstruía su menú y leía el registro (`getLoginItemSettings`) cada 3 s; si el menú estaba abierto podía cerrarse. | El menú solo se reconstruye cuando cambia algo relevante; estado de autoinicio cacheado. |
| M3 | Aviso "Aceptá el aviso en la TV" aparecía con la TV apagada (se activaba por tiempo, no por socket abierto). | Solo se muestra si el socket abrió y no hay token. |
| M4 | La repetición de teclas (volumen/canal/flechas) no se cortaba con `pointercancel` ni al perder el foco: podía quedar mandando teclas sin fin. | Corte en `pointerup/leave/cancel` y `blur`. |
| M5 | Atajos de teclado activos con el foco en un `select`/`input` (las flechas cambiaban la opción y además movían la TV). | Se ignoran si el foco está en un control de formulario. |
| M6 | Posición de ventana guardada sin validar: al cambiar de monitores podía abrir fuera de pantalla. | Se valida contra las áreas de trabajo actuales. |
| M7 | Al apagar el modo ambiente por error de captura, el mensaje de error se pisaba con el estado final. | `stop()` se espera antes de informar el error. |
| M8 | Al detener el espejo mientras arrancaba, el timeout pendiente de Cast terminaba marcándolo como error. | Sesiones con identificador; los resultados de sesiones viejas se ignoran. |
| M9 | Logs de depuración del espejo (cada 2 s) siempre activos. | Logger con niveles; detalle solo con `HUB_DEBUG=1`; log persistente con tamaño acotado. |

## Bajos / prácticas

| # | Hallazgo | Resolución v1 |
|---|---|---|
| B1 | IPC sin validación (`cfg:set` hacía `Object.assign(config, patch)` con cualquier clave; `tv:app` aceptaba nombres inexistentes). | Validación por canal con lista blanca de claves y tipos. |
| B2 | `innerHTML` con datos que vienen de la red (brillo/tono de la lámpara). | Construcción con `textContent`/nodos. |
| B3 | Ventanas sin `setWindowOpenHandler` ni bloqueo de navegación. | Navegación y ventanas emergentes bloqueadas en todas las ventanas propias. |
| B4 | IP y MAC del usuario hardcodeadas en el código. | Descubrimiento automático de la TV (SSDP) y la lámpara; la MAC de la TV se toma de su API. |
| B5 | Sin tests automáticos. | Suite `node --test` para dominio y adaptadores. |
| B6 | Clic en el ícono de la bandeja nunca ocultaba la ventana (el foco ya se había perdido al hacer clic). | Se considera el blur reciente. |
| B7 | Todo en archivos planos con lógica, I/O y Electron mezclados. | Arquitectura hexagonal (ver `docs/architecture.md`). |
