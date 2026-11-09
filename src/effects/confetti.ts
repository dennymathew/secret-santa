// One confetti burst plus a short rain afterwards. The canvas is removed when finished.
export function confetti(durationMs = 3500) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas');
  canvas.id = 'confetti';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = innerWidth, h = innerHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  const colors = ['#c8102e', '#f6c344', '#146b3a', '#ffffff', '#4cc9f0', '#f72585'];
  const pieces = Array.from({ length: w < 600 ? 140 : 220 }, () => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
    const speed = 7 + Math.random() * 9;
    return {
      x: w / 2, y: h * 0.45,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      s: 5 + Math.random() * 6, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
      c: colors[(Math.random() * colors.length) | 0], shape: Math.random() < 0.3 ? 'circle' : 'rect',
    };
  });
  const start = performance.now();
  const tick = (t: number) => {
    const el = t - start;
    ctx.clearRect(0, 0, w, h);
    for (const p of pieces) {
      p.vy += 0.25; p.vx *= 0.99; p.vy *= 0.99;
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - el / durationMs);
      ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c;
      if (p.shape === 'circle') { ctx.beginPath(); ctx.arc(0, 0, p.s / 2, 0, Math.PI * 2); ctx.fill(); }
      else ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    }
    if (el < durationMs) requestAnimationFrame(tick);
    else canvas.remove();
  };
  requestAnimationFrame(tick);
}
