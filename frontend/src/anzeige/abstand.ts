import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

/**
 * Abstand eines Server-Zeitpunkts (UTC, auch ohne Zonenangabe) zu jetzt, in Einsatzsprache:
 * „gerade eben“, „vor 42 min“, „vor 3 h 5 min“ (LLH-1094, Patientenkopf). Rein; die Seite
 * taktet mit `useMinutenTakt` und reicht `jetzt` herein. Eine Zeit in der Zukunft (Uhrversatz)
 * heißt „gerade eben“, nie „vor -2 min“.
 */
export function formatVor(utcStr: string | null | undefined, jetzt: number): string {
  if (!utcStr) return '';
  const minuten = Math.floor((jetzt - dayjs.utc(utcStr).valueOf()) / 60_000);
  if (minuten < 1) return 'gerade eben';
  if (minuten < 60) return `vor ${minuten} min`;
  const stunden = Math.floor(minuten / 60);
  const rest = minuten % 60;
  return rest === 0 ? `vor ${stunden} h` : `vor ${stunden} h ${rest} min`;
}
