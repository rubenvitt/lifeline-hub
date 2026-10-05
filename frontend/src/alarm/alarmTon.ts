/**
 * Akustische Alarmtöne. EIN Per-User-Mute via localStorage für ALLE Alarmtöne; Stufen
 * 'alarm' (Sofortmeldung/Eskalation) und 'dezent' (fällige Erinnerung).
 *
 * Web-Audio statt Audiodatei: kein Asset, kein Netz. Scheitert das Abspielen an der
 * Autoplay-Policy, bleibt es still (die visuelle Spur trägt).
 */
type AlarmStufe = 'dezent' | 'alarm';
export type AlarmTonStatus = 'bereit' | 'blockiert';

/** Browser-internes Statussignal für die einsatzweite Alarm-Anzeige. */
export const ALARM_TON_STATUS_EVENT = 'lfh:alarm-ton-status';

const MUTE_KEY = 'lfh:alarm:mute';
// Alter Sofort-Mute-Key als einmaliger Fallback, damit eine bestehende Stummschaltung
// nicht verlorengeht.
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
 * Frist für eine Freischaltung ohne Antwort (LFH-950). Ohne Bediengeste bleibt `resume()` in
 * Chromium offen, und „wird geprüft" stünde sonst für immer. Nach der Frist gilt der Ton als
 * blockiert; dieselbe Frist begrenzt, wie alt ein aufgestauter Ton sein darf, damit er nach
 * der Freischaltung noch spielt. Ältere Alarme tragen die Toasts.
 */
export const ALARM_TON_FRIST_MS = 2000;

/** Das EINE offene `resume()` aller Anforderungen ohne Geste; `null`, wenn keins wartet. */
let resumeLaeuft: Promise<AlarmTonStatus> | null = null;
/** Nur EINE Anforderung wartet auf die Freischaltung, nie eine Schlange (Stufe: die lautere). */
let ausstehend: { stufe: AlarmStufe; seit: number } | null = null;

/**
 * Nach einem aufgelösten `resume()`: nur `state === 'running'` zählt als bereit, ein aufgelöstes
 * Promise belegt nicht, dass die Autoplay-Sperre gefallen ist. Spielt höchstens EINEN
 * aufgestauten Ton, nur wenn er jünger als die Frist ist und der Ton nicht inzwischen stumm ist.
 */
function nachFreigabe(context: AudioContext): AlarmTonStatus {
  if (context.state !== 'running') return meldeStatus('blockiert');
  meldeStatus('bereit');
  const wartend = ausstehend;
  ausstehend = null;
  if (wartend && !istAlarmGemutet() && Date.now() - wartend.seit <= ALARM_TON_FRIST_MS) {
    starteTon(context, wartend.stufe);
  }
  return 'bereit';
}

/** Gibt `p` zurück, meldet aber nach der Frist „blockiert", wenn `p` bis dahin offen ist. */
function mitFrist(context: AudioContext, p: Promise<AlarmTonStatus>): Promise<AlarmTonStatus> {
  return new Promise((fertig) => {
    const frist = setTimeout(() => {
      // Fiel die Sperre im selben Moment, gewinnt der Zustand, nicht die Uhr.
      fertig(context.state === 'running' ? nachFreigabe(context) : meldeStatus('blockiert'));
    }, ALARM_TON_FRIST_MS);
    void p.then((status) => {
      clearTimeout(frist);
      fertig(status);
    });
  });
}

/**
 * Freischaltung OHNE Geste: alle Anforderungen teilen ein `resume()`. Je Alarm ein eigenes hinge
 * je Alarm eine Kette an, die bei der ersten Geste alle zugleich spielten (L70).
 */
function freigabeOhneGeste(context: AudioContext): Promise<AlarmTonStatus> {
  resumeLaeuft ??= context
    .resume()
    .then(
      () => nachFreigabe(context),
      () => meldeStatus('blockiert'),
    )
    .finally(() => {
      resumeLaeuft = null;
    });
  return mitFrist(context, resumeLaeuft);
}

/**
 * Freischaltung AUS einer Geste: ein eigenes `resume()`, denn nur ein Aufruf mit
 * Nutzeraktivierung hebt die Sperre auf. Fällt sie, lösen auch die offenen `resume()` auf.
 */
function freigabeAusGeste(context: AudioContext): Promise<AlarmTonStatus> {
  return mitFrist(
    context,
    context.resume().then(
      () => nachFreigabe(context),
      () => meldeStatus('blockiert'),
    ),
  );
}

/** Versucht den AudioContext freizuschalten und meldet spätestens nach der Frist einen Zustand. */
async function stelleAudioBereit(ausGeste: boolean): Promise<AlarmTonStatus> {
  try {
    const context = audioContext();
    if (!context) return meldeStatus('blockiert');
    if (context.state === 'running') return nachFreigabe(context);
    return await (ausGeste ? freigabeAusGeste(context) : freigabeOhneGeste(context));
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
  const status = await stelleAudioBereit(false);
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
  return stelleAudioBereit(true);
}

function starteTon(context: AudioContext, stufe: AlarmStufe): void {
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = 'square';
  osc.connect(gain);
  gain.connect(context.destination);

  const t = context.currentTime;
  if (stufe === 'alarm') {
    // Zwei kurze, höhere Beeps.
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
      // Ein frischer Ton ersetzt einen aufgestauten, beide zugleich wären zwei Alarme.
      ausstehend = null;
      meldeStatus('bereit');
      starteTon(context, stufe);
      return;
    }

    // Gesperrt: nur diese Anforderung merken und das gemeinsame `resume()` abwarten. Wartet
    // noch ein junger Alarm, behält der eine Ton dessen Stufe: ein Hinweis danach dämpft ihn nicht.
    const lauter =
      ausstehend?.stufe === 'alarm' && Date.now() - ausstehend.seit <= ALARM_TON_FRIST_MS;
    ausstehend = { stufe: lauter ? 'alarm' : stufe, seit: Date.now() };
    void freigabeOhneGeste(context);
  } catch {
    meldeStatus('blockiert');
  }
}
