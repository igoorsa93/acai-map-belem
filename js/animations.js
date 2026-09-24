/**
 * animations.js - Textura de partículas no hero (baixa intensidade) + revelação por seção
 */
import { reducedMotion } from './utils.js';

const COUNT = 12;
const LINK = 140;
let canvas, ctx, raf = null, visible = true, parts = [];
let mx = -9999, my = -9999, w = 0, h = 0, dpr = 1;

export function startCanvas() {
  canvas = document.getElementById('hero-canvas');
  if (!canvas || reducedMotion()) return;
  ctx = canvas.getContext('2d');
  _resize();
  parts = Array.from({ length: COUNT }, () => ({
    x: Math.random() * w, y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.18, vy: (Math.random() - 0.5) * 0.18,
    r: Math.random() * 1.6 + 0.8,
  }));

  const hero = document.getElementById('hero');
  hero.addEventListener('pointermove', e => { const b = canvas.getBoundingClientRect(); mx = e.clientX - b.left; my = e.clientY - b.top; });
  hero.addEventListener('pointerleave', () => { mx = my = -9999; });
  window.addEventListener('resize', _resize);
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; _toggle(); }).observe(hero);
  document.addEventListener('visibilitychange', _toggle);
  _toggle();
}

function _toggle() {
  const run = visible && !document.hidden && !document.getElementById('hero')?.hidden;
  if (run && !raf) raf = requestAnimationFrame(_loop);
  if (!run && raf) { cancelAnimationFrame(raf); raf = null; }
}

export function refreshCanvas() { _resize(); _toggle(); }

function _resize() {
  if (!canvas) return;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  w = canvas.offsetWidth; h = canvas.offsetHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function _loop() {
  raf = requestAnimationFrame(_loop);
  ctx.clearRect(0, 0, w, h);
  for (const p of parts) {
    const dx = p.x - mx, dy = p.y - my, d = Math.hypot(dx, dy);
    if (d < 110 && d > 0) { p.vx += dx / d * 0.04; p.vy += dy / d * 0.04; }
    p.vx *= 0.985; p.vy *= 0.985;
    if (Math.hypot(p.vx, p.vy) < 0.08) { p.vx += (Math.random() - 0.5) * 0.02; p.vy += (Math.random() - 0.5) * 0.02; }
    p.x += p.vx; p.y += p.vy;
    if (p.x < -10) p.x = w + 10; if (p.x > w + 10) p.x = -10;
    if (p.y < -10) p.y = h + 10; if (p.y > h + 10) p.y = -10;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fill();
  }
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i], b = parts[j], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < LINK) {
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = `rgba(162,204,36,${(1 - d / LINK) * 0.14})`;
        ctx.lineWidth = 0.7; ctx.stroke();
      }
    }
  }
}

/** Seções entram uma a uma conforme o scroll */
export function initReveal() {
  const els = document.querySelectorAll('.reveal');
  if (reducedMotion() || !('IntersectionObserver' in window)) { els.forEach(el => el.classList.add('is-in')); return; }
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } });
  }, { threshold: 0.06, rootMargin: '0px 0px -40px 0px' });
  els.forEach(el => io.observe(el));
}
