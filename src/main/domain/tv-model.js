// Descripción de la TV a partir de lo que informa su API REST.

// Año por la letra de serie de Samsung (QN55Q65D… → D = 2024).
const YEARS = { T: 2020, A: 2021, B: 2022, C: 2023, D: 2024, F: 2025, G: 2026 };

function describeModel(model = '') {
  const m = /^([A-Z]{2})(\d{2})([A-Z]+\d+)([A-Z])/.exec(model);
  if (!m) return { short: model, qled: false, year: null, size: null };
  return { short: `${m[1]}${m[2]}${m[3]}${m[4]}`, size: Number(m[2]), year: YEARS[m[4]] || null, qled: m[3].startsWith('Q') };
}

const decodeEntities = (s = '') => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'");

// Convierte la respuesta de GET /api/v2/ en el estado que usa la app. Tolera campos faltantes.
function parseDeviceInfo(info) {
  const d = info && typeof info === 'object' ? info.device : null;
  if (!d || typeof d !== 'object') return null;
  const model = String(d.modelName || '');
  const desc = describeModel(model);
  const chips = [];
  if (desc.qled) chips.push({ text: 'QLED', kind: 'qled' });
  if (d.resolution === '3840x2160') chips.push({ text: '4K UHD' });
  if (desc.year) chips.push({ text: String(desc.year) });
  if (d.OS) chips.push({ text: d.OS === 'Tizen' ? 'Tizen OS' : String(d.OS) });
  if (d.networkType) chips.push({ text: d.networkType === 'wireless' ? 'Wi-Fi' : 'Ethernet' });
  return {
    power: d.PowerState === 'on' ? 'on' : 'standby',
    device: {
      name: decodeEntities(String(d.name || 'Samsung TV')),
      model,
      title: `${desc.short} · Samsung ${desc.qled ? 'QLED' : 'Smart TV'}`,
      chips,
      detail: [model, d.ip, d.wifiMac, info.version && `API ${info.version}`].filter(Boolean).join(' · '),
      mac: typeof d.wifiMac === 'string' ? d.wifiMac : null,
    },
  };
}

module.exports = { describeModel, parseDeviceInfo };
