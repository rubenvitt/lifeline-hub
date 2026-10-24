/**
 * Uhrzeit ohne Datum (LLH-1058, Spec `zeiteingabe`, „Uhrzeit ohne Datum“): eine Wanduhrzeit
 * `HH:MM` wie der Beginn einer Mahlzeit im Verpflegungsplan. Sie ist kein Zeitpunkt; erst das
 * Anwenden auf einen Kalendertag IN DER ANZEIGEZONE macht einen daraus ({@link uhrzeitAmTag}).
 * Der Server kennt keine Zone dafür (`src/uhrzeit.rs`), er prüft beim Tag aus der Vorlage nur die
 * Tagesgrenzen.
 *
 * - **Maske** ({@link parseUhrzeit}): „HHMM“ (Stab-Schreibweise), „HH:MM“ und die kurzen Formen
 *   „HMM“ und „H:MM“, getrimmt, 00:00 bis 23:59, nur ASCII-Ziffern. Heraus geht immer `HH:MM`;
 *   der Server nimmt nur „HH:MM“ und „HHMM“.
 * - **Feld**: taktisch „0630“ ({@link taktischeUhrzeitAus}), so wie man sie tippt. Die
 *   **Anzeige** folgt der Zeitdarstellung (`zeitDarstellung.ts:uhrzeitOhneDatum`, LLH-1437).
 * - **Sommerzeit**: eine Uhrzeit, die es an dem Tag zweimal gibt (Rückstellung, in Berlin
 *   25.10.2026 02:30), gilt beim ersten Mal; eine, die es nicht gibt (Vorstellung, 29.03.2026
 *   02:30), rückt um die Lücke nach vorn (03:30) — nie früher als gewünscht, wie `zuWanduhr`.
 *
 * Die Zonenrechnung steht hier, in `anzeige/`, weil nur hier die Browserzone gelesen wird (Guard
 * `zeitEingabe.guard.test.ts`).
 */
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { browserZone, effektiveZone } from './zeitEingabe';

dayjs.extend(utc);
dayjs.extend(timezone);

/** „0630“, „06:30“, „630“, „6:30“ — getrimmt, nur ASCII-Ziffern (`[0-9]`, kein `\d`-Unicode). */
const MASKE = /^([0-9]{1,2}):?([0-9]{2})$/;

/**
 * Liest eine eingegebene Uhrzeit; `null`, wenn sie keine ist. Eine dreistellige Eingabe ohne
 * Doppelpunkt ist „HMM“ („630“ → 06:30), eine zweistellige ist keine Uhrzeit.
 */
export function parseUhrzeit(eingabe: string): string | null {
  const t = eingabe.trim();
  const m = MASKE.exec(t);
  if (!m) return null;
  // „1230“ ohne Doppelpunkt ist HHMM; die Maske teilt sie gierig als 12|30, „630“ als 6|30.
  const stunde = Number(m[1]);
  const minute = Number(m[2]);
  if (stunde > 23 || minute > 59) return null;
  return `${String(stunde).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * „06:30“ → „0630“: der Text eines Eingabefelds (BOS-Konvention). Die Anzeige nimmt
 * `uhrzeitOhneDatum` aus `zeitDarstellung.ts`, die der gewählten Darstellung folgt (LLH-1437).
 */
export function taktischeUhrzeitAus(uhrzeit: string): string {
  return uhrzeit.replace(':', '');
}

/** Kalendertag `YYYY-MM-DD` danach; reine Kalenderrechnung ohne Zone. */
export function naechsterTag(tag: string): string {
  return dayjs.utc(tag).add(1, 'day').format('YYYY-MM-DD');
}

const TAG_MS = 86_400_000;

/** Versatz der Zone zu UTC an einem Zeitpunkt, in Millisekunden. */
function versatz(ms: number, zone: string): number {
  return dayjs(ms).tz(zone).utcOffset() * 60_000;
}

/**
 * Der Zeitpunkt, an dem die Uhr der Anzeigezone am Kalendertag `tag` die Uhrzeit `uhrzeit`
 * (`HH:MM`) zeigt. Ohne gültige Anzeigezone gilt die Browserzone.
 *
 * Gerechnet wird über die Versätze einen Tag vor und nach der Wanduhr: höchstens zwei Kandidaten,
 * davon passen null (Lücke der Vorstellung), einer oder zwei (doppelte Stunde der Rückstellung).
 */
export function uhrzeitAmTag(tag: string, uhrzeit: string, zone: string | null | undefined): Dayjs {
  const z = effektiveZone(zone) ?? browserZone();
  const [jahr, monat, tagImMonat] = tag.split('-').map(Number);
  const [stunde, minute] = uhrzeit.split(':').map(Number);
  // Die Wanduhr als wäre sie UTC; der wahre Zeitpunkt liegt um den Versatz davor.
  const wand = Date.UTC(jahr, monat - 1, tagImMonat, stunde, minute);
  const vorher = wand - versatz(wand - TAG_MS, z);
  const nachher = wand - versatz(wand + TAG_MS, z);
  const passend = [vorher, nachher].filter((k) => k + versatz(k, z) === wand).sort((a, b) => a - b);
  // Lücke: mit dem Versatz vor der Umstellung gelesen, landet die Uhrzeit um die Lücke später.
  return dayjs.utc(passend[0] ?? vorher);
}

/**
 * Grenzen eines Kalendertags der Anzeigezone: 00:00 des Tages bis 00:00 des Folgetags. Am Tag
 * einer Umstellung liegen sie 23 bzw. 25 Stunden auseinander.
 */
export function tagesgrenzen(
  tag: string,
  zone: string | null | undefined,
): { von: Dayjs; bis: Dayjs } {
  return {
    von: uhrzeitAmTag(tag, '00:00', zone),
    bis: uhrzeitAmTag(naechsterTag(tag), '00:00', zone),
  };
}
