import type { OrtSucheAntwort } from '../api/karteOrtSuche';
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
  /** Treffer aus dem Adressindex einer Offline-Karte (LLH-1119); die Liste nennt die Quelle. */
  ausOfflineKarte?: boolean;
}

/**
 * Zusatz an einem Adresstreffer aus dem Adressindex einer Offline-Karte (LLH-1119, Spec
 * `lagekarte-ortssuche`, „Adresssuche aus der Offline-Karte“): Lagekarte und Ortsfeld.
 */
export const OFFLINE_KARTE_ZUSATZ = 'aus Offline-Karte';

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

/**
 * Die eine Aussage einer Adresssuche, wenn sie keine Treffer zeigt (Lagekarte, Gruppe „Adresse“;
 * Ortsfeld, LFH-1175). Ein Fehler der Anfrage zählt wie „nicht erreichbar“.
 */
export function adressAussage(
  begriff: string,
  antwort: OrtSucheAntwort | undefined,
  fehler: boolean,
): string | null {
  if (fehler || antwort?.zustand === 'nicht_erreichbar') {
    return 'Adresssuche nicht erreichbar';
  }
  if (antwort?.zustand === 'ausgelastet') {
    return 'Adresssuche ausgelastet';
  }
  if (antwort?.zustand === 'ok' && antwort.treffer.length === 0) {
    return `Keine Adresse zu „${begriff}“ gefunden`;
  }
  return null;
}
