// Catálogo genérico del hub. Los identificadores propios de cada plataforma (p. ej. el ID de Netflix en
// Tizen) viven en el driver correspondiente, no acá.

// Apps conocidas por la UI. Cada driver de TV declara cuáles soporta y cómo abrirlas.
const APPS = Object.freeze({
  netflix: { name: 'Netflix' },
  youtube: { name: 'YouTube' },
  primevideo: { name: 'Prime Video' },
  disneyplus: { name: 'Disney+' },
  appletv: { name: 'Apple TV' },
  spotify: { name: 'Spotify' },
});

const CONSOLES = Object.freeze(['ps5', 'switch']);
const HDMI_PORTS = Object.freeze([1, 2, 3, 4]);
const MIRROR_QUALITIES = Object.freeze(['nitido60', 'nitido', 'fluido60', 'fluido']);

module.exports = { APPS, CONSOLES, HDMI_PORTS, MIRROR_QUALITIES };
