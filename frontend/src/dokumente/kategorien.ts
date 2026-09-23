import type { DokumentKategorie } from '../api/types';

/** Label je Kategorie. Ein Record über das generierte Enum: eine neue Backend-Variante bricht
 *  den Typcheck, statt still ohne Label zu erscheinen. */
export const DOKUMENT_KATEGORIEN: Record<DokumentKategorie, { label: string }> = {
  lagekarte_plan: { label: 'Lagekarte/Plan' },
  befehl: { label: 'Befehl' },
  formular: { label: 'Formular' },
  foto: { label: 'Foto' },
  sonstiges: { label: 'Sonstiges' },
};

export const DOKUMENT_KATEGORIE_REIHENFOLGE: DokumentKategorie[] = [
  'lagekarte_plan',
  'befehl',
  'formular',
  'foto',
  'sonstiges',
];
