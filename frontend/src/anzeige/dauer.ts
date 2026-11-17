import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

/**
 * Formatkern für Dauern (LLH-1750, Spec `zeitdarstellung`, „Eine Form für Dauern“ und „Relative
 * Angaben in der Form der Dauer“). Jede Dauer für Menschen entsteht hier, wie jeder Zeitpunkt in
 * `zeitDarstellung.ts`; der Wächter `dauer.guard.test.ts` lehnt eine eigene Zusammensetzung
 * außerhalb von `anzeige/` ab.
 *
 * Form: „45 min“ · „8 h“ · „5 h 01 min“, nie mit Doppelpunkt (neben „Datum und Uhrzeit“ läse
 * sich „5:01“ als Uhrzeit) und unabhängig von der Zeitdarstellung. Mit `tage` ab 24 h „2 d 14 h“:
 * nur für die Einsatzdauer des Einsatzes und relative Angaben. Kräfte-Dauern und eingestellte
 * Längen (Rhythmus, Grenzwerte) laufen in Stunden weiter, weil sie neben Stunden-Grenzwerten
 * stehen (Entscheidung D2 in `openspec/changes/…/aovwhho1-zeitformate/design.md`).
 *
 * Ganze Minuten, abgerundet; negativ gilt als 0. Der Server bildet dieselbe Form ohne Tage in
 * `src/zeitdarstellung.rs` (`dauer_text`); beide lesen `dauer.faelle.json`.
 */

/** Wie eine Dauer geschrieben wird; `tage` nur für Einsatzdauer und relative Angaben. */
export interface DauerOptionen {
  tage?: boolean;
}

const MINUTE_MS = 60_000;
const TAG_MIN = 24 * 60;

function zwei(n: number): string {
  return String(n).padStart(2, '0');
}

/** „45 min“ · „8 h“ · „5 h 01 min“; mit `tage` ab 24 h „2 d 14 h“ bzw. „1 d“. */
export function dauer(minuten: number, opts: DauerOptionen = {}): string {
  const ganz = Math.max(0, Math.floor(minuten));
  if (opts.tage && ganz >= TAG_MIN) {
    const tage = Math.floor(ganz / TAG_MIN);
    const stunden = Math.floor((ganz % TAG_MIN) / 60);
    return stunden === 0 ? `${tage} d` : `${tage} d ${zwei(stunden)} h`;
  }
  if (ganz < 60) return `${ganz} min`;
  const stunden = Math.floor(ganz / 60);
  const rest = ganz % 60;
  return rest === 0 ? `${stunden} h` : `${stunden} h ${zwei(rest)} min`;
}

/** Vorwort einer relativen Angabe: vergangen, andauernd, kommend, verbleibend. */
export type Vorwort = 'vor' | 'seit' | 'in' | 'noch';

/**
 * „vor 2 min“ · „seit 5 h 01 min“ · „in 25 min“ · „noch 40 min“, ab 24 h mit Tagen. Unter einer
 * Minute „gerade eben“ bzw. „in < 1 min“ (und „seit“/„noch“ entsprechend).
 */
export function relativ(minuten: number, vorwort: Vorwort): string {
  const ganz = Math.max(0, Math.floor(minuten));
  if (ganz < 1) return vorwort === 'vor' ? 'gerade eben' : `${vorwort} < 1 min`;
  return `${vorwort} ${dauer(ganz, { tage: true })}`;
}

/** Server-Zeitpunkt (UTC-Wire-String, auch ohne Zone) oder Epoche → Millisekunden; sonst `null`. */
function alsMs(zeit: string | number): number | null {
  const ms = typeof zeit === 'number' ? zeit : dayjs.utc(zeit).valueOf();
  return Number.isFinite(ms) ? ms : null;
}

/** Volle Minuten von `vonMs` bis `bisMs`, nie negativ. */
export function minutenZwischen(vonMs: number, bisMs: number): number {
  return Math.max(0, Math.floor((bisMs - vonMs) / MINUTE_MS));
}

/**
 * Abstand eines vergangenen Zeitpunkts zu `jetzt`: „gerade eben“, „vor 42 min“, „vor 3 h 05 min“.
 * Eine Zeit in der Zukunft (Uhrversatz) heißt „gerade eben“, nie „vor -2 min“; leer bleibt leer.
 * Rein; die Seite taktet und reicht `jetzt` herein.
 */
export function vorText(zeit: string | number | null | undefined, jetzt: number): string {
  if (zeit == null || zeit === '') return '';
  const ms = alsMs(zeit);
  if (ms == null) return '';
  return relativ(minutenZwischen(ms, jetzt), 'vor');
}

/**
 * Einsatzdauer zwischen zwei Wire-Zeitpunkten (UTC ohne Zonenkennung, ausdrücklich als UTC
 * gelesen), mit Tagen. Ohne Ende bis `jetztMs`; ein Beginn in der Zukunft ergibt „0 min“, ein
 * fehlender oder unlesbarer Beginn `null` (der Aufrufer lässt die Anzeige weg).
 */
export function dauerZwischen(
  beginn: string | null | undefined,
  ende: string | null | undefined,
  jetztMs: number,
): string | null {
  if (!beginn) return null;
  const start = dayjs.utc(beginn);
  if (!start.isValid()) return null;
  const schluss = ende ? dayjs.utc(ende) : null;
  const bisMs = schluss && schluss.isValid() ? schluss.valueOf() : jetztMs;
  return dauer(minutenZwischen(start.valueOf(), bisMs), { tage: true });
}

/** Für den zugänglichen Namen: „1 Minute“, „40 Minuten“, „5 Stunden 12 Minuten“. */
export function dauerAusgeschrieben(minuten: number): string {
  const ganz = Math.max(0, Math.floor(minuten));
  const h = Math.floor(ganz / 60);
  const m = ganz % 60;
  const teile: string[] = [];
  if (h > 0) teile.push(h === 1 ? '1 Stunde' : `${h} Stunden`);
  if (m > 0 || h === 0) teile.push(m === 1 ? '1 Minute' : `${m} Minuten`);
  return teile.join(' ');
}
