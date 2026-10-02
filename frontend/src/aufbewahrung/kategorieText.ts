import type { Datenkategorie } from '../api/types';

/**
 * Texte der Datenkategorien mit eigener Aufbewahrungsfrist (LFH-749, Spec
 * `aufbewahrung-kategorien`) — eine Stelle für Org-Einstellungen, Frist-Paneel und Archivakte.
 * Exhaustiv über die generierte Union: eine neue Kategorie bricht den Typcheck.
 *
 * **Vorschläge sind Text, keine Werte:** die Oberfläche nennt sie mit Quelle, setzt sie aber nie
 * ein (Spec: keine Vorgabewerte). Belege und Belastbarkeit stehen in der Recherche am Task
 * LFH-749 und in `openspec/changes/…/lfh-749-fristen-je-datenkategorie/design.md`, D9.
 */
export interface KategorieText {
  /** Bezeichnung, wie sie auch im ETB steht. */
  bezeichnung: string;
  /** Welche Daten die Kategorie umfasst. */
  daten: string;
  /** Belegter Vorschlag: Dauer in Tagen und Quelle. */
  vorschlag: { tage: number; quelle: string };
}

export const KATEGORIE_TEXT: Record<Datenkategorie, KategorieText> = {
  behandlung: {
    bezeichnung: 'Behandlung',
    daten: 'Zustand der Personen sowie die Notizen zu Sichtung, Verlauf und UHS-Belegung',
    vorschlag: {
      tage: 3650,
      quelle:
        '§ 630f Abs. 3 BGB entsprechend; DRK-LV Saarland, Empfehlung zur patientenbezogenen Datenerfassung im Sanitätsdienst',
    },
  },
  personenauskunft: {
    bezeichnung: 'Personenauskunft',
    daten: 'Herkunftsadresse und Melderkontakt der Personen',
    vorschlag: { tage: 0, quelle: '§ 46 Abs. 5 BHKG NRW (Auskunftsstelle: höchstens ein Monat)' },
  },
  anhaenge: {
    bezeichnung: 'Anhänge',
    daten: 'Datei-Anhänge samt ihrer Ablage als Dokument (an Schäden, Chat und ETB)',
    vorschlag: { tage: 30, quelle: '§ 32b Abs. 3 NKatSG (Drohnenbilder: höchstens zwei Monate)' },
  },
};

/** Die Kategorien in fester Reihenfolge (wie der Server sie liefert). */
export const KATEGORIEN: readonly Datenkategorie[] = ['behandlung', 'personenauskunft', 'anhaenge'];

/** Was mit den Personendaten passiert, die beiden Zwecken dienen — für die Beschreibung. */
export const PERSONENSTAMM_TEXT =
  'Name, Geburtsdatum, Antreffort und Verbleib einer Person bleiben, bis alle ihre Zwecke abgelaufen sind: bei einer gesichteten oder behandelten Person Behandlung und Personenauskunft, sonst nur die Personenauskunft.';

/** Der Satz zur Vorgabe einer Kategorie an einem aktiven Einsatz bzw. ohne eigene Dauer. */
export function vorgabeSatz(dauerTage: number | null | undefined): string {
  if (dauerTage == null) return 'folgt der Frist des Einsatzes';
  if (dauerTage === 0) return 'Frist entsteht beim Abschluss (sofort fällig)';
  return `Frist entsteht beim Abschluss nach ${dauerTage} Tagen`;
}
