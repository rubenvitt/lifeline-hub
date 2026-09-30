import { useRollen } from '../../components/instrument';
import { rollenFarbe } from '../../theme/statusFarben';
import type { KlassenEintrag } from './fachebenen';

/** Randbreite des Punkts — wie `circle-stroke-width` der Fachebenen-Kreise (`fachebenenLayer.ts`). */
const RAND = 1.5;

/**
 * Mini-Legende einer Fachebene mit Klassenfarben (LFH-592): je Klasse der Punkt, wie die Karte ihn
 * zeichnet (Rollenfarbe, Durchmesser, weißer Rand), und das Wort daneben — die Farbe ist nie der
 * einzige Kanal. Steht im Panel an der Stelle des Ebenenpunkts, den die Karte bei diesen Ebenen
 * nirgends zeichnet.
 *
 * Gelesen, nicht gebaut: Wort und Rolle aus dem Vertrag (`theme/statusFarben.ts`), Farbe über
 * `rollenFarbe` aus demselben Token wie die Einfärbung (`useFachebenen`), Durchmesser aus dem
 * Stilmodul der Ebene. Einträge umbrechen als Punkt-Wort-Paare, damit vier bis sieben Klassen das
 * knappe Panel unter `lg` nicht mit je einer Zeile füllen. Kein Bedienziel, also kein Dichte-Boden.
 */
export default function Klassenlegende({
  bezeichnung,
  eintraege,
}: {
  /** Name der Ebene — für den zugänglichen Namen der Liste. */
  bezeichnung: string;
  eintraege: readonly KlassenEintrag[];
}) {
  const { token, rollen } = useRollen();
  // Ein Feld je Punkt in der Breite des größten: die Wörter stehen dann bündig hinter dem Punkt.
  const feld = 2 * Math.max(...eintraege.map((e) => e.radius)) + 2 * RAND;

  return (
    <ul
      aria-label={`Legende: ${bezeichnung}`}
      data-lfh="fachebenen-legende"
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'flex',
        flexWrap: 'wrap',
        columnGap: token.marginSM,
        rowGap: token.marginXXS,
        fontSize: 11,
        color: rollen.text2,
      }}
    >
      {eintraege.map((e) => (
        <li
          key={e.schluessel}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: token.marginXXS,
            whiteSpace: 'nowrap',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: feld,
              height: feld,
              flex: `0 0 ${feld}px`,
            }}
          >
            <span
              data-rolle={e.darstellung.rolle}
              style={{
                // Wie der Kartenkreis: der Rand liegt außerhalb des Radius.
                boxSizing: 'content-box',
                width: 2 * e.radius,
                height: 2 * e.radius,
                borderRadius: '50%',
                background: rollenFarbe(e.darstellung.rolle, token),
                border: `${RAND}px solid ${token.colorWhite}`,
              }}
            />
          </span>
          {e.darstellung.label}
        </li>
      ))}
    </ul>
  );
}
