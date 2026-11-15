/**
 * Rückmeldung je Einheit/Abschnitt — reine Ableitungen über `GET …/meldungen/rueckmeldungen`.
 *
 * Als Rückmeldung zählt JEDE an die Einheit gebundene Meldung, gleich welcher Art. Die
 * Fälligkeit setzt der Server; der Vergleich mit „jetzt" liegt hier, damit die Anzeige mit der
 * Seitenuhr umschlägt.
 *
 * - `aktuell`: Uhrzeit, neutral.
 * - `ueberfaellig`: Uhrzeit, `alarm` — die letzte Rückmeldung ist älter als die Frist. Seit
 *   LLH-1741 Alarm statt Achtung: eine Einheit, von der man nichts mehr hört, ist ein Signal
 *   (ein Zustand, eine Rolle; Meldebild und Überblick lesen dieselbe Karte).
 * - `keine`: „—", `alarm` — noch nie eine Rückmeldung. NUR diese zählt die Kachel
 *   „keine Rückmeldung".
 */
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { LetzteRueckmeldung, MeldungMeldeweg, Rueckmeldungen } from '../api/types';
import type { Statusrolle } from '../theme/statusFarben';

dayjs.extend(utc);

export type RueckmeldungZustand = 'aktuell' | 'ueberfaellig' | 'keine';

/** Zustand → Rolle. Exhaustiv, damit ein vierter Zustand den Build bricht. */
export const RUECKMELDUNG_ROLLE: Record<RueckmeldungZustand, Statusrolle> = {
  aktuell: 'neutral',
  ueberfaellig: 'alarm',
  keine: 'alarm',
};

/** Zweiter Kanal zur Farbe (WCAG 1.4.1) — im zugänglichen Namen bzw. Tooltip. */
export const RUECKMELDUNG_WORT: Record<RueckmeldungZustand, string> = {
  aktuell: 'Rückmeldung in der Frist',
  ueberfaellig: 'Rückmeldung überfällig',
  keine: 'keine Rückmeldung',
};

export const MELDEWEG_WORT: Record<MeldungMeldeweg, string> = {
  funk: 'Funk',
  telefon: 'Telefon',
  persoenlich: 'Persönlich',
  sonstige: 'Sonstige',
};

/** Zustand einer (möglicherweise fehlenden) letzten Rückmeldung zum Zeitpunkt `jetzt`. */
export function rueckmeldungZustand(
  r: LetzteRueckmeldung | null | undefined,
  jetzt: Dayjs,
): RueckmeldungZustand {
  if (!r) return 'keine';
  const faellig = dayjs.utc(r.faellig_at);
  if (!faellig.isValid()) return 'ueberfaellig';
  return faellig.valueOf() <= jetzt.valueOf() ? 'ueberfaellig' : 'aktuell';
}

/**
 * Ganze Minuten seit der Fälligkeit einer Rückmeldung (LLH-1741: „Rückm. überfällig seit 47 min“),
 * nie negativ; `null` ohne Rückmeldung oder ohne lesbare Fälligkeit. Zeitbasis ist die Seitenuhr.
 */
export function rueckmeldungUeberfaelligSeit(
  r: LetzteRueckmeldung | null | undefined,
  jetzt: Dayjs,
): number | null {
  if (!r) return null;
  const faellig = dayjs.utc(r.faellig_at);
  if (!faellig.isValid()) return null;
  return Math.max(0, Math.floor((jetzt.valueOf() - faellig.valueOf()) / 60_000));
}

/** Letzte Rückmeldung je Einheit-id. Leere Map, solange keine Daten da sind. */
export function rueckmeldungJeEinheit(
  daten: Rueckmeldungen | null | undefined,
): Map<number, LetzteRueckmeldung> {
  return new Map((daten?.einheiten ?? []).map((r) => [r.bezug_id, r]));
}

function juenger(a: LetzteRueckmeldung, b: LetzteRueckmeldung): LetzteRueckmeldung {
  const ta = dayjs.utc(a.ereigniszeit).valueOf();
  const tb = dayjs.utc(b.ereigniszeit).valueOf();
  if (ta !== tb) return ta > tb ? a : b;
  return a.meldung_id >= b.meldung_id ? a : b;
}

/**
 * Jüngste Rückmeldung eines Teilbaums: direkt an einen der Abschnitte gebundene Meldungen UND
 * Meldungen der Einheiten darin (der Server liefert beide Listen getrennt).
 */
export function letzteImTeilbaum(
  daten: Rueckmeldungen | null | undefined,
  abschnittIds: ReadonlySet<number>,
  einheitIds: ReadonlySet<number>,
): LetzteRueckmeldung | null {
  let beste: LetzteRueckmeldung | null = null;
  for (const r of daten?.abschnitte ?? []) {
    if (abschnittIds.has(r.bezug_id)) beste = beste ? juenger(beste, r) : r;
  }
  for (const r of daten?.einheiten ?? []) {
    if (einheitIds.has(r.bezug_id)) beste = beste ? juenger(beste, r) : r;
  }
  return beste;
}

/** Zahl der Einheiten ohne jede Rückmeldung — die Kachel „keine Rückmeldung". */
export function ohneRueckmeldung(
  einheitIds: readonly number[],
  daten: Rueckmeldungen | null | undefined,
): number {
  const je = rueckmeldungJeEinheit(daten);
  return einheitIds.filter((id) => !je.has(id)).length;
}
