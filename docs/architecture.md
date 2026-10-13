# Arquitectura de Ambi

Ambi sigue una **arquitectura hexagonal (puertos y adaptadores)**. La regla central: las dependencias
apuntan hacia adentro. El dominio no conoce a nadie; la aplicación conoce al dominio y a los *puertos*
(contratos); los adaptadores implementan esos puertos contra el mundo real (red, Electron, disco).

```
                         ┌───────────────────────── adaptadores de entrada ─────────────────────────┐
                         │  ipc.js (ventana)   tray.js (bandeja)   main-window.js   StatusPoller     │
                         └──────────────────────────────────┬───────────────────────────────────────┘
                                                            │ llaman casos de uso
                         ┌──────────────────────────────────▼───────────────────────────────────────┐
                         │ APLICACIÓN  TvService · LightService · AmbientService · MirrorService      │
                         │             SettingsService · AppState (estado observable)                │
                         │                 │ usa                         │ depende de                │
                         │   ┌─────────────▼──────────────┐   ┌──────────▼───────────┐               │
                         │   │ DOMINIO (puro, sin I/O)    │   │ PUERTOS (ports.js)    │               │
                         │   │ catálogo · modelo TV ·     │   │ TvRemote · TvRest ·   │               │
                         │   │ política HDMI · reglas de  │   │ Volume · InputSource ·│               │
                         │   │ luz · validación           │   │ Light · Capture ·     │               │
                         │   └────────────────────────────┘   │ Cast · Signaling ·    │               │
                         │                                    │ ConfigStore           │               │
                         └────────────────────────────────────┴──────────┬────────────┴───────────────┘
                                                                         │ implementados por
                         ┌───────────────────────────────────────────────▼──────────────────────────┐
                         │ ADAPTADORES DE SALIDA                                                       │
                         │ samsung/ (WebSocket, REST, UPnP, WoL, SSDP) · smartthings/ · wiz/ (UDP) ·  │
                         │ cast/ (CASTV2) · mirror/ (señalización) · storage/ · electron/ (captura,   │
                         │ login OAuth, safeStorage, autoinicio) · net/ · logging/                    │
                         └────────────────────────────────────────────────────────────────────────────┘
```

## Drivers de dispositivos

Las marcas son **drivers** (`src/main/drivers/<id>/`): adaptadores de salida empaquetados por marca que
declaran **capacidades** (`src/main/domain/capabilities.js`: `power`, `volume`, `remote-keys`, `apps`,
`input-cycle`, `cast-target`, `brightness`, `color`, `color-temp`, `scenes`, `color-stream`).
`DeviceManager` instancia cada dispositivo de `config.devices` con su driver, descubre equipos cuando
falta alguno de un tipo y los recrea si cambia su configuración. Los servicios trabajan solo con
capacidades: no saben de qué marca es la TV o la luz. Guía: [drivers.md](drivers.md).

: el único archivo que conoce todas las piezas, las
instancia y las conecta. Cambiar un adaptador (por ejemplo, otra marca de lámpara) no toca el dominio ni
los servicios: se escribe un adaptador que cumpla el mismo puerto.

## Carpetas

| Carpeta | Contenido | Puede depender de |
|---|---|---|
| `src/main/domain/` | Reglas puras: catálogo, modelo de la TV, política de entradas HDMI, reglas de la luz, validación. | nada |
| `src/main/application/` | Casos de uso, estado observable, planificador de sondeo, puertos. | dominio |
| `src/main/adapters/` | Implementaciones de puertos (red, nube, Electron, disco, log). | dominio, Node, Electron |
| `src/main/drivers/` | Un driver por marca (Samsung Tizen, WiZ) + registro con validación del contrato. | dominio, adaptadores de red, Node |
| `src/main/main.js` | Composición. | todo |
| `src/preload/` | Puentes `contextBridge` (API mínima y validada hacia la UI). | Electron |
| `src/renderer/` | Interfaz: vistas TV, luz y ajustes; se dibuja desde el estado que publica el proceso principal. | API del preload |
| `src/capture/` | Páginas de las ventanas ocultas (modo ambiente, emisor del espejo) y el visor que corre en la TV. | `shared/` |
| `src/shared/` | Código puro usado en más de un proceso (algoritmo de color del modo ambiente). | nada |
| `test/` | Tests de dominio, adaptadores (con servidores locales reales) y aplicación (con dobles). | todo |

## Flujo de estado

1. `StatusPoller` ejecuta el sondeo (rápido con la ventana visible, lento en la bandeja; una ejecución
   a la vez y sin cortar el ciclo ante errores).
2. Los servicios escriben en `AppState` por secciones (`tv`, `light`, `ambient`, `mirror`, `remote`,
   `smartthings`); solo se emite un cambio si algo cambió de verdad.
3. La raíz de composición reenvía cada cambio a la ventana (`state`) y a la bandeja.
4. La UI dibuja todo desde ese estado; las acciones vuelven por IPC validado a los casos de uso.

## Seguridad

- Ventanas con `contextIsolation`, `sandbox`, sin `nodeIntegration`, sin ventanas emergentes ni
  navegación; la API IPC solo responde a la página principal y valida cada argumento.
- Secretos cifrados con `safeStorage` (DPAPI). Escritura de configuración atómica.
- Espejo: token por sesión, emisor solo desde loopback, visor solo desde la IP de la TV, servidor
  abierto solo durante la sesión.
- OAuth de SmartThings en una sesión aislada; el código de autorización se intercepta a nivel de red.
- CSP estricta en todas las páginas.
