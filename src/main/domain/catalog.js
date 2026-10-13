// Catálogo fijo del hub: apps de la TV, consolas y escenas de la luz.

// Apps de Tizen (IDs verificados contra la TV: GET /api/v2/applications/<id> → 200).
const APPS = Object.freeze({
  netflix: { id: '3201907018807', name: 'Netflix' },
  youtube: { id: '111299001912', name: 'YouTube' },
  primevideo: { id: '3201910019365', name: 'Prime Video' },
  disneyplus: { id: '3201901017640', name: 'Disney+' },
  appletv: { id: '3201807016597', name: 'Apple TV' },
  spotify: { id: '3201606009684', name: 'Spotify' },
});

const CONSOLES = Object.freeze(['ps5', 'switch']);
const HDMI_PORTS = Object.freeze([1, 2, 3, 4]);

// Escenas WiZ expuestas en el hub (sceneId del protocolo WiZ).
const SCENES = Object.freeze({
  1: 'Océano', 3: 'Atardecer', 4: 'Fiesta', 5: 'Chimenea', 11: 'Blanco cálido', 12: 'Luz de día',
  13: 'Blanco frío', 14: 'Noche', 15: 'Foco', 16: 'Relax', 18: 'TV', 29: 'Velas',
});
// Escenas que en realidad son un blanco fijo (para mostrarlas como temperatura).
const WHITE_SCENES = Object.freeze({ 11: 2700, 12: 4200, 13: 6500 });

const MIRROR_QUALITIES = Object.freeze(['nitido60', 'nitido', 'fluido60', 'fluido']);

module.exports = { APPS, CONSOLES, HDMI_PORTS, SCENES, WHITE_SCENES, MIRROR_QUALITIES };
