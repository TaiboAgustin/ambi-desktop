// IPv4 de esta PC en la misma /24 que otro equipo (la TV).
const os = require('os');

function localIpFor(remoteIp, interfaces = os.networkInterfaces()) {
  const prefix = String(remoteIp || '').split('.').slice(0, 3).join('.') + '.';
  const addrs = Object.values(interfaces).flat().filter((a) => a && (a.family === 'IPv4' || a.family === 4) && !a.internal);
  return addrs.find((a) => a.address.startsWith(prefix))?.address || null;
}

module.exports = { localIpFor };
