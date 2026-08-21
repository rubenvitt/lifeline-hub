import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

/**
 * Zeitachse der ETB-Filterleiste, beide Richtungen an EINER Stelle (LFH-342 · C7).
 *
 * Die Hinrichtung stand bis hierher als lokale Funktion in `EtbFilterleiste.tsx`; die
 * Rückrichtung gab es nicht, und ihr Fehlen war der ausdrückliche Grund, die Leiste
 * unkontrolliert zu lassen (siehe deren Dateikopf, LFH-331 · B3). Sobald der Filter aus
 * der URL zurückgelesen wird, ist sie unvermeidlich.
 *
 * Warum als eigenes Modul mit eigenem Test statt als Einzeiler an der Aufrufstelle: der
 * Fehlermodus ist eine STILLE Verschiebung um den Zonenversatz — kein roter Test, kein
 * Fehlerbild, nur ein falscher Zeitraum in einer beweissichernden Unterlage.
 * `filterZeit.test.ts` prüft deshalb beidseits beider Sommerzeit-Grenzen und vergleicht
 * gegen den absoluten Zeitpunkt, nicht bloß gegen sich selbst.
 */

/** Wandelt einen dayjs-Zeitpunkt ins SQLite-/Backend-Format (UTC). */
export function alsBackendZeit(d: dayjs.Dayjs): string {
  return d.utc().format('YYYY-MM-DD HH:mm:ss');
}

/**
 * Umkehr von {@link alsBackendZeit}.
 *
 * Der Wire-String ist UTC **ohne** Zonenkennung. `dayjs(s)` läse ihn als Ortszeit und
 * verschöbe den Zeitpunkt um den Versatz (in Berlin im Sommer um zwei Stunden) —
 * deshalb `dayjs.utc(s)` und erst danach `.local()` für die Anzeige.
 *
 * Unbrauchbares wird GANZ verworfen statt halb übernommen: ein `Invalid Date` im
 * `DatePicker` ist von außen nicht von einem gesetzten Datum zu unterscheiden.
 */
export function alsOrtszeit(s: string | undefined): dayjs.Dayjs | undefined {
  if (!s) return undefined;
  const d = dayjs.utc(s);
  return d.isValid() ? d.local() : undefined;
}
