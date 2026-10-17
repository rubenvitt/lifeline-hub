/**
 * Ablöser einer Schicht (LLH-1132, Spec `kraefte-abloesung`, „Vollzug mit Folgeschicht“).
 *
 * Eine Schicht trägt eine Liste von Ablösern (`abloeser`, höchstens `ABLOESUNG_ABLOESER_MAX`):
 * laufend die geplanten, abgelöst die beim Vollzug genannten. Der Vollzug legt je Ablöser, der
 * den Knoten bildet, eine Folgeschicht an; hat ein Ablöser schon eine eigene laufende Schicht ohne
 * Vorgänger (ungeplant eingetroffen), übernimmt er sie. Wählbar ist deshalb jede andere Einheit
 * ohne laufende Schicht und jede, deren laufende Schicht keinen Vorgänger hat; nur eine laufende
 * Folgeschicht scheidet aus (der Server lehnt sie mit 422 ab).
 *
 * Welche Einheit den Knoten bildet und wer erbt, entscheidet der Server (Knoten-Modell,
 * `frontend/src/kraefte/AGENTS.md`, „Ablösung“); der Client rechnet das nicht nach.
 */
import type { Abloesung } from '../api/types';

export interface AbloeserOption {
  value: number;
  label: string;
}

/** Was die Auswahl von einer Einheit braucht (Ausschnitt aus `EinheitAnzeige`). */
export interface AbloeserEinheit {
  id: number;
  name: string;
}

/** Wortlaut an einer Einheit, deren eigene laufende Schicht der Vollzug übernähme. */
export const SCHICHT_LAEUFT = 'Schicht läuft';

/** Die Ablöser einer Schicht in ihrer Reihenfolge; ohne Liste der Spiegel (Bestand). */
export function abloeserIds(s: Abloesung): number[] {
  if (s.abloeser.length > 0) return s.abloeser.map((a) => a.einheit_id);
  return s.abloesende_einheit_id != null ? [s.abloesende_einheit_id] : [];
}

/**
 * „Florian 2, Zug 2 (Schicht übernommen)“: die Ablöser einer Schicht, eine übernommene
 * Folgeschicht mit Vermerk. `null` ohne Ablöser.
 */
export function abloeserText(s: Abloesung): string | null {
  const uebernommen = new Set(
    s.folgeschichten.filter((f) => f.uebernommen).map((f) => f.einheit_id),
  );
  const namen =
    s.abloeser.length > 0
      ? s.abloeser.map((a) =>
          uebernommen.has(a.einheit_id) ? `${a.einheit_name} (Schicht übernommen)` : a.einheit_name,
        )
      : s.abloesende_einheit_name
        ? [s.abloesende_einheit_name]
        : [];
  return namen.length > 0 ? namen.join(', ') : null;
}

/**
 * Die wählbaren Ablöser für `schicht`: jede andere Einheit ohne laufende Folgeschicht. Läuft
 * schon eine eigene Schicht ohne Vorgänger, nennt die Option das („· Schicht läuft“).
 */
export function abloeserOptionen(
  einheiten: readonly AbloeserEinheit[],
  laufende: readonly Abloesung[],
  schicht: Abloesung,
): AbloeserOption[] {
  const laufendMitVorgaenger = new Map<number, boolean>();
  for (const s of laufende) {
    if (s.status === 'laufend') laufendMitVorgaenger.set(s.einheit_id, s.vorgaenger_id != null);
  }
  return einheiten
    .filter((e) => e.id !== schicht.einheit_id && laufendMitVorgaenger.get(e.id) !== true)
    .map((e) => ({
      value: e.id,
      label: laufendMitVorgaenger.has(e.id) ? `${e.name} · ${SCHICHT_LAEUFT}` : e.name,
    }));
}
