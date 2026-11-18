import { Button } from 'antd';

/**
 * Wortlaut des Filterknopfs: „Filter“ ohne Wahl, sonst „Filter (n)“ — wie im ETB (LFH-955). Rein.
 */
export function filterKnopfText(zahl: number): string {
  return zahl > 0 ? `Filter (${zahl})` : 'Filter';
}

/**
 * Der Knopf „Filter (n)“ im Seitenkopf am Handschirm (LLH-1786, Change
 * `z137bgm5-seitenkopf-einzeilig` D5, Spec `einsatztauglichkeit-layout`, „Filter und Ansichtswahl
 * am Handschirm hinter einem Knopf“): Ansichtswahl und Filter einer Liste stehen unter `md` erst
 * nach dem Antippen unter dem Seitenkopf, damit die erste Zeile oben im Fenster steht. `zahl`
 * zählt die Wahlen abseits der Vorgabe, auch die verborgenen der `Datensicht` (`onFilterZahl`).
 * Ab `md` rendert die Seite den Knopf nicht, die Wahl steht dort sichtbar.
 */
export default function FilterKnopf({
  offen,
  onWechsel,
  zahl,
  steuert,
}: {
  offen: boolean;
  onWechsel: (offen: boolean) => void;
  zahl: number;
  /** `id` der Wahlfläche, die der Knopf auf- und zuklappt (`aria-controls`). */
  steuert: string;
}) {
  return (
    <Button aria-expanded={offen} aria-controls={steuert} onClick={() => onWechsel(!offen)}>
      {filterKnopfText(zahl)}
    </Button>
  );
}
