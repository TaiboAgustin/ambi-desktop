// Vista de la TV: tarjeta, volumen, entradas, apps, espejo y navegación.
(() => {
  const { $, el, logoSvg, run, api } = window.Ambi;

  const APP_NAMES = { netflix: 'Netflix', youtube: 'YouTube', primevideo: 'Prime Video', disneyplus: 'Disney+', appletv: 'Apple TV', spotify: 'Spotify' };
  const APP_GLOW = { netflix: '#e50914', youtube: '#ff2a2a', primevideo: '#1aa8e0', disneyplus: '#1d6fd1', appletv: '#9aa3ad', spotify: '#1ed760' };
  const WIDE_LOGOS = new Set(['primevideo', 'appletv']);
  const INPUTS = {
    ps5: { name: 'PlayStation 5', logo: 'ps5', wide: true, glow: '#0070d1' },
    switch: { name: 'Nintendo Switch 2', logo: 'nintendoswitch', glow: '#e60012' },
  };
  const MIRROR_LABELS = { idle: 'Espejar', starting: 'Abriendo…', connecting: 'Conectando…', live: 'Detener', error: 'Reintentar' };

  let tv = {};
  let mirror = { state: 'idle' };
  let shownScreen = null;
  let deviceKey = '';

  // ----- Dibujo de la pantalla de la tele
  function setGlow(color) { document.documentElement.style.setProperty('--glow', color); }

  function setScreen(key) {
    if (key === shownScreen) return;
    shownScreen = key;
    const box = $('screenContent');
    box.className = '';
    box.replaceChildren();
    if (!key) return;
    if (key === 'mirror') {
      setGlow('#3b6ff5');
      box.append(lineIcon('M3 4h18v12H3zM8 20h8M12 16v4'));
      return;
    }
    if (key === 'idle') {
      setGlow('#1428a0');
      box.className = 'wide samsung';
      box.append(logoSvg('samsung', { crop: true }));
      return;
    }
    const [kind, id] = key.split(':');
    if (kind === 'app') {
      setGlow(APP_GLOW[id]);
      if (id === 'disneyplus') { box.className = 'img'; box.append(el('img', { src: 'img/disneyplus.png', alt: 'Disney+' })); }
      else { box.className = WIDE_LOGOS.has(id) ? 'wide' : ''; box.append(logoSvg(id, { crop: WIDE_LOGOS.has(id) })); }
    } else {
      const inp = INPUTS[id];
      setGlow(inp.glow);
      box.className = inp.wide ? 'wide' : '';
      box.append(logoSvg(inp.logo, { crop: inp.wide }));
    }
  }

  function lineIcon(d) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'line');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
    return svg;
  }

  function renderDevice(device) {
    const key = JSON.stringify(device);
    if (!device || key === deviceKey) return;
    deviceKey = key;
    $('tvName').textContent = device.name;
    $('tvModel').textContent = device.title;
    $('tvChips').replaceChildren(...device.chips.map((c) => el('span', { class: `chip ${c.kind || ''}`, text: c.text })));
    $('tvChips').title = device.detail;
  }

  function nowLine(on, fg, input) {
    const now = $('nowText');
    const strong = (label, value) => now.replaceChildren(`${label}: `, el('b', { text: value }));
    if (tv.power === 'off') now.textContent = 'Apagada o fuera de la red';
    else if (tv.power === 'standby') now.textContent = 'En reposo';
    else if (tv.power !== 'on') now.textContent = 'Buscando la TV…';
    else if (mirror.state === 'live') strong('En pantalla', 'esta PC');
    else if (mirror.state !== 'idle' && mirror.detail) now.textContent = mirror.detail;
    else if (fg) strong('En pantalla', APP_NAMES[fg]);
    else if (input) strong('Entrada', INPUTS[input].name);
    else now.textContent = 'Encendida';
  }

  function render(state) {
    tv = state.tv;
    mirror = state.mirror;
    const on = tv.power === 'on';
    renderDevice(tv.device);
    $('tv').classList.toggle('on', on);
    $('btnPower').classList.toggle('on', on);
    $('view-tv').classList.toggle('offline', !on);

    const fg = tv.foreground;
    const input = !fg && on ? tv.input : null;
    document.querySelectorAll('[data-app]').forEach((b) => {
      b.classList.toggle('active', b.dataset.app === fg);
      b.hidden = tv.installed?.[b.dataset.app] === false;
    });
    document.querySelectorAll('[data-input]').forEach((b) => b.classList.toggle('active', b.dataset.input === input));
    setScreen(!on ? '' : mirror.state === 'live' ? 'mirror' : fg ? `app:${fg}` : input ? `input:${input}` : 'idle');
    nowLine(on, fg, input);

    const slider = $('volSlider');
    slider.disabled = tv.volume == null;
    if (tv.volume != null && !slider.matches(':active') && Date.now() - lastVolumeInput > 1500) {
      slider.value = tv.volume;
      paintVolume();
    }
    $('btnMute').classList.toggle('muted', !!tv.muted);
    renderMirror();
  }

  // ----- Teclas; las marcadas data-repeat se repiten al mantener apretado.
  function pressKey(btn) {
    const code = btn.dataset.key;
    run(api.tv.key(code));
    if (!('repeat' in btn.dataset)) return;
    let timer = setTimeout(function tick() { run(api.tv.key(code)); timer = setTimeout(tick, 120); }, 400);
    // Cortar en cualquier forma de soltar: si no, podía quedar mandando teclas sin fin.
    const stop = () => {
      clearTimeout(timer);
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.removeEventListener(ev, stop);
      window.removeEventListener('blur', stop);
    };
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, stop);
    window.addEventListener('blur', stop);
  }

  // ----- Volumen absoluto vía UPnP (con un pequeño retardo mientras se arrastra)
  let volTimer;
  let lastVolumeInput = 0;
  function paintVolume() {
    const s = $('volSlider');
    s.style.setProperty('--pct', `${s.value}%`);
    $('volValue').textContent = s.disabled ? '–' : s.value;
  }
  function sendVolume() {
    lastVolumeInput = Date.now();
    clearTimeout(volTimer);
    volTimer = setTimeout(() => run(api.tv.volume(Number($('volSlider').value))), 120);
  }
  function nudgeVolume(delta) {
    const s = $('volSlider');
    if (s.disabled) return run(api.tv.key(delta > 0 ? 'KEY_VOLUP' : 'KEY_VOLDOWN'));
    s.value = Math.min(100, Math.max(0, Number(s.value) + delta));
    paintVolume();
    sendVolume();
  }
  const toggleMute = () => run(api.tv.mute(!tv.muted));

  let playing = true;
  const playPause = () => { run(api.tv.key(playing ? 'KEY_PAUSE' : 'KEY_PLAY')); playing = !playing; };

  // ----- Espejo
  async function loadScreens(select, selectedId) {
    const screens = await run(api.screens());
    if (!screens) return;
    select.replaceChildren(...screens.map((s) => el('option', { value: s.id, text: s.name })));
    if (selectedId && screens.some((s) => s.id === selectedId)) select.value = selectedId;
  }

  function renderMirror() {
    const btn = $('btnMirror');
    $('mirrorLabel').textContent = MIRROR_LABELS[mirror.state] || 'Espejar';
    btn.classList.toggle('live', mirror.state === 'live');
    btn.classList.toggle('busy', mirror.state === 'starting' || mirror.state === 'connecting');
    btn.title = mirror.detail || (mirror.state === 'live' ? 'Detener el espejo' : 'Espejar esta PC en la TV');
    document.querySelector('.mirror').classList.toggle('locked', !['idle', 'error'].includes(mirror.state));
  }

  function init(settings) {
    document.querySelectorAll('[data-key]').forEach((btn) => btn.addEventListener('pointerdown', () => pressKey(btn)));
    document.querySelectorAll('[data-input]').forEach((btn) => btn.addEventListener('click', () => run(api.tv.input(btn.dataset.input))));
    document.querySelectorAll('[data-app]').forEach((btn) => btn.addEventListener('click', () => run(api.tv.app(btn.dataset.app))));
    $('btnPlayPause').addEventListener('click', playPause);
    $('btnPower').addEventListener('click', () => run(api.tv.power()));
    $('volSlider').addEventListener('input', () => { paintVolume(); sendVolume(); });
    $('volSlider').addEventListener('wheel', (e) => { e.preventDefault(); nudgeVolume(e.deltaY < 0 ? 1 : -1); }, { passive: false });
    $('btnMute').addEventListener('click', toggleMute);

    $('mirrorAudio').checked = settings.mirror.audio;
    loadScreens($('mirrorScreen'), settings.mirror.sourceId);
    $('mirrorScreen').addEventListener('focus', () => loadScreens($('mirrorScreen'), $('mirrorScreen').value));
    $('btnMirror').addEventListener('click', () => {
      if (['idle', 'error'].includes(mirror.state)) run(api.mirror.start({ sourceId: $('mirrorScreen').value, audio: $('mirrorAudio').checked }));
      else run(api.mirror.stop());
    });
    showPorts(settings);
  }

  function showPorts(settings) {
    $('ps5Port').textContent = `HDMI ${settings.ps5Hdmi}`;
    $('switchPort').textContent = `HDMI ${settings.switchHdmi}`;
  }

  window.Ambi.tvView = { init, render, showPorts, playPause, toggleMute, nudgeVolume, loadScreens };
})();
