// Descubrimiento de la TV Samsung en la red local (SSDP) cuando no hay IP configurada.
// La TV responde como receptor DIAL; se confirma con su API REST (type "Samsung SmartTV").
const dgram = require('dgram');
const { request, parseJson } = require('../../adapters/net/http-client');

const SEARCH_TARGETS = ['urn:dial-multiscreen-org:service:dial:1', 'urn:samsung.com:device:RemoteControlReceiver:1'];

function ssdpSearch(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const found = new Set();
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const finish = () => { try { sock.close(); } catch {} resolve([...found]); };
    sock.on('error', finish);
    sock.on('message', (_m, rinfo) => found.add(rinfo.address));
    sock.bind(() => {
      for (const st of SEARCH_TARGETS) {
        const msg = Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`);
        sock.send(msg, 1900, '239.255.255.250', () => {});
      }
      setTimeout(finish, timeoutMs);
    });
  });
}

// Devuelve { ip, mac, name } de la primera Samsung Smart TV que responda, o null.
async function discoverSamsungTv() {
  for (const ip of await ssdpSearch()) {
    const info = parseJson(await request({ host: ip, port: 8001, path: '/api/v2/' }));
    if (info?.type === 'Samsung SmartTV' || info?.device?.type === 'Samsung SmartTV') {
      return { ip, mac: info.device?.wifiMac || '', name: info.device?.name || 'Samsung TV' };
    }
  }
  return null;
}

module.exports = { discoverSamsungTv };
