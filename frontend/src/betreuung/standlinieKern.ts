import type { StandVerlaufEintrag } from '../api/types';
import { personenZahl } from './betreuungText';

/**
 * Kern der Stufenlinie „Stand evakuiert über die Zeit“ (LLH-1076, design.md D7), rein.
 *
 * - Punkte nur aus Meldungen, die nicht zurückgenommen sind; zwischen zwei Meldungen gilt die
 *   ältere weiter (Stufe), es wird NIE interpoliert.
 * - Die Linie endet an der jüngsten Meldung: keine Fortschreibung bis „jetzt“ (der Stand danach ist
 *   unbekannt, nicht gleich).
 * - Ab zwei Meldungen mit verschiedenem Zeitpunkt; sonst gibt es keine Linie (Abwesenheit, die
 *   Liste darunter trägt die eine Meldung).
 * - Die y-Achse beginnt bei 0 und reicht über Stand und Plangröße: ein Anteil wird nicht durch
 *   eine abgeschnittene Achse übertrieben.
 */

export interface StandStufe {
  /** Zeitpunkt der Meldung in ms seit Epoche (UTC). */
  t: number;
  evakuiert: number;
  geschaetzt: boolean;
}

/** Wire-Zeit „YYYY-MM-DD HH:mm:ss“ (UTC ohne Zone) → ms; unlesbar → NaN. */
function wireMs(s: string): number {
  return Date.parse(`${s.replace(' ', 'T')}Z`);
}

/** Gültige Meldungen in zeitlicher Folge (älteste zuerst). */
export function standStufen(eintraege: readonly StandVerlaufEintrag[]): StandStufe[] {
  return eintraege
    .filter((e) => !e.zurueckgenommen_at)
    .map((e) => ({
      t: wireMs(e.zeitpunkt_at),
      evakuiert: e.evakuiert,
      geschaetzt: e.erhebung === 'geschaetzt',
    }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
}

export interface StufenGeometrie {
  /** SVG-Pfad der Stufen (`M … H … V …`). */
  d: string;
  /** Die Meldepunkte im Feld. */
  punkte: { x: number; y: number; stufe: StandStufe }[];
  /** y der Plangröße. */
  planY: number;
}

/** Luft über dem höchsten Wert, als Anteil davon. */
const LUFT = 0.1;

/**
 * Geometrie in einem Feld `breite × hoehe`; `null` mit weniger als zwei Zeitpunkten (keine
 * Zeitspanne, keine Linie).
 */
export function stufenGeometrie(
  stufen: readonly StandStufe[],
  plan: number,
  breite: number,
  hoehe: number,
): StufenGeometrie | null {
  if (stufen.length < 2) return null;
  const t0 = stufen[0].t;
  const spanne = stufen[stufen.length - 1].t - t0;
  if (spanne <= 0) return null;
  const oben = Math.max(plan, ...stufen.map((s) => s.evakuiert)) * (1 + LUFT) || 1;
  const x = (t: number) => runde(((t - t0) / spanne) * breite);
  const y = (n: number) => runde(hoehe - (n / oben) * hoehe);
  const punkte = stufen.map((s) => ({ x: x(s.t), y: y(s.evakuiert), stufe: s }));
  const d = punkte.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `H ${p.x} V ${p.y}`)).join(' ');
  return { d, punkte, planY: y(plan) };
}

const runde = (v: number) => Math.round(v * 100) / 100;

/**
 * Aussage der Linie für Vorleser: Anfang, Ende, Zahl der Meldungen und die Plangröße. Die
 * Uhrzeiten kommen formatiert vom Aufrufer (Anzeigezone).
 */
export function stufenAussage(
  stufen: readonly StandStufe[],
  plan: number,
  von: string,
  bis: string,
): string {
  const erste = stufen[0];
  const letzte = stufen[stufen.length - 1];
  const ca = (s: StandStufe) => (s.geschaetzt ? 'etwa ' : '');
  return (
    `Stand evakuiert von ${ca(erste)}${personenZahl(erste.evakuiert)} (${von}) auf ` +
    `${ca(letzte)}${personenZahl(letzte.evakuiert)} (${bis}), ${stufen.length} Meldungen, ` +
    `Plangröße ${personenZahl(plan)}`
  );
}
