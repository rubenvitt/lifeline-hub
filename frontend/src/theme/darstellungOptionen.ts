import {
  IkoneHandStopp,
  IkoneMond,
  IkoneMonitor,
  IkonePfeileAuswaerts,
  IkonePfeileEinwaerts,
  IkoneSonne,
  type Ikone,
} from '../ikonen';
import type { ThemeModus } from './ThemeModeProvider';
import type { Dichte } from './tokens';
import type { Helligkeit } from './helligkeit';

/**
 * Die Stufen der zwei Darstellungsachsen (Modus, Dichte) mit Beschriftung und Symbol, an einem
 * Ort neben `ThemeModeProvider` und `tokens`, damit Benutzermenü und Kommandopalette dieselben
 * Stufen zeigen.
 */
type Darstellungsstufe<W> = { wert: W; titel: string; Icon: Ikone };

/**
 * Die Vollständigkeit hängt an dem Objekt, aus dem die Anzeige entsteht: der Index ist die
 * Quelle, die Liste seine Ableitung. Eine neue Variante in `Dichte`/`ThemeModus` bricht `tsc`
 * genau hier. TypeScript prüft ein Array-Literal nie gegen das Union einer Elementeigenschaft;
 * die Liste zurück in ein Array-Literal zu schreiben nähme die Zusicherung still heraus.
 * `Object.values` erhält die Einfügereihenfolge, das ist die Reihenfolge im Menü.
 */
const DARSTELLUNG_INDEX: Record<ThemeModus, Darstellungsstufe<ThemeModus>> = {
  system: { wert: 'system', titel: 'System', Icon: IkoneMonitor },
  light: { wert: 'light', titel: 'Hell', Icon: IkoneSonne },
  dark: { wert: 'dark', titel: 'Dunkel', Icon: IkoneMond },
};

const DICHTE_INDEX: Record<Dichte, Darstellungsstufe<Dichte>> = {
  kompakt: { wert: 'kompakt', titel: 'Kompakt', Icon: IkonePfeileEinwaerts },
  komfortabel: { wert: 'komfortabel', titel: 'Komfortabel', Icon: IkonePfeileAuswaerts },
  handschuh: { wert: 'handschuh', titel: 'Handschuh', Icon: IkoneHandStopp },
};

export const DARSTELLUNG_OPTIONEN: Darstellungsstufe<ThemeModus>[] =
  Object.values(DARSTELLUNG_INDEX);

export const DICHTE_OPTIONEN: Darstellungsstufe<Dichte>[] = Object.values(DICHTE_INDEX);

/**
 * Die Helligkeitsstufen (LFH-397), nach derselben Regel: der Index ist die Quelle, die
 * Liste seine Ableitung. Die Einfügereihenfolge der Zahlenschlüssel ist hier NICHT die
 * hingeschriebene — Ganzzahl-Schlüssel ordnet JavaScript aufsteigend —, deshalb wird die
 * Liste absteigend sortiert: hell oben, dunkel unten, wie im Menü gelesen.
 */
const HELLIGKEIT_INDEX: Record<Helligkeit, Darstellungsstufe<Helligkeit>> = {
  100: { wert: 100, titel: '100 %', Icon: IkoneSonne },
  80: { wert: 80, titel: '80 %', Icon: IkoneSonne },
  60: { wert: 60, titel: '60 %', Icon: IkoneSonne },
  40: { wert: 40, titel: '40 %', Icon: IkoneSonne },
  20: { wert: 20, titel: '20 %', Icon: IkoneSonne },
};

export const HELLIGKEIT_OPTIONEN: Darstellungsstufe<Helligkeit>[] = Object.values(
  HELLIGKEIT_INDEX,
).sort((a, b) => b.wert - a.wert);
