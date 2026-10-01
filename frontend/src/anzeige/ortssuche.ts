import { erkenneKoordinate } from './koordinatenErkennung';

/**
 * Regeln der Ortssuche (LFH-638, Spec `lagekarte-ortssuche`), geteilt von Suchfeld der
 * Kartenleiste (`pages/lagekarte/MarkerSuche.tsx`) und Sprungpalette.
 */

/** Grenzen des Suchtexts, wie der Server sie prüft (`src/routes/karte_ort_suche.rs`). */
export const ADRESSE_MIN_ZEICHEN = 3;
export const ADRESSE_MAX_ZEICHEN = 200;

/** Ein Ort, den die Lagekarte anfliegt und mit der Suchnadel markiert. */
export interface GefundenerOrt {
  lat: number;
  lon: number;
  /** Adresse bzw. Koordinate im eingestellten Format. */
  beschriftung: string;
  /** Eine Koordinate steht in Mono mit `tabular-nums` (`frontend/AGENTS.md`, `schriftskala`). */
  art: 'koordinate' | 'adresse';
}

/**
 * Der getrimmte Suchtext, wenn er als Adresse gesucht werden darf, sonst `null`: zu kurz, zu
 * lang oder eine Koordinate (die wird ohne Server erkannt und verlässt den Browser nicht).
 * Gezählt werden Zeichen, nicht UTF-16-Einheiten.
 */
export function adressBegriff(eingabe: string): string | null {
  const text = eingabe.trim();
  const zeichen = [...text].length;
  if (zeichen < ADRESSE_MIN_ZEICHEN || zeichen > ADRESSE_MAX_ZEICHEN) return null;
  if (erkenneKoordinate(text) !== null) return null;
  return text;
}
