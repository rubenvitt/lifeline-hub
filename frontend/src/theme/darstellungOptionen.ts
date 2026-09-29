import { FiMaximize, FiMinimize, FiMonitor, FiMoon, FiSun } from 'react-icons/fi';
import { TbHandStop } from 'react-icons/tb';
import type { IconType } from 'react-icons';
import type { ThemeModus } from './ThemeModeProvider';
import type { Dichte } from './tokens';

/**
 * Die Stufen der zwei Darstellungsachsen (Modus, Dichte) mit Beschriftung und Symbol, an einem
 * Ort neben `ThemeModeProvider` und `tokens`, damit Benutzermenü und Kommandopalette dieselben
 * Stufen zeigen.
 */
export type Darstellungsstufe<W> = { wert: W; titel: string; Icon: IconType };

/**
 * Die Vollständigkeit hängt an dem Objekt, aus dem die Anzeige entsteht: der Index ist die
 * Quelle, die Liste seine Ableitung. Eine neue Variante in `Dichte`/`ThemeModus` bricht `tsc`
 * genau hier. TypeScript prüft ein Array-Literal nie gegen das Union einer Elementeigenschaft;
 * die Liste zurück in ein Array-Literal zu schreiben nähme die Zusicherung still heraus.
 * `Object.values` erhält die Einfügereihenfolge, das ist die Reihenfolge im Menü.
 */
const DARSTELLUNG_INDEX: Record<ThemeModus, Darstellungsstufe<ThemeModus>> = {
  system: { wert: 'system', titel: 'System', Icon: FiMonitor },
  light: { wert: 'light', titel: 'Hell', Icon: FiSun },
  dark: { wert: 'dark', titel: 'Dunkel', Icon: FiMoon },
};

const DICHTE_INDEX: Record<Dichte, Darstellungsstufe<Dichte>> = {
  kompakt: { wert: 'kompakt', titel: 'Kompakt', Icon: FiMinimize },
  komfortabel: { wert: 'komfortabel', titel: 'Komfortabel', Icon: FiMaximize },
  handschuh: { wert: 'handschuh', titel: 'Handschuh', Icon: TbHandStop },
};

export const DARSTELLUNG_OPTIONEN: Darstellungsstufe<ThemeModus>[] =
  Object.values(DARSTELLUNG_INDEX);

export const DICHTE_OPTIONEN: Darstellungsstufe<Dichte>[] = Object.values(DICHTE_INDEX);
