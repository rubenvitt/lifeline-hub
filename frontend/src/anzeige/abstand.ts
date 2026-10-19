import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

/**
 * Abstand eines Zeitpunkts zu jetzt, in Einsatzsprache: „gerade eben“, „vor 42 min“,
 * „vor 3 h 5 min“ (LLH-1094 Patientenkopf, LLH-1327 Datenstand des Lagemonitors). Nimmt einen
 * Server-Zeitpunkt (UTC, auch ohne Zonenangabe) oder eine Epoche in Millisekunden. Rein; die
 * Seite taktet (`useMinutenTakt`, der Lagemonitor alle 10 s) und reicht `jetzt` herein. Eine Zeit in der Zukunft
 * (Uhrversatz) heißt „gerade eben“, nie „vor -2 min“.
 *
 * Bewusst eigene Texte haben die Sitzungsliste (`auth/SitzungsListe.tsx:zuletztText`, 5-min-Takt
 * des Servers, „vor n h“ ohne Minuten) und das Lagebild (`pages/lage-dashboard/lagebild.ts`,
 * `standText` mit „Stand“, Sekunden und Uhrzeit).
 */
export function formatVor(zeit: string | number | null | undefined, jetzt: number): string {
  if (zeit == null || zeit === '') return '';
  const zeitMs = typeof zeit === 'number' ? zeit : dayjs.utc(zeit).valueOf();
  const minuten = Math.floor((jetzt - zeitMs) / 60_000);
  if (minuten < 1) return 'gerade eben';
  if (minuten < 60) return `vor ${minuten} min`;
  const stunden = Math.floor(minuten / 60);
  const rest = minuten % 60;
  return rest === 0 ? `vor ${stunden} h` : `vor ${stunden} h ${rest} min`;
}
