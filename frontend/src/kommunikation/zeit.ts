/**
 * Zeitformatierung der Kommunikations-Module (LFH-112).
 *
 * Backend liefert UTC-Strings im Format `YYYY-MM-DD HH:mm:ss` (ohne Zeitzone).
 * Hier werden sie als UTC geparst und lokal formatiert.
 */
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

// Idempotent: dayjs.extend mehrfach aufzurufen ist unschädlich. So funktioniert
// das Modul auch ohne globales dayjs.extend(utc) (z. B. isoliert importiert).
dayjs.extend(utc);

/** UTC-Wirestring → lokal `DD.MM.YYYY HH:mm`; leer/null/undefined → ''. */
export function formatZeit(utcStr?: string | null): string {
  if (!utcStr) return '';
  return dayjs.utc(utcStr).local().format('DD.MM.YYYY HH:mm');
}

/** UTC-Wirestring → `HH:mm` wenn heute, sonst `DD.MM. HH:mm` (lokal); leer → ''. */
export function formatZeitKurz(utcStr?: string | null): string {
  if (!utcStr) return '';
  const lokal = dayjs.utc(utcStr).local();
  return lokal.isSame(dayjs(), 'day') ? lokal.format('HH:mm') : lokal.format('DD.MM. HH:mm');
}
