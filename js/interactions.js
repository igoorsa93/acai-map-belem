/**
 * interactions.js — Navigation, keyboard, global search, ripple
 */
import { dispatch } from './state.js';
import { debounce } from './utils.js';

export function init() {
  _initNav();
  _initSearch();
  _initKeyboard();
  _initOutsideClick();
}

function _initNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
      const view = this.dataset.view;
      if (!view) return;

      // Ripple
      const ripple = document.createElement('span');
      ripple.className = 'nav-ripple';
      const rect = this.getBoundingClientRect();
      ripple.style.left = (e.clientX - rect.left) + 'px';
      ripple.style.top = (e.clientY - rect.top) + 'px';
      this.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);

      dispatch('SET_VIEW', { view });
    });
  });
}

function _initSearch() {
  const input = document.getElementById('header-search-input');
  if (!input) return;
  input.addEventListener('input', debounce(e => {
    dispatch('SET_FILTER', { search: e.target.value.trim() });
  }, 300));
}

function _initKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') dispatch('SELECT_ESTABLISHMENT', { placeId: null });
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      document.getElementById('header-search-input')?.focus();
    }
    // Number keys 1-6 for view switching
    const views = ['overview', 'mapa', 'graficos', 'tabela', 'bairros', 'sobre'];
    const idx = parseInt(e.key) - 1;
    if (!e.ctrlKey && !e.metaKey && !e.altKey && idx >= 0 && idx < views.length) {
      const active = document.activeElement;
      if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(active?.tagName)) {
        dispatch('SET_VIEW', { view: views[idx] });
      }
    }
  });
}

function _initOutsideClick() {
  const panel = document.getElementById('detail-panel');
  if (!panel) return;
  document.addEventListener('click', e => {
    if (window.innerWidth > 480) return;
    const mapSection = document.getElementById('map-section');
    if (mapSection && mapSection.contains(e.target) && !panel.contains(e.target)) {
      dispatch('SELECT_ESTABLISHMENT', { placeId: null });
    }
  });
}

export function updateNav(view) {
  document.body.dataset.view = view;

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
    btn.setAttribute('aria-current', btn.dataset.view === view ? 'page' : 'false');
  });

  document.querySelectorAll('.view-section').forEach(sec => {
    sec.classList.toggle('active', sec.dataset.view === view);
  });

  // Persistent sections: show/hide based on data-views attribute
  document.querySelectorAll('.persistent-section').forEach(sec => {
    const views = (sec.dataset.views || '').split(' ');
    const visible = views.includes(view);
    sec.hidden = !visible;
    // Full-height map when dedicated mapa view
    if (sec.id === 'map-section') {
      sec.classList.toggle('map-fullscreen', view === 'mapa');
    }
    // Full-width charts when dedicated graficos view
    if (sec.id === 'charts-section') {
      sec.classList.toggle('charts-fullpage', view === 'graficos');
    }
    // Full-width table when dedicated tabela view
    if (sec.id === 'table-section') {
      sec.classList.toggle('table-fullpage', view === 'tabela');
    }
  });
}
