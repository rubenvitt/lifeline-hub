/**
 * Akustische Alarmtöne (LFH-97/118). EIN Per-User-Mute via localStorage für ALLE Alarmtöne;
 * abgestufte Dringlichkeit: 'alarm' (Sofortmeldung/Eskalation) vs. 'dezent' (fällige Erinnerung).
 *
 * Web-Audio statt Audiodatei: kein Asset, kein Netz. Der AudioContext startet wegen der
 * Autoplay-Policy ggf. erst nach der ersten User-Geste — schlägt das Abspielen fehl, bleibt es
 * still (die visuelle Spur trägt).
 */
export type AlarmStufe = 'dezent' | 'alarm';
export type AlarmTonStatus = 'bereit' | 'blockiert';

/** Browser-internes Statussignal für die einsatzweite Alarm-Anzeige. */
export const ALARM_TON_STATUS_EVENT = 'lfh:alarm-ton-status';

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
let letzterStatus: AlarmTonStatus | null = null;

function meldeStatus(status: AlarmTonStatus): AlarmTonStatus {
  letzterStatus = status;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ALARM_TON_STATUS_EVENT, { detail: { status } }));
  }
  return status;
}

/** Zuletzt sicher festgestellter Zustand; `null`, solange noch kein Test gelaufen ist. */
export function alarmTonStatus(): AlarmTonStatus | null {
  return letzterStatus;
}

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC: typeof AudioContext | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (ctx?.state === 'closed') ctx = null;
  ctx ??= new AC();
  return ctx;
}

/**
 * Versucht den AudioContext freizuschalten und prüft danach ausdrücklich seinen Zustand.
 * `resume()` kann erfolgreich auflösen, obwohl die Autoplay-Sperre weiter gilt; nur
 * `state === 'running'` zählt deshalb als bereit.
 */
async function stelleAudioBereit(): Promise<AlarmTonStatus> {
  try {
    const context = audioContext();
    if (!context) return meldeStatus('blockiert');
    if (context.state !== 'running') await context.resume();
    return meldeStatus(context.state === 'running' ? 'bereit' : 'blockiert');
  } catch {
    return meldeStatus('blockiert');
  }
}

/** Startet den realen Web-Audio-Pfad mit Null-Gain. So testet der Einstieg nicht
 * nur `resume()`, sondern auch Audio-Graph und Scheduling, ohne hörbare Ausgabe. */
function starteStummenTestton(context: AudioContext): void {
  const osc = context.createOscillator();
  const gain = context.createGain();
  const jetzt = context.currentTime;
  gain.gain.setValueAtTime(0, jetzt);
  osc.connect(gain);
  gain.connect(context.destination);
  osc.start(jetzt);
  osc.stop(jetzt + 0.01);
}

/** Stummer Einstiegstest beim Betreten des Einsatz-Workspace. */
export async function pruefeAlarmTonBereitschaft(): Promise<AlarmTonStatus> {
  const status = await stelleAudioBereit();
  if (status !== 'bereit') return status;
  try {
    const context = audioContext();
    if (!context || context.state !== 'running') return meldeStatus('blockiert');
    starteStummenTestton(context);
    return status;
  } catch {
    return meldeStatus('blockiert');
  }
}

/** Erneuter Freischaltversuch aus einer echten User-Geste. */
export function entsperreAlarmTon(): Promise<AlarmTonStatus> {
  return stelleAudioBereit();
}

function starteTon(context: AudioContext, stufe: AlarmStufe): void {
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = 'square';
  osc.connect(gain);
  gain.connect(context.destination);

  const t = context.currentTime;
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
}

/** Spielt den Alarmton der gegebenen Stufe, sofern nicht gemutet. Fehler werden geschluckt. */
export function spieleAlarmTon(stufe: AlarmStufe): void {
  if (istAlarmGemutet()) return;
  try {
    const context = audioContext();
    if (!context) {
      meldeStatus('blockiert');
      return;
    }
    if (context.state === 'running') {
      meldeStatus('bereit');
      starteTon(context, stufe);
      return;
    }

    // Resume ist asynchron. Erst NACH dem Promise erneut auf `state` prüfen — ein
    // aufgelöstes Promise allein belegt nicht, dass die Autoplay-Sperre gefallen ist.
    void context.resume().then(() => {
      if (context.state !== 'running') {
        meldeStatus('blockiert');
        return;
      }
      meldeStatus('bereit');
      starteTon(context, stufe);
    }).catch(() => meldeStatus('blockiert'));
  } catch {
    meldeStatus('blockiert');
  }
}
