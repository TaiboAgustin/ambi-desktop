// Genera src/renderer/brand-logos.js a partir de los SVG oficiales guardados en src/assets/brand/:
//  - philips-wordmark.svg: Wikimedia Commons "Philips logo new.svg" (dominio público).
//  - wiz-logo.svg: wizconnected.com/content/dam/wiz/master/wiz-logo-small.svg (sitio oficial de WiZ).
// Los trazos de texto pasan a currentColor (se adaptan al tema); el punto de WiZ conserva su celeste.
const fs = require('fs');
const path = require('path');

const brandDir = path.join(__dirname, '..', 'src', 'assets', 'brand');
const read = (f) => fs.readFileSync(path.join(brandDir, f), 'utf8');

// Philips: un único path con las transformaciones de Inkscape.
const philips = read('philips-wordmark.svg');
const philipsD = /<path id="path2859" d="([^"]+)"/.exec(philips)[1];
const philipsBody = `<g transform="translate(-127.26 -383.69)"><g transform="matrix(1.25 0 0 -1.25 -154.36 849.47)"><path d="${philipsD}" fill="currentColor"/></g></g>`;

// WiZ: paths del grupo del logo; texto (#001B2C) → currentColor, punto (#0088CE) se mantiene.
const wiz = read('wiz-logo.svg');
const wizPaths = [...wiz.matchAll(/<path d="([^"]+)"[^>]*fill="(#[0-9A-Fa-f]{6})"/g)]
  .map(([, d, fill]) => `<path d="${d}" fill="${fill.toUpperCase() === '#001B2C' ? 'currentColor' : fill}"/>`)
  .join('');
const wizBody = `<g transform="translate(0 20)">${wizPaths}</g>`;

const out = { philips: philipsBody, wiz: wizBody };
fs.writeFileSync(path.join(__dirname, '..', 'src', 'renderer', 'brand-logos.js'),
  '// Generado por scripts/build-brand-logos.js — no editar a mano.\nwindow.BRAND_LOGOS = ' + JSON.stringify(out) + ';\n');
console.log('brand logos:', Object.keys(out).join(', '), '| wiz paths:', wizPaths.split('<path').length - 1);
