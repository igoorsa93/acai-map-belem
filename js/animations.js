/**
 * animations.js — Interactive canvas background + entrance animations
 */

let canvas, ctx, animId;
let particles = [];
let mouseX = -9999, mouseY = -9999;

const PARTICLE_COUNT = 72;
const MAX_DIST = 110;
const REPEL_RADIUS = 130;
const REPEL_STRENGTH = 0.55;
const MAX_SPEED = 2.2;
const FRICTION = 0.965;

const COLORS = [
  'rgba(203,58,166,', // pink
  'rgba(75,37,93,',   // purple
  'rgba(162,204,36,', // lime
  'rgba(230,29,127,', // bright pink
  'rgba(155,45,138,', // mid purple
];

export function startCanvas() {
  canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  ctx = canvas.getContext('2d');
  _resize();
  _initParticles();
  _loop();

  window.addEventListener('resize', _debounceResize);
  document.addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; });
  document.addEventListener('touchmove', e => {
    mouseX = e.touches[0].clientX;
    mouseY = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('mouseleave', () => { mouseX = -9999; mouseY = -9999; });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelAnimationFrame(animId);
    else _loop();
  });
}

function _resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

let _resizeTimer;
function _debounceResize() {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => { _resize(); _initParticles(); }, 200);
}

function _initParticles() {
  particles = Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    vx: (Math.random() - 0.5) * 0.4,
    vy: (Math.random() - 0.5) * 0.4,
    r: Math.random() * 2.5 + 0.8,
    color: COLORS[i % COLORS.length],
    alpha: Math.random() * 0.35 + 0.15,
    pulse: Math.random() * Math.PI * 2,
    pulseSpeed: 0.015 + Math.random() * 0.015,
  }));
}

function _loop() {
  animId = requestAnimationFrame(_loop);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const p of particles) {
    // Mouse repulsion
    const dx = p.x - mouseX;
    const dy = p.y - mouseY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < REPEL_RADIUS && dist > 0) {
      const force = (REPEL_RADIUS - dist) / REPEL_RADIUS;
      p.vx += (dx / dist) * force * REPEL_STRENGTH;
      p.vy += (dy / dist) * force * REPEL_STRENGTH;
    }

    // Friction + speed cap
    p.vx *= FRICTION;
    p.vy *= FRICTION;
    const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    if (speed > MAX_SPEED) { p.vx = (p.vx / speed) * MAX_SPEED; p.vy = (p.vy / speed) * MAX_SPEED; }

    p.x += p.vx;
    p.y += p.vy;

    // Wrap edges smoothly
    if (p.x < -20) p.x = canvas.width + 20;
    if (p.x > canvas.width + 20) p.x = -20;
    if (p.y < -20) p.y = canvas.height + 20;
    if (p.y > canvas.height + 20) p.y = -20;

    // Pulse alpha
    p.pulse += p.pulseSpeed;
    const a = p.alpha + Math.sin(p.pulse) * 0.08;

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = p.color + a + ')';
    ctx.fill();
  }

  // Connection lines
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const dx = particles[i].x - particles[j].x;
      const dy = particles[i].y - particles[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < MAX_DIST) {
        const opacity = (1 - dist / MAX_DIST) * 0.12;
        ctx.beginPath();
        ctx.moveTo(particles[i].x, particles[i].y);
        ctx.lineTo(particles[j].x, particles[j].y);
        ctx.strokeStyle = `rgba(203,58,166,${opacity})`;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    }
  }
}

/* ── Entrance animations (IntersectionObserver) ── */
export function initEntranceAnimations() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('animate-in');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08 });

  // Stagger siblings
  document.querySelectorAll('#kpi-grid .kpi-card').forEach((el, i) => {
    el.style.transitionDelay = `${i * 70}ms`;
    observer.observe(el);
  });

  document.querySelectorAll('.chart-card').forEach((el, i) => {
    el.style.transitionDelay = `${i * 60}ms`;
    observer.observe(el);
  });

  document.querySelectorAll('.hero-stat').forEach((el, i) => {
    el.style.transitionDelay = `${i * 80}ms`;
    el.classList.add('animate-in'); // hero is immediately visible
  });
}
