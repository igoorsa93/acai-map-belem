/**
 * interactions.js - Navigation, keyboard, global search
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
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (!view) return;
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
    if (e.key === 'Escape') {
      dispatch('SELECT_ESTABLISHMENT', { placeId: null });
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      document.getElementById('header-search-input')?.focus();
    }
  });
}

function _initOutsideClick() {
  const panel = document.getElementById('detail-panel');
  if (!panel) return;
  // Clicking backdrop on mobile
  document.addEventListener('click', e => {
    if (window.innerWidth > 480) return;
    const mapSection = document.getElementById('map-section');
    if (mapSection && mapSection.contains(e.target) && !panel.contains(e.target)) {
      dispatch('SELECT_ESTABLISHMENT', { placeId: null });
    }
  });
}

export function updateNav(view) {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  document.querySelectorAll('.view-section').forEach(sec => {
    sec.classList.toggle('active', sec.dataset.view === view);
  });
}
