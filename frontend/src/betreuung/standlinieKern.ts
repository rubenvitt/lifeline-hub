import type { BelegungVerlaufEintrag, StandVerlaufEintrag } from '../api/types';
import { personenZahl } from './betreuungText';

/**
 * Kern der Stufenlinien „Stand evakuiert über die Zeit“ eines Bezirks (LLH-1076, design.md D7)
 * und „Belegung über die Zeit“ einer Betreuungsstelle (LLH-1347), rein.
 *
 * - Punkte nur aus Meldungen, die nicht zurückgenommen sind; zwischen zwei Meldungen gilt die
 *   ältere weiter (Stufe), es wird NIE interpoliert.
 * - Die Linie endet an der jüngsten Meldung: keine Fortschreibung bis „jetzt“ (der Stand danach ist
 *   unbekannt, nicht gleich).
 * - Ab zwei Meldungen mit verschiedenem Zeitpunkt; sonst gibt es keine Linie (Abwesenheit, die
 *   Liste darunter trägt die eine Meldung).
 * - Die y-Achse beginnt bei 0 und reicht über Werte und Bezugsgröße (Plangröße bzw. Kapazität):
 *   ein Anteil wird nicht durch eine abgeschnittene Achse übertrieben.
 */

export interface Stufe {
  /** Zeitpunkt der Meldung in ms seit Epoche (UTC). */
  t: number;
  /** Gemeldete Zahl (evakuiert bzw. belegt). */
  wert: number;
  geschaetzt: boolean;
}

/** Wire-Zeit „YYYY-MM-DD HH:mm:ss“ (UTC ohne Zone) → ms; unlesbar → NaN. */
function wireMs(s: string): number {
  return Date.parse(`${s.replace(' ', 'T')}Z`);
}

/** Gültige Meldungen in zeitlicher Folge (älteste zuerst). */
function stufen<E extends { zeitpunkt_at: string; zurueckgenommen_at?: string | null }>(
  eintraege: readonly E[],
  wert: (e: E) => number,
  geschaetzt: (e: E) => boolean,
): Stufe[] {
  return eintraege
    .filter((e) => !e.zurueckgenommen_at)
    .map((e) => ({ t: wireMs(e.zeitpunkt_at), wert: wert(e), geschaetzt: geschaetzt(e) }))
    .filter((p) => Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);
}

/** Standmeldungen eines Bezirks. */
export function standStufen(eintraege: readonly StandVerlaufEintrag[]): Stufe[] {
  return stufen(
    eintraege,
    (e) => e.evakuiert,
    (e) => e.erhebung === 'geschaetzt',
  );
}

/** Belegungsmeldungen einer Stelle; eine Belegung ist immer gezählt (keine Erhebungsart). */
export function belegungStufen(eintraege: readonly BelegungVerlaufEintrag[]): Stufe[] {
  return stufen(
    eintraege,
    (e) => e.belegt,
    () => false,
  );
}

export interface StufenGeometrie {
  /** SVG-Pfad der Stufen (`M … H … V …`). */
  d: string;
  /** Die Meldepunkte im Feld. */
  punkte: { x: number; y: number; stufe: Stufe }[];
  /** y der Bezugsgröße; `null` ohne Bezugsgröße (Stelle ohne Kapazität). */
  bezugY: number | null;
}

/** Luft über dem höchsten Wert, als Anteil davon. */
const LUFT = 0.1;

/**
 * Geometrie in einem Feld `breite × hoehe`; `null` mit weniger als zwei Zeitpunkten (keine
 * Zeitspanne, keine Linie). `bezug` ist die Plangröße bzw. Kapazität, `null` wenn unbekannt.
 */
export function stufenGeometrie(
  stufen: readonly Stufe[],
  bezug: number | null,
  breite: number,
  hoehe: number,
): StufenGeometrie | null {
  if (stufen.length < 2) return null;
  const t0 = stufen[0].t;
  const spanne = stufen[stufen.length - 1].t - t0;
  if (spanne <= 0) return null;
  const oben = Math.max(bezug ?? 0, ...stufen.map((s) => s.wert)) * (1 + LUFT) || 1;
  const x = (t: number) => runde(((t - t0) / spanne) * breite);
  const y = (n: number) => runde(hoehe - (n / oben) * hoehe);
  const punkte = stufen.map((s) => ({ x: x(s.t), y: y(s.wert), stufe: s }));
  const d = punkte.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `H ${p.x} V ${p.y}`)).join(' ');
  return { d, punkte, bezugY: bezug == null ? null : y(bezug) };
}

const runde = (v: number) => Math.round(v * 100) / 100;

const ca = (s: Stufe) => (s.geschaetzt ? 'etwa ' : '');

/**
 * Aussage der Bezirkslinie für Vorleser: Anfang, Ende, Zahl der Meldungen und die Plangröße. Die
 * Uhrzeiten kommen formatiert vom Aufrufer (Anzeigezone).
 */
export function stufenAussage(
  stufen: readonly Stufe[],
  plan: number,
  von: string,
  bis: string,
): string {
  const erste = stufen[0];
  const letzte = stufen[stufen.length - 1];
  return (
    `Stand evakuiert von ${ca(erste)}${personenZahl(erste.wert)} (${von}) auf ` +
    `${ca(letzte)}${personenZahl(letzte.wert)} (${bis}), ${stufen.length} Meldungen, ` +
    `Plangröße ${personenZahl(plan)}`
  );
}

/**
 * Aussage der Belegungslinie einer Stelle (LLH-1347): Anfang, Ende, Zahl der Meldungen und, wenn
 * bekannt, die Kapazität.
 */
export function belegungAussage(
  stufen: readonly Stufe[],
  kapazitaet: number | null,
  von: string,
  bis: string,
): string {
  const erste = stufen[0];
  const letzte = stufen[stufen.length - 1];
  return (
    `Belegung von ${personenZahl(erste.wert)} (${von}) auf ${personenZahl(letzte.wert)} ` +
    `(${bis}), ${stufen.length} Meldungen` +
    (kapazitaet == null ? '' : `, Kapazität ${personenZahl(kapazitaet)}`)
  );
}
