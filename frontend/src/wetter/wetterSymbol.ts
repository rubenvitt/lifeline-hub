/**
 * Ikone je Wetterlage der aktuellen Bedingungen (LFH-864, design.md D5). Ein Eintrag je Wert
 * von `WetterSymbol` — der Typ macht die Tabelle vollständig, ein neuer Wert ohne Ikone bricht
 * `tsc`. Die Ikone trägt nie allein Bedeutung: das Wort (`wetterSymbolWort`) steht daneben.
 *
 * Schnee ist die Wolke mit Schnee, nicht die Schneeflocke: alle Niederschlags-Ikonen haben die
 * Wolke als Basis; die Schneeflocke bleibt für Glätte- und Frostwarnungen der Fachebene.
 */
import type { WetterSymbol } from '../api/types';
import {
  IkoneGewitterwolke,
  IkoneHagel,
  IkoneMond,
  IkoneNebel,
  IkoneNebelNacht,
  IkoneRegen,
  IkoneSchneeregen,
  IkoneSchneewolke,
  IkoneSonne,
  IkoneTeilsBewoelktNacht,
  IkoneTeilsBewoelktTag,
  IkoneWind,
  IkoneWolke,
  type Ikone,
} from '../ikonen';

const IKONE: Record<WetterSymbol, Ikone> = {
  klar_tag: IkoneSonne,
  klar_nacht: IkoneMond,
  teils_bewoelkt_tag: IkoneTeilsBewoelktTag,
  teils_bewoelkt_nacht: IkoneTeilsBewoelktNacht,
  bewoelkt: IkoneWolke,
  nebel_tag: IkoneNebel,
  nebel_nacht: IkoneNebelNacht,
  wind: IkoneWind,
  regen: IkoneRegen,
  schneeregen: IkoneSchneeregen,
  schnee: IkoneSchneewolke,
  hagel: IkoneHagel,
  gewitter: IkoneGewitterwolke,
};

/** Ikone der Wetterlage; ohne (unbekannte) Wetterlage `null`. Rein. */
export function wetterSymbolIkone(s: WetterSymbol | null | undefined): Ikone | null {
  return s ? IKONE[s] : null;
}
