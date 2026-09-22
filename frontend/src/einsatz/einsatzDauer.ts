import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

/**
 * Einsatzdauer als `hh:mm h` unter 24 Stunden (Neuentwurf, Fuß des Modulpanels:
 * „Einsatzdauer 06:41 h"), ab 24 Stunden als `d d hh:mm h` („2 d 14:20 h").
 *
 * `beginn`/`ende` sind UTC-Wirestrings OHNE Zonenkennung (`2026-05-23 09:00:00`) — sie
 * werden ausdrücklich als UTC gelesen. `dayjs(s)` läse sie als Ortszeit und verschöbe die
 * Dauer still um den Zonenversatz (dieselbe Falle wie `etb/filterZeit.ts`).
 *
 * Eine Einsatzdauer ist ein Zeitraum, keine Uhrzeit: ein Tageswechsel darf sie nicht auf
 * „07:05" zurücksetzen. Ab 24 Stunden stehen die vollen Tage deshalb VOR der Uhrzeitform
 * („1 d 07:05 h") — „62:20 h" wäre zwar richtig, aber auf einen Blick nicht lesbar.
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
  const tage = Math.floor(minuten / (24 * 60));
  const rest = minuten % (24 * 60);
  const hh = String(Math.floor(rest / 60)).padStart(2, '0');
  const mm = String(rest % 60).padStart(2, '0');
  return tage > 0 ? `${tage} d ${hh}:${mm} h` : `${hh}:${mm} h`;
}
