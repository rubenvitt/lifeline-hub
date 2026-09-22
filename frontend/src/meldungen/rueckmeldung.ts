/**
 * Rückmeldung je Einheit/Abschnitt (LFH-610) — reine Ableitungen über
 * `GET …/meldungen/rueckmeldungen`.
 *
 * Als Rückmeldung zählt JEDE an die Einheit gebundene Meldung, gleich welcher Meldungsart
 * (Entscheidung des Auftraggebers, 22.09.2026): eine Einheit, die gerade eine Sofortmeldung
 * abgesetzt hat, steht nicht auf „überfällig". Die Fälligkeit (`faellig_at`) setzt der
 * Server aus der effektiven Frist; der Vergleich mit „jetzt" liegt hier, damit die Anzeige
 * mit der Seitenuhr umschlägt, ohne dass ein Live-Ereignis kommen muss.
 *
 * Drei Zustände, drei Darstellungen (Neuentwurf S6):
 * - `aktuell`: Uhrzeit, neutral.
 * - `ueberfaellig`: Uhrzeit, `achtung` — die letzte Rückmeldung ist älter als die Frist.
 * - `keine`: „—", `alarm` — von dieser Einheit kam noch nie eine Rückmeldung. NUR diese
 *   zählt die Kachel „keine Rückmeldung"; eine überfällige Einheit hat zurückgemeldet.
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
  ueberfaellig: 'achtung',
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
 * Jüngste Rückmeldung eines Teilbaums: direkt an einen der Abschnitte gebundene Meldungen
 * UND Meldungen der Einheiten darin. Der Server liefert beide Listen getrennt (die
 * Einheit-zu-Abschnitt-Zuordnung kennt der Client ohnehin aus dem Kräftebild).
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
