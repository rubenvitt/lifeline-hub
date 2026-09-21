import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

/**
 * Einsatzdauer als `hh:mm h` (Neuentwurf, Fuß des Modulpanels: „Einsatzdauer 06:41 h").
 *
 * `beginn`/`ende` sind UTC-Wirestrings OHNE Zonenkennung (`2026-05-23 09:00:00`) — sie
 * werden ausdrücklich als UTC gelesen. `dayjs(s)` läse sie als Ortszeit und verschöbe die
 * Dauer still um den Zonenversatz (dieselbe Falle wie `etb/filterZeit.ts`).
 *
 * Die Stunden laufen über 24 weiter (`31:05 h`): eine Einsatzdauer ist ein Zeitraum, keine
 * Uhrzeit, und ein Tageswechsel darf sie nicht auf „07:05" zurücksetzen.
 *
 * Ist der Einsatz abgeschlossen, zählt die Dauer bis `ende` und steht dann still. Ein
 * Beginn in der Zukunft (vorerfasster Einsatz) ergibt `00:00 h` statt einer negativen Zahl.
 * Ein unlesbarer Beginn ergibt `null` — der Aufrufer lässt die Anzeige dann weg, statt eine
 * Dauer zu erfinden.
 */
export function einsatzDauer(
  beginn: string | null | undefined,
  ende: string | null | undefined,
  jetztMs: number,
): string | null {
  if (!beginn) return null;
  const start = dayjs.utc(beginn);
  if (!start.isValid()) return null;
  const schluss = ende ? dayjs.utc(ende) : null;
  const bisMs = schluss && schluss.isValid() ? schluss.valueOf() : jetztMs;
  const minuten = Math.max(0, Math.floor((bisMs - start.valueOf()) / 60_000));
  const hh = String(Math.floor(minuten / 60)).padStart(2, '0');
  const mm = String(minuten % 60).padStart(2, '0');
  return `${hh}:${mm} h`;
}
