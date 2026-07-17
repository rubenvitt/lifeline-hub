/**
 * Akustische Alarmtöne (LFH-97/118). EIN Per-User-Mute via localStorage für ALLE Alarmtöne;
 * abgestufte Dringlichkeit: 'alarm' (Sofortmeldung/Eskalation) vs. 'dezent' (fällige Erinnerung).
 *
 * Web-Audio statt Audiodatei: kein Asset, kein Netz. Der AudioContext startet wegen der
 * Autoplay-Policy ggf. erst nach der ersten User-Geste — schlägt das Abspielen fehl, bleibt es
 * still (die visuelle Spur trägt).
 */
export type AlarmStufe = 'dezent' | 'alarm';

const MUTE_KEY = 'lfh:alarm:mute';
// LFH-118: alter Sofort-Mute-Key als einmaliger Fallback, damit eine bestehende Stummschaltung
// beim Umstieg auf den globalen Mute nicht verlorengeht.
const ALT_MUTE_KEY = 'lfh:sofortmeldung:mute';

export function istAlarmGemutet(): boolean {
  try {
    const aktuell = localStorage.getItem(MUTE_KEY);
    if (aktuell !== null) return aktuell === '1';
    return localStorage.getItem(ALT_MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setzeAlarmMute(gemutet: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, gemutet ? '1' : '0');
  } catch {
    /* localStorage nicht verfügbar → nicht persistierbar, kein harter Fehler */
  }
}

let ctx: AudioContext | null = null;

/** Spielt den Alarmton der gegebenen Stufe, sofern nicht gemutet. Fehler werden geschluckt. */
export function spieleAlarmTon(stufe: AlarmStufe): void {
  if (istAlarmGemutet()) return;
  try {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.connect(gain);
    gain.connect(ctx.destination);

    const t = ctx.currentTime;
    if (stufe === 'alarm') {
      // Zwei kurze, höhere Beeps (unübersehbar) — wie der bisherige Sofort-Alarm.
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.07, t);
      gain.gain.setValueAtTime(0, t + 0.15);
      gain.gain.setValueAtTime(0.07, t + 0.3);
      gain.gain.setValueAtTime(0, t + 0.45);
      osc.start(t);
      osc.stop(t + 0.5);
    } else {
      // Dezent: ein kurzer, tieferer Einzelton.
      osc.frequency.value = 440;
      gain.gain.setValueAtTime(0.04, t);
      gain.gain.setValueAtTime(0, t + 0.18);
      osc.start(t);
      osc.stop(t + 0.2);
    }
  } catch {
    /* Audio nicht verfügbar oder Autoplay blockiert → still, visuelle Spur trägt */
  }
}
