// Vista de la luz WiZ: dibujo de la lámpara, brillo, blancos, colores, escenas y modo ambiente.
(() => {
  const { $, el, run, api } = window.Ambi;

  const SCENE_NAMES = { 18: 'TV', 4: 'Fiesta', 3: 'Atardecer', 16: 'Relax', 29: 'Velas', 14: 'Noche', 1: 'Océano', 5: 'Chimenea', 15: 'Foco', 11: 'Blanco cálido', 12: 'Luz de día', 13: 'Blanco frío' };
  const WHITE_SCENES = { 11: 2700, 12: 4200, 13: 6500 }; // escenas que son un blanco fijo

  let light = null;
  let ambient = { on: false };

  function tempColor(k) {
    if (k <= 2400) return '#ffad55';
    if (k <= 3000) return '#ffcf94';
    if (k <= 4500) return '#fff0da';
    return '#dde8ff';
  }

  function paintDim() {
    const d = $('lightDim');
    d.style.setProperty('--pct', `${((d.value - 10) / 90) * 100}%`);
    $('lightDimVal').textContent = light ? `${d.value}%` : '–';
  }

  function render(state) {
    light = state.light;
    ambient = state.ambient;
    const view = $('view-light');
    const tabs = document.querySelector('.tabs');
    view.classList.toggle('offline', !light);
    renderAmbient();
    if (!light) {
      $('lightSub').textContent = 'No responde en la red';
      view.classList.remove('on');
      tabs.style.removeProperty('--bulb-dot');
      paintDim();
      return;
    }
    const temp = light.temp || WHITE_SCENES[light.sceneId];
    const color = light.rgb ? `rgb(${light.rgb.join(',')})` : temp ? tempColor(temp) : '#ffcf94';
    view.style.setProperty('--bulb', color);
    view.style.setProperty('--level', String((light.dimming ?? 100) / 100));
    view.classList.toggle('on', light.on);
    tabs.style.setProperty('--bulb-dot', light.on ? color : 'transparent');

    const scene = light.sceneId && !WHITE_SCENES[light.sceneId] ? SCENE_NAMES[light.sceneId] || `Escena ${light.sceneId}` : null;
    const sub = $('lightSub');
    if (!light.on) sub.textContent = 'Apagada';
    else sub.replaceChildren('Encendida · ', el('b', { text: scene || (light.rgb ? 'Color' : `${temp} K`) }), ` · ${light.dimming ?? 100}%`);

    const dim = $('lightDim');
    // Con el modo ambiente, el slider es el brillo máximo: no pisarlo con el brillo que va variando.
    if (!dim.matches(':active')) {
      if (ambient.on && ambient.maxDim) dim.value = ambient.maxDim;
      else if (!ambient.on && light.dimming != null) dim.value = light.dimming;
    }
    paintDim();
    document.querySelectorAll('.sw[data-temp]').forEach((b) => b.classList.toggle('active', light.on && !light.rgb && !scene && Number(b.dataset.temp) === temp));
    document.querySelectorAll('.sw[data-rgb]').forEach((b) => b.classList.toggle('active', light.on && !!light.rgb && b.dataset.rgb === light.rgb.join(',')));
    document.querySelectorAll('[data-scene]').forEach((b) => b.classList.toggle('active', light.on && Number(b.dataset.scene) === light.sceneId));
  }

  function renderAmbient() {
    $('ambientToggle').setAttribute('aria-checked', String(!!ambient.on));
    $('view-light').classList.toggle('ambient', !!ambient.on);
    $('dimLabel').hidden = !ambient.on;
    $('ambientHint').textContent = ambient.error
      || (ambient.on ? 'Siguiendo la pantalla · tocá un color o escena para salir' : 'La luz sigue los colores de la pantalla de la PC');
  }

  const setLight = (params) => run(api.light.set(params));
  const toggleLight = () => run(api.light.toggle());
  const toggleAmbient = () => (ambient.on
    ? run(api.ambient.stop())
    : run(api.ambient.start({ sourceId: $('ambientScreen').value || undefined, maxDim: Number($('lightDim').value) })));

  function init(settings) {
    $('btnLight').addEventListener('click', toggleLight);
    let dimTimer;
    $('lightDim').addEventListener('input', () => {
      paintDim();
      clearTimeout(dimTimer);
      dimTimer = setTimeout(() => {
        const v = Number($('lightDim').value);
        if (ambient.on) run(api.ambient.setMax(v));
        else setLight({ state: true, dimming: v });
      }, 120);
    });
    document.querySelectorAll('.sw[data-temp]').forEach((b) => b.addEventListener('click', () => setLight({ state: true, temp: Number(b.dataset.temp) })));
    document.querySelectorAll('.sw[data-rgb]').forEach((b) => b.addEventListener('click', () => {
      const [r, g, bl] = b.dataset.rgb.split(',').map(Number);
      setLight({ state: true, r, g, b: bl });
    }));
    let colorTimer;
    $('lightColor').addEventListener('input', (e) => {
      const hex = e.target.value;
      clearTimeout(colorTimer);
      colorTimer = setTimeout(() => setLight({ state: true, r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) }), 120);
    });
    document.querySelectorAll('[data-scene]').forEach((b) => b.addEventListener('click', () => setLight({ state: true, sceneId: Number(b.dataset.scene) })));

    $('ambientToggle').addEventListener('click', toggleAmbient);
    window.Ambi.tvView.loadScreens($('ambientScreen'), settings.ambient.sourceId);
    // Cambiar de pantalla con el modo ambiente activo lo reinicia sobre la nueva.
    $('ambientScreen').addEventListener('change', () => {
      if (ambient.on) run(api.ambient.start({ sourceId: $('ambientScreen').value, maxDim: Number($('lightDim').value) }));
    });
  }

  window.Ambi.lightView = { init, render, toggleLight, toggleAmbient, isReachable: () => !!light, isAmbient: () => !!ambient.on };
})();
