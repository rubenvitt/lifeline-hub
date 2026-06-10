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
