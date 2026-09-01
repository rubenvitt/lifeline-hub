import { FiMaximize, FiMinimize, FiMonitor, FiMoon, FiSun } from 'react-icons/fi';
import { TbHandStop } from 'react-icons/tb';
import type { IconType } from 'react-icons';
import type { ThemeModus } from './ThemeModeProvider';
import type { Dichte } from './tokens';

/**
 * Die Stufen der zwei Darstellungsachsen mit Beschriftung und Symbol (LFH-329 · B1,
 * hierher gezogen in LFH-392).
 *
 * WARUM EINE EIGENE DATEI: bis LFH-392 lagen diese Listen im `ThemeToggle`, also in
 * einer KOMPONENTE — und weil die Kopfzeile ihre Umschalter ablegte, brauchte das
 * Benutzermenü dieselben Stufen. Die Dichte-Achse kam über einen Export von dort,
 * die Darstellungs-Achse war eine HANDKOPIE mit dem Vermerk „Nacharbeit". Genau die
 * Lage, gegen die der Export gebaut war: eine umbenannte Stufe stand an zwei Orten
 * verschieden da. Seit LFH-392 ist der `ThemeToggle` fort (die Kopfzeile trägt keine
 * Umschalter mehr) — die Listen gehören damit dorthin, wo die Achsen selbst wohnen,
 * neben `ThemeModeProvider` und `tokens`.
 */
export type Darstellungsstufe<W> = { wert: W; titel: string; Icon: IconType };

/**
 * DIE VOLLSTÄNDIGKEIT HÄNGT AN DEM OBJEKT, AUS DEM DIE ANZEIGE ENTSTEHT — nicht an
 * einem Riegel daneben.
 *
 * Der erste Anlauf dieser Datei hatte ein zweites `Record<Dichte, true>` NEBEN der
 * Liste stehen und im Kommentar behauptet, eine vierte Stufe breche damit den
 * Typcheck. Das war falsch, und zwar auf die gefährlichste Art: der Typcheck wäre
 * am Riegel rot geworden, man hätte dort `sitzend: true` ergänzt, und alles wäre
 * wieder grün gewesen — während die Liste, die das Menü rendert, weiter drei
 * Einträge hätte. Die neue Stufe wäre unbedienbar, ohne dass ein Gate anschlägt.
 * TypeScript prüft ein Array-Literal NIE gegen das Union einer Elementeigenschaft;
 * ein Riegel, der sich getrennt beruhigen lässt, deckt nichts.
 *
 * Deshalb ist der Index die Quelle und die Liste seine Ableitung: eine vierte
 * Variante in `Dichte` bricht `tsc` an genau der Stelle, an der auch die Anzeige
 * hängt, und lässt sich nur durch einen echten Eintrag beheben. `Object.values`
 * erhält bei String-Schlüsseln die Einfügereihenfolge — die Reihenfolge im Menü ist
 * also die hier hingeschriebene.
 *
 * WER HIER ANFASST: die Liste bleibt eine ABLEITUNG. Sie zurück in ein
 * Array-Literal zu schreiben nimmt die Zusicherung wieder heraus, ohne dass etwas
 * rot wird.
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
