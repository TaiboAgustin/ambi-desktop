// Panel de ajustes: TV, puertos, calidad del espejo, SmartThings y autoinicio.
(() => {
  const { $, run, toast, api } = window.Ambi;

  let settings = null;
  let st = {};

  const isOpen = () => !$('settings').hidden;

  async function open() {
    settings = await run(api.settings.get());
    if (!settings) return;
    $('cfgIp').value = settings.ip;
    $('cfgMac').value = settings.mac;
    $('cfgTop').checked = settings.alwaysOnTop;
    $('cfgQuality').value = settings.mirrorQuality;
    $('cfgPs5').value = String(settings.ps5Hdmi);
    $('cfgSwitch').value = String(settings.switchHdmi);
    $('cfgPaired').textContent = settings.paired
      ? 'Emparejado: la TV ya confía en esta PC. Para encenderla desde acá, activá en la TV "Encender con dispositivo móvil".'
      : 'Sin emparejar: al conectar, aceptá el aviso que aparece en la TV.';
    run(api.app.getAutostart()).then((on) => { $('cfgAutostart').checked = !!on; });
    renderSmartThings();
    $('settings').hidden = false;
  }

  function close() { $('settings').hidden = true; }

  function renderSmartThings(error) {
    $('stBadge').textContent = st.connected ? (st.needsReauth ? 'Reconectar' : 'Conectado') : 'No conectado';
    $('stBadge').classList.toggle('on', !!st.connected && !st.needsReauth);
    const showSetup = !st.connected || st.needsReauth;
    $('stSetup').hidden = !showSetup;
    $('stDone').hidden = showSetup;
    $('stLabel').textContent = st.label || 'tu TV';
    const msg = error ?? (st.needsReauth ? 'El acceso a SmartThings venció: volvé a conectar con un token nuevo.' : st.error);
    $('stError').textContent = msg || '';
  }

  // El estado de SmartThings llega con el resto del estado de la app.
  function render(state) {
    st = state.smartthings || {};
    if (isOpen()) renderSmartThings();
  }

  async function saveSettings() {
    const saved = await run(api.settings.set({
      ip: $('cfgIp').value.trim(),
      mac: $('cfgMac').value.trim(),
      alwaysOnTop: $('cfgTop').checked,
      ps5Hdmi: Number($('cfgPs5').value),
      switchHdmi: Number($('cfgSwitch').value),
      mirrorQuality: $('cfgQuality').value,
    }));
    if (!saved) return; // el error ya se mostró (p. ej. IP inválida)
    settings = saved;
    window.Ambi.tvView.showPorts(saved);
    close();
  }

  async function connectSmartThings() {
    const pat = $('stPat').value.trim();
    if (!pat) { renderSmartThings('Pegá el token primero.'); return; }
    const btn = $('stConnect');
    btn.disabled = true;
    btn.textContent = 'Esperando…';
    renderSmartThings('');
    try {
      await api.smartthings.connect(pat);
      renderSmartThings(null);
      toast('SmartThings conectado', 'ok');
    } catch (e) {
      renderSmartThings(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Conectar';
      $('stPat').value = ''; // el token no queda en la interfaz
    }
  }

  function init() {
    $('btnSettings').addEventListener('click', () => (isOpen() ? close() : open()));
    $('cfgSave').addEventListener('click', saveSettings);
    $('cfgAutostart').addEventListener('change', (e) => run(api.app.setAutostart(e.target.checked)));
    $('cfgForget').addEventListener('click', async () => { await run(api.tv.forgetPairing()); close(); });
    $('cfgQuit').addEventListener('click', () => run(api.app.quit()));
    $('stOpenTokens').addEventListener('click', () => run(api.smartthings.openTokenPage()));
    $('stConnect').addEventListener('click', connectSmartThings);
    $('stDisconnect').addEventListener('click', () => run(api.smartthings.disconnect()));
  }

  window.Ambi.settingsView = { init, render, isOpen };
})();
