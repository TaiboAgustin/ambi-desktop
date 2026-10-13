// SmartThings (nube), implementa InputSourcePort: elegir la entrada exacta (HDMI 1/2), algo que la
// TV no permite por la red local.
//
// Acceso: los tokens personales (PAT) nuevos vencen a las 24 h, así que el PAT se usa una sola vez
// para crear una app OAuth propia (API_ONLY). El usuario la autoriza una vez y se guarda un refresh
// token que rota y se renueva solo (vence tras 30 días sin uso).
const API = 'https://api.smartthings.com/v1';
const AUTHORIZE_URL = 'https://api.smartthings.com/oauth/authorize';
const TOKEN_URLS = ['https://auth-global.api.smartthings.com/oauth/token', 'https://api.smartthings.com/oauth/token'];
// Nunca se carga: la ventana de login cancela a nivel de red cualquier pedido a esta URL.
const REDIRECT_URI = 'https://httpbin.org/get';
const SCOPES = ['r:devices:*', 'x:devices:*'];
const INPUT_CAPS = ['samsungvd.mediaInputSource', 'mediaInputSource'];
const BACKOFF_MAX_MS = 10 * 60 * 1000;

class SmartThingsError extends Error {
  constructor(message, { status, reauth = false } = {}) {
    super(message);
    this.status = status;
    this.reauth = reauth;
  }
}

