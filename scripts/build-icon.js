// Genera el ícono de la app: build/icon.ico (16–256 px) y src/assets/icon.png y tray.png (ventana/bandeja).
// Diseño: cuadrado redondeado con degradé, una tele blanca y un punto cálido (la luz).
// Se dibuja con funciones de distancia (SDF) para tener bordes suavizados en cualquier tamaño.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const BG_A = hex('#2563eb'), BG_B = hex('#7c3aed'), WHITE = [255, 255, 255], WARM = hex('#ffc95c');

function sdRoundBox(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r, qy = Math.abs(py - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;

function render(N) {
  const px = new Float32Array(N * N * 4); // RGBA 0..1 premultiplicado no; se compone "over"
  const aa = 1 / N; // un píxel en unidades normalizadas
  const cov = (sd) => Math.min(1, Math.max(0, 0.5 - sd / aa));
  // A tamaños chicos, trazos más gruesos para que se lean.
  const stroke = N <= 24 ? 0.11 : N <= 48 ? 0.085 : 0.065;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N, v = (y + 0.5) / N;
      let r = 0, g = 0, b = 0, a = 0;
      const over = (col, alpha) => {
        if (alpha <= 0) return;
        const na = alpha + a * (1 - alpha);
        r = (col[0] * alpha + r * a * (1 - alpha)) / na;
        g = (col[1] * alpha + g * a * (1 - alpha)) / na;
        b = (col[2] * alpha + b * a * (1 - alpha)) / na;
        a = na;
      };
      // Fondo con degradé diagonal.
      const t = Math.min(1, Math.max(0, (u + v) / 2));
      const bg = BG_A.map((c, i) => c + (BG_B[i] - c) * t);
      over(bg, cov(sdRoundBox(u, v, 0.5, 0.5, 0.47, 0.47, 0.22)));
      // Tele: marco (contorno) y pie.
      const tv = sdRoundBox(u, v, 0.47, 0.47, 0.29, 0.2, 0.06);
      over(WHITE, cov(Math.abs(tv) - stroke / 2));
      over(WHITE, cov(sdRoundBox(u, v, 0.47, 0.745, 0.1, stroke / 2, stroke / 2)));
      // Luz: anillo del color de fondo para separarla de la tele, y el punto cálido.
      over(bg, cov(sdCircle(u, v, 0.76, 0.27, 0.15)));
      over(WARM, cov(sdCircle(u, v, 0.76, 0.27, 0.105)));
      const o = (y * N + x) * 4;
      px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = a;
    }
  }
  return px;
}

function png(N, px) {
  const raw = Buffer.alloc(N * (N * 4 + 1));
  for (let y = 0; y < N; y++) {
    raw[y * (N * 4 + 1)] = 0;
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4, o = y * (N * 4 + 1) + 1 + x * 4;
      raw[o] = Math.round(px[i]); raw[o + 1] = Math.round(px[i + 1]); raw[o + 2] = Math.round(px[i + 2]); raw[o + 3] = Math.round(px[i + 3] * 255);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const v of buf) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ICO con entradas PNG (soportado desde Windows Vista).
function ico(images) {
  const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; e[1] = size >= 256 ? 0 : size; e[2] = 0; e[3] = 0;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const root = path.join(__dirname, '..');
const images = SIZES.map((size) => ({ size, data: png(size, render(size)) }));
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico(images));
fs.writeFileSync(path.join(root, 'build', 'icon.png'), images.find((i) => i.size === 256).data);
fs.writeFileSync(path.join(root, 'src', 'assets', 'icon.png'), images.find((i) => i.size === 256).data);
fs.writeFileSync(path.join(root, 'src', 'assets', 'tray.png'), images.find((i) => i.size === 32).data);
console.log('ícono generado:', SIZES.join(', '), 'px');
