import type dayjs from 'dayjs';
import type { EtbTyp, MeldeWeg } from '../api/types';

export type MetaFeld = 'ereigniszeit' | 'von' | 'an' | 'meldeweg' | 'veranlassung';

export type EditorTyp = 'zeit' | 'text' | 'meldeweg';

export interface MetaFeldDef {
  feld: MetaFeld;
  label: string;
  /** Kleingeschriebene Filter-Stichwörter für das /-Menü. */
  trigger: string[];
  editor: EditorTyp;
}

/** Anzeige-/Tab-Reihenfolge der Felder im /-Menü und in der Chip-Leiste. */
export const METADATEN_FELDER: MetaFeldDef[] = [
  { feld: 'ereigniszeit', label: 'Ereigniszeit', trigger: ['zeit', 'ereigniszeit', 'uhrzeit'], editor: 'zeit' },
  { feld: 'von', label: 'Von', trigger: ['von', 'absender'], editor: 'text' },
  { feld: 'an', label: 'An', trigger: ['an', 'empfaenger', 'empfänger'], editor: 'text' },
  { feld: 'meldeweg', label: 'Meldeweg', trigger: ['meldeweg', 'weg', 'funk', 'telefon'], editor: 'meldeweg' },
  { feld: 'veranlassung', label: 'Veranlassung', trigger: ['veranlassung', 'massnahme', 'maßnahme'], editor: 'text' },
];

/** Vom Nutzer gesetzte Metadaten (vor dem Merge in NeuerEintrag). */
export interface MetadatenWerte {
  ereigniszeit?: dayjs.Dayjs;
  von?: string;
  an?: string;
  meldeweg?: MeldeWeg;
  veranlassung?: string;
}

export const MELDEWEG_OPTIONEN: { value: MeldeWeg; label: string }[] = [
  { value: 'funk', label: 'Funk' },
  { value: 'telefon', label: 'Telefon' },
  { value: 'persoenlich', label: 'Persönlich' },
  { value: 'sonstige', label: 'Sonstige' },
];

export interface SlashTrigger {
  aktiv: boolean;
  filter: string;
  start: number;
}

const INAKTIV: SlashTrigger = { aktiv: false, filter: '', start: -1 };

/**
 * Sucht links vom Cursor ein '/' am Wortanfang. Bricht bei Whitespace ab
 * (Whitespace zwischen '/' und Cursor schließt das Menü). '/' mitten im Wort
 * (z.B. "2/9", Datums-/Pfadangaben) triggert nicht.
 */
export function erkenneSlashTrigger(text: string, caret: number): SlashTrigger {
  for (let i = caret - 1; i >= 0; i--) {
    const c = text[i];
    if (c === '/') {
      const wortanfang = i === 0 || /\s/.test(text[i - 1]);
      return wortanfang ? { aktiv: true, filter: text.slice(i + 1, caret), start: i } : INAKTIV;
    }
    if (/\s/.test(c)) return INAKTIV;
  }
  return INAKTIV;
}
