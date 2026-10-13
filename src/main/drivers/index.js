// Registro de drivers de dispositivos. Para sumar una marca: crear `drivers/<id>/index.js` con el
// contrato de abajo y agregarlo a BUILT_IN. Ver docs/drivers.md.
//
// Contrato de un driver:
//   id            string único (kebab-case), se guarda en la configuración del dispositivo
//   name          nombre legible ("Samsung Smart TV (Tizen 2016+)")
//   kind          'tv' | 'light'
//   capabilities  lista de capacidades de domain/capabilities.js
//   discover({ subnets }) → Promise<Array<{ address, mac?, name? }>>   encontrar equipos en la red
//   create({ settings, secrets, save, getSubnets, logger }) → instancia del dispositivo
//
// La instancia expone `address`, `connect()`, `close()`, `status()` y un objeto por capacidad
// (ver docs/drivers.md para la forma de cada uno).
const { KINDS, CAP } = require('../domain/capabilities');

const BUILT_IN = [require('./samsung-tizen'), require('./wiz')];

const KNOWN_CAPS = new Set(Object.values(CAP));

function validateDriver(d) {
  const problems = [];
  if (!d || typeof d !== 'object') return ['no es un objeto'];
  if (typeof d.id !== 'string' || !/^[a-z0-9-]+$/.test(d.id)) problems.push('id inválido');
  if (typeof d.name !== 'string' || !d.name) problems.push('falta name');
  if (!KINDS.includes(d.kind)) problems.push(`kind inválido (${d.kind})`);
  if (!Array.isArray(d.capabilities) || !d.capabilities.length) problems.push('faltan capabilities');
  else for (const c of d.capabilities) if (!KNOWN_CAPS.has(c)) problems.push(`capacidad desconocida: ${c}`);
  if (typeof d.discover !== 'function') problems.push('falta discover()');
  if (typeof d.create !== 'function') problems.push('falta create()');
  return problems;
}

class DriverRegistry {
  constructor(drivers = BUILT_IN) {
    this.drivers = new Map();
    for (const d of drivers) this.register(d);
  }

  register(driver) {
    const problems = validateDriver(driver);
    if (problems.length) throw new Error(`Driver inválido ${driver?.id || '?'}: ${problems.join(', ')}`);
    if (this.drivers.has(driver.id)) throw new Error(`Driver duplicado: ${driver.id}`);
    this.drivers.set(driver.id, driver);
  }

  get(id) { return this.drivers.get(id) || null; }
  ofKind(kind) { return [...this.drivers.values()].filter((d) => d.kind === kind); }
  list() { return [...this.drivers.values()].map(({ id, name, kind, capabilities }) => ({ id, name, kind, capabilities })); }
}

module.exports = { DriverRegistry, validateDriver, BUILT_IN };
