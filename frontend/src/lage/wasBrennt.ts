/**
 * Die Alarmzeile „Was brennt“ (LLH-1743, Spec `lage-alarmzeile`, Change
 * `t9jjrajy-alarmzeile-was-brennt`, design.md D1/D4): EIN Kern für Überblick, Lagebild und
 * Lagemonitor. Er zählt nichts selbst. Die Eingaben kommen verdichtet aus ihren Heimaten (Regel
 * „Eine Heimat je Zahl“, `frontend/AGENTS.md`): Meldungen, Aufträge, Erinnerungen und
 * Nachforderungen aus dem Modulzähler, Vermisste aus `verdichtePersonen`, Rückmeldung je Einheit
 * aus `meldungen/rueckmeldung.ts`, Ausfall aus den Gründen der Tönung des Meldebilds
 * (`lage/ausfallJeEinheit.ts`). Am Lagemonitor kommen dieselben Eingaben vom Server
 * (`lage/alarmAusMonitor.ts`); Folge und Wortlaut sind deshalb überall gleich.
 */
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

/** Die Arten der Zeile in ihrer festen Folge (Spec, „Folge nach Dringlichkeit“). */
export const ALARM_FOLGE = [
  'sofort',
  'bestaetigung',
  'vermisst',
  'kritisch',
  'rueckmeldung',
  'ausfall',
  'auftrag',
  'dringend',
  'erinnerung',
  'nachforderung',
] as const;

export type AlarmArt = (typeof ALARM_FOLGE)[number];

/** Rolle je Art: Alarm vor Achtung; „angespannt“ kommt nie hinein. */
export const ALARM_ROLLE: Record<AlarmArt, 'alarm' | 'achtung'> = {
  sofort: 'alarm',
  bestaetigung: 'alarm',
  vermisst: 'alarm',
  kritisch: 'alarm',
  rueckmeldung: 'alarm',
  ausfall: 'alarm',
  auftrag: 'alarm',
  dringend: 'achtung',
  erinnerung: 'achtung',
  nachforderung: 'achtung',
};

/**
 * Stand einer Quelle. `gesperrt` ist ein Modul, das der Betrachter nicht lesen darf oder das nicht
 * freigegeben ist: die Zeile lässt es weg, ohne den Stand unvollständig zu nennen.
 */
export type QuellStand<T> =
  { zustand: 'daten'; wert: T } | { zustand: 'laden' | 'fehler' | 'gesperrt' };

/** Eine benannte Einheit oder ein Abschnitt; `id` für Sprung und Schlüssel, am Monitor `null`. */
export interface Benannt {
  id: number | null;
  name: string;
}

export interface WasBrenntQuellen {
  meldungen: QuellStand<{
    sofort_offen: number;
    sofort_aelteste_at?: string | null;
    dringend_offen: number;
    bestaetigung_ueberfaellig: number;
  }>;
  auftraege: QuellStand<{ ueberfaellig: number }>;
  erinnerungen: QuellStand<{ faellig: number }>;
  nachforderungen: QuellStand<{ ueberfaellig: number }>;
  vermisst: QuellStand<number>;
  /** Abschnitte im Lagezustand „kritisch“, in der Folge der Gliederung. */
  kritisch: QuellStand<Benannt[]>;
  /** Einheiten mit überfälliger Rückmeldung (schon geurteilt), Minuten seit der Fälligkeit. */
  rueckmeldung: QuellStand<(Benannt & { seitMin: number })[]>;
  /** Einheiten mit Ausfall; `null`, wo es die Quelle nicht gibt (Lagemonitor, D6). */
  ausfall: QuellStand<Benannt[]> | null;
}

/** Bezeichnung einer Quelle für „Stand unvollständig“. */
const QUELL_WORT: Record<keyof WasBrenntQuellen, string> = {
  meldungen: 'Meldungen',
  auftraege: 'Aufträge',
  erinnerungen: 'Erinnerungen',
  nachforderungen: 'Nachforderungen',
  vermisst: 'Betroffene',
  kritisch: 'Einsatzabschnitte',
  rueckmeldung: 'Rückmeldungen',
  ausfall: 'Ausfall',
};

export interface AlarmEintrag {
  art: AlarmArt;
  rolle: 'alarm' | 'achtung';
  /** Was in der Zeile steht, die tragende Aussage vorn. */
  text: string;
  /** Der ganze Wortlaut ohne Kürzung (alle Namen), für Liste, `title` und Vorlesen. */
  voll: string;
  /** Kennungen der genannten Einheiten oder Abschnitte (für den Sprung), sonst leer. */
  bezug: number[];
}

/**
 * `vollstaendig`: alle erlaubten Quellen geladen. `laedt`: mindestens eine lädt noch, keine ist
 * gescheitert. `unvollstaendig`: mindestens eine ist gescheitert. Nur `vollstaendig` ohne Eintrag
 * darf „Nichts brennt“ sagen.
 */
export type AlarmStand = 'vollstaendig' | 'laedt' | 'unvollstaendig';

export interface WasBrennt {
  eintraege: AlarmEintrag[];
  stand: AlarmStand;
  /** Gescheiterte Quellen, für „Stand unvollständig“. */
  fehlend: string[];
}

