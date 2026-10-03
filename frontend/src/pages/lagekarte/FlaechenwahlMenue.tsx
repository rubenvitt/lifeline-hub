/**
 * Auswahlmenü für übereinanderliegende Flächen der Lagekarte (LFH-812). Liegen am Tipppunkt zwei
 * oder mehr Flächen (`entscheideKlickziel` → `mehrdeutig`), wählt der Mensch hier selbst.
 *
 * Die Mechanik (Portal, `autoFocus`, Punktanker, Schließen nur über `onOpenChange`, Fokus zurück an
 * die Karte, Eintragshöhe der Dichtestufe) trägt die gemeinsame Schale `PunktankerMenue` (LFH-776).
 */
import PunktankerMenue from './PunktankerMenue';

export interface Flaechenwahl {
  /** Tipppunkt in Pixeln relativ zum Kartencontainer. */
  x: number;
  y: number;
  eintraege: { schluessel: string; text: string }[];
}

interface Props {
  wahl: Flaechenwahl | null;
  onWaehlen: (schluessel: string) => void;
  onSchliessen: () => void;
  /** Wohin der Fokus beim Schließen zurückgeht (die Karte). */
  fokusZiel?: () => HTMLElement | null;
}

export default function FlaechenwahlMenue({ wahl, onWaehlen, onSchliessen, fokusZiel }: Props) {
  return (
    <PunktankerMenue
      anker={wahl && { x: wahl.x, y: wahl.y }}
      ariaLabel="Fläche wählen"
      ankerKennung="flaechenwahl-anker"
      items={(wahl?.eintraege ?? []).map((e) => ({ key: e.schluessel, label: e.text }))}
      onWaehlen={onWaehlen}
      onSchliessen={onSchliessen}
      fokusZiel={fokusZiel}
    />
  );
}
