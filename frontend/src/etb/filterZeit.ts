import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

/**
 * Zeitachse der ETB-Filterleiste, beide Richtungen an EINER Stelle.
 *
 * Eigenes Modul mit eigenem Test statt eines Einzeilers an der Aufrufstelle: der Fehlermodus
 * ist eine STILLE Verschiebung um den Zonenversatz — kein roter Test, kein Fehlerbild, nur ein
 * falscher Zeitraum in einer beweissichernden Unterlage. `filterZeit.test.ts` prüft deshalb
 * beidseits beider Sommerzeit-Grenzen gegen den absoluten Zeitpunkt.
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
