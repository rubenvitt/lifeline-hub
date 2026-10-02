import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

/**
 * Einsatzdauer als `hh:mm h` unter 24 Stunden, ab 24 Stunden als `d d hh:mm h` („2 d 14:20 h");
 * ein Zeitraum, keine Uhrzeit, der beim Tageswechsel nicht zurückspringen darf.
 *
 * `beginn`/`ende` sind UTC-Wirestrings OHNE Zonenkennung und werden ausdrücklich als UTC
 * gelesen; `dayjs(s)` verschöbe die Dauer still um den Zonenversatz (wie `anzeige/zeitEingabe.ts`).
 *
 * Abgeschlossen zählt bis `ende`. Ein Beginn in der Zukunft ergibt `00:00 h`, ein unlesbarer
 * Beginn `null` — der Aufrufer lässt die Anzeige dann weg.
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
