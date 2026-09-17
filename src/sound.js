let ctx = null;

// A short, dry two-tone beep synthesized on the fly (Web Audio API) rather
// than shipping an audio asset — matches the PDF's "dezenter Ton" (subtle
// tone) requirement for the notification toast without adding a licensed
// sound file to the repo.
export function playNotificationSound() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.09);
      gain.gain.linearRampToValueAtTime(0.08, now + i * 0.09 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.09 + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.09);
      osc.stop(now + i * 0.09 + 0.13);
    });
  } catch (e) {
    // Audio unavailable (e.g. no user gesture yet) — fail silently.
  }
}
