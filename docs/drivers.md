# Cómo escribir un driver

Un **driver** enseña a Ambi a hablar con una marca o protocolo. Todo lo de esa marca vive en una carpeta
`src/main/drivers/<id>/`; el resto de la app solo conoce las **capacidades** que el driver declara.
Los drivers incluidos (`samsung-tizen` y `wiz`) son el mejor ejemplo de referencia.

## 1. El contrato

`src/main/drivers/<id>/index.js` exporta:

```js
module.exports = {
  id: 'mi-marca',                    // único, kebab-case; se guarda en la configuración
  name: 'Mi Marca Smart TV',         // nombre legible
  kind: 'tv',                        // 'tv' | 'light'
  capabilities: ['power', 'volume'], // de src/main/domain/capabilities.js

  // Encontrar equipos en la red. `subnets` son IPs locales de la PC (buscá en sus /24).
  async discover({ subnets }) {
    return [{ address: '192.168.1.50', mac: 'AA:BB:CC:DD:EE:01', name: 'TV del living' }];
  },

  // Crear la instancia de un dispositivo configurado.
  //   settings: objeto vivo ({ address, mac, … }) — podés modificarlo y llamar save()
  //   secrets:  objeto vivo para credenciales (tokens, claves): Ambi los guarda cifrados
  //   save():   persiste la configuración
  //   getSubnets(): IPs locales, por si tenés que volver a buscar el equipo
  //   logger:   { debug, info, warn, error }
  create({ settings, secrets, save, getSubnets, logger }) {
    return { /* ver abajo */ };
  },
};
```

Después agregalo a `BUILT_IN` en `src/main/drivers/index.js`. Al iniciar, Ambi valida el contrato y falla
con un mensaje claro si falta algo.

## 2. La instancia

Siempre:

| Miembro | Qué hace |
|---|---|
| `address` | getter con la dirección actual |
| `connect()` | abrir conexiones persistentes (si las hay). Se llama una vez al crear. |
| `close()` | liberar sockets y timers. |
| `status()` | estado actual o `null` si no responde. **Nunca rechaza.** |

`status()` de una TV devuelve `{ power: 'on'|'standby', device: { name, model, title, chips, detail, mac } }`;
el de una luz, el estado normalizado `{ on, dimming, temp, sceneId, rgb }` (ver `src/main/domain/light.js`).

Y un objeto por capacidad:

| Capacidad | Objeto | Forma |
|---|---|---|
| `power` | `power` | `toggle() → Promise<'on'\|'off'>` (TV). Las luces usan `set({ state })`. |
| `volume` | `volume` | `get() → {volume, muted}\|null`, `set(level)`, `mute(bool)` |
| `remote-keys` | `keys` | `send(key, action) → boolean` con teclas normalizadas (`REMOTE_KEYS`) y `action` = `click\|press\|release` |
| `apps` | `apps` | `supported: string[]` (nombres de `domain/catalog.js`), `status(name) → {installed, visible}\|null`, `launch(name) → boolean` |
| `input-cycle` | `inputs` | `next()`: pasar a la siguiente entrada |
| `cast-target` | `cast` | `host`: IP del receptor Google Cast integrado |
| `brightness` · `color` · `color-temp` · `scenes` | — | `set(cmd) → Promise<boolean>` con el comando normalizado `{ state, dimming, temp, sceneId, r, g, b }` |
| `color-stream` | — | `stream(cmd)`: como `set` pero sin esperar respuesta, ~20 veces por segundo (modo ambiente) |
| (opcional) | `connection` | EventEmitter con `state` y evento `'state'` (`idle\|connecting\|pairing\|connected\|denied\|offline`) para mostrar el emparejamiento |
| (opcional) | `pairing` | `forget()`: borrar credenciales y volver a emparejar |

Declará en `capabilities` solo lo que la instancia implementa de verdad: la app y la UI se adaptan a eso
(si una TV no tiene `volume`, se informa "Esta TV no soporta esa función" en vez de fallar).

## 3. Reglas de oro

- **Nunca rompas el proceso.** Todo socket con handler de `'error'`; todo pedido con timeout; `status()` y
  los envíos devuelven `null`/`false` en vez de lanzar por fallas de red. Mirá
  `src/main/adapters/net/http-client.js`, que ya resuelve esto para HTTP.
- **Nada de Electron** en los drivers: Node puro, así se testean sin la app.
- **Validá lo que llega del equipo** (no confíes en el JSON de la red).
- **Documentá lo raro.** Si el equipo ignora un comando o necesita un truco, dejalo comentado con el modelo
  y el firmware donde lo verificaste: es el conocimiento más valioso del proyecto.

## 4. Tests

Agregá tus casos en `test/drivers.test.js` (o un archivo propio). El test de contrato ya recorre todos los
drivers incluidos. Para el protocolo, levantá un servidor local que simule el equipo (HTTP, UDP o
WebSocket): hay ejemplos para WiZ y para la señalización del espejo.

```bash
npm test
```

## 5. Probarlo con el equipo real

Con `npm start`, si no hay un dispositivo de ese tipo configurado, Ambi llama a `discover()` de cada driver
del tipo y agrega el primero que responda. Mirá el log en `%APPDATA%\Ambi\logs\ambi.log`
(con `HUB_DEBUG=1` para más detalle).
