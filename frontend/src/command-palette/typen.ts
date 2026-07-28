// frontend/src/command-palette/typen.ts
import type { IconType } from 'react-icons';
import type { BenutzerAnzeige, EinsatzAnzeige, ModulOverrides, Koordinatenformat } from '../api/types';
import type { ThemeModus } from '../theme/ThemeModeProvider';
import type { Dichte } from '../theme/tokens';

export type BefehlGruppe = 'module' | 'schnellaktionen' | 'einsaetze' | 'einstellungen' | 'navigation';

export interface Befehl {
  id: string;
  gruppe: BefehlGruppe;
  label: string;
  schlagworte?: string[];
  icon?: IconType;
  ausfuehren: () => void;
}

export interface BefehlKontext {
  einsatzId: number | null;
  benutzer: BenutzerAnzeige | null;
  einsaetze: EinsatzAnzeige[];
  overrides?: ModulOverrides;
  darfSchreibenImEinsatz: boolean;
  navigate: (pfad: string) => void;
  setThemeModus: (m: ThemeModus) => void;
  setDichte: (d: Dichte) => void;
  setKoordinaten: (f: Koordinatenformat) => void;
  logout: () => void;
}

export const GRUPPEN_REIHENFOLGE: BefehlGruppe[] = [
  'module', 'schnellaktionen', 'einsaetze', 'einstellungen', 'navigation',
];

export const GRUPPEN_LABEL: Record<BefehlGruppe, string> = {
  module: 'Module',
  schnellaktionen: 'Schnellaktionen',
  einsaetze: 'Einsatz wechseln',
  einstellungen: 'Einstellungen',
  navigation: 'Navigation',
};
