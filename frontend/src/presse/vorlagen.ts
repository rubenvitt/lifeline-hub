import type { PressemitteilungVorlageKey } from '../api/types';
import type { AbschnittDef } from '../lageberichte/vorlagen';

interface VorlageDef {
  schluessel: PressemitteilungVorlageKey;
  label: string;
  abschnitte: AbschnittDef[];
}

const MASSNAHMEN: AbschnittDef = { schluessel: 'massnahmen', label: 'Maßnahmen' };
const HINWEISE: AbschnittDef = { schluessel: 'hinweise', label: 'Hinweise an die Bevölkerung' };
const NAECHSTE: AbschnittDef = { schluessel: 'naechste_information', label: 'Nächste Information' };
const RUECKFRAGEN: AbschnittDef = { schluessel: 'rueckfragen', label: 'Rückfragen' };

/**
 * Vorlagen der Pressemitteilung (LFH-554) — MUSS synchron zu `src/presse/mitteilung.rs::VORLAGEN`
 * bleiben (Schlüssel + Reihenfolge; Paar-Test `vorlagen.test.ts`). Suchhinweise sind bewusst
 * keine Vorlage: Personenfahndung ist Sache der Polizei.
 */
export const VORLAGEN: VorlageDef[] = [
  {
    schluessel: 'erstinformation',
    label: 'Erstinformation',
    abschnitte: [
      { schluessel: 'sachverhalt', label: 'Sachverhalt' },
      MASSNAHMEN,
      HINWEISE,
      NAECHSTE,
      RUECKFRAGEN,
    ],
  },
  {
    schluessel: 'folgeinformation',
    label: 'Folgeinformation',
    abschnitte: [
      { schluessel: 'neue_entwicklung', label: 'Neue Entwicklung' },
      MASSNAHMEN,
      HINWEISE,
      NAECHSTE,
      RUECKFRAGEN,
    ],
  },
  {
    schluessel: 'bevoelkerungshinweis',
    label: 'Hinweis an die Bevölkerung',
    abschnitte: [
      { schluessel: 'gefahr', label: 'Gefahr' },
      { schluessel: 'gebiet', label: 'Betroffenes Gebiet' },
      { schluessel: 'verhaltenshinweise', label: 'Verhaltenshinweise' },
      { schluessel: 'weitere_informationen', label: 'Weitere Informationen' },
    ],
  },
  {
    schluessel: 'freitext',
    label: 'Freie Mitteilung',
    abschnitte: [{ schluessel: 'text', label: 'Mitteilung' }],
  },
];

export function mitteilungVorlage(schluessel: PressemitteilungVorlageKey): VorlageDef | undefined {
  return VORLAGEN.find((v) => v.schluessel === schluessel);
}
