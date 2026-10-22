import type { FormRule } from 'antd';
import { grenzeText, istZuLang } from '../components/zeichenGrenze';
import type { OrtsfeldWert } from './Ortsfeld';

/** Ortsangabe als Wire-Felder: Text und Koordinate, die Koordinate nur mit Text. */
export interface OrtFelder {
  text: string | null;
  lat: number | null;
  lon: number | null;
}

/**
 * Text und Koordinate eines Ortsfelds, wie sie hinausgehen (LLH-1121, design.md D2): getrimmter
 * Text oder `null`; die Koordinate nur neben einem Text — ein geleerter Text leert beide.
 */
export function ortFelder(w: OrtsfeldWert | null | undefined): OrtFelder {
  const t = w?.text.trim();
  const text = t ? t : null;
  const k = text != null ? w?.koordinate : null;
  return { text, lat: k?.lat ?? null, lon: k?.lon ?? null };
}

/**
 * Gespeicherte Ortsangabe als Wert des Ortsfelds beim Bearbeiten (LLH-1121, design.md D3): eine
 * gespeicherte Koordinate steht als `quelle: 'karte'` im Feld. Eine Textkorrektur behält den
 * Punkt; ein neuer Treffer ersetzt ihn, ein geleerter Text leert beide.
 */
export function ortsfeldAusGespeichert(
  text: string | null | undefined,
  lat: number | null | undefined,
  lon: number | null | undefined,
): OrtsfeldWert {
  return lat != null && lon != null
    ? { text: text ?? '', koordinate: { lat, lon }, quelle: 'karte' }
    : { text: text ?? '', koordinate: null };
}

/**
 * Regeln am Text eines Ortsfelds (sein Wert ist ein Objekt; `zeichenRegel` und `required` prüfen
 * Strings): Länge wie beim Server, auf Wunsch Pflicht.
 */
export function ortRegeln(max: number, feld: string, pflicht?: { meldung: string }): FormRule[] {
  return [
    {
      validator: (_: unknown, wert: OrtsfeldWert | undefined) => {
        if (pflicht && !wert?.text.trim()) return Promise.reject(new Error(pflicht.meldung));
        if (istZuLang(wert?.text, max)) {
          return Promise.reject(
            new Error(`${feld} darf höchstens ${grenzeText(max)} Zeichen lang sein`),
          );
        }
        return Promise.resolve();
      },
    },
  ];
}
