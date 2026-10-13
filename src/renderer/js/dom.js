// Utilidades de la interfaz: selección, creación de nodos, logos y avisos.
// Los módulos de la UI se registran en `window.Ambi` (scripts clásicos, sin empaquetador).
(() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const $ = (id) => document.getElementById(id);

  // Crea un elemento con propiedades y hijos (texto siempre como textContent, nunca como HTML).
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else node[k] = v;
    }
    node.append(...children.filter((c) => c != null));
    return node;
  }

  // ----- Logos (simple-icons en logos.js; Philips y WiZ en brand-logos.js)
  // Se miden en un SVG auxiliar siempre renderizado: getBBox da 0 si el logo está en una pestaña oculta.
  const measureSvg = document.createElementNS(SVG_NS, 'svg');
  measureSvg.setAttribute('style', 'position:absolute;left:-9999px;top:0;width:24px;height:24px;visibility:hidden');
  document.body.append(measureSvg);
  const boxes = {};

  function measure(key, build) {
    if (!boxes[key]) {
      const node = build();
      measureSvg.append(node);
      const b = node.getBBox();
      node.remove();
      boxes[key] = b.width ? `${b.x} ${b.y} ${b.width} ${b.height}` : '0 0 24 24';
    }
    return boxes[key];
  }

  function iconPath(key) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', window.LOGOS[key].path);
    return p;
  }

  function logoSvg(key, { crop = false } = {}) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', crop ? measure(`icon:${key}`, () => iconPath(key)) : '0 0 24 24');
    svg.setAttribute('role', 'img');
    svg.setAttribute('class', 'brand-svg');
    svg.append(iconPath(key));
    return svg;
  }

  // Los SVG de marca son contenido propio empaquetado con la app (no viene de la red).
  function brandGroup(key) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.innerHTML = window.BRAND_LOGOS[key];
    return g;
  }

  function brandSvg(key, attrs = {}) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', measure(`brand:${key}`, () => brandGroup(key)));
    svg.setAttribute('role', 'img');
    for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
    svg.setAttribute('class', `brand-svg ${attrs.class || ''}`.trim());
    svg.append(brandGroup(key));
    return svg;
  }

  // ----- Avisos breves (errores de acciones)
  let toastTimer;
  function toast(message, kind = 'error') {
    const t = $('toast');
    t.textContent = message;
    t.className = `toast ${kind}`;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
  }

  // Ejecuta una acción de la API y muestra el error si falla.
  const run = (promise) => Promise.resolve(promise).catch((e) => { toast(e.message); return undefined; });

  // Controles que usan el teclado: con el foco ahí, los atajos no aplican (un checkbox o botón, sí).
  const TYPING_INPUTS = new Set(['text', 'password', 'number', 'range', 'color', 'search']);
  const isFormField = (t) => !!t && (t.isContentEditable || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA'
    || (t.tagName === 'INPUT' && TYPING_INPUTS.has(t.type)));

  window.Ambi = { $, el, logoSvg, brandSvg, toast, run, isFormField, api: window.ambi };
})();
