/**
 * utils.js - Shared utility functions
 */

/** Format number with locale separators */
export function fmt(n, decimals = 0) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Format rating to 1 decimal */
export function fmtRating(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toFixed(1);
}

/** Render star characters (★/☆) for a rating */
export function starsHtml(rating) {
  const full = Math.round(rating);
  return Array.from({ length: 5 }, (_, i) => i < full ? '★' : '☆').join('');
}

/** Debounce a function */
export function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Haversine distance in km */
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Escape HTML */
export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Smooth count-up animation */
export function countUp(el, target, duration = 900, forcedDecimals = null) {
  const start = parseFloat(el.dataset.current ?? 0) || 0;
  const numTarget = parseFloat(target) || 0;
  if (start === numTarget) return;
  const isFloat = String(target).includes('.');
  const decimals = forcedDecimals != null ? forcedDecimals : (isFloat ? (String(target).split('.')[1]?.length ?? 1) : 0);
  el.dataset.current = numTarget;
  const startTime = performance.now();
  function step(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    const val = start + (numTarget - start) * ease;
    el.textContent = fmt(val, decimals);
    if (progress < 1) requestAnimationFrame(step);
    else el.textContent = fmt(numTarget, decimals);
  }
  requestAnimationFrame(step);
}

/** Tipo color mapping */
export function tipoColor(tipo) {
  if (tipo === 'Especializado em açaí') return '#CB3AA6';
  if (tipo === 'Açaí + outro segmento') return '#A2CC24';
  return '#B08CBC';
}

/** Tipo short label */
export function tipoShort(tipo) {
  if (tipo === 'Especializado em açaí') return 'Especializado';
  if (tipo === 'Açaí + outro segmento') return 'Açaí + Outro';
  return 'Outro';
}

/** Truncate string */
export function truncate(str, n = 40) {
  return str && str.length > n ? str.slice(0, n) + '…' : (str ?? '');
}
