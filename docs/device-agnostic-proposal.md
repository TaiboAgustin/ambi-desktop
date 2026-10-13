# Propuesta: Ambi agnóstico a marcas y dispositivos

> Estado: **propuesta para discutir** (no implementada). Objetivo: que cualquier persona pueda usar Ambi
> con su TV y sus luces, sean de la marca que sean, y que sumar una marca nueva sea escribir un *driver*
> sin tocar el resto de la app.

## Dónde estamos (v1)

La v1 ya separa dominio, aplicación y adaptadores (ver [architecture.md](architecture.md)), pero los
servicios todavía piensan en **una** TV Samsung y **una** lámpara WiZ:

- `TvService` usa directamente puertos con forma de Samsung (control por WebSocket, REST de Tizen, UPnP).
- La UI tiene dibujos, logos y botones fijos (PS5/Switch 2 en HDMI, seis apps de streaming).
- La configuración tiene una sección `tv` y una `light`, no una lista de dispositivos.

## Idea central: dispositivos con capacidades

Cada dispositivo se describe por **capacidades** (qué sabe hacer), no por marca. La app y la UI trabajan
con capacidades; los *drivers* traducen esas capacidades al protocolo de cada fabricante.

| Capacidad | Operaciones | Ejemplos de quien la implementa |
|---|---|---|
| `power` | estado, encender, apagar | TVs, luces, enchufes |
| `volume` | nivel, subir/bajar, silencio | TVs, barras de sonido |
| `remote-keys` | enviar teclas (flechas, OK, volver…) | Samsung, LG, Sony, Android TV, Roku |
| `inputs` | listar entradas, elegir una | TVs (HDMI 1…4), receptores |
| `apps` | listar apps, abrir una, saber cuál está en pantalla | Smart TVs |
| `cast-target` | mostrar una URL (espejo de pantalla) | cualquier receptor Google Cast |
| `brightness` · `color` · `color-temp` · `scenes` | luz | WiZ, Hue, LIFX, Yeelight, Govee |

La UI se arma a partir de las capacidades: si un dispositivo tiene `inputs`, aparece la sección
Entradas con *sus* entradas; si tiene `color`, aparece la paleta. Las consolas dejan de estar fijas: cada
persona nombra sus entradas ("PS5" en HDMI 2, "Decodificador" en HDMI 3…).

## Contrato de un driver

```js
// drivers/<marca>/index.js
module.exports = {
  id: 'samsung-tizen',
  name: 'Samsung Smart TV (Tizen 2016+)',
  kind: 'tv',                          // tv | light | speaker | …
  // Encuentra dispositivos en la red (SSDP, mDNS, broadcast UDP…).
  async discover({ timeoutMs }) { return [{ id, name, address, model }]; },
  // Pasos de emparejamiento, si hacen falta (aviso en la TV, token, PIN, OAuth…).
  pairing: { type: 'prompt-on-device' },
  // Crea la instancia con su configuración y secretos (cifrados por Ambi).
  create({ config, secrets, logger }) {
    return {
      capabilities: ['power', 'volume', 'remote-keys', 'inputs', 'apps'],
      power: { get, set },
      volume: { get, set, mute },
      remoteKeys: { send(key) },          // claves normalizadas: 'up', 'ok', 'back', 'home'…
      inputs: { list, select, current },
      apps: { list, launch, foreground },
      dispose() {},
    };
  },
};
```

Reglas:
- **Claves normalizadas**: la app habla de `'volume-up'` u `'ok'`; cada driver las mapea a lo suyo
  (`KEY_VOLUP` en Samsung, `VOLUMEUP` en LG…).
- **Nada de Electron en los drivers**: son Node puro, testeables con dobles, igual que los adaptadores de hoy.
- **Capacidades opcionales y degradables**: si una TV no informa la entrada activa, la UI lo sabe y no
  la muestra como certeza (lo que hoy resolvemos a mano con `KEY_HDMI`).
- **Complementos**: un driver puede *mejorar* otro (SmartThings agrega `inputs` exactos a una Samsung).

## Configuración

```json
{
  "schemaVersion": 2,
  "devices": [
    { "id": "living-tv", "driver": "samsung-tizen", "name": "TV del living", "address": "192.168.1.50",
      "inputs": [{ "id": "HDMI2", "label": "PS5", "icon": "playstation" }],
      "enhancers": ["smartthings"] },
    { "id": "lampara", "driver": "wiz", "name": "Lámpara", "mac": "aa:bb:cc:dd:ee:01" }
  ],
  "ambient": { "source": "screen:0:0", "targets": ["lampara"] }
}
```

La migración desde v1 convierte las secciones `tv` y `light` en dos entradas de `devices`.

## Experiencia para una persona nueva

1. Abre Ambi por primera vez → **asistente de inicio**: "Buscando dispositivos en tu red…".
2. Ve la lista de lo encontrado con su marca y modelo, elige cuáles agregar.
3. Ambi guía el emparejamiento de cada uno (aceptar en la TV, pegar un token, etc.).
4. Puede renombrar dispositivos y entradas, y elegir qué luces siguen el modo ambiente.

## Drivers candidatos

| Marca / protocolo | Tipo | Notas |
|---|---|---|
| Samsung Tizen (actual) | TV | Ya funciona: se extrae como primer driver. |
| WiZ (actual) | Luz | Ya funciona: segundo driver. |
| Google Cast (actual) | Destino de espejo | Genérico: sirve para cualquier TV con Chromecast integrado. |
| LG webOS | TV | WebSocket (puerto 3000/3001), emparejamiento con aviso en la TV. |
| Sony Bravia | TV | REST + IRCC con PIN o clave precompartida. |
| Android TV / Google TV | TV | Protocolo Android TV Remote v2 (emparejamiento con código). |
| Roku | TV | ECP: HTTP simple en el puerto 8060, sin emparejamiento. |
| Philips Hue | Luz | Bridge local (HTTPS) con botón de vinculación. |
| LIFX · Yeelight · Govee (LAN) | Luz | UDP/TCP local, sin nube. |

## Plan por etapas

1. **Modelo de capacidades y registro de drivers** en el dominio/aplicación; Samsung y WiZ pasan a ser drivers
   (sin cambios visibles para quien ya usa Ambi).
2. **UI guiada por capacidades** y entradas con nombre editable (adiós a PS5/Switch fijos).
3. **Asistente de inicio** con descubrimiento y emparejamiento por driver.
4. **Varios dispositivos** (más de una luz para el modo ambiente, más de una TV).
5. **Nuevos drivers**, empezando por los más pedidos (LG, Hue, Android TV, Roku).
6. **Guía para escribir drivers** y kit de tests (dobles de red listos) para que la comunidad contribuya.

## Preguntas abiertas

- ¿Los drivers viven todos en el repo o se pueden instalar como complementos aparte?
- ¿Soporte para macOS/Linux? Hoy hay piezas de Windows (DPAPI, bandeja, instalador NSIS) pero el
  núcleo es multiplataforma.
- ¿Cómo mostrar de forma genérica los logos de apps de cada plataforma sin depender de marcas fijas?
