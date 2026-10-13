// Direcciones IPv4 de esta PC.
const os = require('os');

const ipv4s = (interfaces = os.networkInterfaces()) => Object.values(interfaces).flat()
  .filter((a) => a && (a.family === 'IPv4' || a.family === 4) && !a.internal)
  .map((a) => a.address);

// IPv4 de esta PC en la misma /24 que otro equipo (p. ej. la TV, para el espejo).
function localIpFor(remoteIp, interfaces) {
  const prefix = String(remoteIp || '').split('.').slice(0, 3).join('.') + '.';
  return ipv4s(interfaces).find((a) => a.startsWith(prefix)) || null;
}

// IPs locales (una por interfaz): los drivers buscan dispositivos en sus /24.
const localSubnets = (interfaces) => ipv4s(interfaces);

module.exports = { localIpFor, localSubnets };
