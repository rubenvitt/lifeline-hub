/**
 * Akustisches Sofort-Signal (LFH-97). Per-User-Mute via localStorage, damit ein einzelner
 * Arbeitsplatz den Ton abstellen kann, ohne die visuelle Hervorhebung zu verlieren.
 *
 * Web-Audio statt Audiodatei: kein Asset, kein Netz, ein kurzer Doppel-Beep reicht. Der
 * AudioContext startet wegen der Browser-Autoplay-Policy ggf. erst nach der ersten
 * User-Geste — schlägt das Abspielen fehl, bleibt es still (die visuelle Spur trägt).
 */
const MUTE_KEY = 'lfh:sofortmeldung:mute';

export function istSofortGemutet(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setzeSofortMute(gemutet: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, gemutet ? '1' : '0');
  } catch {
    /* localStorage nicht verfügbar → Mute nicht persistierbar, kein harter Fehler */
  }
}

let ctx: AudioContext | null = null;

/** Spielt den Sofort-Ton (zwei kurze Beeps), sofern nicht gemutet. Fehler werden geschluckt. */
export function spieleSofortAlarm(): void {
  if (istSofortGemutet()) return;
  try {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 880;
    osc.connect(gain);
    gain.connect(ctx.destination);

    const t = ctx.currentTime;
    // Zwei kurze Beeps (an/aus/an/aus), moderat laut.
    gain.gain.setValueAtTime(0.07, t);
    gain.gain.setValueAtTime(0, t + 0.15);
    gain.gain.setValueAtTime(0.07, t + 0.3);
    gain.gain.setValueAtTime(0, t + 0.45);
    osc.start(t);
    osc.stop(t + 0.5);
  } catch {
    /* Audio nicht verfügbar oder Autoplay blockiert → still, visuelle Spur trägt */
  }
}
