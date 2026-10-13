// Arranque de la interfaz: logos, pestañas, indicador de conexión, atajos de teclado y suscripción
// al estado que envía el proceso principal.
(async () => {
  const { $, logoSvg, brandSvg, run, isFormField, api, tvView, lightView, settingsView } = window.Ambi;

  // ----- Logos
  document.querySelectorAll('[data-logo]').forEach((node) => node.append(logoSvg(node.dataset.logo, { crop: node.classList.contains('wide') })));
  $('wizChip').append(brandSvg('wiz'));
  $('bulbBrand').append(
    brandSvg('philips', { x: '35', y: '86.2', width: '30', height: '5.6', class: 'bulb-philips' }),
    brandSvg('wiz', { x: '43.5', y: '94', width: '13', height: '5.2', class: 'bulb-wiz' }),
  );

  // ----- Estado
  let state = null;
  let activeTab = 'tv';
  const LABELS = {
    idle: 'Buscando la TV…', connecting: 'Conectando…', pairing: 'Aceptá el aviso en la TV',
    connected: 'Conectado', offline: 'Sin conexión', denied: 'Rechazado por la TV',
  };

  // El indicador de arriba muestra la conexión del dispositivo de la pestaña activa.
  function renderStatus() {
    if (!state) return;
    if (activeTab === 'light') {
      const ok = !!state.light;
      $('status').className = `status ${ok ? 'connected' : 'offline'}`;
      $('statusText').textContent = ok ? (state.ambient.on ? 'Conectada · ambiente' : 'Conectada') : 'Sin respuesta';
      return;
    }
    const r = state.remote;
    $('status').className = `status ${r.state}`;
    $('statusText').textContent = r.detail || LABELS[r.state] || r.state;
  }

  function render(next) {
    state = next;
    tvView.render(state);
    lightView.render(state);
    settingsView.render(state);
    renderStatus();
  }

  // ----- Pestañas (TV / Luz); se recuerda la última elegida.
  function selectTab(name) {
    activeTab = name;
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
    document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== `view-${name}`; });
    const light = name === 'light';
    $('brandLogo').replaceChildren(light ? brandSvg('philips', { preserveAspectRatio: 'xMinYMid meet' }) : logoSvg('samsung', { crop: true }));
    $('brandLogo').title = light ? 'Philips' : 'Samsung';
    renderStatus();
    try { localStorage.setItem('tab', name); } catch {}
  }
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => selectTab(t.dataset.tab)));

  // ----- Atajos de teclado (PC → TV / luz)
  const KEYMAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    Enter: 'ok', Backspace: 'back', Escape: 'back',
    h: 'home', s: 'source', i: 'info', PageUp: 'channel-up', PageDown: 'channel-down',
  };
  const REPEATABLE = new Set(['up', 'down', 'left', 'right', 'channel-up', 'channel-down']);
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && (e.key === '1' || e.key === '2')) { selectTab(e.key === '1' ? 'tv' : 'light'); return; }
    if (settingsView.isOpen() || e.ctrlKey || e.altKey || e.metaKey || isFormField(e.target)) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const once = (fn) => { if (!e.repeat) fn(); };
    if (k === ' ') { e.preventDefault(); return once(tvView.playPause); }
    if (k === 'p') return once(() => run(api.tv.power()));
    if (k === 'm') return once(tvView.toggleMute);
    if (k === 'l') return once(lightView.toggleLight);
    if (k === 'a') return once(lightView.toggleAmbient);
    if (k === '+' || k === '=') return tvView.nudgeVolume(1);
    if (k === '-') return tvView.nudgeVolume(-1);
    const inputs = { F1: 'ps5', F2: 'switch', F3: 'next' };
    if (inputs[k]) return once(() => run(api.tv.input(inputs[k])));
    if (/^[0-9]$/.test(k)) return run(api.tv.key(k));
    const code = KEYMAP[k];
    if (!code) return;
    e.preventDefault();
    if (e.repeat && !REPEATABLE.has(code)) return;
    run(api.tv.key(code));
    const btn = document.querySelector(`[data-key="${code}"]`);
    if (btn) { btn.classList.add('pressed'); setTimeout(() => btn.classList.remove('pressed'), 120); }
  });

  // ----- Ventana
  $('btnHide').addEventListener('click', () => run(api.app.hide()));
  $('btnMin').addEventListener('click', () => run(api.app.minimize()));

  // ----- Arranque
  const settings = await run(api.settings.get());
  if (settings) {
    tvView.init(settings);
    lightView.init(settings);
  }
  settingsView.init();
  let initialTab = 'tv';
  try { if (localStorage.getItem('tab') === 'light') initialTab = 'light'; } catch {}
  selectTab(initialTab);
  api.onState(render);
  const initial = await run(api.state());
  if (initial) render(initial);
})();
