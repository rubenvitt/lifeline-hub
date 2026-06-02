import type { LageberichtVorlageKey } from '../api/types';

export interface AbschnittDef {
  schluessel: string;
  label: string;
}
export interface VorlageDef {
  schluessel: LageberichtVorlageKey;
  label: string;
  abschnitte: AbschnittDef[];
}

/**
 * Berichtsvorlagen — MUSS synchron zu src/lagebericht/mod.rs::VORLAGEN bleiben
 * (Schlüssel + Reihenfolge; Labels dürfen rein kosmetisch abweichen).
 */
export const VORLAGEN: VorlageDef[] = [
  {
    schluessel: 'lagebericht',
    label: 'Lagevortrag zur Information',
    abschnitte: [
      { schluessel: 'auftrag', label: 'Auftrag' },
      { schluessel: 'gefahren_schadenlage', label: 'Gefahren-/Schadenlage' },
      { schluessel: 'eigene_lage', label: 'Eigene Lage' },
      { schluessel: 'lageentwicklung', label: 'Lageentwicklung' },
      { schluessel: 'fuehrungsprobleme', label: 'Besondere (Führungs-)Probleme' },
      { schluessel: 'antraege_vorschlaege', label: 'Anträge und Vorschläge' },
      { schluessel: 'zusammenfassung', label: 'Zusammenfassung' },
    ],
  },
  {
    schluessel: 'lagebeurteilung',
    label: 'Lagevortrag zur Entscheidung',
    abschnitte: [
      { schluessel: 'auftrag', label: 'Auftrag' },
      { schluessel: 'anlass', label: 'Anlass des Lagevortrags' },
      { schluessel: 'beurteilung_schadenlage', label: 'Beurteilung der Schadenlage' },
      { schluessel: 'beurteilung_eigene_lage', label: 'Beurteilung der eigenen Lage' },
      { schluessel: 'gemeinsame_elemente', label: 'Gemeinsame Elemente aller Möglichkeiten' },
      { schluessel: 'entschlussvorschlaege', label: 'Entschlussvorschläge' },
      { schluessel: 'abwaegen', label: 'Abwägen der Möglichkeiten' },
      { schluessel: 'vorschlag_beste', label: 'Vorschlag der besten Möglichkeit' },
    ],
  },
  {
    schluessel: 'freitext',
    label: 'Freier Bericht',
    abschnitte: [{ schluessel: 'text', label: 'Bericht' }],
  },
];

export function vorlage(schluessel: LageberichtVorlageKey): VorlageDef | undefined {
  return VORLAGEN.find((v) => v.schluessel === schluessel);
}

/** Leeres Abschnitts-Skelett (lokaler Editor-Startzustand). */
export function leereAbschnitte(v: VorlageDef): { schluessel: string; text: string }[] {
  return v.abschnitte.map((a) => ({ schluessel: a.schluessel, text: '' }));
}
