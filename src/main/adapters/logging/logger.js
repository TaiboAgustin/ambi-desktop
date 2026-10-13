// Logger con niveles: consola y archivo con tamaño acotado (un respaldo rotado).
// El nivel `debug` solo se escribe con la variable de entorno HUB_DEBUG=1.
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 1024 * 1024;
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function createLogger({ file = null, debug = process.env.HUB_DEBUG === '1' } = {}) {
  const min = debug ? LEVELS.debug : LEVELS.info;

  const write = (line) => {
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.1`);
      fs.appendFileSync(file, line + '\n');
    } catch { /* el log nunca debe tirar la app */ }
  };

  const log = (level, scope, msg, extra) => {
    if (LEVELS[level] < min) return;
    const detail = extra instanceof Error ? ` ${extra.stack || extra.message}` : extra !== undefined ? ` ${safeJson(extra)}` : '';
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}${detail}`;
    (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
    write(line);
  };

  const scoped = (scope) => ({
    debug: (m, x) => log('debug', scope, m, x),
    info: (m, x) => log('info', scope, m, x),
    warn: (m, x) => log('warn', scope, m, x),
    error: (m, x) => log('error', scope, m, x),
    child: (sub) => scoped(`${scope}:${sub}`),
  });
  return scoped('hub');
}

function safeJson(v) {
  try { return JSON.stringify(v); } catch { return String(v); }
}

// Logger mudo para tests y adaptadores usados sin composición.
const nullLogger = { debug() {}, info() {}, warn() {}, error() {}, child() { return nullLogger; } };

module.exports = { createLogger, nullLogger };