async function call(url, { method = 'GET', token, body, fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(url, {
      method,
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    throw new SmartThingsError(`Sin conexión con SmartThings (${e.name === 'TimeoutError' ? 'tiempo agotado' : e.message})`);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error_description || data?.message || res.statusText;
    throw new SmartThingsError(`SmartThings ${res.status}: ${msg}`, { status: res.status });
  }
  return data;
}

class SmartThingsClient {
  // store: objeto vivo de configuración `smartthings` + save() para persistirlo.
  constructor({ getState, save, getModelHint = () => '', fetchImpl = fetch }) {
    this.getState = getState;
    this.persist = save;
    this.getModelHint = getModelHint;
    this.fetch = fetchImpl;
    this.refreshing = null;
    this.failures = 0;
    this.blockedUntil = 0;
  }

  get st() { return this.getState(); }
  get connected() { return !!(this.st.refreshToken && this.st.deviceId); }
  get needsReauth() { return !!this.st.needsReauth; }

  save(patch) {
    Object.assign(this.st, patch);
    this.persist();
  }

  api(path, opts = {}) { return this.withToken((token) => call(`${API}${path}`, { ...opts, token, fetchImpl: this.fetch })); }

  // ----- Alta: PAT → app OAuth → autorización → TV
  // Crea la app OAuth del hub (borrando la anterior, si había) y devuelve la URL de autorización.
  async createApp(pat) {
    const token = String(pat || '').trim();
    if (!/^[\w-]{20,}$/.test(token)) throw new SmartThingsError('El token no tiene el formato esperado');
    if (this.st.appId) {
      // Reconectar no debe dejar apps huérfanas en la cuenta.
      await call(`${API}/apps/${encodeURIComponent(this.st.appId)}`, { method: 'DELETE', token, fetchImpl: this.fetch }).catch(() => {});
    }
    const suffix = Math.random().toString(36).slice(2, 8);
    // Solo campos válidos para API_ONLY (signatureType/requireConfirmation son de apps webhook).
    const res = await call(`${API}/apps`, {
      method: 'POST', token, fetchImpl: this.fetch,
      body: {
        appName: `ambi-${suffix}`, displayName: 'Ambi', description: 'Selección de entradas HDMI desde Ambi',
        appType: 'API_ONLY', classifications: ['CONNECTED_SERVICE'],
        oauth: { clientName: 'Ambi', scope: SCOPES, redirectUris: [REDIRECT_URI] },
      },
    });
    if (!res?.oauthClientId) throw new SmartThingsError('SmartThings no devolvió credenciales OAuth');
    this.save({ appId: res.app?.appId, clientId: res.oauthClientId, clientSecret: res.oauthClientSecret, refreshToken: '', accessToken: '', deviceId: '', needsReauth: false });
    const q = new URLSearchParams({ client_id: res.oauthClientId, response_type: 'code', redirect_uri: REDIRECT_URI, scope: SCOPES.join(' ') });
    return `${AUTHORIZE_URL}?${q}`;
  }

  async finishAuth(redirectUrl) {
    const url = new URL(redirectUrl);
    if (url.searchParams.get('error')) throw new SmartThingsError(`Autorización rechazada: ${url.searchParams.get('error')}`);
    const code = url.searchParams.get('code');
    if (!code) throw new SmartThingsError('La autorización no devolvió código');
    await this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI });
    this.failures = 0;
    this.blockedUntil = 0;
    return this.findTv();
  }

  disconnect() {
    for (const k of Object.keys(this.st)) delete this.st[k];
    this.persist();
  }

  // ----- Tokens
  async tokenRequest(params) {
    const basic = Buffer.from(`${this.st.clientId}:${this.st.clientSecret}`).toString('base64');
    let lastErr;
    for (const url of TOKEN_URLS) {
      try {
        const res = await this.fetch(url, {
          method: 'POST',
          headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: new URLSearchParams({ client_id: this.st.clientId, ...params }),
          signal: AbortSignal.timeout(10000),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // invalid_grant/401: el refresh token venció o fue revocado → hay que volver a conectar.
          const reauth = res.status === 401 || data.error === 'invalid_grant';
          throw new SmartThingsError(`Token ${res.status}: ${data.error_description || data.error || res.statusText}`, { status: res.status, reauth });
        }
        if (!data.access_token) throw new SmartThingsError('Respuesta de token sin access_token');
        this.save({
          accessToken: data.access_token,
          refreshToken: data.refresh_token || this.st.refreshToken,
          expiresAt: Date.now() + (data.expires_in || 86400) * 1000,
          needsReauth: false,
        });
        return;
      } catch (e) {
        lastErr = e;
        if (e.reauth) break;
      }
    }
    if (lastErr?.reauth) this.save({ needsReauth: true });
    throw lastErr;
  }

  async token() {
    if (!this.st.refreshToken) throw new SmartThingsError('SmartThings no está conectado', { reauth: true });
    if (!this.st.accessToken || Date.now() > (this.st.expiresAt || 0) - 5 * 60 * 1000) {
      // Una sola renovación a la vez: el refresh token rota y uno ya usado deja de valer.
      this.refreshing ??= this.tokenRequest({ grant_type: 'refresh_token', refresh_token: this.st.refreshToken })
        .finally(() => { this.refreshing = null; });
      await this.refreshing;
    }
    return this.st.accessToken;
  }

  // Ejecuta con token, reintenta una vez ante 401 y aplica backoff exponencial ante fallas repetidas.
  async withToken(fn) {
    if (Date.now() < this.blockedUntil) throw new SmartThingsError('SmartThings en pausa por errores recientes');
    try {
      let result;
      try {
        result = await fn(await this.token());
      } catch (e) {
        if (e.status !== 401) throw e;
        this.save({ accessToken: '' });
        result = await fn(await this.token());
      }
      this.failures = 0;
      return result;
    } catch (e) {
      this.failures += 1;
      this.blockedUntil = Date.now() + Math.min(BACKOFF_MAX_MS, 5000 * 2 ** (this.failures - 1));
      throw e;
    }
  }

  // ----- Dispositivo
  async findTv() {
    const { items = [] } = (await this.api('/devices')) || {};
    const hasInput = (d) => d.components?.some((c) => c.capabilities?.some((cap) => INPUT_CAPS.includes(cap.id)));
    const tvs = items.filter((d) => hasInput(d) || d.ocf?.ocfDeviceType === 'oic.d.tv');
    const hint = (this.getModelHint() || '').slice(0, 8);
    const tv = tvs.find((d) => hint && JSON.stringify(d).includes(hint)) || tvs[0];
    if (!tv) throw new SmartThingsError('No encontré ninguna TV en tu cuenta SmartThings');
    const cap = tv.components.flatMap((c) => c.capabilities.map((x) => x.id)).find((id) => INPUT_CAPS.includes(id)) || INPUT_CAPS[0];
    this.save({ deviceId: tv.deviceId, deviceLabel: tv.label || tv.name, inputCap: cap });
    return { label: this.st.deviceLabel };
  }

  async setInput(source) {
    if (!/^[\w-]{2,20}$/.test(source)) throw new SmartThingsError('Entrada inválida');
    await this.api(`/devices/${encodeURIComponent(this.st.deviceId)}/commands`, {
      method: 'POST',
      body: { commands: [{ component: 'main', capability: this.st.inputCap, command: 'setInputSource', arguments: [source] }] },
    });
  }

  async getInput() {
    const s = await this.api(`/devices/${encodeURIComponent(this.st.deviceId)}/components/main/capabilities/${encodeURIComponent(this.st.inputCap)}/status`);
    return { current: s?.inputSource?.value || null };
  }
}

module.exports = { SmartThingsClient, SmartThingsError, REDIRECT_URI };
