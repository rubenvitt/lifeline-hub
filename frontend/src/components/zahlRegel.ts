import type { FormRule } from 'antd';
import type { NamePath } from 'antd/es/form/interface';

/**
 * Grenzen eines Zahlenfelds als Prüfregel (LLH-1768): Zahlenfelder kappen und runden nie
 * (`frontend/AGENTS.md`, „Zahlenfelder prüfen statt kappen“). antds `min`, `max` und `precision`
 * an `InputNumber` setzten einen getippten Wert beim Verlassen still um (Alter 250 → 120, 2,5 → 3)
 * und gespeichert wurde der umgesetzte Wert. Wächter: `components/zahlfeld.guard.test.ts`.
 */
export interface ZahlGrenzen {
  min?: number;
  max?: number;
  /** Nur ganze Zahlen. */
  ganz?: boolean;
  /** Höchstens so viele Nachkommastellen. */
  stellen?: number;
  /** Einheit hinter der Grenze in der Meldung, z. B. „Jahre“. */
  einheit?: string;
}

/** Nachkommastellen einer Zahl aus ihrer Textform, nicht über Fließkomma-Arithmetik. */
function nachkommastellen(wert: number): number {
  const text = String(wert).toLowerCase();
  const [mantisse, exponent] = text.split('e');
  const bruch = mantisse.split('.')[1]?.length ?? 0;
  return Math.max(0, bruch - (exponent ? Number(exponent) : 0));
}

/** Der Grund, warum der Wert nicht gilt, oder `null`. Leer gilt immer (Pflicht ist `required`). */
export function pruefeZahl(wert: number | null | undefined, o: ZahlGrenzen): string | null {
  if (wert == null || Number.isNaN(wert)) return null;
  const einheit = o.einheit ? ` ${o.einheit}` : '';
  if (o.ganz && !Number.isInteger(wert)) return 'Nur ganze Zahlen';
  if (o.stellen !== undefined && nachkommastellen(wert) > o.stellen) {
    return `Höchstens ${o.stellen} Nachkommastellen`;
  }
  if (o.min !== undefined && wert < o.min) return `Mindestens ${o.min}${einheit}`;
  if (o.max !== undefined && wert > o.max) return `Höchstens ${o.max}${einheit}`;
  return null;
}

/** `rule.field` ist der Punkt-Pfad des Felds; Ziffernsegmente sind Listenplätze. */
function namePfad(feld: string): NamePath {
  return feld.split('.').map((teil) => (/^\d+$/.test(teil) ? Number(teil) : teil));
}

/**
 * Die Prüfregel zu {@link pruefeZahl}. Sie prüft nur ein berührtes Feld: ein gespeicherter Altwert
 * außerhalb der Grenzen sperrt das Speichern nicht, solange niemand ihn anfasst (Entscheidung vom
 * 20.11.2026).
 */
export function zahlRegel(o: ZahlGrenzen): FormRule {
  return ({ isFieldTouched }) => ({
    validator(regel, wert: number | null | undefined) {
      const feld = (regel as { field?: string }).field;
      if (feld !== undefined && !isFieldTouched(namePfad(feld))) return Promise.resolve();
      const grund = pruefeZahl(wert, o);
      return grund ? Promise.reject(new Error(grund)) : Promise.resolve();
    },
  });
}
