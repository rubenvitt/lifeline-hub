import type { BefehlVorlageKey } from '../api/types';

interface AbschnittDef {
  schluessel: string;
  label: string;
  /** Frontend-only Eingabehilfe (SKK-Unterpunkte); nicht im Backend. */
  hilfetext?: string;
}
export interface VorlageDef {
  schluessel: BefehlVorlageKey;
  label: string;
  abschnitte: AbschnittDef[];
  /**
   * Nur noch für bestehende Befehle: lesen, bearbeiten, fortschreiben, filtern und drucken bleibt,
   * ein neuer Befehlsentwurf bietet die Vorlage nicht mehr an (LLH-1091, Spec `befehlsvorlagen`).
   * Rein Frontend; der Eintrag bleibt in dieser Liste, weil Detailseite und Druck ihn brauchen.
   */
  nurBestand?: true;
}

/**
 * Befehlsschemata — MUSS synchron zu src/befehl/mod.rs::VORLAGEN bleiben
 * (Schlüssel + Reihenfolge; Labels/Hilfetexte dürfen kosmetisch abweichen, `nurBestand` ist
 * reine Frontend-Angabe).
 */
export const VORLAGEN: VorlageDef[] = [
  {
    schluessel: 'befehl_lad',
    label: 'Befehl LAD (vereinfacht)',
    abschnitte: [
      { schluessel: 'lage', label: 'Lage' },
      { schluessel: 'auftrag', label: 'Auftrag' },
      { schluessel: 'durchfuehrung', label: 'Durchführung' },
    ],
  },
  {
    schluessel: 'befehl_ladef',
    label: 'Befehl LADEF (erweitert, SKK)',
    abschnitte: [
      {
        schluessel: 'lage',
        label: 'Lage',
        hilfetext: 'a. Allgemeine Lage · b. Schadenlage · c. Eigene Lage',
      },
      { schluessel: 'auftrag', label: 'Auftrag', hilfetext: 'Erhaltener Auftrag' },
      {
        schluessel: 'durchfuehrung',
        label: 'Durchführung',
        hilfetext:
          'a. Eigene Absicht · b. Einzelaufträge · c. Zusammenarbeit/Koordinierung · d. Zeitangaben · e. Schutzmaßnahmen',
      },
      {
        schluessel: 'einsatzunterstuetzung',
        label: 'Einsatzunterstützung',
        hilfetext: 'Verpflegung · Betriebsstoffe · Materialerhaltung · Medizinische Versorgung',
      },
      {
        schluessel: 'fuehrung_kommunikation',
        label: 'Führung und Kommunikation',
        hilfetext:
          'Kommunikationsverbindungen & Meldewesen · Meldeköpfe · Befehlsstellen · Standort der/des Führenden',
      },
    ],
  },
  {
    schluessel: 'befehl_schnee',
    label: 'Befehl SCHNEE',
    abschnitte: [
      { schluessel: 'schadenlage', label: 'Schadenlage' },
      { schluessel: 'nachbarn', label: 'Nachbarn' },
      { schluessel: 'entschluss', label: 'Entschluss / Absicht' },
      { schluessel: 'einzelauftrag', label: 'Einzelauftrag' },
      { schluessel: 'eigener_standort', label: 'Eigener Standort' },
    ],
  },
  {
    schluessel: 'befehl_ea_zmw',
    label: 'Einzelauftrag (EA/ZMW)',
    // Ein Einzelauftrag braucht Empfänger, Quittung und Vollzug: das trägt der Auftrag (LLH-1091).
    nurBestand: true,
    abschnitte: [
      { schluessel: 'einheit', label: 'Einheit' },
      { schluessel: 'auftrag_ziel', label: 'Auftrag / Ziel' },
      { schluessel: 'mittel', label: 'Mittel' },
      { schluessel: 'weg', label: 'Weg' },
    ],
  },
];

export function vorlage(schluessel: BefehlVorlageKey): VorlageDef | undefined {
  return VORLAGEN.find((v) => v.schluessel === schluessel);
}

/** Vorlagen, die ein neuer Befehlsentwurf anbietet (ohne `nurBestand`). */
export const NEW_SELECTABLE: VorlageDef[] = VORLAGEN.filter((v) => !v.nurBestand);
