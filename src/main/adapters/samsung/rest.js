// API REST de Tizen (implementa TvRestPort).
//   GET  http://IP:8001/api/v2/                    → estado, modelo, PowerState
//   GET  http://IP:8001/api/v2/applications/<id>   → {running, visible}; 404 si no está instalada
//   POST https://IP:8002/api/v2/applications/<id>  → abre la app (en este modelo, el POST por HTTP
//        al 8001 corta la conexión y `ed.apps.launch` por WebSocket se ignora)
const { request, parseJson } = require('../net/http-client');

const APP_ID = /^[\w.]{3,40}$/;

class SamsungRest {
  constructor({ getIp, http = { request, parseJson } }) {
    this.getIp = getIp;
    this.http = http;
  }

  async info() {
    const host = this.getIp();
    if (!host) return null;
    return this.http.parseJson(await this.http.request({ host, port: 8001, path: '/api/v2/' }));
  }

  async appStatus(appId) {
    const host = this.getIp();
    if (!host || !APP_ID.test(appId)) return null;
    const res = await this.http.request({ host, port: 8001, path: `/api/v2/applications/${appId}` });
    if (!res) return null;
    if (res.status === 404) return { installed: false };
    const data = this.http.parseJson(res);
    return data ? { installed: true, running: !!data.running, visible: !!data.visible } : null;
  }

  async launchApp(appId) {
    const host = this.getIp();
    if (!host || !APP_ID.test(appId)) return false;
    const res = await this.http.request({ host, port: 8002, path: `/api/v2/applications/${appId}`, method: 'POST', secure: true });
    return res?.status === 200;
  }
}

module.exports = { SamsungRest };
