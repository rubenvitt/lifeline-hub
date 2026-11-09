import type { SchichtplanGrenzwerte, SchichtplanGrenzwerteBody } from '../api/types';
import { mitVorgabe } from '../components/vorgabeText';
import { dauerFeldText, dauerMinuten, formatDauer } from './dauer';

/**
 * Grenzwerte des Einsatzes, also Höchstdienst und Mindestruhe (LLH-1603, Change
 * `z11srqhq-grenzwerte-bedienstelle`, design.md D4–D6). Die Funktion ist rein und hat einen
 * Text für Paneel und Schichtplan sowie die Bodies des PATCH.
 *
 * „(Vorgabe)“ folgt nur den Merkern `*_eigen` des Servers und wird nie aus dem Wert geraten:
 * 12 h als eigener Wert bleibt ein eigener Wert. Ein Body trägt nur Felder, deren Bedeutung sich
 * ändert (fehlt = unverändert, `null` = Vorgabe, wie der Tri-State des Servers in
 * `src/routes/abloesung_schichtplan.rs`, `Grenzwerte`). Damit überschreibt ein Dialog nie einen
 * Wert, den jemand anderes inzwischen gesetzt hat.
 */

/** Höchstdienst ohne eigenen Wert (Server: `MAX_DIENST_VORGABE_MINUTEN`). */
export const MAX_DIENST_VORGABE_MINUTEN = 720;
/** Mindestruhe ohne eigenen Wert (Server: `MIN_RUHE_VORGABE_MINUTEN`). */
export const MIN_RUHE_VORGABE_MINUTEN = 480;

/** „12 h (Vorgabe)“ · „10 h“ · „0 min“. */
export function grenzwertText(minuten: number, eigen: boolean): string {
  const text = formatDauer(minuten);
  return eigen ? text : mitVorgabe(text);
}

/** Die Lesezeile des Schichtplans: „Höchstdienst 12 h (Vorgabe) · Mindestruhe 8 h (Vorgabe)“. */
export function grenzwerteZeile(g: SchichtplanGrenzwerte): string {
  return `Höchstdienst ${grenzwertText(g.max_dienst_minuten, g.max_dienst_eigen)} · Mindestruhe ${grenzwertText(
    g.min_ruhe_minuten,
    g.min_ruhe_eigen,
  )}`;
}

/** Felder des Dialogs als Text; leer heißt Vorgabe. */
export interface GrenzwerteFormWerte {
  max_dienst?: string;
  min_ruhe?: string;
}

/** Vorbelegung: der eigene Wert in Dauerform, bei der Vorgabe leer (der Platzhalter nennt sie). */
export function grenzwerteFormWerte(g: SchichtplanGrenzwerte): GrenzwerteFormWerte {
  return {
    max_dienst: g.max_dienst_eigen ? dauerFeldText(g.max_dienst_minuten) : undefined,
    min_ruhe: g.min_ruhe_eigen ? dauerFeldText(g.min_ruhe_minuten) : undefined,
  };
}

/** Body aus dem alten Stand und den geprüften Feldern; `null`, wenn sich nichts ändert. */
export function grenzwerteBody(
  alt: SchichtplanGrenzwerte,
  werte: GrenzwerteFormWerte,
): SchichtplanGrenzwerteBody | null {
  const body: SchichtplanGrenzwerteBody = {};
  const maxNeu = dauerMinuten(werte.max_dienst);
  const maxAlt = alt.max_dienst_eigen ? alt.max_dienst_minuten : null;
  if (maxNeu !== maxAlt) body.max_dienst_minuten = maxNeu;
  const ruheNeu = dauerMinuten(werte.min_ruhe);
  const ruheAlt = alt.min_ruhe_eigen ? alt.min_ruhe_minuten : null;
  if (ruheNeu !== ruheAlt) body.min_ruhe_minuten = ruheNeu;
  return Object.keys(body).length === 0 ? null : body;
}

/** „Vorgaben wiederherstellen“: `null` für jeden eigenen Wert; `null`, wenn keiner gilt. */
export function vorgabenBody(g: SchichtplanGrenzwerte): SchichtplanGrenzwerteBody | null {
  const body: SchichtplanGrenzwerteBody = {};
  if (g.max_dienst_eigen) body.max_dienst_minuten = null;
  if (g.min_ruhe_eigen) body.min_ruhe_minuten = null;
  return Object.keys(body).length === 0 ? null : body;
}

/** Rückgängig zu {@link vorgabenBody}: die alten eigenen Minuten. */
export function rueckgaengigBody(g: SchichtplanGrenzwerte): SchichtplanGrenzwerteBody {
  const body: SchichtplanGrenzwerteBody = {};
  if (g.max_dienst_eigen) body.max_dienst_minuten = g.max_dienst_minuten;
  if (g.min_ruhe_eigen) body.min_ruhe_minuten = g.min_ruhe_minuten;
  return body;
}
