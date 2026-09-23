// frontend/src/command-palette/Vorschau.tsx
import PersonVorschau from '../personen/PersonVorschau';
import type { VorschauZiel } from './typen';

/**
 * Der Inhalt der Palettenvorschau (LFH-645, Taste →) — je Sorte das Lese-Bauteil, das auch
 * ausserhalb der Palette steht. Die Palette selbst kennt keine Sorte; sie rendert, was hier
 * herauskommt, in ihrer Vorschau-Region.
 *
 * EXHAUSTIV über `art`: der `never`-Zweig bricht den Typcheck, sobald `VorschauZiel` eine
 * Sorte bekommt, die hier keinen Zweig hat. Ohne ihn fiele eine neue Sorte still auf
 * `undefined` — die Palette zeigte eine leere Vorschau, und kein Test sähe es.
 */
export function Vorschau({ ziel }: { ziel: VorschauZiel }) {
  switch (ziel.art) {
    case 'person':
      return <PersonVorschau einsatzId={ziel.einsatzId} personId={ziel.id} />;
    default: {
      const unbekannt: never = ziel.art;
      return unbekannt;
    }
  }
}
