// Präzedenz `components/SeitenZustand.tsx`: die Sprachbausteine werden dort eingebunden,
// wo sie gebraucht werden, nicht global. Alle Regeln hängen an `.lfh-*` — die Datei färbt
// nichts ein, was sie nicht selbst anfasst.
import '../theme/sprache.css';
import { verteilungFelder } from './statusAchse';
import type { StatusVerteilung } from './kraeftebild';

/**
 * Zählzeile einer Statusverteilung als ZWEI eigene Spalten des Meldebilds (LFH-330 · B2).
 *
 * Vorher standen Personal und Fahrzeuge zusammen in EINER 220-px-Statusspalte: bis zu acht
 * `Tag` in einem `Space` ohne `wrap`, zwei Emoji als einzige Unterscheidung der Achsen, und
 * Werte gleich 0 wurden weggelassen — zwei Zeilen einer Vergleichstabelle fluchteten damit
 * nicht mehr übereinander (Prüflisten-Kriterium 14).
 *
 * ── DER ZWEITE KANAL, und warum die naheliegende Lösung nicht reicht ────────────
 *
 * `.lfh-feld--alarm .lfh-zahl` färbt nur die ZAHL. Farbe allein trägt keine Bedeutung
 * (WCAG 1.4.1, Kriterium 6), also ist jedes Feld ein VERBUND aus `.lfh-etikett` (Kurztext,
 * immer sichtbar) und `.lfh-zahl`. Der Text trägt die Bedeutung, die Farbe die Dringlichkeit —
 * und `normal`/`neutral` haben gar keine Farbregel, was genau richtig ist.
 *
 * ── DAS EMOJI IST ZIERDE ────────────────────────────────────────────────────────
 *
 * Es trägt `aria-hidden`, die Zählgruppe trägt das Etikett. Beides gleichzeitig ist kein
 * Widerspruch: es sind zwei Knoten, und der bedeutungstragende ist die Gruppe. Wäre es
 * umgekehrt, hinge die Unterscheidung Personal/Fahrzeuge an einem Bild.
 *
 * ── NICHT `.lfh-felder` ─────────────────────────────────────────────────────────
 *
 * Der Werteblock des Lage-Dashboards ist ein vierspaltiges Raster mit Rahmen. In einer
 * Tabellenzelle ist das falsch, deshalb `.lfh-ampel` — dieselben Felder, ohne Raster, ohne
 * Rahmen, mit engerer Polsterung. Die Klasse ist ADDITIV zu `sprache.css`; die bestehenden
 * Regeln sind nicht angetastet.
 */
export default function AmpelZelle({
  bezeichnung,
  symbol,
  verteilung,
}: {
  /** Zugängliche Bezeichnung der Zählgruppe — dieselbe Zeichenkette wie der Spaltenkopf. */
  bezeichnung: 'Personal' | 'Fahrzeuge';
  symbol: string;
  verteilung: StatusVerteilung | null;
}) {
  const felder = verteilungFelder(verteilung);
  // `mittel`-Zeilen tragen keine Verteilung: dann steht hier nichts, nicht „0 0 0 0".
  if (felder.length === 0) return null;
  return (
    <span className="lfh-ampel" role="group" aria-label={bezeichnung}>
      <span aria-hidden="true">{symbol}</span>
      {felder.map((f) => (
        <span
          key={f.etikett}
          className={f.stufe ? `lfh-feld lfh-feld--${f.stufe}` : 'lfh-feld'}
          title={f.titel}
        >
          <span className="lfh-etikett">{f.etikett}</span>
          <b className="lfh-zahl lfh-zahl--mittel">{f.wert}</b>
        </span>
      ))}
    </span>
  );
}
