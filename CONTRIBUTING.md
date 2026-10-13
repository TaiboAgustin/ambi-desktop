# Cómo contribuir a Ambi

¡Gracias por querer sumar! Ambi está pensado para crecer con la ayuda de quien tenga otros
dispositivos en su casa.

## Antes de empezar

1. Leé la [arquitectura](docs/architecture.md): Ambi usa puertos y adaptadores, así que casi todo cambio
   cae en una sola capa.
2. Si querés sumar una marca nueva, seguí la [guía de drivers](docs/drivers.md) (y la
   [propuesta](docs/device-agnostic-proposal.md) para el panorama). Abrí un *issue* para coordinar.

## Entorno

```bash
git clone https://github.com/TaiboAgustin/ambi-desktop.git
cd ambi-desktop
npm install
npm start
```

Necesitás Node.js 20 o superior y Windows 10/11.

## Reglas del código

- **Dominio puro**: `src/main/domain/` no importa Node, Electron ni nada con efectos.
- **Nada de Electron fuera de `adapters/electron/`** (y de `main.js`): el resto se testea con Node puro.
- **Todo lo que viene de afuera se valida** (IPC, red, archivos) antes de llegar a la aplicación.
- **Nunca rompas el proceso**: los adaptadores manejan sus errores (sockets con handler de `error`,
  promesas que resuelven o rechazan, timeouts siempre).
- **Comentarios en español**, explicando el *por qué* (sobre todo los comportamientos raros de cada
  dispositivo, que son la parte más valiosa del proyecto).
- **Nada de datos personales** en el código ni en los tests (usá IP y MAC de ejemplo).

## Antes de abrir un PR

```bash
npm run check   # sintaxis de todo el proyecto
npm test        # la suite tiene que pasar completa
```

Agregá tests para lo que cambies: los adaptadores se prueban contra servidores locales reales (HTTP, UDP,
WebSocket, TLS) y los servicios con dobles de sus puertos. Mirá `test/` para ver ejemplos.

Contá en el PR **con qué dispositivo lo probaste** (marca, modelo, firmware): ayuda muchísimo.
