// Política de cambio de entrada sin SmartThings.
//
// Este modelo ignora KEY_HDMI1…4 por red; solo responde a KEY_HDMI, que va a la última entrada HDMI
// usada y, si ya se está en HDMI, pasa a la siguiente. Como la TV no informa la entrada activa, se
// lleva un modelo de lo que se cree que muestra. Con dos consolas conectadas eso alterna entre ambas.
const { CONSOLES } = require('./catalog');

class HdmiCycle {
  // state: { lastHdmi: 'ps5'|'switch', onHdmi: boolean }
  constructor({ lastHdmi = CONSOLES[0], onHdmi = false } = {}) {
    this.lastHdmi = CONSOLES.includes(lastHdmi) ? lastHdmi : CONSOLES[0];
    this.onHdmi = !!onHdmi;
  }

  // Cuántas pulsaciones de KEY_HDMI hacen falta para llegar a `target`.
  pressesFor(target) {
    if (!CONSOLES.includes(target)) throw new Error(`Consola desconocida: ${target}`);
    // Desde una app: la primera pulsación vuelve a la última HDMI; si no es la buscada, una más.
    if (!this.onHdmi) return this.lastHdmi === target ? 1 : 2;
    // Ya en HDMI: una pulsación pasa a la otra. Si el modelo creía estar ya en el destino, se
    // desincronizó (p. ej. se cambió con el control físico): pulsar igual lo corrige.
    return 1;
  }

  select(target) {
    const presses = this.pressesFor(target);
    this.lastHdmi = target;
    this.onHdmi = true;
    return presses;
  }

  next() {
    if (this.onHdmi) this.lastHdmi = CONSOLES[(CONSOLES.indexOf(this.lastHdmi) + 1) % CONSOLES.length];
    this.onHdmi = true;
    return 1;
  }

  // La TV mostró una app: ya no está en HDMI (la próxima pulsación vuelve a la última HDMI).
  leftHdmi() { this.onHdmi = false; }

  // SmartThings confirmó qué se ve (o null si no es una consola conocida).
  confirm(console) {
    this.onHdmi = !!console;
    if (console) this.lastHdmi = console;
  }

  get current() { return this.onHdmi ? this.lastHdmi : null; }
  toJSON() { return { lastHdmi: this.lastHdmi, onHdmi: this.onHdmi }; }
}

module.exports = { HdmiCycle };
