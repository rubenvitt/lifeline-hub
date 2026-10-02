/**
 * Icon je Wetterlage der aktuellen Bedingungen (LFH-864, design.md D5). Ein Eintrag je Wert
 * von `WetterSymbol` — der Typ macht die Tabelle vollständig, ein neuer Wert ohne Icon bricht
 * `tsc`. Das Icon trägt nie allein Bedeutung: das Wort (`wetterSymbolWort`) steht daneben.
 *
 * Schnee ist die Wolke mit Schnee, nicht die Schneeflocke: alle Niederschlags-Icons haben die
 * Wolke als Basis; die Schneeflocke bleibt für Glätte- und Frostwarnungen der Fachebene.
 */
import type { WetterSymbol } from '../api/types';
import {
  IconGewitterwolke,
  IconHagel,
  IconMond,
  IconNebel,
  IconNebelNacht,
  IconRegen,
  IconSchneeregen,
  IconSchneewolke,
  IconSonne,
  IconTeilsBewoelktNacht,
  IconTeilsBewoelktTag,
  IconWind,
  IconWolke,
  type Icon,
} from '../icons';

const ICON: Record<WetterSymbol, Icon> = {
  klar_tag: IconSonne,
  klar_nacht: IconMond,
  teils_bewoelkt_tag: IconTeilsBewoelktTag,
  teils_bewoelkt_nacht: IconTeilsBewoelktNacht,
  bewoelkt: IconWolke,
  nebel_tag: IconNebel,
  nebel_nacht: IconNebelNacht,
  wind: IconWind,
  regen: IconRegen,
  schneeregen: IconSchneeregen,
  schnee: IconSchneewolke,
  hagel: IconHagel,
  gewitter: IconGewitterwolke,
};

/** Icon der Wetterlage; ohne (unbekannte) Wetterlage `null`. Rein. */
export function wetterSymbolIcon(s: WetterSymbol | null | undefined): Icon | null {
  return s ? ICON[s] : null;
}
