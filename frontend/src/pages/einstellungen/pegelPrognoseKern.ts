/**
 * Reiner Kern des Prognose-Dialogs (LFH-628) — Formularwerte ↔ Draht.
 *
 * Eigener Basename statt `PegelPrognose.ts` neben `PegelPrognoseModal.tsx`: die
 * Kollisionsregel aus CLAUDE.md (`direkteinstiegKern`) gilt für jedes Paar aus Komponente
 * und reinem Kern.
 */
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { PrognoseEingabe } from '../../api/pegel';
import type { PegelPrognose, PegelVorhersage } from '../../api/types';
import { DEFAULT_KONVENTIONEN, type AnzeigeKonventionen } from '../../anzeige/format';
import { standZeit, wasserstandMeter } from '../../pegel/pegelKennzahl';

dayjs.extend(utc);

export interface PrognoseFormWerte {
  /** Erwarteter Höchststand in METERN — so liest man ihn an der Pegellatte und so steht er
   *  in der Kennzahl. Der Draht führt cm. */
  hoechststand_m: number | null;
  zeitpunkt: Dayjs | null;
}

/** Meter → ganze Zentimeter (dieselbe Rundung wie das Backend). Rein. */
export function meterAlsCm(m: number): number {
  return Math.round(m * 100);
}

/** Formularwerte → Body. `null`, wenn ein Pflichtwert fehlt (die Regeln fangen das vorher). Rein. */
export function prognoseBody(w: PrognoseFormWerte): PrognoseEingabe | null {
  if (w.hoechststand_m == null || !Number.isFinite(w.hoechststand_m) || !w.zeitpunkt) return null;
  return { hoechststand_cm: meterAlsCm(w.hoechststand_m), zeitpunkt: w.zeitpunkt.toISOString() };
}

/** Vorbelegung zum Bearbeiten: die gespeicherte Prognose (Wire-Zeit UTC) als Formularwerte. Rein. */
export function prognoseVorbelegung(p: PegelPrognose | null | undefined): PrognoseFormWerte {
  if (!p) return { hoechststand_m: null, zeitpunkt: null };
  return {
    hoechststand_m: p.hoechststand_cm / 100,
    zeitpunkt: dayjs.utc(p.zeitpunkt).local(),
  };
}

/** Die Werte eines Vorhersage-Vorschlags (Zeit RFC 3339 mit Versatz) als Formularwerte. Rein. */
export function vorhersageAlsWerte(v: PegelVorhersage): PrognoseFormWerte {
  return { hoechststand_m: v.hoechststand_cm / 100, zeitpunkt: dayjs(v.zeitpunkt) };
}

/**
 * Body, der eine gelöschte Prognose wiederherstellt (Rückgängig). Die Wire-Zeit geht
 * unverändert zurück: das Backend nimmt das SQLite-Format ebenso an wie ISO-8601. Rein.
 */
export function wiederherstellBody(p: PegelPrognose): PrognoseEingabe {
  return { hoechststand_cm: p.hoechststand_cm, zeitpunkt: p.zeitpunkt };
}

/**
 * „PEGELONLINE-Vorhersage, gerechnet 07:00: höchster Wert 7,10 m um 18:00" — bei einem Wert
 * aus dem Abschätzungs-Teil der Reihe mit Zusatz, die Quelle unterscheidet beides. Rein.
 */
export function vorhersageSatz(
  v: PegelVorhersage,
  jetzt: number,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string {
  const erstellt = v.erstellt ? `, gerechnet ${standZeit(v.erstellt, jetzt, konv)}` : '';
  const wert = `höchster Wert ${wasserstandMeter(v.hoechststand_cm)} m um ${standZeit(v.zeitpunkt, jetzt, konv)}`;
  const art = v.abschaetzung ? ' (Abschätzung, keine Vorhersage)' : '';
  return `PEGELONLINE-Vorhersage${erstellt}: ${wert}${art}`;
}
