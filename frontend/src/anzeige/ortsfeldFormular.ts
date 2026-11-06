import type { FormRule } from 'antd';
import { grenzeText, istZuLang } from '../components/zeichenGrenze';
import type { OrtsfeldWert } from './Ortsfeld';

/** Ortsangabe als Wire-Felder: Text und Koordinate (nur mit Text oder als Kartenpunkt). */
export interface OrtFelder {
  text: string | null;
  lat: number | null;
  lon: number | null;
}

/**
 * Text und Koordinate eines Ortsfelds, wie sie hinausgehen (LLH-1121, design.md D2): getrimmter
 * Text oder `null`; die Koordinate neben einem Text — ein geleerter Text leert beide. Ein
 * Kartenpunkt (`quelle: 'karte'`) geht auch ohne Text hinaus (LLH-1534): das Feld lässt ihn nur
 * bei einem ohne Text gespeicherten Punkt stehen (etwa auf der Lagekarte verortet), sonst leert ein
 * geleerter Text ihn (`nachTextaenderung`) und ein Punkt ins leere Feld bringt seinen Text mit
 * (`nachKartenpunkt`). Was das Feld als Punkt zeigt, verschwindet so nie still.
 */
export function ortFelder(w: OrtsfeldWert | null | undefined): OrtFelder {
  const t = w?.text.trim();
  const text = t ? t : null;
  const k = text != null || w?.quelle === 'karte' ? w?.koordinate : null;
  return { text, lat: k?.lat ?? null, lon: k?.lon ?? null };
}

/**
 * Gespeicherte Ortsangabe als Wert des Ortsfelds beim Bearbeiten (LLH-1121, design.md D3): eine
 * gespeicherte Koordinate steht als `quelle: 'karte'` im Feld, auch ohne Text. Eine Textkorrektur
 * behält den Punkt; ein neuer Treffer ersetzt ihn, ein geleerter Text leert beide.
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

/**
 * Ortsangabe für den Rumpf eines POST (LLH-1114): wie [`ortFelder`], aber ohne Angabe fehlt das
 * Feld statt `null` zu sein — ein neuer Datensatz braucht keine „leeren“ Werte.
 */
export function ortEingabe(w: OrtsfeldWert | null | undefined): {
  text?: string;
  lat?: number;
  lon?: number;
} {
  const { text, lat, lon } = ortFelder(w);
  return {
    ...(text != null ? { text } : {}),
    ...(lat != null && lon != null ? { lat, lon } : {}),
  };
}
