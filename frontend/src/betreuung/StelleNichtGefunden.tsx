import { SeitenNichtGefunden } from '../components/SeitenZustand';
import { betreuungPfad } from '../routing/deeplinks';

/**
 * Die Betreuungsstelle gibt es nicht (mehr): unlesbare Kennung in der Adresse, unbekannt, fremd
 * oder storniert (die Übersicht trägt sie nicht). Das Muster aus `SeitenNichtGefunden` (LLH-1827,
 * Change `a12ms7g9-seitenzustaende`, D4) statt einer stillen Weiterleitung auf die Übersicht; die
 * Adresse bleibt stehen. Für die Seite der Stelle und „Unterkunft planen“.
 */
export default function StelleNichtGefunden({ einsatzId }: { einsatzId: number }) {
  return (
    <SeitenNichtGefunden
      titel="Diese Betreuungsstelle gibt es nicht (mehr)"
      rueckweg={{ label: 'Zur Betreuung', pfad: betreuungPfad(einsatzId) }}
    />
  );
}
