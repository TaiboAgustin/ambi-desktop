// Extrae el logo de Disney+ (blanco) de la imagen oficial con fondo degradado y genera un PNG con
// transparencia para la UI: src/renderer/img/disneyplus.png.
// Se ejecuta con Electron (usa nativeImage para decodificar/codificar sin dependencias extra):
//   npx electron scripts/build-disney-logo.js
const path = require('path');
const fs = require('fs');
const { app, nativeImage } = require('electron');

const root = path.join(__dirname, '..');
const SOURCE = path.join(root, 'src', 'assets', 'brand', 'disneyplus-source.png');
const OUT = path.join(root, 'src', 'renderer', 'img', 'disneyplus.png');
const OUT_WIDTH = 480;

app.whenReady().then(() => {
  const img = nativeImage.createFromPath(SOURCE);
  if (img.isEmpty()) throw new Error(`No se pudo leer ${SOURCE}`);
  const { width: W, height: H } = img.getSize();
  const px = img.toBitmap(); // BGRA

  // El logo es casi blanco; el fondo (incluido el resplandor celeste) tiene el rojo bajo. Se usa el
  // canal mínimo como máscara: blanco → opaco, fondo → transparente, con borde suave.
  const LO = 150, HI = 215;
  const alpha = new Uint8Array(W * H);
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let i = 0; i < W * H; i++) {
    const b = px[i * 4], g = px[i * 4 + 1], r = px[i * 4 + 2];
    const a = Math.round(Math.min(1, Math.max(0, (Math.min(r, g, b) - LO) / (HI - LO))) * 255);
    alpha[i] = a;
    if (a > 40) {
      const x = i % W, y = (i / W) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  const pad = 6;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;

  // Recorte en blanco puro con la máscara como alfa (BGRA premultiplicado no requerido por nativeImage).
  const out = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const a = alpha[(y + y0) * W + (x + x0)];
      const o = (y * cw + x) * 4;
      out[o] = a; out[o + 1] = a; out[o + 2] = a; out[o + 3] = a; // premultiplicado: blanco * alfa
    }
  }
  const cropped = nativeImage.createFromBitmap(out, { width: cw, height: ch });
  const resized = cropped.resize({ width: OUT_WIDTH, quality: 'best' });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, resized.toPNG());
  console.log(`logo Disney+: recorte ${cw}x${ch} → ${resized.getSize().width}x${resized.getSize().height} en ${path.relative(root, OUT)}`);
  app.quit();
}).catch((e) => { console.error(e); app.exit(1); });
