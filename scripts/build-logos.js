// Genera src/logos.js con los paths SVG oficiales (simple-icons, CC0) de las marcas usadas.
const fs = require('fs');
const path = require('path');
const si = require('simple-icons');
const pick = {
  samsung: 'siSamsung', netflix: 'siNetflix', youtube: 'siYoutube', primevideo: 'siPrimevideo',
  appletv: 'siAppletv', spotify: 'siSpotify', playstation: 'siPlaystation', ps5: 'siPlaystation5',
  nintendoswitch: 'siNintendoswitch', nintendo: 'siNintendo',
};
const out = {};
for (const [k, name] of Object.entries(pick)) out[k] = { path: si[name].path, hex: '#' + si[name].hex, title: si[name].title };
fs.writeFileSync(path.join(__dirname, '..', 'src', 'renderer', 'logos.js'),
  '// Generado por scripts/build-logos.js — no editar a mano.\nwindow.LOGOS = ' + JSON.stringify(out, null, 1) + ';\n');
console.log('logos:', Object.keys(out).join(', '));
