import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { BrVerlaufEintrag } from '../../api/types';
import { dauerText } from '../../kraefte/zeitachse';

dayjs.extend(utc);

/**
 * Reiner Kern der Belegung eines Bereitstellungsraums (LLH-1095, design.md D10–D12, Spec
 * `bereitstellungsraum-belegung`): Wartezeit, „seit …“, die Folge nach Wartezeit und das Wort je
 * Verlaufseintrag. Die Stärke im Raum liegt seitenfrei in `bereitstellungsraum/brZahlen.ts`, weil
 * sie auch außerhalb der BR-Seiten gebraucht wird (Lagekarte, LLH-1107).
 */

/**
 * Ganze Minuten seit `seitAt` (UTC ohne Zone, wie `br_belegung.zeitpunkt_at`), nie negativ.
 *
 * `dayjs.utc`: ein lokales `dayjs(…)` läse die Zeit in der Zone des Geräts und verschöbe die
 * Wartezeit um den Zonenversatz (in Berlin zwei Stunden im Sommer). Eine vorgehende Serveruhr bzw.
 * nachgehende Geräteuhr zeigt 0 statt einer negativen Zahl.
 */
export function wartezeitMinuten(seitAt: string, jetzt: Dayjs): number {
  const seit = dayjs.utc(seitAt);
  if (!seit.isValid()) return 0;
  return Math.max(0, Math.floor((jetzt.valueOf() - seit.valueOf()) / 60_000));
}

/** „seit 1342 · 48 min“: die Uhrzeit kommt formatiert (taktisch, Anzeigezone) herein. */
export function seitText(uhrzeit: string, minuten: number): string {
  return `seit ${uhrzeit} · ${dauerText(minuten)}`;
}

/**
 * Schlüssel der festen Folge, mit `<` vergleichbar wie in `teileZuflussNach`: ohne Groß/Klein und
 * Akzente, Zahlen nach Wert („Florian 2“ vor „Florian 10“). Der Name selbst hängt dahinter, damit
 * „Ärzte“ und „Arzte“ nicht gleich zählen.
 */
export function ordnungsschluessel(name: string): string {
  const grob = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('de')
    .replace(/ß/g, 'ss')
    .replace(/\d+/g, (zahl) => zahl.padStart(12, '0'));
  return `${grob}\u0000${name}`;
}

/**
 * Folge der Belegung: am längsten wartend zuerst (D11). Das Format `YYYY-MM-DD HH:MM:SS` sortiert
 * als Text chronologisch; ohne „seit“ ans Ende (`￿` steht hinter jeder Ziffer), bei
 * Gleichstand nach Name. Eine neu eingetretene Kraft hat das jüngste „seit“ und kommt ans Ende.
 */
export function folgeSchluessel(seitAt: string | null | undefined, name: string): string {
  return `${seitAt ?? '￿'}\u0000${ordnungsschluessel(name)}`;
}

/** Art eines Verlaufseintrags als Wort, ein Wechsel mit dem anderen Raum (D12). */
export function verlaufText(e: Pick<BrVerlaufEintrag, 'art' | 'herkunft' | 'ziel'>): string {
  switch (e.art) {
    case 'eintritt':
      return 'Eintritt';
    case 'austritt':
      return 'Austritt';
    case 'wechsel_herein':
      return e.herkunft ? `Wechsel von ${e.herkunft}` : 'Wechsel herein';
    case 'wechsel_hinaus':
      return e.ziel ? `Wechsel nach ${e.ziel}` : 'Wechsel hinaus';
  }
}
