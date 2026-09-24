/**
 * utils.js - Shared utility functions
 */

export function fmt(n, decimals = 0) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Rating: 0/null = dado ausente */
export function fmtRating(n, decimals = 1) {
  if (n == null || isNaN(n) || n <= 0) return '—';
  return fmt(n, decimals);
}

/** Distância legível: < 1 km em metros */
export function fmtDist(km) {
  if (km == null || isNaN(km)) return '—';
  if (km < 1) return `${fmt(Math.round(km * 1000 / 10) * 10)} m`;
  return `${fmt(km, 2)} km`;
}

export function starsHtml(rating) {
  const full = Math.round(rating);
  return Array.from({ length: 5 }, (_, i) => i < full ? '★' : '☆').join('');
}

export function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Minúsculas sem acento — busca tolerante */
export function normalize(str) {
  return String(str ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Count-up com easing; respeita reduced motion */
export function countUp(el, target, duration = 450, forcedDecimals = null) {
  const numTarget = parseFloat(target);
  if (isNaN(numTarget)) { el.textContent = '—'; el.dataset.current = ''; return; }
  const start = parseFloat(el.dataset.current) || 0;
  const decimals = forcedDecimals ?? (String(target).includes('.') ? (String(target).split('.')[1]?.length ?? 1) : 0);
  el.dataset.current = numTarget;
  if (start === numTarget || reducedMotion()) { el.textContent = fmt(numTarget, decimals); return; }
  const t0 = performance.now();
  cancelAnimationFrame(el._raf);
  const step = now => {
    const p = Math.min((now - t0) / duration, 1);
    const v = start + (numTarget - start) * (1 - Math.pow(1 - p, 3));
    el.textContent = fmt(p < 1 ? v : numTarget, decimals);
    if (p < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
  clearTimeout(el._fallback);
  el._fallback = setTimeout(() => {
    if (parseFloat(el.dataset.current) === numTarget) el.textContent = fmt(numTarget, decimals);
  }, duration + 80);
}

export const TIPOS = ['Especializado em açaí', 'Açaí + outro segmento', 'Outro estabelecimento'];

export function tipoKey(tipo) {
  if (tipo === 'Especializado em açaí') return 'esp';
  if (tipo === 'Açaí + outro segmento') return 'mix';
  return 'out';
}

export function tipoColor(tipo) {
  return { esp: '#7A3C8C', mix: '#A2CC24', out: '#A9A5AD' }[tipoKey(tipo)];
}

export function tipoShort(tipo) {
  return { esp: 'Especializado', mix: 'Açaí + outro', out: 'Outro' }[tipoKey(tipo)];
}

export function truncate(str, n = 40) {
  return str && str.length > n ? str.slice(0, n - 1) + '…' : (str ?? '');
}

/** Ícones de traço (16px) — sem emoji */
const ICON_PATHS = {
  pin:     '<path d="M8 14.5s-5-4.6-5-8.3a5 5 0 0 1 10 0c0 3.7-5 8.3-5 8.3z"/><circle cx="8" cy="6.2" r="1.8"/>',
  star:    '<path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/>',
  chat:    '<path d="M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z"/>',
  grid:    '<path d="M2.5 2.5h4.5V7H2.5zM9 2.5h4.5V7H9zM2.5 9H7v4.5H2.5zM9 9h4.5v4.5H9z"/>',
  search:  '<circle cx="7" cy="7" r="4.3"/><path d="M10.2 10.2l3.3 3.3"/>',
  layers:  '<path d="M8 2l6 3.2-6 3.2-6-3.2z"/><path d="M2 8.4l6 3.2 6-3.2"/>',
  repeat:  '<path d="M3 6.5V5.5A2 2 0 0 1 5 3.5h8M11 1.5l2 2-2 2M13 9.5v1a2 2 0 0 1-2 2H3M5 14.5l-2-2 2-2"/>',
  ruler:   '<path d="M2 11.5L11.5 2l2.5 2.5L4.5 14z"/><path d="M5 9l1.2 1.2M7 7l1.8 1.8M9 5l1.2 1.2"/>',
  radius:  '<circle cx="8" cy="8" r="5.8"/><circle cx="8" cy="8" r="1.4"/>',
  check:   '<path d="M3.5 8.5l3 3 6-7"/>',
  close:   '<path d="M4 4l8 8M12 4l-8 8"/>',
  back:    '<path d="M10 3L5 8l5 5"/>',
  arrow:   '<path d="M3 8h10M9 4l4 4-4 4"/>',
  clock:   '<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/>',
  chevron: '<path d="M4 6l4 4 4-4"/>',
  target:  '<circle cx="8" cy="8" r="5"/><path d="M8 1v3M8 12v3M1 8h3M12 8h3"/>',
  expand:  '<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>',
  external:'<path d="M9 2.5h4.5V7M13.5 2.5L7.5 8.5M12 9.5v4H2.5V4h4"/>',
  filter:  '<path d="M2 3.5h12M4.5 8h7M7 12.5h2"/>',
  phone:   '<path d="M4 2h2.5l1 3-1.5 1a8 8 0 0 0 4 4l1-1.5 3 1V12a2 2 0 0 1-2 2A10 10 0 0 1 2 4a2 2 0 0 1 2-2z"/>',
  globe:   '<circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12"/>',
  alert:   '<path d="M8 2l6.5 11.5h-13z"/><path d="M8 6.5v3M8 11.5v.2"/>',
  dots:    '<circle cx="4" cy="8" r="1.5"/><circle cx="8" cy="5" r="1.5"/><circle cx="12" cy="9" r="1.5"/><circle cx="7" cy="11.5" r="1.5"/>',
};

export function icon(name, size = 16) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] ?? ''}</svg>`;
}
