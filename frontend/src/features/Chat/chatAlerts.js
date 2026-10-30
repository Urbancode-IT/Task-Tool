// New-message alerts: a short chime, the per-browser sound setting, and the system
// notification shown while the tab is in the background.
//
// The chime is synthesised with the Web Audio API (two soft sine notes), so there is
// no audio file to ship or license. Browsers only allow audio after the user has
// interacted with the page, so the audio context is created on the first click or key.

const SOUND_KEY = 'chat.sound';
let audioCtx = null;
let lastChimeAt = 0;

function ensureContext() {
  if (audioCtx) return audioCtx;
  const Ctx = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
  if (!Ctx) return null;
  try {
    audioCtx = new Ctx();
  } catch {
    audioCtx = null;
  }
  return audioCtx;
}

// Unlock audio on the first interaction anywhere in the app.
if (typeof window !== 'undefined') {
  const unlock = () => {
    const ctx = ensureContext();
    if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

/** Play the new-message chime. Bursts of messages chime once, not once each. */
export function playChime() {
  const now = Date.now();
  if (now - lastChimeAt < 1500) return;
  lastChimeAt = now;
  const ctx = ensureContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const start = ctx.currentTime + 0.01;
  [
    { freq: 880, at: 0 },
    { freq: 1318.5, at: 0.12 },
  ].forEach(({ freq, at }) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start + at);
    gain.gain.exponentialRampToValueAtTime(0.18, start + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + at + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start + at);
    osc.stop(start + at + 0.4);
  });
}

/** Whether the chime is on for this browser (default on). */
export function readSoundOn() {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function writeSoundOn(on) {
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    // Storage can be blocked; the setting then lasts only for this visit.
  }
}

const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;

/** Ask once for permission to show system notifications (needs a user gesture). */
export function requestNotificationPermission() {
  if (!notificationsSupported() || Notification.permission !== 'default') return;
  try {
    Notification.requestPermission().catch(() => {});
  } catch {
    // Older browsers use a callback form; ignoring it only skips system popups.
  }
}

/**
 * System notification for when the tab is hidden, so a message is noticed from another
 * window. Clicking it brings the app forward and runs onClick.
 */
export function showSystemNotification({ title, body, icon, tag, onClick }) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, icon: icon || undefined, tag, silent: true });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
    setTimeout(() => n.close(), 8000);
  } catch {
    // Some browsers only allow notifications from a service worker; the in-app popup still shows.
  }
}
