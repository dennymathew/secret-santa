// Lightweight falling snow on a full-screen canvas. Fewer flakes on phones, paused when hidden.
export function startSnow(canvas: HTMLCanvasElement) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  let w = 0, h = 0, dpr = 1;
  type Flake = { x: number; y: number; r: number; vy: number; vx: number; phase: number };
  let flakes: Flake[] = [];

  const resize = () => {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = innerWidth; h = innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = w < 600 ? 60 : 120;
    flakes = Array.from({ length: count }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      r: 1 + Math.random() * 2.6, vy: 0.3 + Math.random() * 0.9, vx: Math.random() * 0.4 - 0.2,
      phase: Math.random() * Math.PI * 2,
    }));
  };
  resize();
  addEventListener('resize', resize);

  let raf = 0;
  const tick = (t: number) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    for (const f of flakes) {
      f.y += f.vy;
      f.x += f.vx + Math.sin(t / 1400 + f.phase) * 0.3;
      if (f.y > h + 5) { f.y = -5; f.x = Math.random() * w; }
      if (f.x > w + 5) f.x = -5; else if (f.x < -5) f.x = w + 5;
      ctx.moveTo(f.x + f.r, f.y);
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
    }
    ctx.fill();
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  document.addEventListener('visibilitychange', () => {
    cancelAnimationFrame(raf);
    if (!document.hidden) raf = requestAnimationFrame(tick);
  });
}

export function buildLights(el: HTMLElement) {
  const colors = ['#ff4d6d', '#ffd23f', '#3ddc97', '#4cc9f0', '#f72585'];
  const n = Math.max(8, Math.round(innerWidth / 44));
  el.innerHTML = Array.from(
    { length: n },
    (_, i) => `<span style="--c:${colors[i % colors.length]};--d:${(i % 5) * 0.3}s"></span>`,
  ).join('');
}
