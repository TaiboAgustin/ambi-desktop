// Cliente HTTP(S) para dispositivos de la red local. Siempre resuelve (nunca rechaza ni queda
// colgado): devuelve { status, body } o null ante cualquier falla, con un timeout total.
//
// Corrige un bug previo: si la respuesta se cortaba a mitad del cuerpo, la promesa no resolvía nunca
// y congelaba el sondeo de estado.
const http = require('http');
const https = require('https');

const MAX_BODY = 2 * 1024 * 1024;

function request({ host, port, path = '/', method = 'GET', headers, body, secure = false, timeoutMs = 2500 }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    // Timeout total (conexión + respuesta completa), no solo de inactividad del socket.
    const timer = setTimeout(() => { req.destroy(); done(null); }, timeoutMs);

    const req = (secure ? https : http).request(
      // Los dispositivos de la red local usan certificados autofirmados (TV Samsung en :8002).
      { host, port, path, method, headers, agent: false, rejectUnauthorized: false },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > MAX_BODY) { req.destroy(); done(null); return; }
          chunks.push(c);
        });
        res.on('end', () => done({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('aborted', () => done(null));
        res.on('error', () => done(null));
        res.on('close', () => done(null)); // cierre sin 'end' (respuesta cortada)
      }
    );
    req.on('error', () => done(null));
    req.end(body);
  });
}

function parseJson(res) {
  if (!res || typeof res.body !== 'string') return null;
  try { return JSON.parse(res.body); } catch { return null; }
}

module.exports = { request, parseJson };
