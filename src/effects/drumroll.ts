// A synthesized snare drum roll that speeds up, ending on a cymbal crash. No audio files needed.
let ctx: AudioContext | null = null;

function noiseBuffer(ac: AudioContext) {
  const buf = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function hit(ac: AudioContext, buf: AudioBuffer, at: number, gain: number, decay: number, freq = 1800) {
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass'; filter.frequency.value = freq; filter.Q.value = 0.8;
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + decay);
  src.connect(filter).connect(g).connect(ac.destination);
  src.start(at); src.stop(at + decay + 0.05);
}

/** Plays a roll for `seconds` and returns once it has been scheduled. Fails silently if audio isn't available. */
export function drumRoll(seconds: number) {
  try {
    ctx ??= new (window.AudioContext || (window as any).webkitAudioContext)();
    const ac = ctx!;
    void ac.resume();
    const buf = noiseBuffer(ac);
    const t0 = ac.currentTime + 0.05;
    let t = t0;
    while (t < t0 + seconds) {
      const p = (t - t0) / seconds; // 0 → 1
      hit(ac, buf, t, 0.15 + p * 0.35, 0.08);
      t += 0.11 - p * 0.075;
    }
    hit(ac, buf, t0 + seconds, 0.9, 1.4, 6000); // crash
    hit(ac, buf, t0 + seconds, 0.7, 0.25, 200); // kick
  } catch {
    /* no audio, that's fine */
  }
  if ('vibrate' in navigator) {
    const pattern: number[] = [];
    for (let i = 0; i < seconds * 8; i++) pattern.push(30, Math.max(20, 110 - i * 3));
    pattern.push(400);
    try { navigator.vibrate(pattern); } catch { /* ignore */ }
  }
}
