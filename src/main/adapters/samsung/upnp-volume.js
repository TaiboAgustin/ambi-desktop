// Volumen exacto por UPnP RenderingControl (implementa TvVolumePort).
//   http://IP:9197/upnp/control/RenderingControl1  (GetVolume/SetVolume, GetMute/SetMute)
const { request } = require('../net/http-client');

const SERVICE = 'urn:schemas-upnp-org:service:RenderingControl:1';

class UpnpVolume {
  constructor({ getIp, http = { request } }) {
    this.getIp = getIp;
    this.http = http;
  }

  async soap(action, args = '') {
    const host = this.getIp();
    if (!host) return null;
    const body = '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>'
      + `<u:${action} xmlns:u="${SERVICE}"><InstanceID>0</InstanceID><Channel>Master</Channel>${args}</u:${action}>`
      + '</s:Body></s:Envelope>';
    const res = await this.http.request({
      host, port: 9197, path: '/upnp/control/RenderingControl1', method: 'POST', body,
      headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPACTION: `"${SERVICE}#${action}"` },
    });
    return res?.status === 200 ? res.body : null;
  }

  async getVolume() {
    const [vol, mute] = await Promise.all([this.soap('GetVolume'), this.soap('GetMute')]);
    const v = vol && /<CurrentVolume>(\d+)</.exec(vol);
    const m = mute && /<CurrentMute>(\d)</.exec(mute);
    return v ? { volume: Number(v[1]), muted: m?.[1] === '1' } : null;
  }

  async setVolume(level) {
    const n = Math.max(0, Math.min(100, Math.round(Number(level))));
    if (!Number.isFinite(n)) return false;
    return !!(await this.soap('SetVolume', `<DesiredVolume>${n}</DesiredVolume>`));
  }

  async setMute(muted) {
    return !!(await this.soap('SetMute', `<DesiredMute>${muted ? 1 : 0}</DesiredMute>`));
  }
}

module.exports = { UpnpVolume };
