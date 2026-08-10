// frontend/src/command-palette/typen.ts
import type { IconType } from 'react-icons';
import type { BenutzerAnzeige, EinsatzAnzeige, ModulOverrides, Koordinatenformat } from '../api/types';
import type { ThemeModus } from '../theme/ThemeModeProvider';
import type { Dichte } from '../theme/tokens';

export type TastaturAktionId = 'speichern' | 'verwerfen' | 'filter-zuruecksetzen';

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
