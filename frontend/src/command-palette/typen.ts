// frontend/src/command-palette/typen.ts
import type { IconType } from 'react-icons';
import type { BenutzerAnzeige, EinsatzAnzeige, ModulOverrides, Koordinatenformat } from '../api/types';
import type { ThemeModus } from '../theme/ThemeModeProvider';
import type { Dichte } from '../theme/tokens';

/**
 * Die Aktionen, die eine Maske oder Seite an die Palette meldet (LFH-391 · B3).
 *
 * NICHT jede hat einen Tastenweg: `tastaturAktionFuerEreignis` bindet weiterhin nur
 * `speichern`/`verwerfen`/`filter-zuruecksetzen` — das sind die Mutations- und
 * Abbruchwege, die man mitten im Tippen braucht. `neue-zeile` und `spalten` sind
 * ausschliesslich über die Palette erreichbar; ein viertes globales Kürzel wäre eine
 * neue Kollisionsfläche mit Browser- und antd-Bindungen.
 *
 * Wer die Union erweitert, trägt in `befehle.ts` BEIDES nach: den Eintrag im
 * exhaustiven `TASTATUR_AKTIONEN` (das erzwingt der Typcheck, TS2741) und die Position
 * in `TASTATUR_AKTION_REIHENFOLGE` (das erzwingt der Guard in `befehle.test.ts` — ein
 * Record hat keine vertragliche Ordnung, die Palette-Gruppe aber schon).
 */
export type TastaturAktionId =
  | 'speichern' | 'verwerfen' | 'filter-zuruecksetzen' | 'neue-zeile' | 'spalten';

export type TastaturAktionen = Partial<Record<TastaturAktionId, () => void>>;

export type BefehlGruppe =
  | 'aktionen' | 'schnellaktionen' | 'zuletzt' | 'module'
  | 'einsaetze' | 'einstellungen' | 'navigation';

export interface Befehl {
  id: string;
  gruppe: BefehlGruppe;
  label: string;
  schlagworte?: string[];
  icon?: IconType;
  kuerzel?: string;
  ausfuehren: () => void;
}

export interface BefehlKontext {
  einsatzId: number | null;
  benutzer: BenutzerAnzeige | null;
  einsaetze: EinsatzAnzeige[];
  overrides?: ModulOverrides;
  darfSchreibenImEinsatz: boolean;
  /** Zuletzt besuchte Modulschlüssel des aktuellen Einsatzes (LFH-337 · H12),
   *  jüngstes zuerst. Kommt aus `einsatz/zuletztModule.ts`. */
  zuletztModulKeys?: string[];
  /**
   * Aufzeichnung einer BEWUSSTEN Modulwahl (LFH-337 · Fix-Welle, Befund B4). Als Callback
   * injiziert, damit `baueBefehle` rein bleibt: die Funktion kennt weder `localStorage`
   * noch die `einsatzId`-Bindung, sie ruft nur, was ihr `useBefehle` gibt.
   */
  merkeModulBesuch?: (modulKey: string) => void;
  navigate: (pfad: string) => void;
  setThemeModus: (m: ThemeModus) => void;
  setDichte: (d: Dichte) => void;
  setKoordinaten: (f: Koordinatenformat) => void;
  logout: () => void;
  tastaturAktionen?: TastaturAktionen;
  userAgent?: string;
}

/**
 * Reihenfolge der Startansicht (LFH-337 · M11): das Nützlichste zuerst.
 *
 * `schnellaktionen` und `zuletzt` stehen jetzt VOR `module` — vorher lagen die vier
 * Schnellaktionen hinter 24 Modulen und waren bei leerer Suche faktisch unerreichbar.
 * `aktionen` (die kontextabhängigen Tastatur-Aktionen aus `TASTATUR_AKTIONEN`) bleibt
 * unangetastet an der Spitze: sie erscheint nur dort, wo eine Maske sie registriert hat,
 * und ist dann die Antwort auf „was kann ich hier gerade tun".
 */
export const GRUPPEN_REIHENFOLGE: BefehlGruppe[] = [
  'aktionen', 'schnellaktionen', 'zuletzt', 'module', 'einsaetze', 'einstellungen', 'navigation',
];

export const GRUPPEN_LABEL: Record<BefehlGruppe, string> = {
  aktionen: 'Aktionen',
  schnellaktionen: 'Schnellaktionen',
  zuletzt: 'Zuletzt',
  module: 'Module',
  einsaetze: 'Einsatz wechseln',
  einstellungen: 'Einstellungen',
  navigation: 'Navigation',
};
