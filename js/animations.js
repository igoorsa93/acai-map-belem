/**
 * animations.js - Canvas background particle animation + count-up
 */

let canvas, ctx, animId, particles = [];
const PARTICLE_COUNT = 60;
const MAX_DIST = 100;

export function startCanvas() {
  canvas = document.getElementById('bg-canvas');
  if (!canvas) return;

  // Respect prefers-reduced-motion
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    canvas.style.display = 'none';
    return;
  }

  ctx = canvas.getContext('2d');
  _resize();
  _initParticles();
  _loop();

  window.addEventListener('resize', _onResize);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(animId); }
    else { _loop(); }
  });
}

function _resize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}

let resizeTimer;
function _onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    _resize();
    _initParticles();
  }, 200);
}

function _initParticles() {
  particles = Array.from({ length: PARTICLE_COUNT }, () => ({
    x:  Math.random() * canvas.width,
    y:  Math.random() * canvas.height,
    vx: (Math.random() - 0.5) * 0.3,
    vy: (Math.random() - 0.5) * 0.3,
    r:  Math.random() * 2 + 1,
  }));
}

function _loop() {
  animId = requestAnimationFrame(_loop);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < 0 || p.x > canvas.width)  p.vx *= -1;
    if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(75,40,109,0.5)';
    ctx.fill();
  }

  // Connection lines
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const dx = particles[i].x - particles[j].x;
      const dy = particles[i].y - particles[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < MAX_DIST) {
        ctx.beginPath();
        ctx.moveTo(particles[i].x, particles[i].y);
        ctx.lineTo(particles[j].x, particles[j].y);
        ctx.strokeStyle = `rgba(75,40,109,${(1 - dist / MAX_DIST) * 0.15})`;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    }
  }
}
