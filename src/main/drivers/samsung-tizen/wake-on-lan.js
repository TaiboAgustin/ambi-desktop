// Wake-on-LAN (implementa WakePort). La TV necesita "Encender con dispositivo móvil" activado.
const dgram = require('dgram');
const { normalizeMac } = require('../../domain/validation');

function magicPacket(mac) {
  const hex = normalizeMac(mac)?.replace(/:/g, '');
  if (!hex) return null;
  const macBuf = Buffer.from(hex, 'hex');
  const packet = Buffer.alloc(102, 0xff);
  for (let i = 0; i < 16; i++) macBuf.copy(packet, 6 + i * 6);
  return packet;
}

// Envía el paquete mágico al broadcast de la /24 de la TV (puertos 9 y 7). Nunca rechaza.
function wake(mac, ip) {
  const packet = magicPacket(mac);
  if (!packet || !ip) return Promise.resolve(false);
  const broadcast = ip.split('.').slice(0, 3).concat('255').join('.');
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const finish = (ok) => { try { sock.close(); } catch {} resolve(ok); };
    sock.on('error', () => finish(false));
    sock.bind(() => {
      sock.setBroadcast(true);
      let pending = 2;
      const sent = () => { if (--pending === 0) finish(true); };
      sock.send(packet, 9, broadcast, sent);
      sock.send(packet, 7, broadcast, sent);
    });
  });
}

module.exports = { wake, magicPacket };