/** Höchstens so viele Namen stehen in einem Eintrag, der Rest als „+n“. */
export const NAMEN_IM_EINTRAG = 2;

function mehrzahl(anzahl: number, einzahl: string, viele: string): string {
  return `${anzahl} ${anzahl === 1 ? einzahl : viele}`;
}

function namenKurz(namen: readonly string[]): string {
  const sichtbar = namen.slice(0, NAMEN_IM_EINTRAG).join(', ');
  const rest = namen.length - NAMEN_IM_EINTRAG;
  return rest > 0 ? `${sichtbar} +${rest}` : sichtbar;
}

function minutenSeit(wire: string | null | undefined, jetzt: Dayjs): number | null {
  if (!wire) return null;
  const t = dayjs.utc(wire);
  if (!t.isValid()) return null;
  return Math.max(0, Math.floor((jetzt.valueOf() - t.valueOf()) / 60_000));
}

export function wasBrennt(q: WasBrenntQuellen, jetzt: Dayjs): WasBrennt {
  const je = new Map<AlarmArt, { text: string; voll: string; bezug: number[] }>();
  const setze = (art: AlarmArt, text: string, voll = text, benannt: readonly Benannt[] = []) =>
    je.set(art, {
      text,
      voll,
      bezug: benannt.flatMap((b) => (b.id != null ? [b.id] : [])),
    });

  if (q.meldungen.zustand === 'daten') {
    const m = q.meldungen.wert;
    if (m.sofort_offen > 0) {
      const seit = minutenSeit(m.sofort_aelteste_at, jetzt);
      const zahl = mehrzahl(m.sofort_offen, 'Sofortmeldung', 'Sofortmeldungen');
      setze('sofort', seit != null ? `${zahl} · älteste ${seit} min` : zahl);
    }
    if (m.bestaetigung_ueberfaellig > 0) {
      setze(
        'bestaetigung',
        `${mehrzahl(m.bestaetigung_ueberfaellig, 'Bestätigung', 'Bestätigungen')} überfällig`,
      );
    }
    if (m.dringend_offen > 0) setze('dringend', `${m.dringend_offen} dringend`);
  }
  if (q.vermisst.zustand === 'daten' && q.vermisst.wert > 0) {
    setze('vermisst', `${q.vermisst.wert} vermisst`);
  }
  if (q.kritisch.zustand === 'daten' && q.kritisch.wert.length > 0) {
    const namen = q.kritisch.wert.map((a) => a.name);
    setze(
      'kritisch',
      `kritisch: ${namenKurz(namen)}`,
      `kritisch: ${namen.join(', ')}`,
      q.kritisch.wert,
    );
  }
  if (q.rueckmeldung.zustand === 'daten' && q.rueckmeldung.wert.length > 0) {
    const folge = [...q.rueckmeldung.wert].sort(
      (a, b) => b.seitMin - a.seitMin || a.name.localeCompare(b.name, 'de'),
    );
    const namen = folge.map((e) => e.name);
    const laengste = ` · längste ${folge[0].seitMin} min`;
    setze(
      'rueckmeldung',
      `Rückmeldung überfällig: ${namenKurz(namen)}${laengste}`,
      `Rückmeldung überfällig: ${namen.join(', ')}${laengste}`,
      folge,
    );
  }
  if (q.ausfall?.zustand === 'daten' && q.ausfall.wert.length > 0) {
    const namen = q.ausfall.wert.map((e) => e.name);
    setze(
      'ausfall',
      `Ausfall: ${namenKurz(namen)}`,
      `Ausfall: ${namen.join(', ')}`,
      q.ausfall.wert,
    );
  }
  if (q.auftraege.zustand === 'daten' && q.auftraege.wert.ueberfaellig > 0) {
    setze(
      'auftrag',
      `${mehrzahl(q.auftraege.wert.ueberfaellig, 'Auftrag', 'Aufträge')} überfällig`,
    );
  }
  if (q.erinnerungen.zustand === 'daten' && q.erinnerungen.wert.faellig > 0) {
    setze(
      'erinnerung',
      `${mehrzahl(q.erinnerungen.wert.faellig, 'Erinnerung', 'Erinnerungen')} fällig`,
    );
  }
  if (q.nachforderungen.zustand === 'daten' && q.nachforderungen.wert.ueberfaellig > 0) {
    setze(
      'nachforderung',
      `${mehrzahl(q.nachforderungen.wert.ueberfaellig, 'Nachforderung', 'Nachforderungen')} überfällig`,
    );
  }

  const eintraege: AlarmEintrag[] = ALARM_FOLGE.flatMap((art) => {
    const e = je.get(art);
    return e ? [{ art, rolle: ALARM_ROLLE[art], ...e }] : [];
  });

  let laedt = false;
  const fehlend: string[] = [];
  for (const schluessel of Object.keys(QUELL_WORT) as (keyof WasBrenntQuellen)[]) {
    const s = q[schluessel];
    if (s == null) continue;
    if (s.zustand === 'laden') laedt = true;
    if (s.zustand === 'fehler') fehlend.push(QUELL_WORT[schluessel]);
  }
  const stand: AlarmStand =
    fehlend.length > 0 ? 'unvollstaendig' : laedt ? 'laedt' : 'vollstaendig';
  return { eintraege, stand, fehlend };
}
